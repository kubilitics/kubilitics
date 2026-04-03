package simulation

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRun_SingleDeleteResource(t *testing.T) {
	snap := buildMutatorFixture()
	req := SimulationRequest{
		Scenarios: []Scenario{
			{Type: ScenarioDeleteResource, TargetKey: "ConfigMap/default/cfg"},
		},
	}

	result, err := Run(snap, req)
	require.NoError(t, err)
	require.NotNil(t, result)

	assert.Len(t, result.RemovedNodes, 1)
	assert.Equal(t, "ConfigMap/default/cfg", result.RemovedNodes[0].Key)
	assert.Greater(t, result.ComputeTimeMs, int64(-1))

	// Health and SPOF data populated
	assert.NotZero(t, result.HealthBefore)
}

func TestRun_MultiScenarioChain(t *testing.T) {
	snap := buildMutatorFixture()
	req := SimulationRequest{
		Scenarios: []Scenario{
			// First delete a configmap
			{Type: ScenarioDeleteResource, TargetKey: "ConfigMap/default/cfg"},
			// Then scale down a deployment
			{Type: ScenarioScaleChange, TargetKey: "Deployment/staging/worker", Replicas: 5},
			// Then deploy a new resource
			{Type: ScenarioDeployNew, ManifestYAML: `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: new-worker
  namespace: staging
spec:
  replicas: 3
`},
		},
	}

	result, err := Run(snap, req)
	require.NoError(t, err)
	require.NotNil(t, result)

	// ConfigMap should be removed
	foundRemoved := false
	for _, n := range result.RemovedNodes {
		if n.Key == "ConfigMap/default/cfg" {
			foundRemoved = true
			break
		}
	}
	assert.True(t, foundRemoved, "ConfigMap should be in removed nodes")

	// New deployment should be added
	foundAdded := false
	for _, n := range result.AddedNodes {
		if n.Key == "Deployment/staging/new-worker" {
			foundAdded = true
			break
		}
	}
	assert.True(t, foundAdded, "new-worker should be in added nodes")

	// Health delta should be computed
	assert.NotZero(t, result.HealthBefore)

	// All slices should be non-nil (JSON-safe)
	assert.NotNil(t, result.RemovedNodes)
	assert.NotNil(t, result.AddedNodes)
	assert.NotNil(t, result.ModifiedNodes)
	assert.NotNil(t, result.LostEdges)
	assert.NotNil(t, result.AddedEdges)
	assert.NotNil(t, result.AffectedServices)
	assert.NotNil(t, result.NewSPOFs)
	assert.NotNil(t, result.ResolvedSPOFs)
}

func TestRun_DeleteNamespaceScenario(t *testing.T) {
	snap := buildMutatorFixture()
	req := SimulationRequest{
		Scenarios: []Scenario{
			{Type: ScenarioDeleteNamespace, Namespace: "staging"},
		},
	}

	result, err := Run(snap, req)
	require.NoError(t, err)
	require.NotNil(t, result)

	// All staging resources should be in removed nodes
	for _, n := range result.RemovedNodes {
		assert.Equal(t, "staging", n.Namespace, "only staging resources should be removed")
	}
	assert.Greater(t, len(result.RemovedNodes), 0)
}

func TestRun_NodeFailureScenario(t *testing.T) {
	snap := buildMutatorFixture()
	req := SimulationRequest{
		Scenarios: []Scenario{
			{Type: ScenarioNodeFailure, NodeName: "node-az1-a"},
		},
	}

	result, err := Run(snap, req)
	require.NoError(t, err)
	require.NotNil(t, result)

	// Node and its pod should be removed
	removedKeys := make(map[string]bool)
	for _, n := range result.RemovedNodes {
		removedKeys[n.Key] = true
	}
	assert.True(t, removedKeys["Node//node-az1-a"], "node should be removed")
	assert.True(t, removedKeys["Pod/default/node-az1-a-pod"], "pod on node should be removed")
}

func TestRun_ValidationErrors(t *testing.T) {
	snap := buildMutatorFixture()

	tests := []struct {
		name string
		req  SimulationRequest
	}{
		{"empty scenarios", SimulationRequest{Scenarios: nil}},
		{"too many scenarios", SimulationRequest{Scenarios: make([]Scenario, MaxScenarios+1)}},
		{"unknown type", SimulationRequest{Scenarios: []Scenario{{Type: "unknown"}}}},
		{"delete resource missing key", SimulationRequest{Scenarios: []Scenario{{Type: ScenarioDeleteResource}}}},
		{"delete namespace missing ns", SimulationRequest{Scenarios: []Scenario{{Type: ScenarioDeleteNamespace}}}},
		{"node failure missing name", SimulationRequest{Scenarios: []Scenario{{Type: ScenarioNodeFailure}}}},
		{"az failure missing label", SimulationRequest{Scenarios: []Scenario{{Type: ScenarioAZFailure}}}},
		{"scale change missing key", SimulationRequest{Scenarios: []Scenario{{Type: ScenarioScaleChange, Replicas: 3}}}},
		{"deploy new missing yaml", SimulationRequest{Scenarios: []Scenario{{Type: ScenarioDeployNew}}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Run(snap, tt.req)
			assert.Error(t, err, "should fail validation")
		})
	}
}

func TestRun_ScenarioTargetNotFound(t *testing.T) {
	snap := buildMutatorFixture()
	req := SimulationRequest{
		Scenarios: []Scenario{
			{Type: ScenarioDeleteResource, TargetKey: "Deployment/default/nonexistent"},
		},
	}

	_, err := Run(snap, req)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestRun_OriginalSnapshotUnmutated(t *testing.T) {
	snap := buildMutatorFixture()
	originalNodeCount := len(snap.Nodes)

	req := SimulationRequest{
		Scenarios: []Scenario{
			{Type: ScenarioDeleteNamespace, Namespace: "staging"},
		},
	}

	_, err := Run(snap, req)
	require.NoError(t, err)

	// The original snapshot should still have all its nodes
	// (Run clones internally, but we also rescore the original before cloning)
	assert.Equal(t, originalNodeCount, len(snap.Nodes),
		"original snapshot node count should be unchanged")
}

func TestValidate_AllScenarioTypes(t *testing.T) {
	req := SimulationRequest{
		Scenarios: []Scenario{
			{Type: ScenarioDeleteResource, TargetKey: "Deployment/default/api"},
			{Type: ScenarioDeleteNamespace, Namespace: "staging"},
			{Type: ScenarioNodeFailure, NodeName: "node-1"},
			{Type: ScenarioAZFailure, AZLabel: "us-east-1a"},
			{Type: ScenarioScaleChange, TargetKey: "Deployment/default/api", Replicas: 5},
			{Type: ScenarioDeployNew, ManifestYAML: "kind: Deployment\nmetadata:\n  name: x"},
		},
	}

	err := Validate(req)
	assert.NoError(t, err)
}

func TestAvailableScenarios(t *testing.T) {
	scenarios := AvailableScenarios()
	assert.Len(t, scenarios, 6)

	types := make(map[ScenarioType]bool)
	for _, s := range scenarios {
		types[s.Type] = true
		assert.NotEmpty(t, s.Label)
		assert.NotEmpty(t, s.Description)
		assert.NotEmpty(t, s.Fields)
	}

	assert.True(t, types[ScenarioDeleteResource])
	assert.True(t, types[ScenarioDeleteNamespace])
	assert.True(t, types[ScenarioNodeFailure])
	assert.True(t, types[ScenarioAZFailure])
	assert.True(t, types[ScenarioScaleChange])
	assert.True(t, types[ScenarioDeployNew])
}
