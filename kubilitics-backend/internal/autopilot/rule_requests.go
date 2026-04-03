package autopilot

import (
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// MissingRequestsRule flags workloads that may lack resource requests.
// Without requests, the scheduler cannot make informed placement decisions
// and pods risk being OOMKilled or getting best-effort QoS.
// Heuristic: workloads with known replicas > 0 and fan-in > 0 that are
// not covered by HPA (HPA typically requires requests to work).
type MissingRequestsRule struct{}

func (r *MissingRequestsRule) ID() string          { return "missing-requests" }
func (r *MissingRequestsRule) Name() string        { return "Missing Resource Requests" }
func (r *MissingRequestsRule) Description() string { return "Flags workloads that may lack CPU/memory requests, leading to best-effort QoS and unpredictable scheduling" }
func (r *MissingRequestsRule) Severity() string    { return "low" }

func (r *MissingRequestsRule) Detect(snapshot *graph.GraphSnapshot) []Finding {
	var findings []Finding

	for key, ref := range snapshot.Nodes {
		switch ref.Kind {
		case "Deployment", "StatefulSet", "DaemonSet":
			// eligible
		default:
			continue
		}

		replicas := snapshot.NodeReplicas[key]
		if replicas <= 0 {
			continue
		}

		fanIn := len(snapshot.Reverse[key])
		if fanIn < 1 {
			continue
		}

		// If HPA exists, requests are almost certainly set (HPA needs them).
		if snapshot.NodeHasHPA[key] {
			continue
		}

		findings = append(findings, Finding{
			RuleID:          r.ID(),
			Severity:        "low",
			TargetKind:      ref.Kind,
			TargetNamespace: ref.Namespace,
			TargetName:      ref.Name,
			Description:     fmt.Sprintf("%s/%s has %d replica(s) and %d dependent(s) but no HPA — may lack resource requests, resulting in best-effort QoS", ref.Kind, ref.Name, replicas, fanIn),
			ActionType:      "set_requests",
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
										"requests": map[string]interface{}{
											"cpu":    "100m",
											"memory": "128Mi",
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
