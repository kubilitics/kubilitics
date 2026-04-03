package autopilot

import (
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// MissingNetPolRule detects namespaces that have no NetworkPolicy objects,
// meaning all ingress/egress traffic is unrestricted by default.
type MissingNetPolRule struct{}

func (r *MissingNetPolRule) ID() string          { return "missing-netpol" }
func (r *MissingNetPolRule) Name() string        { return "Missing Network Policy" }
func (r *MissingNetPolRule) Description() string { return "Detects namespaces with no NetworkPolicy — all traffic is unrestricted by default" }
func (r *MissingNetPolRule) Severity() string    { return "medium" }

func (r *MissingNetPolRule) Detect(snapshot *graph.GraphSnapshot) []Finding {
	// Build set of namespaces that have at least one NetworkPolicy
	coveredNS := make(map[string]bool)
	for _, ref := range snapshot.Nodes {
		if ref.Kind == "NetworkPolicy" {
			coveredNS[ref.Namespace] = true
		}
	}

	var findings []Finding

	for ns := range snapshot.Namespaces {
		// Skip kube-system and other infrastructure namespaces
		if isInfraNamespace(ns) {
			continue
		}

		if coveredNS[ns] {
			continue
		}

		findings = append(findings, Finding{
			RuleID:          r.ID(),
			Severity:        "medium",
			TargetKind:      "Namespace",
			TargetNamespace: ns,
			TargetName:      ns,
			Description:     fmt.Sprintf("Namespace %q has no NetworkPolicy — all pod traffic is unrestricted", ns),
			ActionType:      "create_netpol",
			ProposedPatch: map[string]interface{}{
				"apiVersion": "networking.k8s.io/v1",
				"kind":       "NetworkPolicy",
				"metadata": map[string]interface{}{
					"name":      "default-deny-ingress",
					"namespace": ns,
				},
				"spec": map[string]interface{}{
					"podSelector": map[string]interface{}{},
					"policyTypes": []string{"Ingress"},
					"ingress":     []interface{}{},
				},
			},
		})
	}

	return findings
}

// isInfraNamespace returns true for Kubernetes infrastructure namespaces
// that typically should not be managed by autopilot network policies.
func isInfraNamespace(ns string) bool {
	switch ns {
	case "kube-system", "kube-public", "kube-node-lease", "default":
		return true
	}
	return false
}
