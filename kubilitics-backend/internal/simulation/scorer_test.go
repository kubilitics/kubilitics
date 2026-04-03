package simulation

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRescoreSnapshot_ScoresChangeWhenNodesRemoved(t *testing.T) {
	snap := buildFixtureSnapshot()
	clone := CloneSnapshot(snap)

	// Score the original
	rescoreSnapshot(snap)
	origScore := snap.NodeScores["Deployment/default/api"]

	// Remove ConfigMap (a dependency of the Deployment)
	_ = deleteResource(clone, "ConfigMap/default/cfg")

	// Rescore the mutated clone
	rescoreSnapshot(clone)
	newScore := clone.NodeScores["Deployment/default/api"]

	// Scores should differ because the graph structure changed
	// (PageRank redistribution + fanOut changed)
	assert.NotEqual(t, origScore, newScore,
		"scores should change when dependencies are removed (orig=%f, new=%f)", origScore, newScore)
}

func TestRescoreSnapshot_EmptySnapshot(t *testing.T) {
	snap := buildFixtureSnapshot()
	clone := CloneSnapshot(snap)

	// Remove all nodes
	for key := range clone.Nodes {
		delete(clone.Nodes, key)
	}
	clone.Forward = make(map[string]map[string]bool)
	clone.Reverse = make(map[string]map[string]bool)

	// Should not panic
	rescoreSnapshot(clone)
	assert.Equal(t, 0, len(clone.NodeScores))
}

func TestComputeHealthScore_FullyHealthyCluster(t *testing.T) {
	snap := buildFixtureSnapshot()
	// Give everything HPA and high replicas to make cluster "healthy"
	snap.NodeHasHPA["Deployment/default/api"] = true
	snap.NodeReplicas["Deployment/default/api"] = 3

	rescoreSnapshot(snap)
	health := computeHealthScore(snap)

	// Health should be relatively high (above 50 at least)
	assert.Greater(t, health, 50.0, "healthy cluster should score above 50")
}

func TestComputeHealthScore_EmptyCluster(t *testing.T) {
	snap := buildFixtureSnapshot()
	for key := range snap.Nodes {
		delete(snap.Nodes, key)
	}
	health := computeHealthScore(snap)
	assert.Equal(t, 100.0, health, "empty cluster should be 100% healthy")
}

func TestCountSPOFs(t *testing.T) {
	snap := buildMutatorFixture()

	// staging/worker has replicas=1, no HPA, and has fanIn=1 (from Service) -> SPOF
	spofs := countSPOFs(snap)
	assert.Greater(t, spofs, 0, "should detect at least one SPOF")
}

func TestIsSPOF(t *testing.T) {
	snap := buildMutatorFixture()

	// Deployment/staging/worker: replicas=1, hasHPA=false, fanIn=1 -> SPOF
	assert.True(t, isSPOF(snap, "Deployment/staging/worker"), "single replica + no HPA + dependents = SPOF")

	// Deployment/default/api: replicas=3, hasHPA=true -> not SPOF
	assert.False(t, isSPOF(snap, "Deployment/default/api"), "multi-replica + HPA != SPOF")
}
