package autopilot

import (
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// MissingPDBRule detects workloads with multiple replicas but no PodDisruptionBudget.
type MissingPDBRule struct{}

func (r *MissingPDBRule) ID() string          { return "missing-pdb" }
func (r *MissingPDBRule) Name() string        { return "Missing PodDisruptionBudget" }
func (r *MissingPDBRule) Description() string { return "Detects workloads with >= 2 replicas that have no PodDisruptionBudget, risking full outage during voluntary disruptions" }
func (r *MissingPDBRule) Severity() string    { return "high" }

func (r *MissingPDBRule) Detect(snapshot *graph.GraphSnapshot) []Finding {
	var findings []Finding

	for key, replicas := range snapshot.NodeReplicas {
		if replicas < 2 {
			continue
		}
		if snapshot.NodeHasPDB[key] {
			continue
		}

		ref, ok := snapshot.Nodes[key]
		if !ok {
			continue
		}

		// Only consider workload types
		switch ref.Kind {
		case "Deployment", "StatefulSet":
			// eligible for PDB
		default:
			continue
		}

		findings = append(findings, Finding{
			RuleID:          r.ID(),
			Severity:        "high",
			TargetKind:      ref.Kind,
			TargetNamespace: ref.Namespace,
			TargetName:      ref.Name,
			Description:     fmt.Sprintf("%s/%s has %d replicas but no PodDisruptionBudget — voluntary disruptions may cause full outage", ref.Kind, ref.Name, replicas),
			ActionType:      "create_pdb",
			ProposedPatch: map[string]interface{}{
				"apiVersion": "policy/v1",
				"kind":       "PodDisruptionBudget",
				"metadata": map[string]interface{}{
					"name":      ref.Name + "-pdb",
					"namespace": ref.Namespace,
				},
				"spec": map[string]interface{}{
					"maxUnavailable": 1,
					"selector": map[string]interface{}{
						"matchLabels": map[string]interface{}{
							"app": ref.Name,
						},
					},
				},
			},
		})
	}

	return findings
}
