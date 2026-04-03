package autopilot

import (
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// MissingAntiAffinityRule detects multi-replica workloads with high fan-in
// that likely lack topology spread constraints or pod anti-affinity.
// Without these, all replicas may land on the same node, defeating HA.
type MissingAntiAffinityRule struct{}

func (r *MissingAntiAffinityRule) ID() string       { return "missing-anti-affinity" }
func (r *MissingAntiAffinityRule) Name() string     { return "Missing Anti-Affinity / Topology Spread" }
func (r *MissingAntiAffinityRule) Description() string { return "Flags multi-replica workloads with high fan-in that may lack pod anti-affinity or topology spread constraints" }
func (r *MissingAntiAffinityRule) Severity() string { return "high" }

func (r *MissingAntiAffinityRule) Detect(snapshot *graph.GraphSnapshot) []Finding {
	var findings []Finding

	for key, replicas := range snapshot.NodeReplicas {
		if replicas < 2 {
			continue
		}

		ref, ok := snapshot.Nodes[key]
		if !ok {
			continue
		}

		switch ref.Kind {
		case "Deployment", "StatefulSet":
			// eligible for anti-affinity
		default:
			continue
		}

		fanIn := len(snapshot.Reverse[key])
		if fanIn <= 3 {
			continue
		}

		findings = append(findings, Finding{
			RuleID:          r.ID(),
			Severity:        "high",
			TargetKind:      ref.Kind,
			TargetNamespace: ref.Namespace,
			TargetName:      ref.Name,
			Description:     fmt.Sprintf("%s/%s has %d replicas and %d dependents but may lack topology spread — all pods could schedule on one node", ref.Kind, ref.Name, replicas, fanIn),
			ActionType:      "add_spread",
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
							"topologySpreadConstraints": []map[string]interface{}{
								{
									"maxSkew":           1,
									"topologyKey":       "kubernetes.io/hostname",
									"whenUnsatisfiable": "DoNotSchedule",
									"labelSelector": map[string]interface{}{
										"matchLabels": map[string]interface{}{
											"app": ref.Name,
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
