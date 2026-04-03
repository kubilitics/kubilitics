package compliance

// SOC2Framework maps structural findings to SOC2 Type II trust service criteria.
// Since SOC2 is an audit framework (not a prescriptive benchmark), many controls
// map to underlying CIS checks rather than defining novel detection logic.
type SOC2Framework struct{}

// Name returns the framework identifier.
func (f *SOC2Framework) Name() string { return "soc2" }

// Evaluate runs all SOC2 controls by delegating to the underlying CIS checks
// where applicable and returning SOC2-scoped ControlResults.
func (f *SOC2Framework) Evaluate(data ClusterComplianceData) []ControlResult {
	cis := &CISFramework{}
	cisResults := cis.Evaluate(data)

	// Index CIS results by control ID for easy lookup.
	cisMap := make(map[string]ControlResult, len(cisResults))
	for _, cr := range cisResults {
		cisMap[cr.ControlID] = cr
	}

	var results []ControlResult
	results = append(results, f.checkCC6_1(data))
	results = append(results, f.checkCC7_2(cisMap))
	results = append(results, f.checkA1_2(cisMap))
	// CC8.1 (Change Management) removed — requires CI/CD pipeline integration
	// data that is not available from the cluster graph alone. Will be added
	// when KOTG.ai CI/CD integration ships.
	return results
}

// SOC2-CC6.1 — Logical access controls.
// Checks for overly permissive ClusterRoleBindings (bindings to cluster-admin
// or other high-privilege roles that are not bound to specific ServiceAccounts).
func (f *SOC2Framework) checkCC6_1(data ClusterComplianceData) ControlResult {
	cr := ControlResult{
		ControlID:   "SOC2-CC6.1",
		Title:       "Logical access controls",
		Description: "The entity uses logical access security measures to restrict access to information assets.",
		Severity:    "high",
		Framework:   "soc2",
		Remediation: "Review ClusterRoleBindings and remove overly permissive bindings. Implement least-privilege RBAC.",
	}

	if len(data.ClusterRoleBindings) == 0 {
		// No RBAC data available — cannot evaluate.
		cr.Status = "warn"
		cr.Description = "No ClusterRoleBinding data available. Ensure RBAC is enabled and configured."
		return cr
	}

	// Permissive roles that represent excessive privilege.
	permissiveRoles := map[string]bool{
		"cluster-admin": true,
		"admin":         true,
	}

	var affected []ResourceRef
	for _, crb := range data.ClusterRoleBindings {
		if !permissiveRoles[crb.RoleName] {
			continue
		}
		// Binding a permissive role to a Group or User (not a specific ServiceAccount) is risky.
		for _, sk := range crb.SubjectKinds {
			if sk == "Group" || sk == "User" {
				affected = append(affected, ResourceRef{
					Name: crb.Name,
					Kind: "ClusterRoleBinding",
				})
				break
			}
		}
	}

	if len(affected) > 0 {
		cr.Status = "fail"
		cr.AffectedResources = affected
		cr.Description = "Overly permissive ClusterRoleBindings detected — cluster-admin or admin bound to Users/Groups."
	} else {
		cr.Status = "pass"
		cr.Description = "No overly permissive ClusterRoleBindings detected."
	}

	return cr
}

// SOC2-CC7.2 — System availability (maps to CIS-5.7.1 replica count).
func (f *SOC2Framework) checkCC7_2(cisMap map[string]ControlResult) ControlResult {
	cr := ControlResult{
		ControlID:   "SOC2-CC7.2",
		Title:       "System availability",
		Description: "The entity monitors system availability and takes action to maintain processing capacity.",
		Severity:    "high",
		Framework:   "soc2",
		Remediation: "Ensure all production workloads run at least 2 replicas. Configure HPA for automatic scaling.",
	}

	if cis, ok := cisMap["CIS-5.7.1"]; ok {
		cr.Status = cis.Status
		cr.AffectedResources = cis.AffectedResources
		if cis.Status == "fail" {
			cr.Description = "Workloads with insufficient replicas detected (maps to CIS-5.7.1)."
		}
	} else {
		cr.Status = "pass"
	}

	return cr
}

// SOC2-A1.2 — Recovery mechanisms (maps to CIS-5.2.1 PDB coverage).
func (f *SOC2Framework) checkA1_2(cisMap map[string]ControlResult) ControlResult {
	cr := ControlResult{
		ControlID:   "SOC2-A1.2",
		Title:       "Recovery mechanisms",
		Description: "The entity provides recovery mechanisms to meet its objectives for availability.",
		Severity:    "high",
		Framework:   "soc2",
		Remediation: "Create PodDisruptionBudgets for all multi-replica workloads to ensure graceful disruption handling.",
	}

	if cis, ok := cisMap["CIS-5.2.1"]; ok {
		cr.Status = cis.Status
		cr.AffectedResources = cis.AffectedResources
		if cis.Status == "fail" {
			cr.Description = "Workloads without PodDisruptionBudgets detected (maps to CIS-5.2.1)."
		}
	} else {
		cr.Status = "pass"
	}

	return cr
}
