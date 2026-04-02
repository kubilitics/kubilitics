package diff

import (
	"testing"
	"time"
)

func TestInMemorySnapshotStore_SaveAndGet(t *testing.T) {
	store := NewInMemorySnapshotStore()

	snap := TopologySnapshot{
		ID:        "snap-1",
		ClusterID: "cluster-1",
		Namespace: "",
		Nodes:     []SnapshotNode{{ID: "n1", Name: "nginx", Kind: "Deployment", Namespace: "default"}},
		Edges:     []SnapshotEdge{{Source: "n1", Target: "n2", Type: "selects", Weight: 1.0}},
		Metadata:  SnapshotMetadata{TotalNodes: 1, TotalEdges: 1},
		CreatedAt: time.Now(),
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
}

func TestInMemorySnapshotStore_SaveDuplicate(t *testing.T) {
	store := NewInMemorySnapshotStore()

	snap := TopologySnapshot{
		ID:        "snap-1",
		ClusterID: "cluster-1",
		CreatedAt: time.Now(),
	}

	if err := store.Save(snap); err != nil {
		t.Fatalf("first Save failed: %v", err)
	}
	if err := store.Save(snap); err == nil {
		t.Error("expected error on duplicate Save, got nil")
	}
}

func TestInMemorySnapshotStore_GetNotFound(t *testing.T) {
	store := NewInMemorySnapshotStore()

	_, err := store.Get("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent snapshot, got nil")
	}
}

func TestInMemorySnapshotStore_GetLatest(t *testing.T) {
	store := NewInMemorySnapshotStore()

	now := time.Now()
	snaps := []TopologySnapshot{
		{ID: "snap-1", ClusterID: "cluster-1", Namespace: "", CreatedAt: now.Add(-2 * time.Hour)},
		{ID: "snap-2", ClusterID: "cluster-1", Namespace: "", CreatedAt: now.Add(-1 * time.Hour)},
		{ID: "snap-3", ClusterID: "cluster-1", Namespace: "", CreatedAt: now},
		{ID: "snap-4", ClusterID: "cluster-2", Namespace: "", CreatedAt: now.Add(1 * time.Hour)}, // different cluster
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

func TestInMemorySnapshotStore_GetLatestNotFound(t *testing.T) {
	store := NewInMemorySnapshotStore()

	_, err := store.GetLatest("nonexistent", "")
	if err == nil {
		t.Error("expected error for nonexistent cluster, got nil")
	}
}

func TestInMemorySnapshotStore_GetByDateRange(t *testing.T) {
	store := NewInMemorySnapshotStore()

	baseTime := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	snaps := []TopologySnapshot{
		{ID: "snap-1", ClusterID: "cluster-1", Namespace: "", CreatedAt: baseTime},
		{ID: "snap-2", ClusterID: "cluster-1", Namespace: "", CreatedAt: baseTime.Add(24 * time.Hour)},
		{ID: "snap-3", ClusterID: "cluster-1", Namespace: "", CreatedAt: baseTime.Add(48 * time.Hour)},
		{ID: "snap-4", ClusterID: "cluster-1", Namespace: "", CreatedAt: baseTime.Add(72 * time.Hour)},
		{ID: "snap-5", ClusterID: "cluster-1", Namespace: "kube-system", CreatedAt: baseTime.Add(24 * time.Hour)}, // different namespace
	}

	for _, s := range snaps {
		if err := store.Save(s); err != nil {
			t.Fatalf("Save failed: %v", err)
		}
	}

	// Query date range: day 1 to day 3 (inclusive)
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

func TestInMemorySnapshotStore_GetByDateRange_Empty(t *testing.T) {
	store := NewInMemorySnapshotStore()

	results, err := store.GetByDateRange("cluster-1", "", time.Now(), time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("GetByDateRange failed: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}

func TestInMemorySnapshotStore_DeleteOlderThan(t *testing.T) {
	store := NewInMemorySnapshotStore()

	now := time.Now()
	snaps := []TopologySnapshot{
		{ID: "snap-old-1", ClusterID: "cluster-1", Namespace: "", CreatedAt: now.Add(-100 * 24 * time.Hour)},
		{ID: "snap-old-2", ClusterID: "cluster-1", Namespace: "", CreatedAt: now.Add(-95 * 24 * time.Hour)},
		{ID: "snap-recent", ClusterID: "cluster-1", Namespace: "", CreatedAt: now.Add(-1 * time.Hour)},
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

func TestInMemorySnapshotStore_DeleteOlderThan_NoneDeleted(t *testing.T) {
	store := NewInMemorySnapshotStore()

	snap := TopologySnapshot{
		ID:        "snap-recent",
		ClusterID: "cluster-1",
		Namespace: "",
		CreatedAt: time.Now(),
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

func TestInMemorySnapshotStore_NamespaceFiltering(t *testing.T) {
	store := NewInMemorySnapshotStore()

	now := time.Now()
	snaps := []TopologySnapshot{
		{ID: "snap-1", ClusterID: "cluster-1", Namespace: "", CreatedAt: now},
		{ID: "snap-2", ClusterID: "cluster-1", Namespace: "kube-system", CreatedAt: now},
		{ID: "snap-3", ClusterID: "cluster-1", Namespace: "kube-system", CreatedAt: now.Add(time.Hour)},
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
