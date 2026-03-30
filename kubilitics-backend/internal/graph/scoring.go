package graph

import (
	"math"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// scoringParams holds the inputs required to compute a criticality score.
type scoringParams struct {
	pageRank         float64
	fanIn            int
	crossNsCount     int
	isDataStore      bool
	isIngressExposed bool
	isSPOF           bool
	hasHPA           bool
	hasPDB           bool
}

// computeCriticalityScore returns a 0-100 criticality score from the given params.
func computeCriticalityScore(p scoringParams) float64 {
	score := 0.0

	// PageRank contribution: max 30
	score += math.Min(p.pageRank*30.0, 30.0)

	// Fan-in contribution: max 20
	score += math.Min(float64(p.fanIn)*3.0, 20.0)

	// Cross-namespace contribution: max 10, only if >1
	if p.crossNsCount > 1 {
		score += math.Min(float64(p.crossNsCount)*2.5, 10.0)
	}

	// Data store bonus
	if p.isDataStore {
		score += 15.0
	}

	// Ingress exposed bonus
	if p.isIngressExposed {
		score += 10.0
	}

	// SPOF bonus
	if p.isSPOF {
		score += 10.0
	}

	// No HPA penalty
	if !p.hasHPA {
		score += 5.0
	}

	// No PDB penalty
	if !p.hasPDB {
		score += 5.0
	}

	// Cap at 100
	if score > 100.0 {
		score = 100.0
	}
	return score
}

// simplePageRank computes an iterative PageRank over the graph and returns
// a map of nodeKey -> normalized score in the [0, 1] range.
//
// Parameters:
//
//	nodes   – refKey -> ResourceRef mapping (keys are the node identifiers)
//	forward – adjacency map: source -> set of targets (what source depends on)
//	reverse – adjacency map: target -> set of sources (what depends on target)
func simplePageRank(
	nodes map[string]models.ResourceRef,
	forward map[string]map[string]bool,
	_ map[string]map[string]bool, // reverse — accepted for API symmetry; PageRank only needs forward
) map[string]float64 {
	nodeList := make([]string, 0, len(nodes))
	for k := range nodes {
		nodeList = append(nodeList, k)
	}
	return pageRankOnKeys(nodeList, forward)
}

// pageRankOnKeys is the core PageRank implementation operating on a plain
// slice of node keys.
func pageRankOnKeys(
	nodeList []string,
	forward map[string]map[string]bool,
) map[string]float64 {
	const damping = 0.85
	const maxIter = 50
	const convergenceThreshold = 0.0001

	n := len(nodeList)
	if n == 0 {
		return map[string]float64{}
	}

	rank := make(map[string]float64, n)
	initial := 1.0 / float64(n)
	for _, k := range nodeList {
		rank[k] = initial
	}

	for iter := 0; iter < maxIter; iter++ {
		newRank := make(map[string]float64, n)
		for _, k := range nodeList {
			newRank[k] = (1.0 - damping) / float64(n)
		}

		for _, k := range nodeList {
			// outDegree = number of outgoing edges (forward links)
			out := len(forward[k])
			if out == 0 {
				// Dangling node: distribute rank evenly to all nodes
				share := rank[k] / float64(n)
				for _, dest := range nodeList {
					newRank[dest] += damping * share
				}
			} else {
				share := rank[k] / float64(out)
				for dest := range forward[k] {
					newRank[dest] += damping * share
				}
			}
		}

		// Check convergence
		delta := 0.0
		for _, k := range nodeList {
			d := newRank[k] - rank[k]
			if d < 0 {
				d = -d
			}
			delta += d
		}
		rank = newRank
		if delta < convergenceThreshold {
			break
		}
	}

	// Normalize to [0, 1]
	maxVal := 0.0
	for _, v := range rank {
		if v > maxVal {
			maxVal = v
		}
	}
	if maxVal > 0 {
		for k, v := range rank {
			rank[k] = v / maxVal
		}
	}

	return rank
}

