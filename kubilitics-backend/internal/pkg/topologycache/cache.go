// Package topologycache provides a TTL cache for topology graphs per (clusterID, namespace).
// Invalidated on WebSocket resource update for that scope (C1.3).
package topologycache

import (
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
)

type entry struct {
	graph *models.TopologyGraph
	expAt time.Time
}

// Cache holds topology graphs by (clusterID, namespace) with TTL. Thread-safe.
type Cache struct {
	ttl   time.Duration
	mu    sync.RWMutex
	store map[string]*entry
}

// New returns a cache with the given TTL. If ttl <= 0, Get will always miss (cache disabled).
func New(ttl time.Duration) *Cache {
	return &Cache{
		ttl:   ttl,
		store: make(map[string]*entry),
	}
}

// key builds a cache key that includes mode and depth to prevent
// cross-contamination between different topology views for the same cluster.
// Previously only used clusterID|namespace, which caused stale data when
// switching between modes or depth levels (Bug 1+6).
func key(clusterID, mode, namespace string, depth int) string {
	return clusterID + "|" + mode + "|" + namespace + "|" + strconv.Itoa(depth)
}

// Get returns a cached graph if the key exists and is not expired. Records hit/miss.
// The key includes mode and depth to avoid cross-contamination between views (Bug 1+6).
func (c *Cache) Get(clusterID, mode, namespace string, depth int) (*models.TopologyGraph, bool) {
	if c.ttl <= 0 {
		metrics.TopologyCacheMissesTotal.Inc()
		return nil, false
	}
	k := key(clusterID, mode, namespace, depth)
	c.mu.RLock()
	e, ok := c.store[k]
	c.mu.RUnlock()
	if !ok || e == nil || time.Now().After(e.expAt) {
		metrics.TopologyCacheMissesTotal.Inc()
		return nil, false
	}
	metrics.TopologyCacheHitsTotal.Inc()
	return e.graph, true
}

// Set stores the graph for the given scope with TTL from cache config.
// The key includes mode and depth to avoid cross-contamination between views (Bug 1+6).
func (c *Cache) Set(clusterID, mode, namespace string, depth int, graph *models.TopologyGraph) {
	if c.ttl <= 0 || graph == nil {
		return
	}
	k := key(clusterID, mode, namespace, depth)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.store[k] = &entry{graph: graph, expAt: time.Now().Add(c.ttl)}
}

// InvalidateForCluster removes all cached entries for the cluster (any namespace).
func (c *Cache) InvalidateForCluster(clusterID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	prefix := clusterID + "|"
	for k := range c.store {
		if strings.HasPrefix(k, prefix) {
			delete(c.store, k)
		}
	}
}

// InvalidateForClusterNamespace removes all entries for the given clusterID and namespace
// regardless of mode/depth. This is the safe approach since callers may not know
// which modes are cached.
func (c *Cache) InvalidateForClusterNamespace(clusterID, namespace string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// With the new key format (clusterID|mode|namespace|depth), we need to scan
	// for all entries matching the clusterID and namespace components.
	prefix := clusterID + "|"
	needle := "|" + namespace + "|"
	for k := range c.store {
		if strings.HasPrefix(k, prefix) && strings.Contains(k, needle) {
			delete(c.store, k)
		}
	}
}
