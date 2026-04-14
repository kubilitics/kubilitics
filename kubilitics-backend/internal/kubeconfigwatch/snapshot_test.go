package kubeconfigwatch

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWriteSnapshot_RoundTrip(t *testing.T) {
	dir := t.TempDir()

	snap := Snapshot{
		Timestamp:    time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC),
		Trigger:      "fsnotify_event",
		WatchedPaths: []string{"/home/user/.kube/config"},
		OrphanIDs:    []string{"id-1"},
		AllClusters: []RedactedCluster{
			{ID: "id-1", Name: "docker-desktop", Context: "docker-desktop",
				KubeconfigPath: "/home/user/.kube/config", Provider: "docker-desktop",
				Source: "kubeconfig", CreatedAt: time.Date(2026, 4, 14, 11, 0, 0, 0, time.UTC),
				UpdatedAt: time.Date(2026, 4, 14, 11, 30, 0, 0, time.UTC)},
		},
	}

	path, err := WriteSnapshot(dir, snap)
	if err != nil {
		t.Fatalf("WriteSnapshot: %v", err)
	}

	// File should be under the snapshot dir with the expected prefix.
	if filepath.Dir(path) != dir {
		// On macOS, /var is symlinked to /private/var, so the written path
		// can have a /private prefix that the original dir doesn't. Use
		// EvalSymlinks on both sides for the comparison.
		gotDir, _ := filepath.EvalSymlinks(filepath.Dir(path))
		wantDir, _ := filepath.EvalSymlinks(dir)
		if gotDir != wantDir {
			t.Errorf("snapshot dir: got %q, want %q", filepath.Dir(path), dir)
		}
	}
	if !strings.HasPrefix(filepath.Base(path), "clusters-pre-sync-") {
		t.Errorf("filename prefix: got %q", filepath.Base(path))
	}
	if !strings.HasSuffix(path, ".json") {
		t.Errorf("filename suffix: got %q", path)
	}

	// Read the file back and verify round-trip.
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var got Snapshot
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.Trigger != "fsnotify_event" {
		t.Errorf("Trigger: got %q, want %q", got.Trigger, "fsnotify_event")
	}
	if len(got.AllClusters) != 1 || got.AllClusters[0].ID != "id-1" {
		t.Errorf("AllClusters: got %+v", got.AllClusters)
	}
}

func TestPruneSnapshots_KeepsNewestN(t *testing.T) {
	dir := t.TempDir()

	// Write 15 snapshots; stagger their mod times so prune can pick the
	// newest reliably. WriteSnapshot uses the snap.Timestamp field for the
	// filename, but PruneSnapshots reads OS mtime — so we need to set mtime
	// explicitly via os.Chtimes after the write.
	var writtenPaths []string
	for i := 0; i < 15; i++ {
		snap := Snapshot{
			Timestamp:    time.Date(2026, 4, 14, 0, i, 0, 0, time.UTC),
			Trigger:      "test",
			WatchedPaths: []string{"/tmp/x"},
		}
		path, err := WriteSnapshot(dir, snap)
		if err != nil {
			t.Fatalf("WriteSnapshot %d: %v", i, err)
		}
		mtime := time.Date(2026, 4, 14, 0, i, 0, 0, time.UTC)
		if err := os.Chtimes(path, mtime, mtime); err != nil {
			t.Fatalf("Chtimes %d: %v", i, err)
		}
		writtenPaths = append(writtenPaths, path)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 15 {
		t.Fatalf("pre-prune count: got %d, want 15", len(entries))
	}

	if err := PruneSnapshots(dir, 10); err != nil {
		t.Fatalf("PruneSnapshots: %v", err)
	}

	entries, err = os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir post-prune: %v", err)
	}
	if len(entries) != 10 {
		t.Errorf("post-prune count: got %d, want 10", len(entries))
	}

	// The 10 remaining should be the 10 newest (minutes 5-14).
	// The oldest surviving snapshot is minute 05; filename uses dashes
	// instead of colons so we check for "T00-05-00".
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	foundOldestSurvivor := false
	for _, n := range names {
		if strings.Contains(n, "T00-05-00") {
			foundOldestSurvivor = true
		}
	}
	if !foundOldestSurvivor {
		t.Errorf("expected minute-05 snapshot to survive, got files: %v", names)
	}
}

func TestPruneSnapshots_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	if err := PruneSnapshots(dir, 10); err != nil {
		t.Fatalf("PruneSnapshots on empty dir: %v", err)
	}
}

func TestPruneSnapshots_FewerThanKeep(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 3; i++ {
		snap := Snapshot{
			Timestamp:    time.Date(2026, 4, 14, 0, i, 0, 0, time.UTC),
			Trigger:      "test",
			WatchedPaths: []string{"/tmp/x"},
		}
		if _, err := WriteSnapshot(dir, snap); err != nil {
			t.Fatalf("WriteSnapshot %d: %v", i, err)
		}
	}
	if err := PruneSnapshots(dir, 10); err != nil {
		t.Fatalf("PruneSnapshots: %v", err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 3 {
		t.Errorf("expected 3 files untouched, got %d", len(entries))
	}
}
