package diff

import (
	"fmt"
	"strings"
)

// edgeKey builds a canonical key for an edge: "source|target|type".
func edgeKey(e SnapshotEdge) string {
	return e.Source + "|" + e.Target + "|" + e.Type
}

// ComputeDiff compares two topology snapshots and returns a TopologyDiff
// describing what changed between them.
func ComputeDiff(from, to *TopologySnapshot) *TopologyDiff {
	diff := &TopologyDiff{
		FromSnapshot: from.ID,
		ToSnapshot:   to.ID,
	}

	// --- Node diffing ---
	fromNodes := make(map[string]SnapshotNode, len(from.Nodes))
	for _, n := range from.Nodes {
		fromNodes[n.ID] = n
	}
	toNodes := make(map[string]SnapshotNode, len(to.Nodes))
	for _, n := range to.Nodes {
		toNodes[n.ID] = n
	}

	// Added: in `to` but not in `from`
	for id, node := range toNodes {
		if _, exists := fromNodes[id]; !exists {
			diff.AddedNodes = append(diff.AddedNodes, node)
		}
	}

	// Removed: in `from` but not in `to`
	for id, node := range fromNodes {
		if _, exists := toNodes[id]; !exists {
			diff.RemovedNodes = append(diff.RemovedNodes, node)
		}
	}

	// --- Edge diffing ---
	fromEdges := make(map[string]SnapshotEdge, len(from.Edges))
	for _, e := range from.Edges {
		fromEdges[edgeKey(e)] = e
	}
	toEdges := make(map[string]SnapshotEdge, len(to.Edges))
	for _, e := range to.Edges {
		toEdges[edgeKey(e)] = e
	}

	// Added edges: in `to` but not in `from`
	for key, edge := range toEdges {
		if _, exists := fromEdges[key]; !exists {
			diff.AddedEdges = append(diff.AddedEdges, edge)
		}
	}

	// Removed edges: in `from` but not in `to`
	for key, edge := range fromEdges {
		if _, exists := toEdges[key]; !exists {
			diff.RemovedEdges = append(diff.RemovedEdges, edge)
		}
	}

	// Changed edges: same key but different weight
	for key, toEdge := range toEdges {
		if fromEdge, exists := fromEdges[key]; exists {
			if fromEdge.Weight != toEdge.Weight {
				diff.ChangedEdges = append(diff.ChangedEdges, EdgeChange{
					Source:    toEdge.Source,
					Target:    toEdge.Target,
					Type:      toEdge.Type,
					OldWeight: fromEdge.Weight,
					NewWeight: toEdge.Weight,
				})
			}
		}
	}

	// --- SPOF diff ---
	newSPOFs := to.Metadata.SPOFCount - from.Metadata.SPOFCount
	var removedSPOFs int
	if newSPOFs < 0 {
		removedSPOFs = -newSPOFs
		newSPOFs = 0
	}

	// --- Summary ---
	diff.Summary = DiffSummary{
		NodesAdded:   len(diff.AddedNodes),
		NodesRemoved: len(diff.RemovedNodes),
		EdgesAdded:   len(diff.AddedEdges),
		EdgesRemoved: len(diff.RemovedEdges),
		EdgesChanged: len(diff.ChangedEdges),
		NewSPOFs:     newSPOFs,
		RemovedSPOFs: removedSPOFs,
	}
	diff.Summary.NaturalLanguage = generateNaturalLanguage(diff.Summary)

	return diff
}

// generateNaturalLanguage builds a human-readable summary string.
// Zero-count items are omitted.
func generateNaturalLanguage(s DiffSummary) string {
	var parts []string

	if s.NodesAdded > 0 {
		parts = append(parts, fmt.Sprintf("%d %s added", s.NodesAdded, pluralize("resource", s.NodesAdded)))
	}
	if s.NodesRemoved > 0 {
		parts = append(parts, fmt.Sprintf("%d removed", s.NodesRemoved))
	}
	if s.EdgesAdded > 0 {
		parts = append(parts, fmt.Sprintf("%d new %s", s.EdgesAdded, pluralize("dependency", s.EdgesAdded)))
	}
	if s.EdgesRemoved > 0 {
		parts = append(parts, fmt.Sprintf("%d %s removed", s.EdgesRemoved, pluralize("dependency", s.EdgesRemoved)))
	}
	if s.EdgesChanged > 0 {
		parts = append(parts, fmt.Sprintf("%d %s changed", s.EdgesChanged, pluralize("dependency", s.EdgesChanged)))
	}
	if s.NewSPOFs > 0 {
		parts = append(parts, fmt.Sprintf("%d new %s introduced", s.NewSPOFs, pluralize("single point of failure", s.NewSPOFs)))
	}
	if s.RemovedSPOFs > 0 {
		parts = append(parts, fmt.Sprintf("%d %s resolved", s.RemovedSPOFs, pluralize("single point of failure", s.RemovedSPOFs)))
	}

	if len(parts) == 0 {
		return "No changes detected."
	}

	// Capitalize first part, join with ", "
	result := strings.Join(parts, ", ")
	return strings.ToUpper(result[:1]) + result[1:] + "."
}

// pluralize returns the plural form if count != 1.
func pluralize(word string, count int) string {
	if count == 1 {
		return word
	}
	// Handle "dependency" -> "dependencies"
	if strings.HasSuffix(word, "y") && !strings.HasSuffix(word, "ey") {
		return word[:len(word)-1] + "ies"
	}
	return word + "s"
}
