package autopilot

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSafetyGate_ScaleActionSafe(t *testing.T) {
	snap := testSnapshot()
	gate := NewSafetyGate()

	finding := Finding{
		RuleID:          "spof-single-replica",
		ActionType:      "scale",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "api-gateway",
	}

	safe, delta, err := gate.Check(snap, finding)
	require.NoError(t, err)
	assert.True(t, safe, "scaling a SPOF should be safe")
	assert.Greater(t, delta, 0.0, "health delta should be positive")
	// api-gateway has fanIn=6, so delta should be 6 * 1.5 = 9.0
	assert.InDelta(t, 9.0, delta, 0.01)
}

func TestSafetyGate_PDBActionSafe(t *testing.T) {
	snap := testSnapshot()
	gate := NewSafetyGate()

	finding := Finding{
		RuleID:          "missing-pdb",
		ActionType:      "create_pdb",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "payment-svc",
	}

	safe, delta, err := gate.Check(snap, finding)
	require.NoError(t, err)
	assert.True(t, safe, "creating PDB should be safe")
	assert.Equal(t, 5.0, delta)
}

func TestSafetyGate_SpreadActionSafe(t *testing.T) {
	snap := testSnapshot()
	gate := NewSafetyGate()

	finding := Finding{
		RuleID:          "missing-anti-affinity",
		ActionType:      "add_spread",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "payment-svc",
	}

	safe, delta, err := gate.Check(snap, finding)
	require.NoError(t, err)
	assert.True(t, safe)
	assert.Equal(t, 3.0, delta)
}

func TestSafetyGate_LimitsActionSafe(t *testing.T) {
	snap := testSnapshot()
	gate := NewSafetyGate()

	finding := Finding{
		RuleID:          "missing-limits",
		ActionType:      "set_limits",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "api-gateway",
	}

	safe, delta, err := gate.Check(snap, finding)
	require.NoError(t, err)
	assert.True(t, safe)
	assert.Equal(t, 2.0, delta)
}

func TestSafetyGate_RequestsActionSafe(t *testing.T) {
	snap := testSnapshot()
	gate := NewSafetyGate()

	finding := Finding{
		RuleID:          "missing-requests",
		ActionType:      "set_requests",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "api-gateway",
	}

	safe, delta, err := gate.Check(snap, finding)
	require.NoError(t, err)
	assert.True(t, safe)
	assert.Equal(t, 1.0, delta)
}

func TestSafetyGate_NetPolActionSafe(t *testing.T) {
	snap := testSnapshot()
	gate := NewSafetyGate()

	finding := Finding{
		RuleID:          "missing-netpol",
		ActionType:      "create_netpol",
		TargetKind:      "Namespace",
		TargetNamespace: "prod",
		TargetName:      "prod",
	}

	safe, delta, err := gate.Check(snap, finding)
	require.NoError(t, err)
	assert.True(t, safe)
	assert.Equal(t, 2.0, delta)
}

func TestSafetyGate_NilSnapshotDefaultsSafe(t *testing.T) {
	gate := NewSafetyGate()

	finding := Finding{
		RuleID:     "test",
		ActionType: "scale",
	}

	safe, delta, err := gate.Check(nil, finding)
	require.NoError(t, err)
	assert.True(t, safe, "nil snapshot should default to safe")
	assert.Equal(t, 0.0, delta)
}

func TestSafetyGate_ScaleWithNoDependents(t *testing.T) {
	snap := &graph.GraphSnapshot{
		Nodes: map[string]models.ResourceRef{
			"Deployment/prod/lonely": {Kind: "Deployment", Namespace: "prod", Name: "lonely"},
		},
		Forward:      make(map[string]map[string]bool),
		Reverse:      make(map[string]map[string]bool),
		NodeReplicas: map[string]int{"Deployment/prod/lonely": 1},
		NodeHasHPA:   make(map[string]bool),
		NodeHasPDB:   make(map[string]bool),
		Namespaces:   map[string]bool{"prod": true},
	}

	gate := NewSafetyGate()
	finding := Finding{
		ActionType:      "scale",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "lonely",
	}

	safe, delta, err := gate.Check(snap, finding)
	require.NoError(t, err)
	assert.True(t, safe)
	assert.Equal(t, 2.0, delta, "workload with no dependents gets default delta=2.0")
}
