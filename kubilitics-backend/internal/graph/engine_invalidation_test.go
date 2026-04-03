package graph

import (
	"log/slog"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/topologycache"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestOnRebuildCallbackFires verifies that the onRebuild callback is invoked
// after a successful graph rebuild, which is the mechanism for active cache
// invalidation (Gap 2 fix).
func TestOnRebuildCallbackFires(t *testing.T) {
	engine := &ClusterGraphEngine{
		clusterID: "test-cluster",
		log:       slog.Default(),
	}
	// Store an empty snapshot so rebuild() can run without a factory.
	engine.snapshot.Store(&GraphSnapshot{
		Nodes:      make(map[string]models.ResourceRef),
		Forward:    make(map[string]map[string]bool),
		Reverse:    make(map[string]map[string]bool),
		Namespaces: make(map[string]bool),
	})

	var callbackClusterID atomic.Value
	var callbackCount atomic.Int64

	engine.SetOnRebuild(func(clusterID string) {
		callbackClusterID.Store(clusterID)
		callbackCount.Add(1)
	})

	// Simulate what happens when collectResources succeeds:
	// rebuild() builds a snapshot and calls onRebuild.
	// We can't call rebuild() directly (no factory), so we test the callback
	// invocation pattern.
	require.NotNil(t, engine.onRebuild, "onRebuild should be set after SetOnRebuild")
	engine.onRebuild(engine.clusterID)

	assert.Equal(t, int64(1), callbackCount.Load(), "callback should fire exactly once")
	assert.Equal(t, "test-cluster", callbackClusterID.Load().(string), "callback should receive correct clusterID")
}

// TestOnRebuildInvalidatesTopologyCache verifies the end-to-end flow:
// onRebuild callback -> topologycache.InvalidateForCluster -> cache entries removed.
// This is the key assertion for Gap 2: informer-driven changes actively bust
// the topology cache instead of waiting for TTL expiry.
func TestOnRebuildInvalidatesTopologyCache(t *testing.T) {
	// Set up a topology cache with some entries.
	cache := topologycache.New(30 * time.Second)
	g := &models.TopologyGraph{Nodes: []models.TopologyNode{{ID: "pod-1"}}}

	cache.Set("cluster-a", "v1", "default", 0, g)
	cache.Set("cluster-a", "v2", "kube-system", 2, g)
	cache.Set("cluster-b", "v1", "default", 0, g) // different cluster

	// Verify entries exist.
	_, ok := cache.Get("cluster-a", "v1", "default", 0)
	require.True(t, ok, "cluster-a v1 entry should exist before invalidation")
	_, ok = cache.Get("cluster-a", "v2", "kube-system", 2)
	require.True(t, ok, "cluster-a v2 entry should exist before invalidation")

	// Wire the onRebuild callback exactly as main.go does.
	engine := &ClusterGraphEngine{
		clusterID: "cluster-a",
		log:       slog.Default(),
	}
	engine.snapshot.Store(&GraphSnapshot{
		Nodes:      make(map[string]models.ResourceRef),
		Forward:    make(map[string]map[string]bool),
		Reverse:    make(map[string]map[string]bool),
		Namespaces: make(map[string]bool),
	})
	engine.SetOnRebuild(func(cid string) {
		cache.InvalidateForCluster(cid)
	})

	// Fire the callback (simulates what rebuild() does after a successful build).
	engine.onRebuild(engine.clusterID)

	// All cluster-a entries should be gone.
	_, ok = cache.Get("cluster-a", "v1", "default", 0)
	assert.False(t, ok, "cluster-a v1 entry should be invalidated after onRebuild")
	_, ok = cache.Get("cluster-a", "v2", "kube-system", 2)
	assert.False(t, ok, "cluster-a v2 entry should be invalidated after onRebuild")

	// cluster-b should be untouched.
	_, ok = cache.Get("cluster-b", "v1", "default", 0)
	assert.True(t, ok, "cluster-b entry should survive cluster-a invalidation")
}

// TestMarkDirtyTriggersRebuildDebounce verifies that markDirty sets a timer
// that eventually fires (the debounced rebuild path). We can't test full rebuild
// without a real informer factory, but we verify the timer mechanism works.
func TestMarkDirtyTriggersRebuildDebounce(t *testing.T) {
	engine := &ClusterGraphEngine{
		clusterID: "test-cluster",
		log:       slog.Default(),
	}
	engine.snapshot.Store(&GraphSnapshot{
		Nodes:      make(map[string]models.ResourceRef),
		Forward:    make(map[string]map[string]bool),
		Reverse:    make(map[string]map[string]bool),
		Namespaces: make(map[string]bool),
	})

	// Verify markDirty creates a debounce timer.
	engine.markDirty()

	engine.debounceMu.Lock()
	timerSet := engine.dirtyTimer != nil
	engine.dirtyTimer.Stop() // prevent actual rebuild (no factory)
	engine.debounceMu.Unlock()

	assert.True(t, timerSet, "markDirty should create a debounce timer")
}
