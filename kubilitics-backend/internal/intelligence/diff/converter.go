package diff

import (
	"time"

	"github.com/google/uuid"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// TopologyResponseToSnapshot converts a V2 TopologyResponse into a TopologySnapshot
// suitable for storage and diffing.
func TopologyResponseToSnapshot(clusterID, namespace string, resp *v2.TopologyResponse) TopologySnapshot {
	nodes := make([]SnapshotNode, 0, len(resp.Nodes))
	for _, n := range resp.Nodes {
		nodes = append(nodes, SnapshotNode{
			ID:        n.ID,
			Name:      n.Name,
			Kind:      n.Kind,
			Namespace: n.Namespace,
			Health:    n.Status,
		})
	}

	edges := make([]SnapshotEdge, 0, len(resp.Edges))
	for _, e := range resp.Edges {
		// V2 edges don't have an explicit weight; use 1.0 for healthy, 0.5 for unhealthy.
		weight := 1.0
		if !e.Healthy {
			weight = 0.5
		}
		edges = append(edges, SnapshotEdge{
			Source: e.Source,
			Target: e.Target,
			Type:   string(e.RelationshipType),
			Weight: weight,
		})
	}

	return TopologySnapshot{
		ID:        uuid.New().String(),
		ClusterID: clusterID,
		Namespace: namespace,
		Nodes:     nodes,
		Edges:     edges,
		Metadata: SnapshotMetadata{
			TotalNodes: len(nodes),
			TotalEdges: len(edges),
			// SPOFCount and HealthScore are populated by the caller if available.
		},
		CreatedAt: time.Now(),
	}
}
