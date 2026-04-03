package autopilot

import "fmt"

// Executor generates valid Kubernetes API payloads for each action type.
// It does NOT apply the payloads — that is the responsibility of the REST handler
// or a future K8s client integration.
type Executor struct{}

// NewExecutor creates a new Executor.
func NewExecutor() *Executor {
	return &Executor{}
}

// GeneratePatch returns a K8s-compatible API payload for the given finding.
// The patch structure depends on the action type.
func (e *Executor) GeneratePatch(finding Finding) (interface{}, error) {
	switch finding.ActionType {
	case "scale":
		return e.scalePayload(finding), nil
	case "create_pdb":
		return e.pdbPayload(finding), nil
	case "set_limits":
		return e.limitsPayload(finding), nil
	case "create_netpol":
		return e.netpolPayload(finding), nil
	case "add_spread":
		return e.spreadPayload(finding), nil
	case "set_requests":
		return e.requestsPayload(finding), nil
	default:
		return nil, fmt.Errorf("unsupported action type: %s", finding.ActionType)
	}
}

// scalePayload generates a JSON merge patch to set replicas on a workload.
func (e *Executor) scalePayload(f Finding) interface{} {
	return map[string]interface{}{
		"apiVersion": "apps/v1",
		"kind":       f.TargetKind,
		"metadata": map[string]interface{}{
			"name":      f.TargetName,
			"namespace": f.TargetNamespace,
		},
		"spec": map[string]interface{}{
			"replicas": 2,
		},
	}
}

// pdbPayload generates a PodDisruptionBudget manifest.
func (e *Executor) pdbPayload(f Finding) interface{} {
	return map[string]interface{}{
		"apiVersion": "policy/v1",
		"kind":       "PodDisruptionBudget",
		"metadata": map[string]interface{}{
			"name":      f.TargetName + "-pdb",
			"namespace": f.TargetNamespace,
		},
		"spec": map[string]interface{}{
			"maxUnavailable": 1,
			"selector": map[string]interface{}{
				"matchLabels": map[string]interface{}{
					"app": f.TargetName,
				},
			},
		},
	}
}

// limitsPayload generates a strategic merge patch adding resource limits.
func (e *Executor) limitsPayload(f Finding) interface{} {
	return map[string]interface{}{
		"apiVersion": "apps/v1",
		"kind":       f.TargetKind,
		"metadata": map[string]interface{}{
			"name":      f.TargetName,
			"namespace": f.TargetNamespace,
		},
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"spec": map[string]interface{}{
					"containers": []map[string]interface{}{
						{
							"name": f.TargetName,
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
	}
}

// netpolPayload generates a default-deny-ingress NetworkPolicy manifest.
func (e *Executor) netpolPayload(f Finding) interface{} {
	return map[string]interface{}{
		"apiVersion": "networking.k8s.io/v1",
		"kind":       "NetworkPolicy",
		"metadata": map[string]interface{}{
			"name":      "default-deny-ingress",
			"namespace": f.TargetNamespace,
		},
		"spec": map[string]interface{}{
			"podSelector": map[string]interface{}{},
			"policyTypes": []string{"Ingress"},
			"ingress":     []interface{}{},
		},
	}
}

// spreadPayload generates a strategic merge patch adding topologySpreadConstraints.
func (e *Executor) spreadPayload(f Finding) interface{} {
	return map[string]interface{}{
		"apiVersion": "apps/v1",
		"kind":       f.TargetKind,
		"metadata": map[string]interface{}{
			"name":      f.TargetName,
			"namespace": f.TargetNamespace,
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
									"app": f.TargetName,
								},
							},
						},
					},
				},
			},
		},
	}
}

// requestsPayload generates a strategic merge patch adding resource requests.
func (e *Executor) requestsPayload(f Finding) interface{} {
	return map[string]interface{}{
		"apiVersion": "apps/v1",
		"kind":       f.TargetKind,
		"metadata": map[string]interface{}{
			"name":      f.TargetName,
			"namespace": f.TargetNamespace,
		},
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"spec": map[string]interface{}{
					"containers": []map[string]interface{}{
						{
							"name": f.TargetName,
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
	}
}
