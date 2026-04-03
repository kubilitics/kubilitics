package autopilot

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testSnapshot builds a GraphSnapshot fixture used by all rule tests.
// It models a small cluster with:
//   - "api-gateway" Deployment: 1 replica, no HPA, no PDB, 6 dependents (SPOF)
//   - "payment-svc" Deployment: 3 replicas, no PDB, 4 dependents
//   - "redis" StatefulSet: 1 replica, no HPA, no PDB, 3 dependents (SPOF)
//   - "frontend" Deployment: 2 replicas, HPA, PDB, 2 dependents (healthy)
//   - Two namespaces: "prod" with no NetworkPolicy, "infra" with one
func testSnapshot() *graph.GraphSnapshot {
	nodes := map[string]models.ResourceRef{
		"Deployment/prod/api-gateway": {Kind: "Deployment", Namespace: "prod", Name: "api-gateway"},
		"Deployment/prod/payment-svc": {Kind: "Deployment", Namespace: "prod", Name: "payment-svc"},
		"StatefulSet/prod/redis":      {Kind: "StatefulSet", Namespace: "prod", Name: "redis"},
		"Deployment/prod/frontend":    {Kind: "Deployment", Namespace: "prod", Name: "frontend"},
		"Service/prod/api-svc":        {Kind: "Service", Namespace: "prod", Name: "api-svc"},
		"Service/prod/payment-ep":     {Kind: "Service", Namespace: "prod", Name: "payment-ep"},
		"Service/prod/redis-svc":      {Kind: "Service", Namespace: "prod", Name: "redis-svc"},
		"Service/prod/frontend-svc":   {Kind: "Service", Namespace: "prod", Name: "frontend-svc"},
		"ConfigMap/prod/app-config":   {Kind: "ConfigMap", Namespace: "prod", Name: "app-config"},
		"Secret/prod/db-creds":        {Kind: "Secret", Namespace: "prod", Name: "db-creds"},
		"NetworkPolicy/infra/deny-all": {Kind: "NetworkPolicy", Namespace: "infra", Name: "deny-all"},
		"Deployment/infra/monitoring": {Kind: "Deployment", Namespace: "infra", Name: "monitoring"},
	}

	// Build reverse dependencies (who depends on me)
	reverse := map[string]map[string]bool{
		// api-gateway has 6 dependents
		"Deployment/prod/api-gateway": {
			"Service/prod/api-svc":        true,
			"Service/prod/frontend-svc":   true,
			"Deployment/prod/frontend":    true,
			"Deployment/prod/payment-svc": true,
			"ConfigMap/prod/app-config":   true,
			"Secret/prod/db-creds":        true,
		},
		// payment-svc has 4 dependents
		"Deployment/prod/payment-svc": {
			"Service/prod/payment-ep":   true,
			"Service/prod/api-svc":      true,
			"ConfigMap/prod/app-config": true,
			"Secret/prod/db-creds":      true,
		},
		// redis has 3 dependents
		"StatefulSet/prod/redis": {
			"Service/prod/redis-svc":      true,
			"Deployment/prod/api-gateway": true,
			"Deployment/prod/payment-svc": true,
		},
		// frontend has 2 dependents
		"Deployment/prod/frontend": {
			"Service/prod/frontend-svc": true,
			"Service/prod/api-svc":      true,
		},
	}

	forward := map[string]map[string]bool{
		"Service/prod/api-svc":      {"Deployment/prod/api-gateway": true},
		"Service/prod/payment-ep":   {"Deployment/prod/payment-svc": true},
		"Service/prod/redis-svc":    {"StatefulSet/prod/redis": true},
		"Service/prod/frontend-svc": {"Deployment/prod/frontend": true},
	}

	return &graph.GraphSnapshot{
		Nodes:   nodes,
		Forward: forward,
		Reverse: reverse,
		NodeReplicas: map[string]int{
			"Deployment/prod/api-gateway": 1,
			"Deployment/prod/payment-svc": 3,
			"StatefulSet/prod/redis":      1,
			"Deployment/prod/frontend":    2,
			"Deployment/infra/monitoring": 1,
		},
		NodeHasHPA: map[string]bool{
			"Deployment/prod/api-gateway": false,
			"Deployment/prod/payment-svc": false,
			"StatefulSet/prod/redis":      false,
			"Deployment/prod/frontend":    true,
			"Deployment/infra/monitoring": false,
		},
		NodeHasPDB: map[string]bool{
			"Deployment/prod/api-gateway": false,
			"Deployment/prod/payment-svc": false,
			"StatefulSet/prod/redis":      false,
			"Deployment/prod/frontend":    true,
			"Deployment/infra/monitoring": false,
		},
		Namespaces: map[string]bool{
			"prod":  true,
			"infra": true,
		},
		TotalWorkloads: 5,
		BuiltAt:        1000000,
	}
}

// --- SPOF Rule ---

func TestSPOFRule_DetectsCorrectFindings(t *testing.T) {
	snap := testSnapshot()
	rule := &SPOFRule{}
	findings := rule.Detect(snap)

	// api-gateway: 1 replica, no HPA, fanIn=6 -> should be detected as high severity
	// redis: 1 replica, no HPA, fanIn=3 -> should be detected as medium severity
	require.Len(t, findings, 2, "expected 2 SPOF findings (api-gateway and redis)")

	findingMap := make(map[string]Finding)
	for _, f := range findings {
		findingMap[f.TargetName] = f
	}

	gw, ok := findingMap["api-gateway"]
	require.True(t, ok, "expected api-gateway finding")
	assert.Equal(t, "high", gw.Severity, "api-gateway has fanIn=6, should be high")
	assert.Equal(t, "scale", gw.ActionType)
	assert.Equal(t, "Deployment", gw.TargetKind)
	assert.Equal(t, "prod", gw.TargetNamespace)

	redis, ok := findingMap["redis"]
	require.True(t, ok, "expected redis finding")
	assert.Equal(t, "medium", redis.Severity, "redis has fanIn=3, should be medium")
	assert.Equal(t, "scale", redis.ActionType)
	assert.Equal(t, "StatefulSet", redis.TargetKind)
}

func TestSPOFRule_IgnoresHPAProtected(t *testing.T) {
	snap := testSnapshot()
	// Give api-gateway an HPA
	snap.NodeHasHPA["Deployment/prod/api-gateway"] = true

	rule := &SPOFRule{}
	findings := rule.Detect(snap)

	findingNames := make(map[string]bool)
	for _, f := range findings {
		findingNames[f.TargetName] = true
	}
	assert.False(t, findingNames["api-gateway"], "api-gateway with HPA should not be flagged")
}

func TestSPOFRule_IgnoresMultiReplica(t *testing.T) {
	snap := testSnapshot()
	rule := &SPOFRule{}
	findings := rule.Detect(snap)

	findingNames := make(map[string]bool)
	for _, f := range findings {
		findingNames[f.TargetName] = true
	}
	assert.False(t, findingNames["payment-svc"], "payment-svc with 3 replicas should not be flagged")
}

// --- Missing PDB Rule ---

func TestMissingPDBRule_DetectsCorrectFindings(t *testing.T) {
	snap := testSnapshot()
	rule := &MissingPDBRule{}
	findings := rule.Detect(snap)

	// payment-svc: 3 replicas, no PDB -> should be detected
	// frontend: 2 replicas, has PDB -> should NOT be detected
	require.Len(t, findings, 1, "expected 1 missing-PDB finding (payment-svc)")
	assert.Equal(t, "payment-svc", findings[0].TargetName)
	assert.Equal(t, "high", findings[0].Severity)
	assert.Equal(t, "create_pdb", findings[0].ActionType)
}

func TestMissingPDBRule_IgnoresSingleReplica(t *testing.T) {
	snap := testSnapshot()
	rule := &MissingPDBRule{}
	findings := rule.Detect(snap)

	findingNames := make(map[string]bool)
	for _, f := range findings {
		findingNames[f.TargetName] = true
	}
	assert.False(t, findingNames["api-gateway"], "single-replica workloads should not get PDB finding")
}

// --- Missing Network Policy Rule ---

func TestMissingNetPolRule_DetectsUncoveredNamespace(t *testing.T) {
	snap := testSnapshot()
	rule := &MissingNetPolRule{}
	findings := rule.Detect(snap)

	// "prod" has no NetworkPolicy -> should be detected
	// "infra" has a NetworkPolicy -> should NOT be detected
	require.Len(t, findings, 1, "expected 1 missing-netpol finding")
	assert.Equal(t, "prod", findings[0].TargetNamespace)
	assert.Equal(t, "medium", findings[0].Severity)
	assert.Equal(t, "create_netpol", findings[0].ActionType)
}

func TestMissingNetPolRule_SkipsInfraNamespaces(t *testing.T) {
	snap := testSnapshot()
	// Add kube-system with no netpol — should be skipped
	snap.Namespaces["kube-system"] = true

	rule := &MissingNetPolRule{}
	findings := rule.Detect(snap)

	findingNames := make(map[string]bool)
	for _, f := range findings {
		findingNames[f.TargetNamespace] = true
	}
	assert.False(t, findingNames["kube-system"], "kube-system should be skipped")
}

// --- Missing Anti-Affinity Rule ---

func TestMissingAntiAffinityRule_DetectsHighFanInMultiReplica(t *testing.T) {
	snap := testSnapshot()
	rule := &MissingAntiAffinityRule{}
	findings := rule.Detect(snap)

	// payment-svc: 3 replicas, fanIn=4 -> should be detected
	// frontend: 2 replicas, fanIn=2 -> fanIn <= 3, should NOT be detected
	require.Len(t, findings, 1, "expected 1 anti-affinity finding (payment-svc)")
	assert.Equal(t, "payment-svc", findings[0].TargetName)
	assert.Equal(t, "high", findings[0].Severity)
	assert.Equal(t, "add_spread", findings[0].ActionType)
}

// --- Missing Limits Rule ---

func TestMissingLimitsRule_DetectsHighFanInUnprotected(t *testing.T) {
	snap := testSnapshot()
	rule := &MissingLimitsRule{}
	findings := rule.Detect(snap)

	// Workloads with fanIn >= 3 and not both HPA+PDB:
	// api-gateway: fanIn=6, no HPA, no PDB -> detected
	// payment-svc: fanIn=4, no HPA, no PDB -> detected
	// redis: fanIn=3, no HPA, no PDB -> detected
	// frontend: fanIn=2 -> too low
	findingNames := make(map[string]bool)
	for _, f := range findings {
		findingNames[f.TargetName] = true
		assert.Equal(t, "medium", f.Severity)
		assert.Equal(t, "set_limits", f.ActionType)
	}
	assert.True(t, findingNames["api-gateway"], "api-gateway should be flagged")
	assert.True(t, findingNames["payment-svc"], "payment-svc should be flagged")
	assert.True(t, findingNames["redis"], "redis should be flagged")
}

// --- Missing Requests Rule ---

func TestMissingRequestsRule_DetectsWorkloadsWithoutHPA(t *testing.T) {
	snap := testSnapshot()
	rule := &MissingRequestsRule{}
	findings := rule.Detect(snap)

	// Workloads with replicas > 0, fanIn > 0, no HPA:
	// api-gateway: replica=1, fanIn=6, no HPA -> detected
	// payment-svc: replica=3, fanIn=4, no HPA -> detected
	// redis: replica=1, fanIn=3, no HPA -> detected
	// frontend: replica=2, has HPA -> NOT detected
	// monitoring: replica=1, fanIn=0 -> NOT detected
	findingNames := make(map[string]bool)
	for _, f := range findings {
		findingNames[f.TargetName] = true
		assert.Equal(t, "low", f.Severity)
		assert.Equal(t, "set_requests", f.ActionType)
	}
	assert.True(t, findingNames["api-gateway"])
	assert.True(t, findingNames["payment-svc"])
	assert.True(t, findingNames["redis"])
	assert.False(t, findingNames["frontend"], "frontend has HPA, should not be flagged")
	assert.False(t, findingNames["monitoring"], "monitoring has no dependents")
}

// --- RuleRegistry ---

func TestRuleRegistry_DetectAll(t *testing.T) {
	snap := testSnapshot()
	registry := NewRuleRegistry()
	findings := registry.DetectAll(snap)

	// Verify all 6 rules contributed findings
	ruleIDs := make(map[string]bool)
	for _, f := range findings {
		ruleIDs[f.RuleID] = true
	}

	assert.True(t, ruleIDs["spof-single-replica"], "SPOF rule should produce findings")
	assert.True(t, ruleIDs["missing-pdb"], "PDB rule should produce findings")
	assert.True(t, ruleIDs["missing-limits"], "Limits rule should produce findings")
	assert.True(t, ruleIDs["missing-netpol"], "NetPol rule should produce findings")
	assert.True(t, ruleIDs["missing-anti-affinity"], "Anti-affinity rule should produce findings")
	assert.True(t, ruleIDs["missing-requests"], "Requests rule should produce findings")
}

func TestRuleRegistry_DetectAll_EmptySnapshot(t *testing.T) {
	snap := &graph.GraphSnapshot{
		Nodes:        make(map[string]models.ResourceRef),
		Forward:      make(map[string]map[string]bool),
		Reverse:      make(map[string]map[string]bool),
		NodeReplicas: make(map[string]int),
		NodeHasHPA:   make(map[string]bool),
		NodeHasPDB:   make(map[string]bool),
		Namespaces:   make(map[string]bool),
	}

	registry := NewRuleRegistry()
	findings := registry.DetectAll(snap)
	assert.Empty(t, findings, "empty snapshot should produce zero findings")
}
