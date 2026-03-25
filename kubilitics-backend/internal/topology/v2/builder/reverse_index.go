package builder

import (
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// ReverseIndex provides bidirectional dependency lookups over topology edges.
// Given a resource ID it can answer both "what does this resource depend on?"
// (forward / dependencies) and "what depends on this resource?" (reverse / dependents).
type ReverseIndex struct {
	// dependents maps a resourceID to the list of resources that depend on it.
	// If edge A→B exists, then dependents[B] contains A.
	dependents map[string][]string

	// dependencies maps a resourceID to the list of resources it depends on.
	// If edge A→B exists, then dependencies[A] contains B.
	dependencies map[string][]string
}

// BuildReverseIndex constructs a ReverseIndex from a slice of TopologyEdge.
// Edge semantics: Source depends on Target (Source→Target means Source uses/consumes Target).
// Therefore: dependents[Target] includes Source, dependencies[Source] includes Target.
func BuildReverseIndex(edges []v2.TopologyEdge) *ReverseIndex {
	ri := &ReverseIndex{
		dependents:   make(map[string][]string),
		dependencies: make(map[string][]string),
	}

	for i := range edges {
		src := edges[i].Source
		tgt := edges[i].Target

		ri.dependencies[src] = append(ri.dependencies[src], tgt)
		ri.dependents[tgt] = append(ri.dependents[tgt], src)
	}

	return ri
}

// GetDependents returns the direct dependents of the given resource — i.e. all
// resources that have an edge pointing TO resourceID. These are the consumers
// that would be affected if resourceID were deleted.
func (ri *ReverseIndex) GetDependents(resourceID string) []string {
	if ri == nil {
		return nil
	}
	return ri.dependents[resourceID]
}

// GetDependencies returns the direct dependencies of the given resource — i.e.
// all resources that resourceID has an edge pointing TO. These are the upstream
// resources that resourceID consumes.
func (ri *ReverseIndex) GetDependencies(resourceID string) []string {
	if ri == nil {
		return nil
	}
	return ri.dependencies[resourceID]
}

// GetImpact performs a BFS traversal through the dependents graph up to
// maxDepth levels and returns ALL transitively dependent resources. This
// powers "what breaks if I delete this ConfigMap?" analysis.
//
// A maxDepth of 0 returns no results; a maxDepth of 1 returns only direct
// dependents; higher values follow the chain further.
func (ri *ReverseIndex) GetImpact(resourceID string, maxDepth int) []string {
	if ri == nil || maxDepth <= 0 {
		return nil
	}

	visited := make(map[string]bool)
	visited[resourceID] = true // exclude the root itself

	type queueItem struct {
		id    string
		depth int
	}

	queue := []queueItem{{id: resourceID, depth: 0}}
	var result []string

	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]

		if item.depth >= maxDepth {
			continue
		}

		for _, dep := range ri.dependents[item.id] {
			if visited[dep] {
				continue
			}
			visited[dep] = true
			result = append(result, dep)
			queue = append(queue, queueItem{id: dep, depth: item.depth + 1})
		}
	}

	return result
}

// ImpactedResource represents a resource affected by a change, with parsed
// kind, namespace, and name extracted from the canonical node ID.
type ImpactedResource struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// GetImpactDetailed performs the same BFS as GetImpact but returns structured
// ImpactedResource values with kind/namespace/name parsed from the node IDs.
func (ri *ReverseIndex) GetImpactDetailed(resourceID string, maxDepth int) []ImpactedResource {
	ids := ri.GetImpact(resourceID, maxDepth)
	result := make([]ImpactedResource, 0, len(ids))
	for _, id := range ids {
		kind, ns, name := parseNodeID(id)
		result = append(result, ImpactedResource{
			ID:        id,
			Kind:      kind,
			Namespace: ns,
			Name:      name,
		})
	}
	return result
}

// parseNodeID splits a canonical node ID ("Kind/namespace/name" or "Kind/name")
// into its components.
func parseNodeID(id string) (kind, namespace, name string) {
	parts := strings.SplitN(id, "/", 3)
	switch len(parts) {
	case 3:
		return parts[0], parts[1], parts[2]
	case 2:
		return parts[0], "", parts[1]
	default:
		return id, "", ""
	}
}
