package preview

// PreviewRequest is the JSON body for the pre-apply blast radius endpoint.
type PreviewRequest struct {
	ManifestYAML string `json:"manifest_yaml"`
	DryRun       bool   `json:"dry_run"` // default true
}

// PreviewResult is the aggregate impact report returned by AnalyzeManifest.
type PreviewResult struct {
	AffectedResources []AffectedResource `json:"affected_resources"`
	TotalAffected     int                `json:"total_affected"`
	BlastRadiusScore  float64            `json:"blast_radius_score"`
	BlastRadiusLevel  string             `json:"blast_radius_level"`
	HealthScoreBefore float64            `json:"health_score_before"`
	HealthScoreAfter  float64            `json:"health_score_after"`
	HealthScoreDelta  float64            `json:"health_score_delta"`
	NewSPOFs          []ResourceRef      `json:"new_spofs"`
	RemovedSPOFs      []ResourceRef      `json:"removed_spofs"`
	Warnings          []string           `json:"warnings"`
	Remediations      []Remediation      `json:"remediations"`
}

// AffectedResource describes a single resource that would be impacted by applying
// the manifest.
type AffectedResource struct {
	Name       string  `json:"name"`
	Kind       string  `json:"kind"`
	Namespace  string  `json:"namespace"`
	Impact     string  `json:"impact"`      // "created", "modified", "deleted"
	BlastScore float64 `json:"blast_score"` // per-resource blast radius score
}

// ResourceRef uniquely identifies a Kubernetes resource.
type ResourceRef struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
}

// Remediation is a suggested action to reduce blast radius.
type Remediation struct {
	Type        string `json:"type"`
	Description string `json:"description"`
	Priority    string `json:"priority"` // "critical", "high", "medium", "low"
}
