package autopilot

import (
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// MissingLimitsRule flags high-fan-in workloads that are likely missing resource limits.
// Since GraphSnapshot does not track container-level resource limits directly, this uses
// a heuristic: workloads that are SPOFs (single-replica, no HPA, with dependents) and have
// high fan-in are flagged because unbound resource consumption can cause cascading failures.
type MissingLimitsRule struct{}

func (r *MissingLimitsRule) ID() string          { return "missing-limits" }
func (r *MissingLimitsRule) Name() string        { return "Missing Resource Limits" }
func (r *MissingLimitsRule) Description() string { return "Flags critical workloads that may lack CPU/memory limits, risking noisy-neighbor disruption" }
func (r *MissingLimitsRule) Severity() string    { return "medium" }

func (r *MissingLimitsRule) Detect(snapshot *graph.GraphSnapshot) []Finding {
	var findings []Finding

	for key, ref := range snapshot.Nodes {
		// Only workload types
		switch ref.Kind {
		case "Deployment", "StatefulSet", "DaemonSet":
			// eligible
		default:
			continue
		}

		fanIn := len(snapshot.Reverse[key])
		if fanIn < 3 {
			continue
		}

		// Heuristic: high fan-in, no HPA, no PDB — likely unprotected workload
		if snapshot.NodeHasHPA[key] && snapshot.NodeHasPDB[key] {
			continue
		}

		findings = append(findings, Finding{
			RuleID:          r.ID(),
			Severity:        "medium",
			TargetKind:      ref.Kind,
			TargetNamespace: ref.Namespace,
			TargetName:      ref.Name,
			Description:     fmt.Sprintf("%s/%s has %d dependents and may lack resource limits — unbounded consumption can disrupt colocated pods", ref.Kind, ref.Name, fanIn),
			ActionType:      "set_limits",
			ProposedPatch: map[string]interface{}{
				"apiVersion": "apps/v1",
				"kind":       ref.Kind,
				"metadata": map[string]interface{}{
					"name":      ref.Name,
					"namespace": ref.Namespace,
				},
				"spec": map[string]interface{}{
					"template": map[string]interface{}{
						"spec": map[string]interface{}{
							"containers": []map[string]interface{}{
								{
									"name": ref.Name,
									"resources": map[string]interface{}{
										"limits": map[string]interface{}{
											"cpu":    "500m",
											"memory": "512Mi",
										},
									},
								},
							},
						},
					},
				},
			},
		})
	}

	return findings
}
