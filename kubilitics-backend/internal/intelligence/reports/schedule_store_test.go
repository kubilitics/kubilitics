package reports

import (
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"
)

func newTestStore(t *testing.T) *SQLiteScheduleStore {
	t.Helper()
	db, err := sqlx.Open("sqlite", ":memory:")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	store, err := NewSQLiteScheduleStore(db)
	require.NoError(t, err)
	return store
}

func sampleSchedule() *Schedule {
	now := time.Now().UTC().Truncate(time.Second)
	return &Schedule{
		ID:          "sched-001",
		ClusterID:   "cluster-1",
		Frequency:   "weekly",
		Format:      "json",
		WebhookURL:  "https://hooks.slack.com/test",
		WebhookType: "slack",
		NextRun:     now.Add(7 * 24 * time.Hour),
		CreatedAt:   now,
		Enabled:     true,
	}
}

func TestStore_SaveAndGet(t *testing.T) {
	store := newTestStore(t)
	orig := sampleSchedule()

	require.NoError(t, store.Save(orig))

	got, err := store.Get(orig.ID)
	require.NoError(t, err)
	assert.Equal(t, orig.ID, got.ID)
	assert.Equal(t, orig.ClusterID, got.ClusterID)
	assert.Equal(t, orig.Frequency, got.Frequency)
	assert.Equal(t, orig.Format, got.Format)
	assert.Equal(t, orig.WebhookURL, got.WebhookURL)
	assert.Equal(t, orig.WebhookType, got.WebhookType)
	assert.True(t, got.Enabled)
	assert.True(t, got.LastRun.IsZero(), "LastRun should be zero when never run")
}

func TestStore_Get_NotFound(t *testing.T) {
	store := newTestStore(t)
	_, err := store.Get("nonexistent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "schedule not found")
}

func TestStore_List(t *testing.T) {
	store := newTestStore(t)

	s1 := sampleSchedule()
	s1.ID = "s1"
	s1.ClusterID = "c1"
	s2 := sampleSchedule()
	s2.ID = "s2"
	s2.ClusterID = "c1"
	s3 := sampleSchedule()
	s3.ID = "s3"
	s3.ClusterID = "c2"

	require.NoError(t, store.Save(s1))
	require.NoError(t, store.Save(s2))
	require.NoError(t, store.Save(s3))

	// List all
	all, err := store.List("")
	require.NoError(t, err)
	assert.Len(t, all, 3)

	// List by cluster
	c1, err := store.List("c1")
	require.NoError(t, err)
	assert.Len(t, c1, 2)

	c2, err := store.List("c2")
	require.NoError(t, err)
	assert.Len(t, c2, 1)

	// Empty result
	empty, err := store.List("c99")
	require.NoError(t, err)
	assert.Len(t, empty, 0)
}

func TestStore_Update(t *testing.T) {
	store := newTestStore(t)
	orig := sampleSchedule()
	require.NoError(t, store.Save(orig))

	orig.Frequency = "monthly"
	orig.WebhookURL = "https://updated"
	orig.Enabled = false
	require.NoError(t, store.Update(orig.ID, orig))

	got, err := store.Get(orig.ID)
	require.NoError(t, err)
	assert.Equal(t, "monthly", got.Frequency)
	assert.Equal(t, "https://updated", got.WebhookURL)
	assert.False(t, got.Enabled)
}

func TestStore_Update_NotFound(t *testing.T) {
	store := newTestStore(t)
	err := store.Update("nonexistent", sampleSchedule())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "schedule not found")
}

func TestStore_Delete(t *testing.T) {
	store := newTestStore(t)
	orig := sampleSchedule()
	require.NoError(t, store.Save(orig))

	require.NoError(t, store.Delete(orig.ID))

	_, err := store.Get(orig.ID)
	assert.Error(t, err)
}

func TestStore_Delete_NotFound(t *testing.T) {
	store := newTestStore(t)
	err := store.Delete("nonexistent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "schedule not found")
}

func TestStore_ListDue(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UTC().Truncate(time.Second)

	// Due schedule (next_run in the past, enabled).
	s1 := sampleSchedule()
	s1.ID = "due-1"
	s1.NextRun = now.Add(-1 * time.Hour)
	s1.Enabled = true

	// Not due (next_run in the future, enabled).
	s2 := sampleSchedule()
	s2.ID = "future-1"
	s2.NextRun = now.Add(24 * time.Hour)
	s2.Enabled = true

	// Due but disabled.
	s3 := sampleSchedule()
	s3.ID = "disabled-1"
	s3.NextRun = now.Add(-1 * time.Hour)
	s3.Enabled = false

	require.NoError(t, store.Save(s1))
	require.NoError(t, store.Save(s2))
	require.NoError(t, store.Save(s3))

	due, err := store.ListDue(now)
	require.NoError(t, err)
	require.Len(t, due, 1)
	assert.Equal(t, "due-1", due[0].ID)
}

func TestStore_SaveAndGet_WithLastRun(t *testing.T) {
	store := newTestStore(t)
	now := time.Now().UTC().Truncate(time.Second)

	orig := sampleSchedule()
	orig.LastRun = now.Add(-1 * time.Hour)
	orig.LastStatus = "success"

	require.NoError(t, store.Save(orig))

	got, err := store.Get(orig.ID)
	require.NoError(t, err)
	assert.False(t, got.LastRun.IsZero())
	assert.Equal(t, "success", got.LastStatus)
}

func TestStore_TableCreatedIdempotent(t *testing.T) {
	db, err := sqlx.Open("sqlite", ":memory:")
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	// Creating twice should not error.
	_, err = NewSQLiteScheduleStore(db)
	require.NoError(t, err)
	_, err = NewSQLiteScheduleStore(db)
	require.NoError(t, err)
}
