package topologycache

import (
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestKey_IncludesModeAndDepth(t *testing.T) {
	// Bug 1+6 regression: cache key must differentiate by mode and depth.
	k1 := key("cluster1", "v1", "default", 0)
	k2 := key("cluster1", "v2", "default", 0)
	k3 := key("cluster1", "v1", "default", 2)
	k4 := key("cluster1", "v1", "default", 0)

	if k1 == k2 {
		t.Error("keys with different modes must differ")
	}
	if k1 == k3 {
		t.Error("keys with different depths must differ")
	}
	if k1 != k4 {
		t.Error("identical parameters must produce the same key")
	}
}

func TestGetSet_WithModeAndDepth(t *testing.T) {
	c := New(10 * time.Second)
	g1 := &models.TopologyGraph{Nodes: []models.TopologyNode{{ID: "a"}}}
	g2 := &models.TopologyGraph{Nodes: []models.TopologyNode{{ID: "b"}}}

	// Set two entries with different mode/depth
	c.Set("c1", "cluster", "ns1", 0, g1)
	c.Set("c1", "resource", "ns1", 2, g2)

	// Retrieve them independently
	got1, ok := c.Get("c1", "cluster", "ns1", 0)
	if !ok || got1.Nodes[0].ID != "a" {
		t.Error("expected graph g1 for cluster mode depth 0")
	}

	got2, ok := c.Get("c1", "resource", "ns1", 2)
	if !ok || got2.Nodes[0].ID != "b" {
		t.Error("expected graph g2 for resource mode depth 2")
	}

	// Miss on a different depth
	_, ok = c.Get("c1", "cluster", "ns1", 1)
	if ok {
		t.Error("expected miss for depth 1 (not cached)")
	}
}

func TestInvalidateForCluster_ClearsAllModes(t *testing.T) {
	c := New(10 * time.Second)
	g := &models.TopologyGraph{Nodes: []models.TopologyNode{{ID: "x"}}}

	c.Set("c1", "cluster", "ns1", 0, g)
	c.Set("c1", "resource", "ns1", 2, g)
	c.Set("c2", "cluster", "ns1", 0, g)

	c.InvalidateForCluster("c1")

	if _, ok := c.Get("c1", "cluster", "ns1", 0); ok {
		t.Error("expected c1 cluster entry to be invalidated")
	}
	if _, ok := c.Get("c1", "resource", "ns1", 2); ok {
		t.Error("expected c1 resource entry to be invalidated")
	}
	// c2 should survive
	if _, ok := c.Get("c2", "cluster", "ns1", 0); !ok {
		t.Error("c2 entry should survive cluster c1 invalidation")
	}
}

func TestInvalidateForClusterNamespace_NewKeyFormat(t *testing.T) {
	c := New(10 * time.Second)
	g := &models.TopologyGraph{Nodes: []models.TopologyNode{{ID: "x"}}}

	c.Set("c1", "cluster", "ns1", 0, g)
	c.Set("c1", "cluster", "ns2", 0, g)
	c.Set("c1", "resource", "ns1", 2, g)

	c.InvalidateForClusterNamespace("c1", "ns1")

	// ns1 entries should be gone
	if _, ok := c.Get("c1", "cluster", "ns1", 0); ok {
		t.Error("expected ns1 cluster entry to be invalidated")
	}
	if _, ok := c.Get("c1", "resource", "ns1", 2); ok {
		t.Error("expected ns1 resource entry to be invalidated")
	}
	// ns2 should survive
	if _, ok := c.Get("c1", "cluster", "ns2", 0); !ok {
		t.Error("ns2 entry should survive ns1 invalidation")
	}
}
