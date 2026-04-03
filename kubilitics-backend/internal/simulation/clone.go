package simulation

import (
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// CloneSnapshot performs a deep copy of a GraphSnapshot so the simulation can
// mutate the clone without affecting the original immutable snapshot.
// Every map is individually cloned — Go maps are reference types.
func CloneSnapshot(src *graph.GraphSnapshot) *graph.GraphSnapshot {
	dst := &graph.GraphSnapshot{
		TotalWorkloads: src.TotalWorkloads,
		BuiltAt:        time.Now().UnixMilli(),
		BuildDuration:  src.BuildDuration,
	}

	// Nodes: map[string]models.ResourceRef
	dst.Nodes = make(map[string]models.ResourceRef, len(src.Nodes))
	for k, v := range src.Nodes {
		dst.Nodes[k] = v
	}

	// Forward: map[string]map[string]bool — each inner map must be cloned
	dst.Forward = cloneAdjacency(src.Forward)

	// Reverse: map[string]map[string]bool — each inner map must be cloned
	dst.Reverse = cloneAdjacency(src.Reverse)

	// Edges: slice of structs — copy into new backing array
	dst.Edges = make([]models.BlastDependencyEdge, len(src.Edges))
	copy(dst.Edges, src.Edges)

	// NodeScores: map[string]float64
	dst.NodeScores = make(map[string]float64, len(src.NodeScores))
	for k, v := range src.NodeScores {
		dst.NodeScores[k] = v
	}

	// NodeReplicas: map[string]int
	dst.NodeReplicas = make(map[string]int, len(src.NodeReplicas))
	for k, v := range src.NodeReplicas {
		dst.NodeReplicas[k] = v
	}

	// NodeHasHPA: map[string]bool
	dst.NodeHasHPA = make(map[string]bool, len(src.NodeHasHPA))
	for k, v := range src.NodeHasHPA {
		dst.NodeHasHPA[k] = v
	}

	// NodeHasPDB: map[string]bool
	dst.NodeHasPDB = make(map[string]bool, len(src.NodeHasPDB))
	for k, v := range src.NodeHasPDB {
		dst.NodeHasPDB[k] = v
	}

	// NodeIngress: map[string][]string — clone each slice
	dst.NodeIngress = make(map[string][]string, len(src.NodeIngress))
	for k, v := range src.NodeIngress {
		c := make([]string, len(v))
		copy(c, v)
		dst.NodeIngress[k] = c
	}

	// NodeRisks: map[string][]models.RiskIndicator — clone each slice
	dst.NodeRisks = make(map[string][]models.RiskIndicator, len(src.NodeRisks))
	for k, v := range src.NodeRisks {
		c := make([]models.RiskIndicator, len(v))
		copy(c, v)
		dst.NodeRisks[k] = c
	}

	// Namespaces: map[string]bool
	dst.Namespaces = make(map[string]bool, len(src.Namespaces))
	for k, v := range src.Namespaces {
		dst.Namespaces[k] = v
	}

	return dst
}

// cloneAdjacency deep-copies a map[string]map[string]bool adjacency structure.
func cloneAdjacency(src map[string]map[string]bool) map[string]map[string]bool {
	dst := make(map[string]map[string]bool, len(src))
	for k, inner := range src {
		c := make(map[string]bool, len(inner))
		for ik, iv := range inner {
			c[ik] = iv
		}
		dst[k] = c
	}
	return dst
}
