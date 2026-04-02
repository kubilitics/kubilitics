package diff

import (
	"testing"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

func TestTopologyResponseToSnapshot(t *testing.T) {
	resp := &v2.TopologyResponse{
		Metadata: v2.TopologyMetadata{
			ClusterID:     "cluster-1",
			ClusterName:   "test-cluster",
			Mode:          v2.ViewModeCluster,
			ResourceCount: 3,
			EdgeCount:     2,
		},
		Nodes: []v2.TopologyNode{
			{
				ID:        "Deployment/default/nginx",
				Kind:      "Deployment",
				Name:      "nginx",
				Namespace: "default",
				Status:    "Running",
			},
			{
				ID:        "Service/default/nginx-svc",
				Kind:      "Service",
				Name:      "nginx-svc",
				Namespace: "default",
				Status:    "Active",
			},
			{
				ID:        "ConfigMap/default/nginx-config",
				Kind:      "ConfigMap",
				Name:      "nginx-config",
				Namespace: "default",
				Status:    "",
			},
		},
		Edges: []v2.TopologyEdge{
			{
				ID:               "e1",
				Source:            "Service/default/nginx-svc",
				Target:            "Deployment/default/nginx",
				RelationshipType: "selects",
				Healthy:          true,
			},
			{
				ID:               "e2",
				Source:            "Deployment/default/nginx",
				Target:            "ConfigMap/default/nginx-config",
				RelationshipType: "mounts",
				Healthy:          false,
			},
		},
	}

	snap := TopologyResponseToSnapshot("cluster-1", "default", resp)

	// Verify basic fields
	if snap.ID == "" {
		t.Error("expected non-empty snapshot ID")
	}
	if snap.ClusterID != "cluster-1" {
		t.Errorf("expected cluster_id 'cluster-1', got %q", snap.ClusterID)
	}
	if snap.Namespace != "default" {
		t.Errorf("expected namespace 'default', got %q", snap.Namespace)
	}
	if snap.CreatedAt.IsZero() {
		t.Error("expected non-zero CreatedAt")
	}

	// Verify nodes
	if len(snap.Nodes) != 3 {
		t.Fatalf("expected 3 nodes, got %d", len(snap.Nodes))
	}

	nodeByID := make(map[string]SnapshotNode)
	for _, n := range snap.Nodes {
		nodeByID[n.ID] = n
	}

	nginx := nodeByID["Deployment/default/nginx"]
	if nginx.Name != "nginx" {
		t.Errorf("expected node name 'nginx', got %q", nginx.Name)
	}
	if nginx.Kind != "Deployment" {
		t.Errorf("expected kind 'Deployment', got %q", nginx.Kind)
	}
	if nginx.Health != "Running" {
		t.Errorf("expected health 'Running', got %q", nginx.Health)
	}

	// Verify edges
	if len(snap.Edges) != 2 {
		t.Fatalf("expected 2 edges, got %d", len(snap.Edges))
	}

	// Find the healthy edge (weight 1.0)
	var healthyEdge, unhealthyEdge *SnapshotEdge
	for i := range snap.Edges {
		if snap.Edges[i].Weight == 1.0 {
			healthyEdge = &snap.Edges[i]
		} else {
			unhealthyEdge = &snap.Edges[i]
		}
	}

	if healthyEdge == nil {
		t.Fatal("expected a healthy edge with weight 1.0")
	}
	if healthyEdge.Source != "Service/default/nginx-svc" {
		t.Errorf("expected healthy edge source 'Service/default/nginx-svc', got %q", healthyEdge.Source)
	}
	if healthyEdge.Type != "selects" {
		t.Errorf("expected healthy edge type 'selects', got %q", healthyEdge.Type)
	}

	if unhealthyEdge == nil {
		t.Fatal("expected an unhealthy edge with weight 0.5")
	}
	if unhealthyEdge.Weight != 0.5 {
		t.Errorf("expected unhealthy edge weight 0.5, got %f", unhealthyEdge.Weight)
	}

	// Verify metadata
	if snap.Metadata.TotalNodes != 3 {
		t.Errorf("expected total_nodes 3, got %d", snap.Metadata.TotalNodes)
	}
	if snap.Metadata.TotalEdges != 2 {
		t.Errorf("expected total_edges 2, got %d", snap.Metadata.TotalEdges)
	}
}

func TestTopologyResponseToSnapshot_Empty(t *testing.T) {
	resp := &v2.TopologyResponse{
		Metadata: v2.TopologyMetadata{
			ClusterID: "cluster-1",
		},
		Nodes: []v2.TopologyNode{},
		Edges: []v2.TopologyEdge{},
	}

	snap := TopologyResponseToSnapshot("cluster-1", "", resp)

	if len(snap.Nodes) != 0 {
		t.Errorf("expected 0 nodes, got %d", len(snap.Nodes))
	}
	if len(snap.Edges) != 0 {
		t.Errorf("expected 0 edges, got %d", len(snap.Edges))
	}
	if snap.Metadata.TotalNodes != 0 {
		t.Errorf("expected total_nodes 0, got %d", snap.Metadata.TotalNodes)
	}
}
