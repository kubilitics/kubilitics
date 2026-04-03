package diff

import (
	"database/sql"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// newTestDB opens an in-memory SQLite database for testing.
func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open in-memory sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestSQLiteSnapshotStore_SaveAndGet(t *testing.T) {
	store, err := NewSQLiteSnapshotStore(newTestDB(t))
	if err != nil {
		t.Fatalf("NewSQLiteSnapshotStore failed: %v", err)
	}

	snap := TopologySnapshot{
		ID:        "snap-1",
		ClusterID: "cluster-1",
		Namespace: "",
		Nodes:     []SnapshotNode{{ID: "n1", Name: "nginx", Kind: "Deployment", Namespace: "default"}},
		Edges:     []SnapshotEdge{{Source: "n1", Target: "n2", Type: "selects", Weight: 1.0}},
		Metadata:  SnapshotMetadata{TotalNodes: 1, TotalEdges: 1},
		CreatedAt: time.Now().UTC().Truncate(time.Second),
	}

	if err := store.Save(snap); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := store.Get("snap-1")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.ID != "snap-1" {
		t.Errorf("expected ID snap-1, got %s", got.ID)
	}
	if got.ClusterID != "cluster-1" {
		t.Errorf("expected ClusterID cluster-1, got %s", got.ClusterID)
	}
	if len(got.Nodes) != 1 {
		t.Errorf("expected 1 node, got %d", len(got.Nodes))
	}
	if got.Nodes[0].Name != "nginx" {
		t.Errorf("expected node name nginx, got %s", got.Nodes[0].Name)
	}
	if len(got.Edges) != 1 {
		t.Errorf("expected 1 edge, got %d", len(got.Edges))
	}
	if got.Edges[0].Weight != 1.0 {
		t.Errorf("expected edge weight 1.0, got %f", got.Edges[0].Weight)
	}
	if got.Metadata.TotalNodes != 1 {
		t.Errorf("expected TotalNodes 1, got %d", got.Metadata.TotalNodes)
	}
}

func TestSQLiteSnapshotStore_SaveDuplicate(t *testing.T) {
	store, err := NewSQLiteSnapshotStore(newTestDB(t))
	if err != nil {
		t.Fatalf("NewSQLiteSnapshotStore failed: %v", err)
	}

	snap := TopologySnapshot{
		ID:        "snap-1",
		ClusterID: "cluster-1",
		CreatedAt: time.Now().UTC(),
	}

	if err := store.Save(snap); err != nil {
		t.Fatalf("first Save failed: %v", err)
	}
	if err := store.Save(snap); err == nil {
		t.Error("expected error on duplicate Save, got nil")
	}
}

func TestSQLiteSnapshotStore_GetNotFound(t *testing.T) {
	store, err := NewSQLiteSnapshotStore(newTestDB(t))
	if err != nil {
		t.Fatalf("NewSQLiteSnapshotStore failed: %v", err)
	}

	_, err = store.Get("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent snapshot, got nil")
	}
}

func TestSQLiteSnapshotStore_GetLatest(t *testing.T) {
	store, err := NewSQLiteSnapshotStore(newTestDB(t))
	if err != nil {
		t.Fatalf("NewSQLiteSnapshotStore failed: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Second)
	snaps := []TopologySnapshot{
		{ID: "snap-1", ClusterID: "cluster-1", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: now.Add(-2 * time.Hour)},
		{ID: "snap-2", ClusterID: "cluster-1", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: now.Add(-1 * time.Hour)},
		{ID: "snap-3", ClusterID: "cluster-1", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: now},
		{ID: "snap-4", ClusterID: "cluster-2", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: now.Add(1 * time.Hour)},
	}

	for _, s := range snaps {
		if err := store.Save(s); err != nil {
			t.Fatalf("Save failed: %v", err)
		}
	}

	latest, err := store.GetLatest("cluster-1", "")
	if err != nil {
		t.Fatalf("GetLatest failed: %v", err)
	}
	if latest.ID != "snap-3" {
		t.Errorf("expected latest snap-3, got %s", latest.ID)
	}
}

func TestSQLiteSnapshotStore_GetLatestNotFound(t *testing.T) {
	store, err := NewSQLiteSnapshotStore(newTestDB(t))
	if err != nil {
		t.Fatalf("NewSQLiteSnapshotStore failed: %v", err)
	}

	_, err = store.GetLatest("nonexistent", "")
	if err == nil {
		t.Error("expected error for nonexistent cluster, got nil")
	}
}

func TestSQLiteSnapshotStore_GetByDateRange(t *testing.T) {
	store, err := NewSQLiteSnapshotStore(newTestDB(t))
	if err != nil {
		t.Fatalf("NewSQLiteSnapshotStore failed: %v", err)
	}

	baseTime := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	snaps := []TopologySnapshot{
		{ID: "snap-1", ClusterID: "cluster-1", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: baseTime},
		{ID: "snap-2", ClusterID: "cluster-1", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: baseTime.Add(24 * time.Hour)},
		{ID: "snap-3", ClusterID: "cluster-1", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: baseTime.Add(48 * time.Hour)},
		{ID: "snap-4", ClusterID: "cluster-1", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: baseTime.Add(72 * time.Hour)},
		{ID: "snap-5", ClusterID: "cluster-1", Namespace: "kube-system", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: baseTime.Add(24 * time.Hour)},
	}

	for _, s := range snaps {
		if err := store.Save(s); err != nil {
			t.Fatalf("Save failed: %v", err)
		}
	}

	// Query day 1 to day 3 (inclusive)
	from := baseTime
	to := baseTime.Add(48 * time.Hour)

	results, err := store.GetByDateRange("cluster-1", "", from, to)
	if err != nil {
		t.Fatalf("GetByDateRange failed: %v", err)
	}

	if len(results) != 3 {
		t.Fatalf("expected 3 snapshots in range, got %d", len(results))
	}

	// Verify ordering (ascending by time)
	if results[0].ID != "snap-1" || results[1].ID != "snap-2" || results[2].ID != "snap-3" {
		t.Errorf("unexpected ordering: %s, %s, %s", results[0].ID, results[1].ID, results[2].ID)
	}
}

func TestSQLiteSnapshotStore_GetByDateRange_Empty(t *testing.T) {
	store, err := NewSQLiteSnapshotStore(newTestDB(t))
	if err != nil {
		t.Fatalf("NewSQLiteSnapshotStore failed: %v", err)
	}

	results, err := store.GetByDateRange("cluster-1", "", time.Now().UTC(), time.Now().UTC().Add(time.Hour))
	if err != nil {
		t.Fatalf("GetByDateRange failed: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}

func TestSQLiteSnapshotStore_DeleteOlderThan(t *testing.T) {
	store, err := NewSQLiteSnapshotStore(newTestDB(t))
	if err != nil {
		t.Fatalf("NewSQLiteSnapshotStore failed: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Second)
	snaps := []TopologySnapshot{
		{ID: "snap-old-1", ClusterID: "cluster-1", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: now.Add(-100 * 24 * time.Hour)},
		{ID: "snap-old-2", ClusterID: "cluster-1", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: now.Add(-95 * 24 * time.Hour)},
		{ID: "snap-recent", ClusterID: "cluster-1", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: now.Add(-1 * time.Hour)},
	}

	for _, s := range snaps {
		if err := store.Save(s); err != nil {
			t.Fatalf("Save failed: %v", err)
		}
	}

	deleted, err := store.DeleteOlderThan(DefaultRetention)
	if err != nil {
		t.Fatalf("DeleteOlderThan failed: %v", err)
	}
	if deleted != 2 {
		t.Errorf("expected 2 deleted, got %d", deleted)
	}

	// Verify old snapshots are gone
	_, err = store.Get("snap-old-1")
	if err == nil {
		t.Error("expected snap-old-1 to be deleted")
	}
	_, err = store.Get("snap-old-2")
	if err == nil {
		t.Error("expected snap-old-2 to be deleted")
	}

	// Verify recent snapshot still exists
	got, err := store.Get("snap-recent")
	if err != nil {
		t.Fatalf("snap-recent should still exist: %v", err)
	}
	if got.ID != "snap-recent" {
		t.Errorf("expected snap-recent, got %s", got.ID)
	}
}

func TestSQLiteSnapshotStore_DeleteOlderThan_NoneDeleted(t *testing.T) {
	store, err := NewSQLiteSnapshotStore(newTestDB(t))
	if err != nil {
		t.Fatalf("NewSQLiteSnapshotStore failed: %v", err)
	}

	snap := TopologySnapshot{
		ID:        "snap-recent",
		ClusterID: "cluster-1",
		Namespace: "",
		Nodes:     []SnapshotNode{},
		Edges:     []SnapshotEdge{},
		CreatedAt: time.Now().UTC(),
	}
	if err := store.Save(snap); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	deleted, err := store.DeleteOlderThan(DefaultRetention)
	if err != nil {
		t.Fatalf("DeleteOlderThan failed: %v", err)
	}
	if deleted != 0 {
		t.Errorf("expected 0 deleted, got %d", deleted)
	}
}

func TestSQLiteSnapshotStore_NamespaceFiltering(t *testing.T) {
	store, err := NewSQLiteSnapshotStore(newTestDB(t))
	if err != nil {
		t.Fatalf("NewSQLiteSnapshotStore failed: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Second)
	snaps := []TopologySnapshot{
		{ID: "snap-1", ClusterID: "cluster-1", Namespace: "", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: now},
		{ID: "snap-2", ClusterID: "cluster-1", Namespace: "kube-system", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: now},
		{ID: "snap-3", ClusterID: "cluster-1", Namespace: "kube-system", Nodes: []SnapshotNode{}, Edges: []SnapshotEdge{}, CreatedAt: now.Add(time.Hour)},
	}

	for _, s := range snaps {
		if err := store.Save(s); err != nil {
			t.Fatalf("Save failed: %v", err)
		}
	}

	// GetLatest for kube-system
	latest, err := store.GetLatest("cluster-1", "kube-system")
	if err != nil {
		t.Fatalf("GetLatest failed: %v", err)
	}
	if latest.ID != "snap-3" {
		t.Errorf("expected snap-3, got %s", latest.ID)
	}

	// GetLatest for cluster-wide
	latest, err = store.GetLatest("cluster-1", "")
	if err != nil {
		t.Fatalf("GetLatest failed: %v", err)
	}
	if latest.ID != "snap-1" {
		t.Errorf("expected snap-1, got %s", latest.ID)
	}
}
