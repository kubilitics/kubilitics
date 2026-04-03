package reports

import "time"

// ResilienceReport is the top-level structure for a cluster resilience report.
// It aggregates health scores, SPOF inventory, risk rankings, blast radius data,
// topology drift, and prioritized recommendations into a single exportable document.
type ResilienceReport struct {
	ClusterID   string    `json:"cluster_id"`
	ClusterName string    `json:"cluster_name"`
	GeneratedAt time.Time `json:"generated_at"`
	Format      string    `json:"format"` // "pdf" or "json"

	ExecutiveSummary ExecutiveSummary `json:"executive_summary"`
	SPOFInventory    SPOFSection      `json:"spof_inventory"`
	RiskRanking      RiskSection      `json:"risk_ranking"`
	BlastRadiusMap   BlastSection     `json:"blast_radius_map"`
	TopologyDrift    DriftSection     `json:"topology_drift"`
	Recommendations  []Recommendation `json:"recommendations"`
}

// ExecutiveSummary provides a high-level overview of cluster resilience posture.
type ExecutiveSummary struct {
	HealthScore      float64 `json:"health_score"`
	HealthLevel      string  `json:"health_level"`
	TotalWorkloads   int     `json:"total_workloads"`
	TotalSPOFs       int     `json:"total_spofs"`
	CriticalSPOFs    int     `json:"critical_spofs"`
	NamespacesAtRisk int     `json:"namespaces_at_risk"`
	TopRisk          string  `json:"top_risk"`
}

// SPOFSection contains the highest-impact single points of failure.
type SPOFSection struct {
	Items []SPOFEntry `json:"items"` // top 20 by blast radius
}

// SPOFEntry is a single point of failure with its impact details.
type SPOFEntry struct {
	Name        string  `json:"name"`
	Kind        string  `json:"kind"`
	Namespace   string  `json:"namespace"`
	BlastRadius float64 `json:"blast_radius"`
	Reason      string  `json:"reason"`
	Remediation string  `json:"remediation"`
}

// RiskSection contains the riskiest namespaces.
type RiskSection struct {
	Namespaces []RiskEntry `json:"namespaces"` // top 10 riskiest
}

// RiskEntry is a namespace-level risk assessment.
type RiskEntry struct {
	Namespace string  `json:"namespace"`
	RiskScore float64 `json:"risk_score"`
	Level     string  `json:"level"`
	SPOFCount int     `json:"spof_count"`
}

// BlastSection contains the resources with the largest blast radius.
type BlastSection struct {
	TopResources []BlastEntry `json:"top_resources"` // top 10 highest blast radius
}

// BlastEntry is a resource with its blast radius analysis.
type BlastEntry struct {
	Name      string  `json:"name"`
	Kind      string  `json:"kind"`
	Namespace string  `json:"namespace"`
	Score     float64 `json:"score"`
	Level     string  `json:"level"`
	Affected  int     `json:"affected_count"`
}

// DriftSection summarizes topology changes over a time period.
type DriftSection struct {
	Period       string `json:"period"` // e.g. "last 30 days"
	NodesAdded   int    `json:"nodes_added"`
	NodesRemoved int    `json:"nodes_removed"`
	EdgesAdded   int    `json:"edges_added"`
	EdgesRemoved int    `json:"edges_removed"`
	NewSPOFs     int    `json:"new_spofs"`
	Summary      string `json:"summary"` // natural language
}

// Recommendation is a prioritized action item for improving cluster resilience.
type Recommendation struct {
	Priority    string `json:"priority"` // "critical", "high", "medium", "low"
	Title       string `json:"title"`
	Description string `json:"description"`
	Impact      string `json:"impact"`
}
