package diff

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

// SnapshotStore defines the interface for persisting and retrieving topology snapshots.
type SnapshotStore interface {
	Save(snapshot TopologySnapshot) error
	Get(id string) (*TopologySnapshot, error)
	GetLatest(clusterID, namespace string) (*TopologySnapshot, error)
	GetByDateRange(clusterID, namespace string, from, to time.Time) ([]TopologySnapshot, error)
	DeleteOlderThan(retention time.Duration) (int, error)
}

// DefaultRetention is the default snapshot retention period (90 days).
const DefaultRetention = 90 * 24 * time.Hour

// InMemorySnapshotStore implements SnapshotStore using an in-memory slice with mutex.
// Suitable for development and testing; production should use a database-backed implementation.
type InMemorySnapshotStore struct {
	mu        sync.RWMutex
	snapshots []TopologySnapshot
	byID      map[string]int // snapshot ID -> index in snapshots slice
}

// NewInMemorySnapshotStore creates a new in-memory snapshot store.
func NewInMemorySnapshotStore() *InMemorySnapshotStore {
	return &InMemorySnapshotStore{
		snapshots: make([]TopologySnapshot, 0),
		byID:      make(map[string]int),
	}
}

// Save persists a snapshot. Returns an error if a snapshot with the same ID already exists.
func (s *InMemorySnapshotStore) Save(snapshot TopologySnapshot) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.byID[snapshot.ID]; exists {
		return fmt.Errorf("snapshot %s already exists", snapshot.ID)
	}

	idx := len(s.snapshots)
	s.snapshots = append(s.snapshots, snapshot)
	s.byID[snapshot.ID] = idx
	return nil
}

// Get retrieves a snapshot by ID.
func (s *InMemorySnapshotStore) Get(id string) (*TopologySnapshot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	idx, ok := s.byID[id]
	if !ok {
		return nil, fmt.Errorf("snapshot %s not found", id)
	}
	snap := s.snapshots[idx]
	return &snap, nil
}

// GetLatest returns the most recent snapshot for a cluster+namespace.
func (s *InMemorySnapshotStore) GetLatest(clusterID, namespace string) (*TopologySnapshot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var latest *TopologySnapshot
	for i := range s.snapshots {
		snap := &s.snapshots[i]
		if snap.ClusterID != clusterID || snap.Namespace != namespace {
			continue
		}
		if latest == nil || snap.CreatedAt.After(latest.CreatedAt) {
			latest = snap
		}
	}
	if latest == nil {
		return nil, fmt.Errorf("no snapshot found for cluster %s namespace %q", clusterID, namespace)
	}
	result := *latest
	return &result, nil
}

// GetByDateRange returns all snapshots for a cluster+namespace within the given time range,
// sorted by creation time ascending.
func (s *InMemorySnapshotStore) GetByDateRange(clusterID, namespace string, from, to time.Time) ([]TopologySnapshot, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var results []TopologySnapshot
	for _, snap := range s.snapshots {
		if snap.ClusterID != clusterID || snap.Namespace != namespace {
			continue
		}
		if (snap.CreatedAt.Equal(from) || snap.CreatedAt.After(from)) &&
			(snap.CreatedAt.Equal(to) || snap.CreatedAt.Before(to)) {
			results = append(results, snap)
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].CreatedAt.Before(results[j].CreatedAt)
	})

	return results, nil
}

// DeleteOlderThan removes snapshots older than the given retention duration.
// Returns the number of snapshots deleted.
func (s *InMemorySnapshotStore) DeleteOlderThan(retention time.Duration) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().Add(-retention)
	var kept []TopologySnapshot
	deleted := 0

	for _, snap := range s.snapshots {
		if snap.CreatedAt.Before(cutoff) {
			deleted++
		} else {
			kept = append(kept, snap)
		}
	}

	// Rebuild index
	s.snapshots = kept
	s.byID = make(map[string]int, len(kept))
	for i, snap := range s.snapshots {
		s.byID[snap.ID] = i
	}

	return deleted, nil
}
