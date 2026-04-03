package reports

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ReportFunc generates a resilience report for the given cluster.
type ReportFunc func(clusterID string) (*ResilienceReport, error)

// Schedule defines a recurring report schedule.
type Schedule struct {
	ID          string    `json:"id"`
	ClusterID   string    `json:"cluster_id"`
	Frequency   string    `json:"frequency"`              // "weekly", "biweekly", "monthly"
	Format      string    `json:"format"`                 // "json"
	WebhookURL  string    `json:"webhook_url"`            // delivery endpoint
	WebhookType string    `json:"webhook_type"`           // "slack", "teams", "generic"
	NextRun     time.Time `json:"next_run"`
	LastRun     time.Time `json:"last_run,omitempty"`
	LastStatus  string    `json:"last_status,omitempty"`  // "success", "failed"
	CreatedAt   time.Time `json:"created_at"`
	Enabled     bool      `json:"enabled"`
}

// ScheduleUpdate allows partial updates to a schedule.
type ScheduleUpdate struct {
	Frequency   *string `json:"frequency,omitempty"`
	WebhookURL  *string `json:"webhook_url,omitempty"`
	WebhookType *string `json:"webhook_type,omitempty"`
	Enabled     *bool   `json:"enabled,omitempty"`
}

// Scheduler manages recurring report schedules backed by a ScheduleStore.
type Scheduler struct {
	store  ScheduleStore
	mu     sync.Mutex // protects stopCh only
	stopCh chan struct{}
}

// NewScheduler creates a scheduler backed by the given store.
func NewScheduler(store ScheduleStore) *Scheduler {
	return &Scheduler{
		store: store,
	}
}

// validFrequencies restricts allowed frequency values.
var validFrequencies = map[string]bool{
	"weekly":   true,
	"biweekly": true,
	"monthly":  true,
}

// validWebhookTypes restricts allowed webhook types.
var validWebhookTypes = map[string]bool{
	"slack":   true,
	"teams":   true,
	"generic": true,
}

// Create adds a new schedule. It assigns an ID, CreatedAt, and computes NextRun.
func (s *Scheduler) Create(schedule Schedule) (*Schedule, error) {
	if schedule.ClusterID == "" {
		return nil, errors.New("cluster_id is required")
	}
	if !validFrequencies[schedule.Frequency] {
		return nil, errors.New("frequency must be weekly, biweekly, or monthly")
	}
	if schedule.WebhookURL == "" {
		return nil, errors.New("webhook_url is required")
	}
	if !validWebhookTypes[schedule.WebhookType] {
		return nil, errors.New("webhook_type must be slack, teams, or generic")
	}

	now := time.Now().UTC()
	schedule.ID = uuid.New().String()
	schedule.CreatedAt = now
	schedule.Format = "json"
	schedule.NextRun = computeNextRun(now, schedule.Frequency)
	schedule.Enabled = true

	if err := s.store.Save(&schedule); err != nil {
		return nil, err
	}
	return &schedule, nil
}

// Get retrieves a schedule by ID.
func (s *Scheduler) Get(id string) (*Schedule, error) {
	return s.store.Get(id)
}

// List returns all schedules for a given cluster. If clusterID is empty, returns all.
func (s *Scheduler) List(clusterID string) ([]Schedule, error) {
	schedules, err := s.store.List(clusterID)
	if err != nil {
		return nil, err
	}
	result := make([]Schedule, 0, len(schedules))
	for _, sched := range schedules {
		result = append(result, *sched)
	}
	return result, nil
}

// Update applies partial updates to an existing schedule.
func (s *Scheduler) Update(id string, updates ScheduleUpdate) (*Schedule, error) {
	sched, err := s.store.Get(id)
	if err != nil {
		return nil, err
	}

	if updates.Frequency != nil {
		if !validFrequencies[*updates.Frequency] {
			return nil, errors.New("frequency must be weekly, biweekly, or monthly")
		}
		sched.Frequency = *updates.Frequency
		// Recompute next run from now when frequency changes.
		sched.NextRun = computeNextRun(time.Now().UTC(), sched.Frequency)
	}
	if updates.WebhookURL != nil {
		if *updates.WebhookURL == "" {
			return nil, errors.New("webhook_url cannot be empty")
		}
		sched.WebhookURL = *updates.WebhookURL
	}
	if updates.WebhookType != nil {
		if !validWebhookTypes[*updates.WebhookType] {
			return nil, errors.New("webhook_type must be slack, teams, or generic")
		}
		sched.WebhookType = *updates.WebhookType
	}
	if updates.Enabled != nil {
		sched.Enabled = *updates.Enabled
	}

	if err := s.store.Update(id, sched); err != nil {
		return nil, err
	}
	return sched, nil
}

// Delete removes a schedule by ID.
func (s *Scheduler) Delete(id string) error {
	return s.store.Delete(id)
}

// Start runs the background ticker that checks for due schedules every 60 seconds.
// The reportFn callback generates the report; delivery is handled internally.
func (s *Scheduler) Start(ctx context.Context, reportFn ReportFunc) {
	s.mu.Lock()
	s.stopCh = make(chan struct{})
	s.mu.Unlock()
	go s.run(ctx, reportFn)
}

// Stop stops the background scheduler loop.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopCh != nil {
		close(s.stopCh)
	}
}

func (s *Scheduler) run(ctx context.Context, reportFn ReportFunc) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.tick(reportFn)
		}
	}
}

// tick checks all schedules and runs any that are due.
func (s *Scheduler) tick(reportFn ReportFunc) {
	now := time.Now().UTC()
	due, err := s.store.ListDue(now)
	if err != nil {
		slog.Error("failed to list due schedules", "error", err)
		return
	}

	for _, sched := range due {
		s.executeSchedule(sched, reportFn)
	}
}

func (s *Scheduler) executeSchedule(sched *Schedule, reportFn ReportFunc) {
	log := slog.With("schedule_id", sched.ID, "cluster_id", sched.ClusterID)
	log.Info("executing scheduled report")

	report, err := reportFn(sched.ClusterID)
	if err != nil {
		log.Error("report generation failed", "error", err)
		s.updateAfterRun(sched.ID, "failed")
		return
	}

	if err := DeliverWebhook(sched.WebhookURL, sched.WebhookType, report); err != nil {
		log.Error("webhook delivery failed", "error", err)
		s.updateAfterRun(sched.ID, "failed")
		return
	}

	log.Info("scheduled report delivered successfully")
	s.updateAfterRun(sched.ID, "success")
}

func (s *Scheduler) updateAfterRun(id, status string) {
	now := time.Now().UTC()
	sched, err := s.store.Get(id)
	if err != nil {
		slog.Error("failed to get schedule for post-run update", "id", id, "error", err)
		return
	}
	sched.LastRun = now
	sched.LastStatus = status
	sched.NextRun = computeNextRun(now, sched.Frequency)

	if err := s.store.Update(id, sched); err != nil {
		slog.Error("failed to update schedule after run", "id", id, "error", err)
	}
}

// computeNextRun calculates the next run time from the given time.
func computeNextRun(from time.Time, frequency string) time.Time {
	switch frequency {
	case "weekly":
		return from.Add(7 * 24 * time.Hour)
	case "biweekly":
		return from.Add(14 * 24 * time.Hour)
	case "monthly":
		return from.Add(30 * 24 * time.Hour)
	default:
		return from.Add(7 * 24 * time.Hour)
	}
}
