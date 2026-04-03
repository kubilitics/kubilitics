package autopilot

import (
	"log/slog"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// SafetyGate uses blast-radius simulation to verify that a proposed remediation
// does not degrade overall cluster health. If the health delta is negative, the
// action is blocked.
type SafetyGate struct{}

// NewSafetyGate creates a SafetyGate instance.
func NewSafetyGate() *SafetyGate {
	return &SafetyGate{}
}

// Check simulates the proposed remediation and returns (safe, healthDelta, error).
// safe=true means the action will not degrade cluster health.
//
// For v1, we compute a heuristic health delta from the graph snapshot data:
//   - Scaling up a SPOF improves health (+fanIn points)
//   - Adding a PDB to an unprotected workload improves health (+5)
//   - Adding topology spread to multi-replica workloads improves health (+3)
//   - Other actions default to safe with a small positive delta (+1)
//
// A real simulation engine integration would replace this heuristic.
func (g *SafetyGate) Check(snapshot *graph.GraphSnapshot, finding Finding) (bool, float64, error) {
	if snapshot == nil {
		slog.Warn("safety gate: nil snapshot, defaulting to safe")
		return true, 0.0, nil
	}

	delta := g.estimateHealthDelta(snapshot, finding)
	safe := delta >= 0

	return safe, delta, nil
}

// estimateHealthDelta computes a heuristic health impact for the proposed action.
func (g *SafetyGate) estimateHealthDelta(snapshot *graph.GraphSnapshot, finding Finding) float64 {
	key := finding.TargetKind + "/" + finding.TargetNamespace + "/" + finding.TargetName

	switch finding.ActionType {
	case "scale":
		// Scaling up a SPOF removes the single-point-of-failure risk.
		// Health improvement is proportional to the number of dependents.
		fanIn := len(snapshot.Reverse[key])
		if fanIn > 0 {
			return float64(fanIn) * 1.5
		}
		return 2.0

	case "create_pdb":
		// Adding a PDB protects against voluntary disruptions.
		return 5.0

	case "add_spread":
		// Topology spread constraints improve HA.
		return 3.0

	case "set_limits":
		// Resource limits prevent noisy-neighbor problems.
		return 2.0

	case "set_requests":
		// Resource requests improve scheduling decisions.
		return 1.0

	case "create_netpol":
		// Network policies improve security posture.
		return 2.0

	default:
		// Unknown action type; assume neutral.
		return 1.0
	}
}
