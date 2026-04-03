package simulation

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// buildMutatorFixture creates a richer snapshot suitable for mutator tests.
func buildMutatorFixture() *graph.GraphSnapshot {
	return &graph.GraphSnapshot{
		Nodes: map[string]models.ResourceRef{
			"Deployment/default/api":     {Kind: "Deployment", Namespace: "default", Name: "api"},
			"Service/default/api":        {Kind: "Service", Namespace: "default", Name: "api"},
			"ConfigMap/default/cfg":      {Kind: "ConfigMap", Namespace: "default", Name: "cfg"},
			"Pod/default/api-abc":        {Kind: "Pod", Namespace: "default", Name: "api-abc"},
			"Pod/default/api-def":        {Kind: "Pod", Namespace: "default", Name: "api-def"},
			"Deployment/staging/worker":  {Kind: "Deployment", Namespace: "staging", Name: "worker"},
			"Pod/staging/worker-xyz":     {Kind: "Pod", Namespace: "staging", Name: "worker-xyz"},
			"Service/staging/worker":     {Kind: "Service", Namespace: "staging", Name: "worker"},
			"Node//node-az1-a":           {Kind: "Node", Namespace: "", Name: "node-az1-a"},
			"Node//node-az1-b":           {Kind: "Node", Namespace: "", Name: "node-az1-b"},
			"Node//node-az2-a":           {Kind: "Node", Namespace: "", Name: "node-az2-a"},
			"Pod/default/node-az1-a-pod": {Kind: "Pod", Namespace: "default", Name: "node-az1-a-pod"},
		},
		Forward: map[string]map[string]bool{
			"Service/default/api":       {"Deployment/default/api": true},
			"Deployment/default/api":    {"ConfigMap/default/cfg": true},
			"Service/staging/worker":    {"Deployment/staging/worker": true},
			"Pod/default/node-az1-a-pod": {"Node//node-az1-a": true},
		},
		Reverse: map[string]map[string]bool{
			"Deployment/default/api":    {"Service/default/api": true},
			"ConfigMap/default/cfg":     {"Deployment/default/api": true},
			"Deployment/staging/worker": {"Service/staging/worker": true},
			"Node//node-az1-a":          {"Pod/default/node-az1-a-pod": true},
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
		NodeScores:   map[string]float64{"Deployment/default/api": 55.0, "Service/default/api": 30.0, "Deployment/staging/worker": 40.0},
		NodeReplicas: map[string]int{"Deployment/default/api": 3, "Deployment/staging/worker": 1},
		NodeHasHPA:   map[string]bool{"Deployment/default/api": true, "Deployment/staging/worker": false},
		NodeHasPDB:   map[string]bool{},
		NodeIngress:  map[string][]string{},
		NodeRisks:    map[string][]models.RiskIndicator{},
		Namespaces:   map[string]bool{"default": true, "staging": true},
		TotalWorkloads: 6,
	}
}

func TestDeleteResource(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := deleteResource(clone, "ConfigMap/default/cfg")
	require.NoError(t, err)

	// Node removed
	_, found := clone.Nodes["ConfigMap/default/cfg"]
	assert.False(t, found, "ConfigMap should be removed from Nodes")

	// Reverse cleaned up
	_, found = clone.Reverse["ConfigMap/default/cfg"]
	assert.False(t, found, "ConfigMap should be removed from Reverse")

	// Forward edge from Deployment -> ConfigMap cleaned up
	assert.NotContains(t, clone.Forward["Deployment/default/api"], "ConfigMap/default/cfg")

	// Edges cleaned up
	for _, e := range clone.Edges {
		assert.NotEqual(t, "ConfigMap", e.Target.Kind, "Edge to ConfigMap should be removed")
	}

	// Original unchanged
	_, found = snap.Nodes["ConfigMap/default/cfg"]
	assert.True(t, found, "Original should still have ConfigMap")
}

func TestDeleteResource_NotFound(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := deleteResource(clone, "Deployment/default/nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestDeleteNamespace(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := deleteNamespace(clone, "staging")
	require.NoError(t, err)

	// All staging resources removed
	for key, ref := range clone.Nodes {
		assert.NotEqual(t, "staging", ref.Namespace, "Node %s should not be in staging namespace", key)
	}

	// Namespace removed
	assert.False(t, clone.Namespaces["staging"])
}

func TestDeleteNamespace_NotFound(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := deleteNamespace(clone, "nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestNodeFailure(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := nodeFailure(clone, "node-az1-a")
	require.NoError(t, err)

	// Pod on that node should be removed
	_, found := clone.Nodes["Pod/default/node-az1-a-pod"]
	assert.False(t, found, "Pod scheduled on failed node should be removed")

	// Node itself should be removed
	_, found = clone.Nodes["Node//node-az1-a"]
	assert.False(t, found, "Failed node should be removed")

	// Other pods unaffected
	_, found = clone.Nodes["Pod/default/api-abc"]
	assert.True(t, found, "Unrelated pods should remain")

	// Controllers survive
	_, found = clone.Nodes["Deployment/default/api"]
	assert.True(t, found, "Deployment should survive node failure")
}

func TestNodeFailure_NotFound(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := nodeFailure(clone, "nonexistent-node")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestAZFailure(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := azFailure(clone, "az1")
	require.NoError(t, err)

	// Both az1 nodes should be removed
	_, found := clone.Nodes["Node//node-az1-a"]
	assert.False(t, found)
	_, found = clone.Nodes["Node//node-az1-b"]
	assert.False(t, found)

	// az2 node should remain
	_, found = clone.Nodes["Node//node-az2-a"]
	assert.True(t, found)
}

func TestAZFailure_NotFound(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := azFailure(clone, "nonexistent-az")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no nodes found")
}

func TestScaleChange(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := scaleChange(clone, "Deployment/default/api", 5)
	require.NoError(t, err)
	assert.Equal(t, 5, clone.NodeReplicas["Deployment/default/api"])

	// Original unchanged
	assert.Equal(t, 3, snap.NodeReplicas["Deployment/default/api"])
}

func TestScaleChange_NotFound(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := scaleChange(clone, "Deployment/default/nonexistent", 5)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestScaleChange_NegativeReplicas(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := scaleChange(clone, "Deployment/default/api", -1)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "replicas must be >= 0")
}

func TestDeployNew(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	yaml := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: new-api
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: new-api
`

	err := deployNew(clone, yaml)
	require.NoError(t, err)

	// New node added
	ref, found := clone.Nodes["Deployment/default/new-api"]
	assert.True(t, found)
	assert.Equal(t, "Deployment", ref.Kind)
	assert.Equal(t, "default", ref.Namespace)
	assert.Equal(t, "new-api", ref.Name)

	// Replicas set
	assert.Equal(t, 2, clone.NodeReplicas["Deployment/default/new-api"])
}

func TestDeployNew_EmptyYAML(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := deployNew(clone, "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "manifest_yaml is required")
}

func TestDeployNew_InvalidYAML(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := deployNew(clone, "not: valid: yaml: [")
	assert.Error(t, err)
}

func TestDeployNew_MissingKind(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	err := deployNew(clone, `
apiVersion: v1
metadata:
  name: test
`)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "missing kind")
}

func TestDeployNew_DefaultNamespace(t *testing.T) {
	snap := buildMutatorFixture()
	clone := CloneSnapshot(snap)

	yaml := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: no-ns
spec:
  replicas: 1
`
	err := deployNew(clone, yaml)
	require.NoError(t, err)

	ref, found := clone.Nodes["Deployment/default/no-ns"]
	assert.True(t, found)
	assert.Equal(t, "default", ref.Namespace)
}
