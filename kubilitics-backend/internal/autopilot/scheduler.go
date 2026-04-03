package autopilot

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// DefaultScanInterval is the default time between background autopilot scans.
const DefaultScanInterval = 5 * time.Minute

// Scheduler runs periodic autopilot detection across all registered clusters.
type Scheduler struct {
	registry   *RuleRegistry
	policy     *PolicyEngine
	safetyGate *SafetyGate
	executor   *Executor
	repo       AutoPilotRepository
	engines    map[string]*graph.ClusterGraphEngine
	interval   time.Duration
	stopCh     chan struct{}
	mu         sync.RWMutex
	running    bool
}

// NewScheduler creates a new autopilot scheduler.
func NewScheduler(
	registry *RuleRegistry,
	policy *PolicyEngine,
	safetyGate *SafetyGate,
	executor *Executor,
	repo AutoPilotRepository,
	engines map[string]*graph.ClusterGraphEngine,
	interval time.Duration,
) *Scheduler {
	if interval <= 0 {
		interval = DefaultScanInterval
	}
	return &Scheduler{
		registry:   registry,
		policy:     policy,
		safetyGate: safetyGate,
		executor:   executor,
		repo:       repo,
		engines:    engines,
		interval:   interval,
		stopCh:     make(chan struct{}),
	}
}

// Start begins the background detection loop. It blocks until ctx is cancelled
// or Stop() is called.
func (s *Scheduler) Start(ctx context.Context) {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.stopCh = make(chan struct{})
	s.mu.Unlock()

	slog.Info("autopilot scheduler started", "interval", s.interval)

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("autopilot scheduler stopped (context cancelled)")
			s.mu.Lock()
			s.running = false
			s.mu.Unlock()
			return
		case <-s.stopCh:
			slog.Info("autopilot scheduler stopped")
			s.mu.Lock()
			s.running = false
			s.mu.Unlock()
			return
		case <-ticker.C:
			s.runAll()
		}
	}
}

// Stop signals the scheduler to stop its background loop.
func (s *Scheduler) Stop() {
	s.mu.RLock()
	running := s.running
	s.mu.RUnlock()

	if running {
		close(s.stopCh)
	}
}

// RunOnce performs a single detection pass for a specific cluster.
// This is used for manual trigger (scan endpoint).
func (s *Scheduler) RunOnce(clusterID string) ([]Finding, error) {
	engine, ok := s.engines[clusterID]
	if !ok {
		return nil, nil
	}

	snap := engine.Snapshot()
	if len(snap.Nodes) == 0 {
		return nil, nil
	}

	findings := s.registry.DetectAll(snap)
	s.processFindings(clusterID, snap, findings)
	return findings, nil
}

// runAll iterates over all registered cluster engines and runs detection.
func (s *Scheduler) runAll() {
	for clusterID := range s.engines {
		findings, err := s.RunOnce(clusterID)
		if err != nil {
			slog.Error("autopilot scan failed", "cluster", clusterID, "error", err)
			continue
		}
		slog.Info("autopilot scan completed", "cluster", clusterID, "findings", len(findings))
	}
}

// processFindings evaluates each finding through the policy engine and safety gate,
// then records the resulting action in the repository.
func (s *Scheduler) processFindings(clusterID string, snapshot *graph.GraphSnapshot, findings []Finding) {
	for _, finding := range findings {
		// Get rule config (default to approval mode if not configured)
		ruleCfg := s.getRuleConfig(clusterID, finding.RuleID)

		// Policy decision
		decision := s.policy.Evaluate(finding, ruleCfg)

		var status string
		var safetyDelta float64

		switch decision {
		case PolicyApprove:
			// Run safety gate
			safe, delta, err := s.safetyGate.Check(snapshot, finding)
			safetyDelta = delta
			if err != nil {
				slog.Error("safety gate error", "rule", finding.RuleID, "error", err)
				status = "pending"
			} else if safe {
				// In v1, we don't actually apply — just log as "applied"
				status = "applied"
			} else {
				// Safety gate blocked — defer to human
				status = "pending"
			}

		case PolicyDefer:
			status = "pending"

		case PolicySkip:
			status = "audit"
		}

		// Generate the actual K8s patch
		patch, err := s.executor.GeneratePatch(finding)
		if err != nil {
			slog.Error("patch generation failed", "rule", finding.RuleID, "error", err)
			continue
		}

		now := time.Now()
		action := &ActionRecord{
			ID:              uuid.New().String(),
			ClusterID:       clusterID,
			RuleID:          finding.RuleID,
			Status:          status,
			Severity:        finding.Severity,
			TargetKind:      finding.TargetKind,
			TargetNamespace: finding.TargetNamespace,
			TargetName:      finding.TargetName,
			Description:     finding.Description,
			ActionType:      finding.ActionType,
			ProposedPatch:   patch,
			SafetyDelta:     safetyDelta,
			CreatedAt:       now,
			UpdatedAt:       now,
		}

		if s.repo != nil {
			if err := s.repo.CreateAction(action); err != nil {
				slog.Error("failed to persist action", "rule", finding.RuleID, "error", err)
			}
		}
	}
}

// getRuleConfig retrieves rule config from repo, falling back to sensible defaults.
func (s *Scheduler) getRuleConfig(clusterID, ruleID string) RuleConfig {
	if s.repo != nil {
		cfg, err := s.repo.GetRuleConfig(clusterID, ruleID)
		if err == nil && cfg != nil {
			return *cfg
		}
	}

	// Default config: approval mode, enabled, 30-minute cooldown
	return RuleConfig{
		RuleID:          ruleID,
		Mode:            "approval",
		Enabled:         true,
		CooldownMinutes: 30,
	}
}
