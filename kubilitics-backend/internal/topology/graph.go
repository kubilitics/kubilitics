package topology

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// OwnerRef is used for inferencing owner-reference edges (UID lookup).
type OwnerRef struct {
	UID       string
	Kind      string
	Name      string
	Namespace string
}

// Graph represents the topology graph
type Graph struct {
	Nodes         []models.TopologyNode
	Edges         []models.TopologyEdge
	NodeMap       map[string]*models.TopologyNode // id -> node
	UIDToNode     map[string]*models.TopologyNode // uid -> node (for owner ref inference)
	EdgeMap       map[string]bool
	nodeOwnerRefs map[string][]OwnerRef            // nodeID -> owner refs
	nodeExtra     map[string]map[string]interface{} // nodeID -> extra fields for inference (scaleTargetRef, roleRef, spec, etc.)
	LayoutSeed    string
	// MaxNodes caps the number of nodes (C1.4); 0 = no limit. When reached, Truncated is set and no more nodes are added.
	MaxNodes   int
	Truncated  bool
}

// NewGraph creates a new empty graph. Optionally pass maxNodes > 0 to cap node count (C1.4).
func NewGraph(maxNodes int) *Graph {
	return &Graph{
		Nodes:         []models.TopologyNode{},
		Edges:         []models.TopologyEdge{},
		NodeMap:       make(map[string]*models.TopologyNode),
		UIDToNode:     make(map[string]*models.TopologyNode),
		EdgeMap:       make(map[string]bool),
		nodeOwnerRefs: make(map[string][]OwnerRef),
		nodeExtra:     make(map[string]map[string]interface{}),
		MaxNodes:      maxNodes,
	}
}

// SetNodeExtra stores extra per-node data for inference (e.g. scaleTargetRef, roleRef, spec).
func (g *Graph) SetNodeExtra(nodeID string, extra map[string]interface{}) {
	g.nodeExtra[nodeID] = extra
}

// GetNodeExtra returns extra data for a node (for inference only).
func (g *Graph) GetNodeExtra(nodeID string) map[string]interface{} {
	return g.nodeExtra[nodeID]
}

// SetOwnerRefs stores owner references for a node (used by engine for inference).
func (g *Graph) SetOwnerRefs(nodeID string, refs []OwnerRef) {
	g.nodeOwnerRefs[nodeID] = refs
}

// GetOwnerRefs returns owner references for a node.
func (g *Graph) GetOwnerRefs(nodeID string) []OwnerRef {
	return g.nodeOwnerRefs[nodeID]
}

// GetNodeByUID returns a node by its UID (for owner ref resolution).
func (g *Graph) GetNodeByUID(uid string) *models.TopologyNode {
	return g.UIDToNode[uid]
}

// AddNode adds a node to the graph and indexes by UID for owner-ref inference.
// When MaxNodes > 0 and capacity is reached, no-op and set Truncated (C1.4).
func (g *Graph) AddNode(node models.TopologyNode) {
	if g.MaxNodes > 0 && len(g.Nodes) >= g.MaxNodes {
		g.Truncated = true
		return
	}
	if _, exists := g.NodeMap[node.ID]; exists {
		return // Skip duplicates
	}
	g.Nodes = append(g.Nodes, node)
	ptr := &g.Nodes[len(g.Nodes)-1]
	g.NodeMap[node.ID] = ptr
	if node.Metadata.UID != "" {
		g.UIDToNode[node.Metadata.UID] = ptr
	}
}

// AddEdge adds an edge to the graph
func (g *Graph) AddEdge(edge models.TopologyEdge) {
	edgeKey := fmt.Sprintf("%s->%s:%s", edge.Source, edge.Target, edge.RelationshipType)
	if g.EdgeMap[edgeKey] {
		return // Skip duplicates
	}

	g.Edges = append(g.Edges, edge)
	g.EdgeMap[edgeKey] = true
}

// GetNode retrieves a node by ID
func (g *Graph) GetNode(id string) *models.TopologyNode {
	return g.NodeMap[id]
}

// GenerateLayoutSeed generates a deterministic layout seed based on graph structure
func (g *Graph) GenerateLayoutSeed() string {
	// Sort nodes and edges for determinism
	sortedNodes := make([]string, len(g.Nodes))
	for i, node := range g.Nodes {
		sortedNodes[i] = fmt.Sprintf("%s:%s:%s", node.Kind, node.Namespace, node.Name)
	}
	sort.Strings(sortedNodes)

	sortedEdges := make([]string, len(g.Edges))
	for i, edge := range g.Edges {
		sortedEdges[i] = fmt.Sprintf("%s->%s:%s", edge.Source, edge.Target, edge.RelationshipType)
	}
	sort.Strings(sortedEdges)

	// Create deterministic hash
	data := struct {
		Nodes []string
		Edges []string
	}{
		Nodes: sortedNodes,
		Edges: sortedEdges,
	}

	jsonData, _ := json.Marshal(data)
	hash := sha256.Sum256(jsonData)
	return fmt.Sprintf("%x", hash)
}

// ToTopologyGraph converts internal graph to API model (contract: schemaVersion, nodes, edges, metadata).
func (g *Graph) ToTopologyGraph(clusterID string) models.TopologyGraph {
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z07:00")
	warnings := []models.GraphWarning{}
	if g.Truncated {
		warnings = append(warnings, models.GraphWarning{
			Code:    "TOPOLOGY_TRUNCATED",
			Message: "Graph was truncated at max nodes; use ?namespace= to scope or increase topology_max_nodes",
		})
	}
	return models.TopologyGraph{
		SchemaVersion: "1.0",
		Nodes:         g.Nodes,
		Edges:         g.Edges,
		Metadata: models.TopologyGraphMetadata{
			ClusterId:   clusterID,
			GeneratedAt: now,
			LayoutSeed:  g.LayoutSeed,
			IsComplete:  !g.Truncated,
			Warnings:    warnings,
			NodeCount:   len(g.Nodes),
			EdgeCount:   len(g.Edges),
		},
	}
}

// Validate checks graph completeness and correctness
func (g *Graph) Validate() error {
	// Check for orphan edges (edges referencing non-existent nodes)
	for _, edge := range g.Edges {
		if g.GetNode(edge.Source) == nil {
			return fmt.Errorf("edge references non-existent source node: %s", edge.Source)
		}
		if g.GetNode(edge.Target) == nil {
			return fmt.Errorf("edge references non-existent target node: %s", edge.Target)
		}
	}

	// Check for duplicate node IDs
	if len(g.Nodes) != len(g.NodeMap) {
		return fmt.Errorf("duplicate node IDs detected")
	}

	return nil
}

// GetNodesByKind returns all nodes of a given kind (contract: use "kind" not "type").
func (g *Graph) GetNodesByKind(kind string) []models.TopologyNode {
	var result []models.TopologyNode
	for _, node := range g.Nodes {
		if node.Kind == kind {
			result = append(result, node)
		}
	}
	return result
}

// GetNodesByType is an alias for GetNodesByKind for backward compatibility.
func (g *Graph) GetNodesByType(kind string) []models.TopologyNode {
	return g.GetNodesByKind(kind)
}

// GetOutgoingEdges returns all edges originating from a node
func (g *Graph) GetOutgoingEdges(nodeID string) []models.TopologyEdge {
	var result []models.TopologyEdge
	for _, edge := range g.Edges {
		if edge.Source == nodeID {
			result = append(result, edge)
		}
	}
	return result
}

// GetIncomingEdges returns all edges targeting a node
func (g *Graph) GetIncomingEdges(nodeID string) []models.TopologyEdge {
	var result []models.TopologyEdge
	for _, edge := range g.Edges {
		if edge.Target == nodeID {
			result = append(result, edge)
		}
	}
	return result
}
