package graph

import "github.com/kubilitics/kubilitics-backend/internal/models"

// ScoringParams is the exported equivalent of the unexported scoringParams,
// used by the simulation package to recompute criticality scores on a mutated snapshot.
type ScoringParams struct {
	PageRank         float64
	FanIn            int
	CrossNsCount     int
	IsDataStore      bool
	IsIngressExposed bool
	IsSPOF           bool
	HasHPA           bool
	HasPDB           bool
}

// ComputeCriticalityScore exports the internal computeCriticalityScore function
// so the simulation package can reuse the exact same scoring algorithm.
func ComputeCriticalityScore(p ScoringParams) float64 {
	return computeCriticalityScore(scoringParams{
		pageRank:         p.PageRank,
		fanIn:            p.FanIn,
		crossNsCount:     p.CrossNsCount,
		isDataStore:      p.IsDataStore,
		isIngressExposed: p.IsIngressExposed,
		isSPOF:           p.IsSPOF,
		hasHPA:           p.HasHPA,
		hasPDB:           p.HasPDB,
	})
}

// SimplePageRank exports the internal simplePageRank function
// so the simulation package can recompute PageRank on a mutated graph.
func SimplePageRank(
	nodes map[string]models.ResourceRef,
	forward, reverse map[string]map[string]bool,
) map[string]float64 {
	return simplePageRank(nodes, forward, reverse)
}

// BfsWalk exports the internal bfsWalk function for cross-namespace counting.
func BfsWalk(adj map[string]map[string]bool, startKey string) map[string]bool {
	return bfsWalk(adj, startKey)
}

// RefKey exports the internal refKey helper.
func RefKey(r models.ResourceRef) string {
	return refKey(r)
}
