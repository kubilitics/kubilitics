package simulation

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// buildFixtureSnapshot creates a small but realistic snapshot for testing.
func buildFixtureSnapshot() *graph.GraphSnapshot {
	snap := &graph.GraphSnapshot{
		Nodes: map[string]models.ResourceRef{
			"Deployment/default/api": {Kind: "Deployment", Namespace: "default", Name: "api"},
			"Service/default/api":    {Kind: "Service", Namespace: "default", Name: "api"},
			"ConfigMap/default/cfg":  {Kind: "ConfigMap", Namespace: "default", Name: "cfg"},
			"Pod/default/api-abc":    {Kind: "Pod", Namespace: "default", Name: "api-abc"},
		},
		Forward: map[string]map[string]bool{
			"Service/default/api":   {"Deployment/default/api": true},
			"Deployment/default/api": {"ConfigMap/default/cfg": true},
		},
		Reverse: map[string]map[string]bool{
			"Deployment/default/api": {"Service/default/api": true},
			"ConfigMap/default/cfg":  {"Deployment/default/api": true},
		},
		Edges: []models.BlastDependencyEdge{
			{
				Source: models.ResourceRef{Kind: "Service", Namespace: "default", Name: "api"},
				Target: models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "api"},
				Type:   "selector",
			},
			{
				Source: models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "api"},
				Target: models.ResourceRef{Kind: "ConfigMap", Namespace: "default", Name: "cfg"},
				Type:   "volume-mount",
			},
		},
		NodeScores:   map[string]float64{"Deployment/default/api": 55.0, "Service/default/api": 30.0},
		NodeReplicas: map[string]int{"Deployment/default/api": 3},
		NodeHasHPA:   map[string]bool{"Deployment/default/api": true},
		NodeHasPDB:   map[string]bool{"Deployment/default/api": false},
		NodeIngress:  map[string][]string{"Service/default/api": {"api.example.com"}},
		NodeRisks: map[string][]models.RiskIndicator{
			"Deployment/default/api": {{Severity: "info", Title: "test risk", Detail: "detail"}},
		},
		Namespaces:     map[string]bool{"default": true},
		TotalWorkloads: 4,
		BuiltAt:        1000,
	}
	return snap
}

func TestCloneSnapshot_IndependentMaps(t *testing.T) {
	original := buildFixtureSnapshot()
	clone := CloneSnapshot(original)

	// Verify clone has same data
	require.Equal(t, len(original.Nodes), len(clone.Nodes))
	require.Equal(t, len(original.Forward), len(clone.Forward))
	require.Equal(t, len(original.Reverse), len(clone.Reverse))
	require.Equal(t, len(original.Edges), len(clone.Edges))

	// Mutate clone's Nodes — add a new node
	clone.Nodes["Secret/default/db-creds"] = models.ResourceRef{Kind: "Secret", Namespace: "default", Name: "db-creds"}
	assert.Equal(t, 4, len(original.Nodes), "original Nodes should be unchanged")
	assert.Equal(t, 5, len(clone.Nodes), "clone should have new node")

	// Mutate clone's Forward — add an edge
	clone.Forward["Service/default/api"]["Secret/default/db-creds"] = true
	_, found := original.Forward["Service/default/api"]["Secret/default/db-creds"]
	assert.False(t, found, "original Forward inner map should be unchanged")

	// Mutate clone's Reverse — add an entry
	clone.Reverse["Secret/default/db-creds"] = map[string]bool{"Service/default/api": true}
	_, found = original.Reverse["Secret/default/db-creds"]
	assert.False(t, found, "original Reverse should not have new key")

	// Mutate clone's NodeScores
	clone.NodeScores["Deployment/default/api"] = 99.0
	assert.Equal(t, 55.0, original.NodeScores["Deployment/default/api"], "original NodeScores should be unchanged")

	// Mutate clone's NodeReplicas
	clone.NodeReplicas["Deployment/default/api"] = 10
	assert.Equal(t, 3, original.NodeReplicas["Deployment/default/api"], "original NodeReplicas should be unchanged")

	// Mutate clone's NodeHasHPA
	clone.NodeHasHPA["Deployment/default/api"] = false
	assert.True(t, original.NodeHasHPA["Deployment/default/api"], "original NodeHasHPA should be unchanged")

	// Mutate clone's Namespaces
	clone.Namespaces["kube-system"] = true
	_, found = original.Namespaces["kube-system"]
	assert.False(t, found, "original Namespaces should be unchanged")

	// Mutate clone's NodeIngress
	clone.NodeIngress["Service/default/api"] = append(clone.NodeIngress["Service/default/api"], "new.example.com")
	assert.Equal(t, 1, len(original.NodeIngress["Service/default/api"]), "original NodeIngress slice should be unchanged")

	// Mutate clone's NodeRisks
	clone.NodeRisks["Deployment/default/api"] = append(clone.NodeRisks["Deployment/default/api"],
		models.RiskIndicator{Severity: "critical", Title: "new risk"})
	assert.Equal(t, 1, len(original.NodeRisks["Deployment/default/api"]), "original NodeRisks slice should be unchanged")

	// Mutate clone's Edges
	clone.Edges = append(clone.Edges, models.BlastDependencyEdge{
		Source: models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "api"},
		Target: models.ResourceRef{Kind: "Secret", Namespace: "default", Name: "db-creds"},
		Type:   "volume-mount",
	})
	assert.Equal(t, 2, len(original.Edges), "original Edges should be unchanged")
}

func TestCloneSnapshot_EmptySnapshot(t *testing.T) {
	original := &graph.GraphSnapshot{
		Nodes:        make(map[string]models.ResourceRef),
		Forward:      make(map[string]map[string]bool),
		Reverse:      make(map[string]map[string]bool),
		Edges:        nil,
		NodeScores:   make(map[string]float64),
		NodeReplicas: make(map[string]int),
		NodeHasHPA:   make(map[string]bool),
		NodeHasPDB:   make(map[string]bool),
		NodeIngress:  make(map[string][]string),
		NodeRisks:    make(map[string][]models.RiskIndicator),
		Namespaces:   make(map[string]bool),
	}

	clone := CloneSnapshot(original)
	require.NotNil(t, clone)
	assert.Equal(t, 0, len(clone.Nodes))
	assert.Equal(t, 0, len(clone.Forward))
}
