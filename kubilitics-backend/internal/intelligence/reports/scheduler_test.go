package reports

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScheduler_Create(t *testing.T) {
	s := NewScheduler()

	sched, err := s.Create(Schedule{
		ClusterID:   "cluster-1",
		Frequency:   "weekly",
		WebhookURL:  "https://hooks.slack.com/test",
		WebhookType: "slack",
		Enabled:     true,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, sched.ID)
	assert.Equal(t, "cluster-1", sched.ClusterID)
	assert.Equal(t, "weekly", sched.Frequency)
	assert.Equal(t, "json", sched.Format)
	assert.True(t, sched.Enabled)
	assert.False(t, sched.NextRun.IsZero())
	assert.False(t, sched.CreatedAt.IsZero())
}

func TestScheduler_Create_ValidationErrors(t *testing.T) {
	s := NewScheduler()

	tests := []struct {
		name     string
		schedule Schedule
		errMsg   string
	}{
		{
			name:     "missing cluster_id",
			schedule: Schedule{Frequency: "weekly", WebhookURL: "https://x", WebhookType: "slack"},
			errMsg:   "cluster_id is required",
		},
		{
			name:     "invalid frequency",
			schedule: Schedule{ClusterID: "c1", Frequency: "daily", WebhookURL: "https://x", WebhookType: "slack"},
			errMsg:   "frequency must be weekly, biweekly, or monthly",
		},
		{
			name:     "missing webhook_url",
			schedule: Schedule{ClusterID: "c1", Frequency: "weekly", WebhookType: "slack"},
			errMsg:   "webhook_url is required",
		},
		{
			name:     "invalid webhook_type",
			schedule: Schedule{ClusterID: "c1", Frequency: "weekly", WebhookURL: "https://x", WebhookType: "discord"},
			errMsg:   "webhook_type must be slack, teams, or generic",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := s.Create(tc.schedule)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.errMsg)
		})
	}
}

func TestScheduler_Get(t *testing.T) {
	s := NewScheduler()

	created, err := s.Create(Schedule{
		ClusterID: "c1", Frequency: "weekly",
		WebhookURL: "https://x", WebhookType: "slack",
	})
	require.NoError(t, err)

	got, err := s.Get(created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.ID, got.ID)

	_, err = s.Get("nonexistent")
	assert.Error(t, err)
}

func TestScheduler_List(t *testing.T) {
	s := NewScheduler()

	_, err := s.Create(Schedule{ClusterID: "c1", Frequency: "weekly", WebhookURL: "https://x", WebhookType: "slack"})
	require.NoError(t, err)
	_, err = s.Create(Schedule{ClusterID: "c1", Frequency: "monthly", WebhookURL: "https://y", WebhookType: "teams"})
	require.NoError(t, err)
	_, err = s.Create(Schedule{ClusterID: "c2", Frequency: "biweekly", WebhookURL: "https://z", WebhookType: "generic"})
	require.NoError(t, err)

	all, err := s.List("")
	require.NoError(t, err)
	assert.Len(t, all, 3)

	c1, err := s.List("c1")
	require.NoError(t, err)
	assert.Len(t, c1, 2)

	c2, err := s.List("c2")
	require.NoError(t, err)
	assert.Len(t, c2, 1)

	empty, err := s.List("c99")
	require.NoError(t, err)
	assert.Len(t, empty, 0)
}

func TestScheduler_Update(t *testing.T) {
	s := NewScheduler()

	created, err := s.Create(Schedule{
		ClusterID: "c1", Frequency: "weekly",
		WebhookURL: "https://x", WebhookType: "slack", Enabled: true,
	})
	require.NoError(t, err)

	newFreq := "monthly"
	newURL := "https://updated"
	disabled := false

	updated, err := s.Update(created.ID, ScheduleUpdate{
		Frequency:  &newFreq,
		WebhookURL: &newURL,
		Enabled:    &disabled,
	})
	require.NoError(t, err)
	assert.Equal(t, "monthly", updated.Frequency)
	assert.Equal(t, "https://updated", updated.WebhookURL)
	assert.False(t, updated.Enabled)

	// Verify invalid frequency on update.
	badFreq := "hourly"
	_, err = s.Update(created.ID, ScheduleUpdate{Frequency: &badFreq})
	assert.Error(t, err)

	// Verify not found.
	_, err = s.Update("nonexistent", ScheduleUpdate{Enabled: &disabled})
	assert.Error(t, err)
}

func TestScheduler_Delete(t *testing.T) {
	s := NewScheduler()

	created, err := s.Create(Schedule{
		ClusterID: "c1", Frequency: "weekly",
		WebhookURL: "https://x", WebhookType: "slack",
	})
	require.NoError(t, err)

	err = s.Delete(created.ID)
	require.NoError(t, err)

	_, err = s.Get(created.ID)
	assert.Error(t, err)

	err = s.Delete("nonexistent")
	assert.Error(t, err)
}

func TestComputeNextRun(t *testing.T) {
	base := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		frequency string
		expected  time.Time
	}{
		{"weekly", base.Add(7 * 24 * time.Hour)},
		{"biweekly", base.Add(14 * 24 * time.Hour)},
		{"monthly", base.Add(30 * 24 * time.Hour)},
	}

	for _, tc := range tests {
		t.Run(tc.frequency, func(t *testing.T) {
			result := computeNextRun(base, tc.frequency)
			assert.Equal(t, tc.expected, result)
		})
	}
}

func TestScheduler_TickDetectsDueSchedules(t *testing.T) {
	s := NewScheduler()

	// Create a schedule that is immediately due (NextRun in the past).
	sched, err := s.Create(Schedule{
		ClusterID: "c1", Frequency: "weekly",
		WebhookURL: "https://x", WebhookType: "generic", Enabled: true,
	})
	require.NoError(t, err)

	// Manually set NextRun to the past.
	s.mu.Lock()
	s.schedules[sched.ID].NextRun = time.Now().UTC().Add(-1 * time.Hour)
	s.mu.Unlock()

	called := false
	reportFn := func(clusterID string) (*ResilienceReport, error) {
		called = true
		return &ResilienceReport{
			ClusterID:   clusterID,
			ClusterName: "test-cluster",
			HealthScore: 85,
			HealthLabel: "Healthy",
		}, nil
	}

	// We can't easily test actual HTTP delivery in a unit test, so we test
	// that tick finds due schedules. The delivery would fail (no server),
	// but the report generation callback is invoked.
	// For a complete test, see delivery_test.go with httptest.
	s.tick(reportFn)

	// The report function should have been called since the schedule was due.
	assert.True(t, called)
}

func TestScheduler_TickSkipsDisabledSchedules(t *testing.T) {
	s := NewScheduler()

	sched, err := s.Create(Schedule{
		ClusterID: "c1", Frequency: "weekly",
		WebhookURL: "https://x", WebhookType: "generic", Enabled: false,
	})
	require.NoError(t, err)

	// Set NextRun to the past, but schedule is disabled.
	s.mu.Lock()
	s.schedules[sched.ID].NextRun = time.Now().UTC().Add(-1 * time.Hour)
	s.mu.Unlock()

	called := false
	reportFn := func(clusterID string) (*ResilienceReport, error) {
		called = true
		return &ResilienceReport{}, nil
	}

	s.tick(reportFn)
	assert.False(t, called, "disabled schedule should not be executed")
}

func TestScheduler_TickSkipsFutureSchedules(t *testing.T) {
	s := NewScheduler()

	_, err := s.Create(Schedule{
		ClusterID: "c1", Frequency: "weekly",
		WebhookURL: "https://x", WebhookType: "generic", Enabled: true,
	})
	require.NoError(t, err)
	// NextRun is ~7 days in the future from Create, so tick should not execute.

	called := false
	reportFn := func(clusterID string) (*ResilienceReport, error) {
		called = true
		return &ResilienceReport{}, nil
	}

	s.tick(reportFn)
	assert.False(t, called, "future schedule should not be executed")
}
