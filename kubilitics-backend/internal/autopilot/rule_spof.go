package autopilot

import (
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// SPOFRule detects single-replica critical services that have no HPA
// and a significant fan-in (dependents relying on them).
type SPOFRule struct{}

func (r *SPOFRule) ID() string          { return "spof-single-replica" }
func (r *SPOFRule) Name() string        { return "Single-Replica Critical Services" }
func (r *SPOFRule) Description() string { return "Detects workloads with <= 1 replica, no HPA, and high fan-in that are single points of failure" }
func (r *SPOFRule) Severity() string    { return "high" }

func (r *SPOFRule) Detect(snapshot *graph.GraphSnapshot) []Finding {
	var findings []Finding

	for key, replicas := range snapshot.NodeReplicas {
		// Only flag single-replica workloads without autoscaling
		if replicas > 1 {
			continue
		}
		if snapshot.NodeHasHPA[key] {
			continue
		}

		ref, ok := snapshot.Nodes[key]
		if !ok {
			continue
		}

		// Only consider workload types
		switch ref.Kind {
		case "Deployment", "StatefulSet", "DaemonSet":
			// eligible
		default:
			continue
		}

		// Count fan-in (reverse dependencies)
		fanIn := len(snapshot.Reverse[key])
		if fanIn <= 2 {
			continue
		}

		severity := "medium"
		if fanIn > 5 {
			severity = "high"
		}

		findings = append(findings, Finding{
			RuleID:          r.ID(),
			Severity:        severity,
			TargetKind:      ref.Kind,
			TargetNamespace: ref.Namespace,
			TargetName:      ref.Name,
			Description:     fmt.Sprintf("%s/%s has %d replica(s), no HPA, and %d dependents — single point of failure", ref.Kind, ref.Name, replicas, fanIn),
			ActionType:      "scale",
			ProposedPatch: map[string]interface{}{
				"apiVersion": "apps/v1",
				"kind":       ref.Kind,
				"metadata": map[string]interface{}{
					"name":      ref.Name,
					"namespace": ref.Namespace,
				},
				"spec": map[string]interface{}{
					"replicas": 2,
				},
			},
		})
	}

	return findings
}
