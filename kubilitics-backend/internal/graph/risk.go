package graph

import (
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// detectRisks evaluates a resource's properties and returns a slice of
// human-readable RiskIndicators ordered by descending severity.
func detectRisks(
	nodeKey string,
	replicas int,
	fanIn int,
	hasHPA bool,
	hasPDB bool,
	isIngressExposed bool,
	ingressHosts []string,
	isDataStore bool,
	crossNsCount int,
) []models.RiskIndicator {
	var risks []models.RiskIndicator

	// SPOF: single replica with dependents
	if replicas == 1 && fanIn > 0 {
		risks = append(risks, models.RiskIndicator{
			Severity: "critical",
			Title:    "Single Point of Failure",
			Detail:   fmt.Sprintf("%s has 1 replica and %d dependent(s) — any restart causes downtime", nodeKey, fanIn),
		})
	}

	// No PDB: no disruption budget on a running workload
	if !hasPDB && replicas > 0 {
		risks = append(risks, models.RiskIndicator{
			Severity: "critical",
			Title:    "No PodDisruptionBudget",
			Detail:   fmt.Sprintf("%s has no PodDisruptionBudget — voluntary disruptions (node drain, upgrades) may cause full outage", nodeKey),
		})
	}

	// No HPA: no autoscaler on a running workload
	if !hasHPA && replicas > 0 {
		risks = append(risks, models.RiskIndicator{
			Severity: "warning",
			Title:    "No HorizontalPodAutoscaler",
			Detail:   fmt.Sprintf("%s has no HorizontalPodAutoscaler — cannot scale automatically under load", nodeKey),
		})
	}

	// Cross-namespace dependencies
	if crossNsCount > 1 {
		risks = append(risks, models.RiskIndicator{
			Severity: "warning",
			Title:    "Cross-Namespace Dependencies",
			Detail:   fmt.Sprintf("%s has dependencies across %d namespaces — increases blast radius and coupling", nodeKey, crossNsCount),
		})
	}

	// Ingress exposed
	if isIngressExposed {
		detail := fmt.Sprintf("%s is exposed via Ingress", nodeKey)
		if len(ingressHosts) > 0 {
			detail = fmt.Sprintf("%s is exposed via Ingress on host(s): %s", nodeKey, strings.Join(ingressHosts, ", "))
		}
		risks = append(risks, models.RiskIndicator{
			Severity: "info",
			Title:    "Ingress Exposed",
			Detail:   detail,
		})
	}

	// Data store
	if isDataStore {
		risks = append(risks, models.RiskIndicator{
			Severity: "info",
			Title:    "Data Store",
			Detail:   fmt.Sprintf("%s is classified as a data store — data loss risk on failure", nodeKey),
		})
	}

	return risks
}
