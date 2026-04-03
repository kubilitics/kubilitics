package simulation

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestComputeDiff_RemovedNodes(t *testing.T) {
	original := buildMutatorFixture()
	rescoreSnapshot(original)

	clone := CloneSnapshot(original)
	_ = deleteResource(clone, "ConfigMap/default/cfg")
	rescoreSnapshot(clone)

	diff := computeDiff(original, clone)

	assert.Len(t, diff.RemovedNodes, 1)
	assert.Equal(t, "ConfigMap/default/cfg", diff.RemovedNodes[0].Key)
}

func TestComputeDiff_AddedNodes(t *testing.T) {
	original := buildMutatorFixture()
	rescoreSnapshot(original)

	clone := CloneSnapshot(original)
	yaml := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: new-svc
  namespace: default
spec:
  replicas: 2
`
	_ = deployNew(clone, yaml)
	rescoreSnapshot(clone)

	diff := computeDiff(original, clone)

	assert.Len(t, diff.AddedNodes, 1)
	assert.Equal(t, "Deployment/default/new-svc", diff.AddedNodes[0].Key)
}

func TestComputeDiff_ModifiedNodes(t *testing.T) {
	original := buildMutatorFixture()
	rescoreSnapshot(original)

	clone := CloneSnapshot(original)
	// Removing ConfigMap changes the Deployment's PageRank and thus its score
	_ = deleteResource(clone, "ConfigMap/default/cfg")
	rescoreSnapshot(clone)

	diff := computeDiff(original, clone)

	// At minimum, the Deployment should show as modified (score changed)
	found := false
	for _, m := range diff.ModifiedNodes {
		if m.Key == "Deployment/default/api" {
			found = true
			break
		}
	}
	assert.True(t, found, "Deployment should be in ModifiedNodes after dependency removal")
}

func TestComputeDiff_LostEdges(t *testing.T) {
	original := buildMutatorFixture()
	rescoreSnapshot(original)

	clone := CloneSnapshot(original)
	_ = deleteResource(clone, "ConfigMap/default/cfg")
	rescoreSnapshot(clone)

	diff := computeDiff(original, clone)

	assert.Greater(t, len(diff.LostEdges), 0, "removing ConfigMap should produce lost edges")

	// Verify the specific edge Deployment/default/api -> ConfigMap/default/cfg is lost
	found := false
	for _, e := range diff.LostEdges {
		if e.Source == "Deployment/default/api" && e.Target == "ConfigMap/default/cfg" {
			found = true
			break
		}
	}
	assert.True(t, found, "edge from Deployment to ConfigMap should be in lost edges")
}

func TestComputeDiff_AffectedServices(t *testing.T) {
	original := buildMutatorFixture()
	rescoreSnapshot(original)

	clone := CloneSnapshot(original)
	// Remove the Deployment that the Service depends on
	_ = deleteResource(clone, "Deployment/default/api")
	rescoreSnapshot(clone)

	diff := computeDiff(original, clone)

	assert.Greater(t, len(diff.AffectedServices), 0, "Service/default/api should be affected")
	assert.Equal(t, "Service/default/api", diff.AffectedServices[0].Key)
}

func TestComputeDiff_NewSPOFs(t *testing.T) {
	original := buildMutatorFixture()
	// Deployment/default/api: replicas=3, hasHPA=true -> not a SPOF
	rescoreSnapshot(original)

	clone := CloneSnapshot(original)
	// Scale down to 1 replica and remove HPA
	clone.NodeReplicas["Deployment/default/api"] = 1
	clone.NodeHasHPA["Deployment/default/api"] = false
	rescoreSnapshot(clone)

	diff := computeDiff(original, clone)

	found := false
	for _, s := range diff.NewSPOFs {
		if s.Key == "Deployment/default/api" {
			found = true
			break
		}
	}
	assert.True(t, found, "Deployment/default/api should become a new SPOF after scale down")
}

func TestComputeDiff_ResolvedSPOFs(t *testing.T) {
	original := buildMutatorFixture()
	// Deployment/staging/worker: replicas=1, hasHPA=false, has reverse deps -> is SPOF
	rescoreSnapshot(original)
	require.True(t, isSPOF(original, "Deployment/staging/worker"), "precondition: should be SPOF")

	clone := CloneSnapshot(original)
	// Scale up to resolve the SPOF
	clone.NodeReplicas["Deployment/staging/worker"] = 3
	rescoreSnapshot(clone)

	diff := computeDiff(original, clone)

	found := false
	for _, s := range diff.ResolvedSPOFs {
		if s.Key == "Deployment/staging/worker" {
			found = true
			break
		}
	}
	assert.True(t, found, "Deployment/staging/worker should be a resolved SPOF after scale up")
}

func TestComputeDiff_EmptyDiff(t *testing.T) {
	original := buildMutatorFixture()
	rescoreSnapshot(original)

	clone := CloneSnapshot(original)
	rescoreSnapshot(clone)

	diff := computeDiff(original, clone)

	assert.Empty(t, diff.RemovedNodes)
	assert.Empty(t, diff.AddedNodes)
	assert.Empty(t, diff.LostEdges)
	assert.Empty(t, diff.AddedEdges)
}
