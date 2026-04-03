package simulation

import (
	"context"
	"fmt"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

const (
	// MaxScenarios is the maximum number of scenarios allowed in a single request.
	MaxScenarios = 10
	// MaxNodes is the maximum number of graph nodes allowed for simulation.
	MaxNodes = 10000
	// SimulationTimeout is the hard deadline for a simulation run.
	SimulationTimeout = 5 * time.Second
)

// Validate checks the scenarios without running them. Returns an error describing
// the first invalid scenario, or nil if all are valid.
func Validate(req SimulationRequest) error {
	if len(req.Scenarios) == 0 {
		return fmt.Errorf("at least one scenario is required")
	}
	if len(req.Scenarios) > MaxScenarios {
		return fmt.Errorf("too many scenarios: %d exceeds limit of %d", len(req.Scenarios), MaxScenarios)
	}
	for i, s := range req.Scenarios {
		if err := validateScenario(s); err != nil {
			return fmt.Errorf("scenario[%d]: %w", i, err)
		}
	}
	return nil
}

// validateScenario checks a single scenario for required fields.
func validateScenario(s Scenario) error {
	switch s.Type {
	case ScenarioDeleteResource:
		if s.TargetKey == "" {
			return fmt.Errorf("target_key is required for %s", s.Type)
		}
	case ScenarioDeleteNamespace:
		if s.Namespace == "" {
			return fmt.Errorf("namespace is required for %s", s.Type)
		}
	case ScenarioNodeFailure:
		if s.NodeName == "" {
			return fmt.Errorf("node_name is required for %s", s.Type)
		}
	case ScenarioAZFailure:
		if s.AZLabel == "" {
			return fmt.Errorf("az_label is required for %s", s.Type)
		}
	case ScenarioScaleChange:
		if s.TargetKey == "" {
			return fmt.Errorf("target_key is required for %s", s.Type)
		}
		if s.Replicas < 0 {
			return fmt.Errorf("replicas must be >= 0 for %s", s.Type)
		}
	case ScenarioDeployNew:
		if s.ManifestYAML == "" {
			return fmt.Errorf("manifest_yaml is required for %s", s.Type)
		}
	default:
		return fmt.Errorf("unknown scenario type: %q", s.Type)
	}
	return nil
}

// Run executes the full simulation pipeline:
// validate -> clone -> apply scenarios in sequence -> rescore -> diff -> return result.
func Run(snapshot *graph.GraphSnapshot, req SimulationRequest) (*SimulationResult, error) {
	start := time.Now()

	// Enforce a hard timeout
	ctx, cancel := context.WithTimeout(context.Background(), SimulationTimeout)
	defer cancel()

	// Step 1: Validate
	if err := Validate(req); err != nil {
		return nil, fmt.Errorf("validation failed: %w", err)
	}

	// Step 2: Check snapshot size
	if len(snapshot.Nodes) > MaxNodes {
		return nil, fmt.Errorf("snapshot too large: %d nodes exceeds limit of %d", len(snapshot.Nodes), MaxNodes)
	}

	// Step 3: Compute "before" metrics on the original snapshot
	rescoreSnapshot(snapshot)
	healthBefore := computeHealthScore(snapshot)
	spofsBefore := countSPOFs(snapshot)

	// Step 4: Deep clone the snapshot
	clone := CloneSnapshot(snapshot)

	// Step 5: Apply each scenario in sequence
	for i, scenario := range req.Scenarios {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("simulation timed out after %v", SimulationTimeout)
		default:
		}

		if err := applyScenario(clone, scenario); err != nil {
			return nil, fmt.Errorf("scenario[%d] (%s) failed: %w", i, scenario.Type, err)
		}
	}

	// Step 6: Rescore the mutated snapshot
	rescoreSnapshot(clone)

	// Step 7: Compute "after" metrics
	healthAfter := computeHealthScore(clone)
	spofsAfter := countSPOFs(clone)

	// Step 8: Diff original vs mutated
	diff := computeDiff(snapshot, clone)

	elapsed := time.Since(start)

	return &SimulationResult{
		HealthBefore:     healthBefore,
		HealthAfter:      healthAfter,
		HealthDelta:      healthAfter - healthBefore,
		SPOFsBefore:      spofsBefore,
		SPOFsAfter:       spofsAfter,
		NewSPOFs:         ensureNodeSlice(diff.NewSPOFs),
		ResolvedSPOFs:    ensureNodeSlice(diff.ResolvedSPOFs),
		RemovedNodes:     ensureNodeSlice(diff.RemovedNodes),
		AddedNodes:       ensureNodeSlice(diff.AddedNodes),
		ModifiedNodes:    ensureNodeDiffSlice(diff.ModifiedNodes),
		LostEdges:        ensureEdgeSlice(diff.LostEdges),
		AddedEdges:       ensureEdgeSlice(diff.AddedEdges),
		AffectedServices: ensureNodeSlice(diff.AffectedServices),
		ComputeTimeMs:    elapsed.Milliseconds(),
	}, nil
}

// applyScenario routes a scenario to the correct mutator.
func applyScenario(snap *graph.GraphSnapshot, s Scenario) error {
	switch s.Type {
	case ScenarioDeleteResource:
		return deleteResource(snap, s.TargetKey)
	case ScenarioDeleteNamespace:
		return deleteNamespace(snap, s.Namespace)
	case ScenarioNodeFailure:
		return nodeFailure(snap, s.NodeName)
	case ScenarioAZFailure:
		return azFailure(snap, s.AZLabel)
	case ScenarioScaleChange:
		return scaleChange(snap, s.TargetKey, s.Replicas)
	case ScenarioDeployNew:
		return deployNew(snap, s.ManifestYAML)
	default:
		return fmt.Errorf("unknown scenario type: %q", s.Type)
	}
}

// ensureNodeSlice returns a non-nil slice for JSON marshaling.
func ensureNodeSlice(s []NodeInfo) []NodeInfo {
	if s == nil {
		return []NodeInfo{}
	}
	return s
}

// ensureNodeDiffSlice returns a non-nil slice for JSON marshaling.
func ensureNodeDiffSlice(s []NodeDiff) []NodeDiff {
	if s == nil {
		return []NodeDiff{}
	}
	return s
}

// ensureEdgeSlice returns a non-nil slice for JSON marshaling.
func ensureEdgeSlice(s []EdgeInfo) []EdgeInfo {
	if s == nil {
		return []EdgeInfo{}
	}
	return s
}
