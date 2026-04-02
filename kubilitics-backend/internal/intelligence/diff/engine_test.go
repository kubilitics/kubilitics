package diff

import (
	"testing"
	"time"
)

func makeSnapshot(id string, nodes []SnapshotNode, edges []SnapshotEdge, spofCount int) *TopologySnapshot {
	return &TopologySnapshot{
		ID:        id,
		ClusterID: "cluster-1",
		Namespace: "",
		Nodes:     nodes,
		Edges:     edges,
		Metadata: SnapshotMetadata{
			TotalNodes: len(nodes),
			TotalEdges: len(edges),
			SPOFCount:  spofCount,
		},
		CreatedAt: time.Now(),
	}
}

func TestComputeDiff_IdenticalSnapshots(t *testing.T) {
	nodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
		{ID: "svc/default/nginx", Name: "nginx", Kind: "Service", Namespace: "default"},
	}
	edges := []SnapshotEdge{
		{Source: "svc/default/nginx", Target: "deploy/default/nginx", Type: "selects", Weight: 1.0},
	}

	from := makeSnapshot("snap-1", nodes, edges, 0)
	to := makeSnapshot("snap-2", nodes, edges, 0)

	result := ComputeDiff(from, to)

	if len(result.AddedNodes) != 0 {
		t.Errorf("expected 0 added nodes, got %d", len(result.AddedNodes))
	}
	if len(result.RemovedNodes) != 0 {
		t.Errorf("expected 0 removed nodes, got %d", len(result.RemovedNodes))
	}
	if len(result.AddedEdges) != 0 {
		t.Errorf("expected 0 added edges, got %d", len(result.AddedEdges))
	}
	if len(result.RemovedEdges) != 0 {
		t.Errorf("expected 0 removed edges, got %d", len(result.RemovedEdges))
	}
	if len(result.ChangedEdges) != 0 {
		t.Errorf("expected 0 changed edges, got %d", len(result.ChangedEdges))
	}
	if result.Summary.NaturalLanguage != "No changes detected." {
		t.Errorf("expected 'No changes detected.', got %q", result.Summary.NaturalLanguage)
	}
}

func TestComputeDiff_NodeAdded(t *testing.T) {
	fromNodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
	}
	toNodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
		{ID: "deploy/default/redis", Name: "redis", Kind: "Deployment", Namespace: "default"},
	}

	from := makeSnapshot("snap-1", fromNodes, nil, 0)
	to := makeSnapshot("snap-2", toNodes, nil, 0)

	result := ComputeDiff(from, to)

	if len(result.AddedNodes) != 1 {
		t.Fatalf("expected 1 added node, got %d", len(result.AddedNodes))
	}
	if result.AddedNodes[0].ID != "deploy/default/redis" {
		t.Errorf("expected added node ID 'deploy/default/redis', got %q", result.AddedNodes[0].ID)
	}
	if result.Summary.NodesAdded != 1 {
		t.Errorf("expected NodesAdded=1, got %d", result.Summary.NodesAdded)
	}
}

func TestComputeDiff_NodeRemoved(t *testing.T) {
	fromNodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
		{ID: "deploy/default/redis", Name: "redis", Kind: "Deployment", Namespace: "default"},
	}
	toNodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
	}

	from := makeSnapshot("snap-1", fromNodes, nil, 0)
	to := makeSnapshot("snap-2", toNodes, nil, 0)

	result := ComputeDiff(from, to)

	if len(result.RemovedNodes) != 1 {
		t.Fatalf("expected 1 removed node, got %d", len(result.RemovedNodes))
	}
	if result.RemovedNodes[0].ID != "deploy/default/redis" {
		t.Errorf("expected removed node ID 'deploy/default/redis', got %q", result.RemovedNodes[0].ID)
	}
	if result.Summary.NodesRemoved != 1 {
		t.Errorf("expected NodesRemoved=1, got %d", result.Summary.NodesRemoved)
	}
}

func TestComputeDiff_EdgeAdded(t *testing.T) {
	nodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
		{ID: "svc/default/nginx", Name: "nginx", Kind: "Service", Namespace: "default"},
	}
	fromEdges := []SnapshotEdge{}
	toEdges := []SnapshotEdge{
		{Source: "svc/default/nginx", Target: "deploy/default/nginx", Type: "selects", Weight: 1.0},
	}

	from := makeSnapshot("snap-1", nodes, fromEdges, 0)
	to := makeSnapshot("snap-2", nodes, toEdges, 0)

	result := ComputeDiff(from, to)

	if len(result.AddedEdges) != 1 {
		t.Fatalf("expected 1 added edge, got %d", len(result.AddedEdges))
	}
	if result.Summary.EdgesAdded != 1 {
		t.Errorf("expected EdgesAdded=1, got %d", result.Summary.EdgesAdded)
	}
}

func TestComputeDiff_EdgeRemoved(t *testing.T) {
	nodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
		{ID: "svc/default/nginx", Name: "nginx", Kind: "Service", Namespace: "default"},
	}
	fromEdges := []SnapshotEdge{
		{Source: "svc/default/nginx", Target: "deploy/default/nginx", Type: "selects", Weight: 1.0},
	}
	toEdges := []SnapshotEdge{}

	from := makeSnapshot("snap-1", nodes, fromEdges, 0)
	to := makeSnapshot("snap-2", nodes, toEdges, 0)

	result := ComputeDiff(from, to)

	if len(result.RemovedEdges) != 1 {
		t.Fatalf("expected 1 removed edge, got %d", len(result.RemovedEdges))
	}
	if result.Summary.EdgesRemoved != 1 {
		t.Errorf("expected EdgesRemoved=1, got %d", result.Summary.EdgesRemoved)
	}
}

func TestComputeDiff_EdgeWeightChanged(t *testing.T) {
	nodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
		{ID: "svc/default/nginx", Name: "nginx", Kind: "Service", Namespace: "default"},
	}
	fromEdges := []SnapshotEdge{
		{Source: "svc/default/nginx", Target: "deploy/default/nginx", Type: "selects", Weight: 1.0},
	}
	toEdges := []SnapshotEdge{
		{Source: "svc/default/nginx", Target: "deploy/default/nginx", Type: "selects", Weight: 0.5},
	}

	from := makeSnapshot("snap-1", nodes, fromEdges, 0)
	to := makeSnapshot("snap-2", nodes, toEdges, 0)

	result := ComputeDiff(from, to)

	if len(result.ChangedEdges) != 1 {
		t.Fatalf("expected 1 changed edge, got %d", len(result.ChangedEdges))
	}
	if result.ChangedEdges[0].OldWeight != 1.0 {
		t.Errorf("expected old weight 1.0, got %f", result.ChangedEdges[0].OldWeight)
	}
	if result.ChangedEdges[0].NewWeight != 0.5 {
		t.Errorf("expected new weight 0.5, got %f", result.ChangedEdges[0].NewWeight)
	}
	if result.Summary.EdgesChanged != 1 {
		t.Errorf("expected EdgesChanged=1, got %d", result.Summary.EdgesChanged)
	}
}

func TestComputeDiff_SPOFChanges(t *testing.T) {
	from := makeSnapshot("snap-1", nil, nil, 2)
	to := makeSnapshot("snap-2", nil, nil, 5)

	result := ComputeDiff(from, to)

	if result.Summary.NewSPOFs != 3 {
		t.Errorf("expected NewSPOFs=3, got %d", result.Summary.NewSPOFs)
	}
	if result.Summary.RemovedSPOFs != 0 {
		t.Errorf("expected RemovedSPOFs=0, got %d", result.Summary.RemovedSPOFs)
	}
}

func TestComputeDiff_SPOFsRemoved(t *testing.T) {
	from := makeSnapshot("snap-1", nil, nil, 5)
	to := makeSnapshot("snap-2", nil, nil, 2)

	result := ComputeDiff(from, to)

	if result.Summary.NewSPOFs != 0 {
		t.Errorf("expected NewSPOFs=0, got %d", result.Summary.NewSPOFs)
	}
	if result.Summary.RemovedSPOFs != 3 {
		t.Errorf("expected RemovedSPOFs=3, got %d", result.Summary.RemovedSPOFs)
	}
}

func TestComputeDiff_NaturalLanguageSummary(t *testing.T) {
	fromNodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
	}
	toNodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
		{ID: "deploy/default/redis", Name: "redis", Kind: "Deployment", Namespace: "default"},
		{ID: "deploy/default/postgres", Name: "postgres", Kind: "Deployment", Namespace: "default"},
	}
	toEdges := []SnapshotEdge{
		{Source: "deploy/default/redis", Target: "deploy/default/postgres", Type: "depends-on", Weight: 1.0},
	}

	from := makeSnapshot("snap-1", fromNodes, nil, 0)
	to := makeSnapshot("snap-2", toNodes, toEdges, 2)

	result := ComputeDiff(from, to)

	// Should contain: "2 resources added", "1 new dependency", "2 new single points of failure introduced"
	summary := result.Summary.NaturalLanguage
	if summary == "" {
		t.Fatal("expected non-empty natural language summary")
	}

	// Verify it's a complete sentence (ends with period)
	if summary[len(summary)-1] != '.' {
		t.Errorf("expected summary to end with period, got %q", summary)
	}

	// Verify key parts
	if result.Summary.NodesAdded != 2 {
		t.Errorf("expected NodesAdded=2, got %d", result.Summary.NodesAdded)
	}
	if result.Summary.EdgesAdded != 1 {
		t.Errorf("expected EdgesAdded=1, got %d", result.Summary.EdgesAdded)
	}
	if result.Summary.NewSPOFs != 2 {
		t.Errorf("expected NewSPOFs=2, got %d", result.Summary.NewSPOFs)
	}
}

func TestComputeDiff_ComplexScenario(t *testing.T) {
	fromNodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
		{ID: "deploy/default/redis", Name: "redis", Kind: "Deployment", Namespace: "default"},
		{ID: "svc/default/nginx", Name: "nginx", Kind: "Service", Namespace: "default"},
	}
	fromEdges := []SnapshotEdge{
		{Source: "svc/default/nginx", Target: "deploy/default/nginx", Type: "selects", Weight: 1.0},
		{Source: "deploy/default/nginx", Target: "deploy/default/redis", Type: "depends-on", Weight: 1.0},
	}

	toNodes := []SnapshotNode{
		{ID: "deploy/default/nginx", Name: "nginx", Kind: "Deployment", Namespace: "default"},
		{ID: "svc/default/nginx", Name: "nginx", Kind: "Service", Namespace: "default"},
		{ID: "deploy/default/postgres", Name: "postgres", Kind: "Deployment", Namespace: "default"},
	}
	toEdges := []SnapshotEdge{
		{Source: "svc/default/nginx", Target: "deploy/default/nginx", Type: "selects", Weight: 0.5}, // weight changed
		{Source: "deploy/default/nginx", Target: "deploy/default/postgres", Type: "depends-on", Weight: 1.0}, // new edge
	}

	from := makeSnapshot("snap-1", fromNodes, fromEdges, 1)
	to := makeSnapshot("snap-2", toNodes, toEdges, 1)

	result := ComputeDiff(from, to)

	if len(result.AddedNodes) != 1 {
		t.Errorf("expected 1 added node, got %d", len(result.AddedNodes))
	}
	if len(result.RemovedNodes) != 1 {
		t.Errorf("expected 1 removed node, got %d", len(result.RemovedNodes))
	}
	if len(result.AddedEdges) != 1 {
		t.Errorf("expected 1 added edge, got %d", len(result.AddedEdges))
	}
	if len(result.RemovedEdges) != 1 {
		t.Errorf("expected 1 removed edge, got %d", len(result.RemovedEdges))
	}
	if len(result.ChangedEdges) != 1 {
		t.Errorf("expected 1 changed edge, got %d", len(result.ChangedEdges))
	}
}

func TestPluralize(t *testing.T) {
	tests := []struct {
		word  string
		count int
		want  string
	}{
		{"resource", 1, "resource"},
		{"resource", 2, "resources"},
		{"dependency", 1, "dependency"},
		{"dependency", 2, "dependencies"},
		{"single point of failure", 1, "single point of failure"},
		{"single point of failure", 3, "single point of failures"},
	}

	for _, tc := range tests {
		got := pluralize(tc.word, tc.count)
		if got != tc.want {
			t.Errorf("pluralize(%q, %d) = %q, want %q", tc.word, tc.count, got, tc.want)
		}
	}
}
