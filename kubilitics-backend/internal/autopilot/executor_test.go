package autopilot

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExecutor_ScalePatch(t *testing.T) {
	exec := NewExecutor()
	finding := Finding{
		ActionType:      "scale",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "api-gateway",
	}

	patch, err := exec.GeneratePatch(finding)
	require.NoError(t, err)

	m := patch.(map[string]interface{})
	assert.Equal(t, "apps/v1", m["apiVersion"])
	assert.Equal(t, "Deployment", m["kind"])

	meta := m["metadata"].(map[string]interface{})
	assert.Equal(t, "api-gateway", meta["name"])
	assert.Equal(t, "prod", meta["namespace"])

	spec := m["spec"].(map[string]interface{})
	assert.Equal(t, 2, spec["replicas"])
}

func TestExecutor_PDBPatch(t *testing.T) {
	exec := NewExecutor()
	finding := Finding{
		ActionType:      "create_pdb",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "payment-svc",
	}

	patch, err := exec.GeneratePatch(finding)
	require.NoError(t, err)

	m := patch.(map[string]interface{})
	assert.Equal(t, "policy/v1", m["apiVersion"])
	assert.Equal(t, "PodDisruptionBudget", m["kind"])

	meta := m["metadata"].(map[string]interface{})
	assert.Equal(t, "payment-svc-pdb", meta["name"])
	assert.Equal(t, "prod", meta["namespace"])

	spec := m["spec"].(map[string]interface{})
	assert.Equal(t, 1, spec["maxUnavailable"])

	selector := spec["selector"].(map[string]interface{})
	matchLabels := selector["matchLabels"].(map[string]interface{})
	assert.Equal(t, "payment-svc", matchLabels["app"])
}

func TestExecutor_LimitsPatch(t *testing.T) {
	exec := NewExecutor()
	finding := Finding{
		ActionType:      "set_limits",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "api-gateway",
	}

	patch, err := exec.GeneratePatch(finding)
	require.NoError(t, err)

	m := patch.(map[string]interface{})
	assert.Equal(t, "apps/v1", m["apiVersion"])
	assert.Equal(t, "Deployment", m["kind"])

	spec := m["spec"].(map[string]interface{})
	tmpl := spec["template"].(map[string]interface{})
	podSpec := tmpl["spec"].(map[string]interface{})
	containers := podSpec["containers"].([]map[string]interface{})
	require.Len(t, containers, 1)

	resources := containers[0]["resources"].(map[string]interface{})
	limits := resources["limits"].(map[string]interface{})
	assert.Equal(t, "500m", limits["cpu"])
	assert.Equal(t, "512Mi", limits["memory"])
}

func TestExecutor_NetPolPatch(t *testing.T) {
	exec := NewExecutor()
	finding := Finding{
		ActionType:      "create_netpol",
		TargetKind:      "Namespace",
		TargetNamespace: "prod",
		TargetName:      "prod",
	}

	patch, err := exec.GeneratePatch(finding)
	require.NoError(t, err)

	m := patch.(map[string]interface{})
	assert.Equal(t, "networking.k8s.io/v1", m["apiVersion"])
	assert.Equal(t, "NetworkPolicy", m["kind"])

	meta := m["metadata"].(map[string]interface{})
	assert.Equal(t, "default-deny-ingress", meta["name"])
	assert.Equal(t, "prod", meta["namespace"])

	spec := m["spec"].(map[string]interface{})
	policyTypes := spec["policyTypes"].([]string)
	assert.Contains(t, policyTypes, "Ingress")
}

func TestExecutor_SpreadPatch(t *testing.T) {
	exec := NewExecutor()
	finding := Finding{
		ActionType:      "add_spread",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "payment-svc",
	}

	patch, err := exec.GeneratePatch(finding)
	require.NoError(t, err)

	m := patch.(map[string]interface{})
	assert.Equal(t, "apps/v1", m["apiVersion"])

	spec := m["spec"].(map[string]interface{})
	tmpl := spec["template"].(map[string]interface{})
	podSpec := tmpl["spec"].(map[string]interface{})
	constraints := podSpec["topologySpreadConstraints"].([]map[string]interface{})
	require.Len(t, constraints, 1)

	assert.Equal(t, 1, constraints[0]["maxSkew"])
	assert.Equal(t, "kubernetes.io/hostname", constraints[0]["topologyKey"])
	assert.Equal(t, "DoNotSchedule", constraints[0]["whenUnsatisfiable"])
}

func TestExecutor_RequestsPatch(t *testing.T) {
	exec := NewExecutor()
	finding := Finding{
		ActionType:      "set_requests",
		TargetKind:      "StatefulSet",
		TargetNamespace: "prod",
		TargetName:      "redis",
	}

	patch, err := exec.GeneratePatch(finding)
	require.NoError(t, err)

	m := patch.(map[string]interface{})
	assert.Equal(t, "apps/v1", m["apiVersion"])
	assert.Equal(t, "StatefulSet", m["kind"])

	spec := m["spec"].(map[string]interface{})
	tmpl := spec["template"].(map[string]interface{})
	podSpec := tmpl["spec"].(map[string]interface{})
	containers := podSpec["containers"].([]map[string]interface{})
	require.Len(t, containers, 1)

	resources := containers[0]["resources"].(map[string]interface{})
	requests := resources["requests"].(map[string]interface{})
	assert.Equal(t, "100m", requests["cpu"])
	assert.Equal(t, "128Mi", requests["memory"])
}

func TestExecutor_UnsupportedActionType(t *testing.T) {
	exec := NewExecutor()
	finding := Finding{
		ActionType: "unknown_action",
	}

	_, err := exec.GeneratePatch(finding)
	assert.Error(t, err, "unsupported action type should return error")
	assert.Contains(t, err.Error(), "unsupported action type")
}
