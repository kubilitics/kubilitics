package reports

import (
	"fmt"
	"sort"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// Generator builds resilience reports from cluster intelligence data.
type Generator struct{}

// NewGenerator creates a new report generator.
func NewGenerator() *Generator {
	return &Generator{}
}

// ReportInput holds all the data sources needed to generate a resilience report.
type ReportInput struct {
	ClusterID   string
	ClusterName string
	Snapshot    *graph.GraphSnapshot
}

// GenerateReport collects data from the graph snapshot and produces a complete
// resilience report with executive summary, SPOF inventory, risk ranking,
// blast radius map, and prioritized recommendations.
func (g *Generator) GenerateReport(input ReportInput) (*ResilienceReport, error) {
	if input.Snapshot == nil {
		return nil, fmt.Errorf("graph snapshot is required")
	}

	snap := input.Snapshot

	// Gather blast radius summary (top 50 for internal use, we'll slice for sections)
	summary := snap.GetSummary(50)

	// Build SPOF inventory: filter to SPOFs only, top 20
	spofSection := g.buildSPOFSection(summary)

	// Build risk ranking: aggregate by namespace, top 10
	riskSection := g.buildRiskSection(snap, summary)

	// Build blast radius map: top 10 highest blast radius
	blastSection := g.buildBlastSection(summary)

	// Build executive summary
	execSummary := g.buildExecutiveSummary(snap, spofSection, riskSection)

	// Build drift section (from snapshot metadata only — no historical diffing)
	driftSection := g.buildDriftSection(snap)

	// Generate recommendations
	recommendations := g.generateRecommendations(execSummary, spofSection, riskSection, blastSection)

	report := &ResilienceReport{
		ClusterID:        input.ClusterID,
		ClusterName:      input.ClusterName,
		GeneratedAt:      time.Now().UTC(),
		Format:           "json",
		ExecutiveSummary: execSummary,
		SPOFInventory:    spofSection,
		RiskRanking:      riskSection,
		BlastRadiusMap:   blastSection,
		TopologyDrift:    driftSection,
		Recommendations:  recommendations,
	}

	return report, nil
}

// buildSPOFSection extracts SPOFs from the blast radius summary, limited to top 20.
func (g *Generator) buildSPOFSection(summary []models.BlastRadiusSummaryEntry) SPOFSection {
	var items []SPOFEntry
	for _, entry := range summary {
		if !entry.IsSPOF {
			continue
		}
		reason := "Single replica with dependents"
		if entry.FanIn > 3 {
			reason = fmt.Sprintf("Single replica with %d dependents — high fan-in", entry.FanIn)
		}
		remediation := "Increase replica count to at least 2 and add a PodDisruptionBudget"
		if entry.BlastRadiusPercent > 20 {
			remediation = "Critical: increase replicas, add PDB, and consider HPA for auto-scaling"
		}
		items = append(items, SPOFEntry{
			Name:        entry.Resource.Name,
			Kind:        entry.Resource.Kind,
			Namespace:   entry.Resource.Namespace,
			BlastRadius: entry.BlastRadiusPercent,
			Reason:      reason,
			Remediation: remediation,
		})
	}
	// Sort by blast radius descending
	sort.Slice(items, func(i, j int) bool {
		return items[i].BlastRadius > items[j].BlastRadius
	})
	if len(items) > 20 {
		items = items[:20]
	}
	if items == nil {
		items = []SPOFEntry{}
	}
	return SPOFSection{Items: items}
}

// buildRiskSection aggregates risk scores by namespace.
func (g *Generator) buildRiskSection(snap *graph.GraphSnapshot, summary []models.BlastRadiusSummaryEntry) RiskSection {
	type nsAgg struct {
		totalScore float64
		count      int
		spofCount  int
	}
	nsMap := make(map[string]*nsAgg)

	for _, entry := range summary {
		ns := entry.Resource.Namespace
		if ns == "" {
			ns = "(cluster-scoped)"
		}
		agg, ok := nsMap[ns]
		if !ok {
			agg = &nsAgg{}
			nsMap[ns] = agg
		}
		agg.totalScore += entry.CriticalityScore
		agg.count++
		if entry.IsSPOF {
			agg.spofCount++
		}
	}

	var entries []RiskEntry
	for ns, agg := range nsMap {
		avgScore := agg.totalScore / float64(agg.count)
		// Weight by SPOF count: more SPOFs = higher risk
		riskScore := avgScore + float64(agg.spofCount)*5.0
		if riskScore > 100 {
			riskScore = 100
		}
		entries = append(entries, RiskEntry{
			Namespace: ns,
			RiskScore: riskScore,
			Level:     riskLevel(riskScore),
			SPOFCount: agg.spofCount,
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].RiskScore > entries[j].RiskScore
	})
	if len(entries) > 10 {
		entries = entries[:10]
	}
	if entries == nil {
		entries = []RiskEntry{}
	}
	return RiskSection{Namespaces: entries}
}

// buildBlastSection extracts the top 10 highest blast radius resources.
func (g *Generator) buildBlastSection(summary []models.BlastRadiusSummaryEntry) BlastSection {
	var entries []BlastEntry
	for _, s := range summary {
		entries = append(entries, BlastEntry{
			Name:      s.Resource.Name,
			Kind:      s.Resource.Kind,
			Namespace: s.Resource.Namespace,
			Score:     s.CriticalityScore,
			Level:     s.CriticalityLevel,
			Affected:  s.AffectedNamespaces,
		})
	}
	// Already sorted by criticality from GetSummary
	if len(entries) > 10 {
		entries = entries[:10]
	}
	if entries == nil {
		entries = []BlastEntry{}
	}
	return BlastSection{TopResources: entries}
}

// buildExecutiveSummary creates the high-level overview.
func (g *Generator) buildExecutiveSummary(snap *graph.GraphSnapshot, spofs SPOFSection, risks RiskSection) ExecutiveSummary {
	totalSPOFs := len(spofs.Items)
	criticalSPOFs := 0
	for _, s := range spofs.Items {
		if s.BlastRadius > 10 {
			criticalSPOFs++
		}
	}

	namespacesAtRisk := 0
	for _, r := range risks.Namespaces {
		if r.Level == "critical" || r.Level == "high" {
			namespacesAtRisk++
		}
	}

	// Health score: start at 100 and deduct for issues
	healthScore := 100.0
	healthScore -= float64(totalSPOFs) * 3.0
	healthScore -= float64(criticalSPOFs) * 5.0
	healthScore -= float64(namespacesAtRisk) * 4.0
	if healthScore < 0 {
		healthScore = 0
	}

	topRisk := "No critical risks detected"
	if criticalSPOFs > 0 {
		topRisk = fmt.Sprintf("%d critical single points of failure detected", criticalSPOFs)
	} else if totalSPOFs > 0 {
		topRisk = fmt.Sprintf("%d single points of failure detected", totalSPOFs)
	}

	return ExecutiveSummary{
		HealthScore:      healthScore,
		HealthLevel:      healthLevel(healthScore),
		TotalWorkloads:   snap.TotalWorkloads,
		TotalSPOFs:       totalSPOFs,
		CriticalSPOFs:    criticalSPOFs,
		NamespacesAtRisk: namespacesAtRisk,
		TopRisk:          topRisk,
	}
}

// buildDriftSection creates a topology drift summary from snapshot metadata.
// Full historical diffing requires snapshot storage (T9); this provides current state info.
func (g *Generator) buildDriftSection(snap *graph.GraphSnapshot) DriftSection {
	return DriftSection{
		Period:  "current snapshot",
		Summary: fmt.Sprintf("Current topology contains %d nodes and %d edges across %d namespaces", len(snap.Nodes), len(snap.Edges), len(snap.Namespaces)),
	}
}

// generateRecommendations creates prioritized action items based on findings.
func (g *Generator) generateRecommendations(
	exec ExecutiveSummary,
	spofs SPOFSection,
	risks RiskSection,
	blasts BlastSection,
) []Recommendation {
	var recs []Recommendation

	// Critical: SPOFs with high blast radius
	for _, spof := range spofs.Items {
		if spof.BlastRadius > 20 {
			recs = append(recs, Recommendation{
				Priority:    "critical",
				Title:       fmt.Sprintf("Eliminate SPOF: %s/%s in %s", spof.Kind, spof.Name, spof.Namespace),
				Description: spof.Remediation,
				Impact:      fmt.Sprintf("Reduces blast radius by %.1f%% of cluster workloads", spof.BlastRadius),
			})
		}
	}

	// High: SPOFs with moderate blast radius
	for _, spof := range spofs.Items {
		if spof.BlastRadius > 5 && spof.BlastRadius <= 20 {
			recs = append(recs, Recommendation{
				Priority:    "high",
				Title:       fmt.Sprintf("Add redundancy to %s/%s in %s", spof.Kind, spof.Name, spof.Namespace),
				Description: spof.Remediation,
				Impact:      fmt.Sprintf("Eliminates single point of failure affecting %.1f%% of workloads", spof.BlastRadius),
			})
		}
	}

	// High: Namespaces at critical risk
	for _, ns := range risks.Namespaces {
		if ns.Level == "critical" {
			recs = append(recs, Recommendation{
				Priority:    "high",
				Title:       fmt.Sprintf("Review resilience of namespace %s", ns.Namespace),
				Description: fmt.Sprintf("Namespace has %d single points of failure with risk score %.0f", ns.SPOFCount, ns.RiskScore),
				Impact:      "Reduces namespace-level outage risk",
			})
		}
	}

	// Medium: Top blast radius resources that aren't SPOFs
	for _, b := range blasts.TopResources {
		if b.Level == "critical" || b.Level == "high" {
			recs = append(recs, Recommendation{
				Priority:    "medium",
				Title:       fmt.Sprintf("Monitor high-criticality resource %s/%s", b.Kind, b.Name),
				Description: fmt.Sprintf("Criticality score %.0f (%s) — affects %d namespaces", b.Score, b.Level, b.Affected),
				Impact:      "Early warning for potential cascading failures",
			})
		}
	}

	// Low: General cluster health
	if exec.HealthScore < 80 {
		recs = append(recs, Recommendation{
			Priority:    "low",
			Title:       "Improve overall cluster resilience posture",
			Description: fmt.Sprintf("Cluster health score is %.0f/100 (%s). Address SPOFs and add PodDisruptionBudgets to critical workloads.", exec.HealthScore, exec.HealthLevel),
			Impact:      "Improves recovery time and reduces blast radius of incidents",
		})
	}

	// Ensure stable sort order by priority
	priorityOrder := map[string]int{"critical": 0, "high": 1, "medium": 2, "low": 3}
	sort.SliceStable(recs, func(i, j int) bool {
		return priorityOrder[recs[i].Priority] < priorityOrder[recs[j].Priority]
	})

	if recs == nil {
		recs = []Recommendation{}
	}
	return recs
}

// riskLevel maps a risk score to a human-readable level.
func riskLevel(score float64) string {
	switch {
	case score >= 75:
		return "critical"
	case score >= 50:
		return "high"
	case score >= 25:
		return "medium"
	default:
		return "low"
	}
}

// healthLevel maps a health score to a human-readable level.
func healthLevel(score float64) string {
	switch {
	case score >= 90:
		return "excellent"
	case score >= 80:
		return "good"
	case score >= 70:
		return "fair"
	case score >= 60:
		return "poor"
	default:
		return "critical"
	}
}
