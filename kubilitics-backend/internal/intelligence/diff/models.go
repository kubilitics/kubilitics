package diff

import "time"

// TopologySnapshot represents a point-in-time capture of the cluster's topology graph.
type TopologySnapshot struct {
	ID        string           `json:"id"`
	ClusterID string           `json:"cluster_id"`
	Namespace string           `json:"namespace"` // empty string = cluster-wide
	Nodes     []SnapshotNode   `json:"nodes"`
	Edges     []SnapshotEdge   `json:"edges"`
	Metadata  SnapshotMetadata `json:"metadata"`
	CreatedAt time.Time        `json:"created_at"`
}

// SnapshotNode is a lightweight representation of a topology node for diffing.
type SnapshotNode struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Health    string `json:"health,omitempty"`
}

// SnapshotEdge captures a dependency relationship between two nodes.
type SnapshotEdge struct {
	Source string  `json:"source"`
	Target string  `json:"target"`
	Type   string  `json:"type"`
	Weight float64 `json:"weight"`
}

// SnapshotMetadata stores aggregate statistics about a snapshot.
type SnapshotMetadata struct {
	TotalNodes  int     `json:"total_nodes"`
	TotalEdges  int     `json:"total_edges"`
	SPOFCount   int     `json:"spof_count"`
	HealthScore float64 `json:"health_score,omitempty"`
}

// TopologyDiff represents the difference between two topology snapshots.
type TopologyDiff struct {
	FromSnapshot string         `json:"from_snapshot"` // snapshot ID or date
	ToSnapshot   string         `json:"to_snapshot"`
	AddedNodes   []SnapshotNode `json:"added_nodes"`
	RemovedNodes []SnapshotNode `json:"removed_nodes"`
	AddedEdges   []SnapshotEdge `json:"added_edges"`
	RemovedEdges []SnapshotEdge `json:"removed_edges"`
	ChangedEdges []EdgeChange   `json:"changed_edges"`
	Summary      DiffSummary    `json:"summary"`
}

// EdgeChange captures a weight change on an otherwise-identical edge.
type EdgeChange struct {
	Source    string  `json:"source"`
	Target   string  `json:"target"`
	Type     string  `json:"type"`
	OldWeight float64 `json:"old_weight"`
	NewWeight float64 `json:"new_weight"`
}

// DiffSummary provides counts and a human-readable description of the diff.
type DiffSummary struct {
	NodesAdded      int    `json:"nodes_added"`
	NodesRemoved    int    `json:"nodes_removed"`
	EdgesAdded      int    `json:"edges_added"`
	EdgesRemoved    int    `json:"edges_removed"`
	EdgesChanged    int    `json:"edges_changed"`
	NewSPOFs        int    `json:"new_spofs"`
	RemovedSPOFs    int    `json:"removed_spofs"`
	NaturalLanguage string `json:"natural_language"` // e.g. "5 new dependencies added, 2 SPOFs introduced"
}
