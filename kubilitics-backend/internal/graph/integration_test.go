package graph

import (
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
)

// buildSnapshotScenario1 creates a cluster with:
//   - 1 Deployment "app" with 3 replicas
//   - 3 Pods owned by the Deployment
//   - 1 Service "app-svc" with 3 ready endpoints pointing to the 3 pods
func buildSnapshotScenario1() *GraphSnapshot {
	dep := models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "app"}
	pod1 := models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "pod-1"}
	pod2 := models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "pod-2"}
	pod3 := models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "pod-3"}
	svc := models.ResourceRef{Kind: "Service", Namespace: "default", Name: "app-svc"}

	depKey := refKey(dep)
	pod1Key := refKey(pod1)
	pod2Key := refKey(pod2)
	pod3Key := refKey(pod3)
	svcKey := refKey(svc)

	snap := &GraphSnapshot{}
	snap.EnsureMaps()

	// Register nodes
	snap.Nodes[depKey] = dep
	snap.Nodes[pod1Key] = pod1
	snap.Nodes[pod2Key] = pod2
	snap.Nodes[pod3Key] = pod3
	snap.Nodes[svcKey] = svc

	// Pod owners: all 3 pods owned by the Deployment
	snap.PodOwners[pod1Key] = depKey
	snap.PodOwners[pod2Key] = depKey
	snap.PodOwners[pod3Key] = depKey

	// Replicas
	snap.NodeReplicas[depKey] = 3

	// Service endpoints: 3 ready endpoints pointing to the 3 pods
	snap.ServiceEndpoints[svcKey] = []corev1.EndpointAddress{
		{
			IP: "10.0.0.1",
			TargetRef: &corev1.ObjectReference{
				Kind:      "Pod",
				Namespace: "default",
				Name:      "pod-1",
			},
		},
		{
			IP: "10.0.0.2",
			TargetRef: &corev1.ObjectReference{
				Kind:      "Pod",
				Namespace: "default",
				Name:      "pod-2",
			},
		},
		{
			IP: "10.0.0.3",
			TargetRef: &corev1.ObjectReference{
				Kind:      "Pod",
				Namespace: "default",
				Name:      "pod-3",
			},
		},
	}

	// Graph edges: Service depends on Deployment, Deployment owns Pods
	snap.Forward[svcKey] = map[string]bool{depKey: true}
	snap.Reverse[depKey] = map[string]bool{svcKey: true}

	snap.Edges = []models.BlastDependencyEdge{
		{Source: svc, Target: dep, Type: "selects"},
	}

	snap.TotalWorkloads = 2 // Deployment + Service
	snap.BuiltAt = time.Now().UnixMilli()
	snap.Namespaces["default"] = true

	return snap
}

// buildSnapshotScenario2 creates a cluster with:
//   - 1 Deployment "api" with 1 replica
//   - 1 Pod owned by it
//   - 1 Service "api-svc" with 1 endpoint
func buildSnapshotScenario2() *GraphSnapshot {
	dep := models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "api"}
	pod := models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "api-pod-1"}
	svc := models.ResourceRef{Kind: "Service", Namespace: "default", Name: "api-svc"}

	depKey := refKey(dep)
	podKey := refKey(pod)
	svcKey := refKey(svc)

	snap := &GraphSnapshot{}
	snap.EnsureMaps()

	// Register nodes
	snap.Nodes[depKey] = dep
	snap.Nodes[podKey] = pod
	snap.Nodes[svcKey] = svc

	// Pod owners: 1 pod owned by the Deployment
	snap.PodOwners[podKey] = depKey

	// Replicas: single replica
	snap.NodeReplicas[depKey] = 1

	// Service endpoints: 1 endpoint pointing to the single pod
	snap.ServiceEndpoints[svcKey] = []corev1.EndpointAddress{
		{
			IP: "10.0.0.1",
			TargetRef: &corev1.ObjectReference{
				Kind:      "Pod",
				Namespace: "default",
				Name:      "api-pod-1",
			},
		},
	}

	// Graph edges
	snap.Forward[svcKey] = map[string]bool{depKey: true}
	snap.Reverse[depKey] = map[string]bool{svcKey: true}

	snap.Edges = []models.BlastDependencyEdge{
		{Source: svc, Target: dep, Type: "selects"},
	}

	snap.TotalWorkloads = 2 // Deployment + Service
	snap.BuiltAt = time.Now().UnixMilli()
	snap.Namespaces["default"] = true

	return snap
}

// TestScenario_PodCrashWithReplicas tests that crashing one pod from a 3-replica
// Deployment causes minimal impact: the service should be classified "self-healing"
// and the blast radius should be 0 (or near 0).
func TestScenario_PodCrashWithReplicas(t *testing.T) {
	snap := buildSnapshotScenario1()

	pod1 := models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "pod-1"}
	result, err := snap.ComputeBlastRadiusWithMode(pod1, FailureModePodCrash)
	require.NoError(t, err)
	require.NotNil(t, result)

	// With 3 replicas and only 1 lost, the service remains above the 50% threshold
	// → classification must be "self-healing", weight = 0.0 → blast radius = 0%
	assert.InDelta(t, 0.0, result.BlastRadiusPercent, 0.01,
		"blast radius should be ~0%% when only 1 of 3 replicas is lost")

	// Verify the affected service is classified as self-healing
	require.NotEmpty(t, result.AffectedServices,
		"should have at least one service impact entry")
	found := false
	for _, si := range result.AffectedServices {
		if si.Service.Name == "app-svc" {
			found = true
			assert.Equal(t, "self-healing", si.Classification,
				"app-svc should be self-healing: 2 of 3 endpoints remain")
		}
	}
	assert.True(t, found, "app-svc should appear in AffectedServices")
}

// TestScenario_SingleReplicaPodCrash tests that crashing the only pod of a
// single-replica Deployment results in a broken service and non-zero blast radius.
func TestScenario_SingleReplicaPodCrash(t *testing.T) {
	snap := buildSnapshotScenario2()

	pod := models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "api-pod-1"}
	result, err := snap.ComputeBlastRadiusWithMode(pod, FailureModePodCrash)
	require.NoError(t, err)
	require.NotNil(t, result)

	// With only 1 replica and it lost, the service must be "broken"
	require.NotEmpty(t, result.AffectedServices,
		"should have at least one service impact entry")
	found := false
	for _, si := range result.AffectedServices {
		if si.Service.Name == "api-svc" {
			found = true
			assert.Equal(t, "broken", si.Classification,
				"api-svc should be broken: 0 of 1 endpoints remain")
		}
	}
	assert.True(t, found, "api-svc should appear in AffectedServices")

	// Blast radius must be strictly greater than 0
	assert.Greater(t, result.BlastRadiusPercent, 0.0,
		"blast radius should be >0%% when the single replica is lost")
}

// buildSnapshotScenarioIngress creates a cluster with:
//   - 1 Deployment "web" with 1 replica
//   - 1 Pod "web-pod-1" owned by the Deployment
//   - 1 Service "web-svc" with 1 endpoint pointing to the pod
//   - 1 Ingress "web-ing" with host "app.example.com" depending on "web-svc"
func buildSnapshotScenarioIngress() *GraphSnapshot {
	dep := models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "web"}
	pod := models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "web-pod-1"}
	svc := models.ResourceRef{Kind: "Service", Namespace: "default", Name: "web-svc"}
	ing := models.ResourceRef{Kind: "Ingress", Namespace: "default", Name: "web-ing"}

	depKey := refKey(dep)
	podKey := refKey(pod)
	svcKey := refKey(svc)
	ingKey := refKey(ing)

	snap := &GraphSnapshot{}
	snap.EnsureMaps()

	snap.Nodes[depKey] = dep
	snap.Nodes[podKey] = pod
	snap.Nodes[svcKey] = svc
	snap.Nodes[ingKey] = ing

	snap.PodOwners[podKey] = depKey
	snap.NodeReplicas[depKey] = 1

	snap.ServiceEndpoints[svcKey] = []corev1.EndpointAddress{
		{
			IP: "10.0.0.1",
			TargetRef: &corev1.ObjectReference{
				Kind:      "Pod",
				Namespace: "default",
				Name:      "web-pod-1",
			},
		},
	}

	// Ingress -> Service -> Deployment
	snap.Forward[ingKey] = map[string]bool{svcKey: true}
	snap.Forward[svcKey] = map[string]bool{depKey: true}
	snap.Reverse[svcKey] = map[string]bool{ingKey: true}
	snap.Reverse[depKey] = map[string]bool{svcKey: true}

	snap.NodeIngress[ingKey] = []string{"app.example.com"}

	snap.Edges = []models.BlastDependencyEdge{
		{Source: ing, Target: svc, Type: "routes-to"},
		{Source: svc, Target: dep, Type: "selects"},
	}

	snap.TotalWorkloads = 3
	snap.BuiltAt = time.Now().UnixMilli()
	snap.Namespaces["default"] = true

	return snap
}

// buildSnapshotScenarioStatefulSet creates a cluster with:
//   - 1 StatefulSet "db" with 1 replica
//   - 1 Pod "db-0" owned by the StatefulSet
//   - 1 Service "db-svc" with 1 endpoint pointing to the pod
func buildSnapshotScenarioStatefulSet() *GraphSnapshot {
	sts := models.ResourceRef{Kind: "StatefulSet", Namespace: "default", Name: "db"}
	pod := models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "db-0"}
	svc := models.ResourceRef{Kind: "Service", Namespace: "default", Name: "db-svc"}

	stsKey := refKey(sts)
	podKey := refKey(pod)
	svcKey := refKey(svc)

	snap := &GraphSnapshot{}
	snap.EnsureMaps()

	snap.Nodes[stsKey] = sts
	snap.Nodes[podKey] = pod
	snap.Nodes[svcKey] = svc

	snap.PodOwners[podKey] = stsKey
	snap.NodeReplicas[stsKey] = 1

	snap.ServiceEndpoints[svcKey] = []corev1.EndpointAddress{
		{
			IP: "10.0.1.1",
			TargetRef: &corev1.ObjectReference{
				Kind:      "Pod",
				Namespace: "default",
				Name:      "db-0",
			},
		},
	}

	snap.Forward[svcKey] = map[string]bool{stsKey: true}
	snap.Reverse[stsKey] = map[string]bool{svcKey: true}

	snap.Edges = []models.BlastDependencyEdge{
		{Source: svc, Target: sts, Type: "selects"},
	}

	snap.TotalWorkloads = 2
	snap.BuiltAt = time.Now().UnixMilli()
	snap.Namespaces["default"] = true

	return snap
}

// TestScenario_ServiceLosingAllEndpoints tests that deleting a single-replica workload
// causes the service to lose all endpoints and be classified as "broken".
func TestScenario_ServiceLosingAllEndpoints(t *testing.T) {
	snap := buildSnapshotScenario2()
	dep := models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "api"}
	result, err := snap.ComputeBlastRadiusWithMode(dep, FailureModeWorkloadDeletion)
	require.NoError(t, err)
	require.NotNil(t, result)

	found := false
	for _, si := range result.AffectedServices {
		if si.Service.Name == "api-svc" {
			found = true
			assert.Equal(t, "broken", si.Classification)
			assert.Equal(t, 0, si.RemainingEndpoints)
		}
	}
	assert.True(t, found, "api-svc should appear in AffectedServices")
	assert.Greater(t, result.BlastRadiusPercent, 0.0)
}

// TestScenario_IngressLosingBackend tests that deleting a workload behind a service
// causes the ingress to be classified as "broken" when all backend endpoints are lost.
func TestScenario_IngressLosingBackend(t *testing.T) {
	snap := buildSnapshotScenarioIngress()
	dep := models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "web"}
	result, err := snap.ComputeBlastRadiusWithMode(dep, FailureModeWorkloadDeletion)
	require.NoError(t, err)
	require.NotNil(t, result)

	require.NotEmpty(t, result.AffectedIngresses, "ingress should be affected")
	assert.Equal(t, "broken", result.AffectedIngresses[0].Classification)
}

// TestScenario_NamespaceDeletion tests that deleting a namespace cascades to all
// workloads within it and reports non-zero affected resources.
func TestScenario_NamespaceDeletion(t *testing.T) {
	snap := buildSnapshotScenario1()
	ns := models.ResourceRef{Kind: "Namespace", Namespace: "", Name: "default"}
	result, err := snap.ComputeBlastRadiusWithMode(ns, FailureModeNamespaceDeletion)
	require.NoError(t, err)
	require.NotNil(t, result)

	assert.Equal(t, FailureModeNamespaceDeletion, result.FailureMode)
	assert.Greater(t, result.TotalAffected, 0)
}

// TestScenario_StatefulSetFailure tests that deleting a StatefulSet causes its
// headless service to lose all endpoints and be classified as "broken".
func TestScenario_StatefulSetFailure(t *testing.T) {
	snap := buildSnapshotScenarioStatefulSet()
	sts := models.ResourceRef{Kind: "StatefulSet", Namespace: "default", Name: "db"}
	result, err := snap.ComputeBlastRadiusWithMode(sts, FailureModeWorkloadDeletion)
	require.NoError(t, err)
	require.NotNil(t, result)

	found := false
	for _, si := range result.AffectedServices {
		if si.Service.Name == "db-svc" {
			found = true
			assert.Equal(t, "broken", si.Classification)
		}
	}
	assert.True(t, found)
	assert.Greater(t, result.BlastRadiusPercent, 0.0)
}

// TestScenario_ControlPlaneComponent tests that a control-plane component (kube-apiserver
// in kube-system) triggers the 100% blast radius override.
func TestScenario_ControlPlaneComponent(t *testing.T) {
	snap := &GraphSnapshot{}
	snap.EnsureMaps()

	apiserver := models.ResourceRef{Kind: "Deployment", Namespace: "kube-system", Name: "kube-apiserver"}
	pod := models.ResourceRef{Kind: "Pod", Namespace: "kube-system", Name: "kube-apiserver-pod-1"}

	snap.Nodes[refKey(apiserver)] = apiserver
	snap.Nodes[refKey(pod)] = pod
	snap.PodOwners[refKey(pod)] = refKey(apiserver)
	snap.NodeReplicas[refKey(apiserver)] = 1
	snap.TotalWorkloads = 1
	snap.BuiltAt = time.Now().UnixMilli()
	snap.Namespaces["kube-system"] = true

	result, err := snap.ComputeBlastRadiusWithMode(apiserver, FailureModeWorkloadDeletion)
	require.NoError(t, err)
	require.NotNil(t, result)

	// Control-plane component should trigger 100% blast radius
	assert.Equal(t, 100.0, result.BlastRadiusPercent)
}

// TestScenario_NodeDrain tests that draining a node evicts all pods scheduled on it
// and reports the correct number of affected pods.
func TestScenario_NodeDrain(t *testing.T) {
	snap := buildSnapshotScenario1()
	snap.PodNodes = map[string]string{
		"Pod/default/pod-1": "worker-1",
		"Pod/default/pod-2": "worker-1",
		"Pod/default/pod-3": "worker-2",
	}

	node := models.ResourceRef{Kind: "Node", Namespace: "", Name: "worker-1"}
	snap.Nodes[refKey(node)] = node

	result, err := snap.ComputeBlastRadiusWithMode(node, FailureModeNodeDrain)
	require.NoError(t, err)
	require.NotNil(t, result)

	assert.Equal(t, FailureModeNodeDrain, result.FailureMode)
	assert.Equal(t, 2, result.TotalAffected, "should lose 2 pods on worker-1")
}
