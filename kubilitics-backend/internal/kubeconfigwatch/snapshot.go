package kubeconfigwatch

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// Snapshot is a pre-destructive record of the cluster table state immediately
// before a sync pass that would remove one or more clusters. It is written to
// disk as JSON under ~/.kubilitics/snapshots/clusters-pre-sync-<ISO8601>.json
// so an operator can recover clusters that were incorrectly removed by a bug
// or misconfiguration. Only non-sensitive metadata is included; kubeconfig
// contents, credentials, and runtime status are redacted.
type Snapshot struct {
	Timestamp    time.Time         `json:"timestamp"`
	Trigger      string            `json:"trigger"` // "fsnotify_event" | "health_ticker" | "poll_fallback" | "startup"
	WatchedPaths []string          `json:"watched_paths"`
	OrphanIDs    []string          `json:"orphan_ids"`
	AllClusters  []RedactedCluster `json:"all_clusters"`
}

// RedactedCluster is the metadata-only subset of models.Cluster that is
// safe to persist in a snapshot. No credentials, no secrets, no runtime
// state (status, last_connected) that could become misleading after restore.
type RedactedCluster struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Context        string    `json:"context"`
	KubeconfigPath string    `json:"kubeconfig_path"`
	ServerURL      string    `json:"server_url"`
	Version        string    `json:"version"`
	Provider       string    `json:"provider"`
	Source         string    `json:"source"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// snapshotFilenamePrefix is the shared prefix for snapshot filenames. Used
// both at write time (to build the name) and at prune time (to identify
// candidates without touching unrelated files in the same dir).
const snapshotFilenamePrefix = "clusters-pre-sync-"

// WriteSnapshot serializes snap as JSON and writes it to
// <dir>/clusters-pre-sync-<ISO8601>.json. The timestamp embedded in the
// filename is drawn from snap.Timestamp (not time.Now()) so tests can
// construct deterministic filenames.
//
// The directory is created with 0700 if it does not exist. The file is
// written with 0600. Returns the absolute path of the file on success.
func WriteSnapshot(dir string, snap Snapshot) (string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("mkdir snapshot dir: %w", err)
	}

	// Use a filesystem-safe ISO 8601 variant: no colons.
	stamp := snap.Timestamp.UTC().Format("2006-01-02T15:04:05Z")
	// Replace colons with dashes for Windows / filesystem compatibility.
	stamp = replaceColons(stamp)
	name := snapshotFilenamePrefix + stamp + ".json"
	path := filepath.Join(dir, name)

	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal snapshot: %w", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("write snapshot: %w", err)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return path, nil
	}
	return abs, nil
}

// PruneSnapshots keeps the newest `keep` snapshot files in `dir` and deletes
// older ones. Files that don't match the snapshot filename prefix are left
// alone. "Newest" is determined by os.FileInfo.ModTime, not by filename — we
// want the most recently written files to survive regardless of how their
// timestamps were formatted.
func PruneSnapshots(dir string, keep int) error {
	if keep < 0 {
		keep = 0
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read snapshot dir: %w", err)
	}

	type candidate struct {
		name    string
		modTime time.Time
	}
	var cands []candidate
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if len(name) < len(snapshotFilenamePrefix) || name[:len(snapshotFilenamePrefix)] != snapshotFilenamePrefix {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		cands = append(cands, candidate{name: name, modTime: info.ModTime()})
	}

	// Sort newest first.
	sort.Slice(cands, func(i, j int) bool { return cands[i].modTime.After(cands[j].modTime) })

	if len(cands) <= keep {
		return nil
	}

	var firstErr error
	for _, c := range cands[keep:] {
		if err := os.Remove(filepath.Join(dir, c.name)); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// replaceColons swaps ':' with '-' so filenames are valid on Windows.
// (filepath.Abs doesn't help here — the issue is Windows rejecting colon
// in filenames, not path separators.)
func replaceColons(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] == ':' {
			out = append(out, '-')
		} else {
			out = append(out, s[i])
		}
	}
	return string(out)
}
