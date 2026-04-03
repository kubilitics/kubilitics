package preview

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// buildTestSnapshot creates a minimal graph snapshot for testing.
func buildTestSnapshot() *graph.GraphSnapshot {
	nodes := map[string]models.ResourceRef{
		"Deployment/default/web-api": {Kind: "Deployment", Name: "web-api", Namespace: "default"},
		"Service/default/web-svc":    {Kind: "Service", Name: "web-svc", Namespace: "default"},
		"ConfigMap/default/app-cfg":  {Kind: "ConfigMap", Name: "app-cfg", Namespace: "default"},
	}

	forward := map[string]map[string]bool{
		"Deployment/default/web-api": {"ConfigMap/default/app-cfg": true},
		"Service/default/web-svc":    {"Deployment/default/web-api": true},
	}
	reverse := map[string]map[string]bool{
		"ConfigMap/default/app-cfg":  {"Deployment/default/web-api": true},
		"Deployment/default/web-api": {"Service/default/web-svc": true},
	}

	return &graph.GraphSnapshot{
		Nodes:   nodes,
		Forward: forward,
		Reverse: reverse,
		Edges: []models.BlastDependencyEdge{
			{
				Source: models.ResourceRef{Kind: "Deployment", Name: "web-api", Namespace: "default"},
				Target: models.ResourceRef{Kind: "ConfigMap", Name: "app-cfg", Namespace: "default"},
				Type:   "volume-mount",
			},
			{
				Source: models.ResourceRef{Kind: "Service", Name: "web-svc", Namespace: "default"},
				Target: models.ResourceRef{Kind: "Deployment", Name: "web-api", Namespace: "default"},
				Type:   "selector",
			},
		},
		NodeScores: map[string]float64{
			"Deployment/default/web-api": 55.0,
			"Service/default/web-svc":    30.0,
			"ConfigMap/default/app-cfg":  20.0,
		},
		NodeRisks:    map[string][]models.RiskIndicator{},
		NodeReplicas: map[string]int{"Deployment/default/web-api": 3},
		NodeHasHPA:   map[string]bool{"Deployment/default/web-api": true},
		NodeHasPDB:   map[string]bool{"Deployment/default/web-api": true},
		NodeIngress:  map[string][]string{},
		TotalWorkloads: 3,
		BuiltAt:        1000000,
		Namespaces:     map[string]bool{"default": true},
	}
}

func TestAnalyzeManifest_SingleNewResource(t *testing.T) {
	engine := NewEngine()
	snap := buildTestSnapshot()

	manifest := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: new-service
  namespace: default
spec:
  replicas: 3
`
	result, err := engine.AnalyzeManifest(manifest, snap)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.TotalAffected != 1 {
		t.Errorf("expected 1 affected, got %d", result.TotalAffected)
	}
	if result.AffectedResources[0].Impact != "created" {
		t.Errorf("expected impact 'created', got '%s'", result.AffectedResources[0].Impact)
	}
	if result.AffectedResources[0].Kind != "Deployment" {
		t.Errorf("expected kind 'Deployment', got '%s'", result.AffectedResources[0].Kind)
	}
}

func TestAnalyzeManifest_ModifiedExistingResource(t *testing.T) {
	engine := NewEngine()
	snap := buildTestSnapshot()

	manifest := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-api
  namespace: default
spec:
  replicas: 5
`
	result, err := engine.AnalyzeManifest(manifest, snap)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.TotalAffected != 1 {
		t.Errorf("expected 1 affected, got %d", result.TotalAffected)
	}
	if result.AffectedResources[0].Impact != "modified" {
		t.Errorf("expected impact 'modified', got '%s'", result.AffectedResources[0].Impact)
	}
	if result.AffectedResources[0].BlastScore == 0 {
		t.Error("expected non-zero blast score for modified resource")
	}
}

func TestAnalyzeManifest_MultiDocYAML(t *testing.T) {
	engine := NewEngine()
	snap := buildTestSnapshot()

	manifest := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: svc-a
  namespace: default
spec:
  replicas: 2
---
apiVersion: v1
kind: Service
metadata:
  name: svc-a-svc
  namespace: default
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: svc-a-config
  namespace: default
`
	result, err := engine.AnalyzeManifest(manifest, snap)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.TotalAffected != 3 {
		t.Errorf("expected 3 affected resources, got %d", result.TotalAffected)
	}

	// All should be "created" since they don't exist in the snapshot.
	for _, ar := range result.AffectedResources {
		if ar.Impact != "created" {
			t.Errorf("expected impact 'created' for %s/%s, got '%s'", ar.Kind, ar.Name, ar.Impact)
		}
	}
}

func TestAnalyzeManifest_SPOFDetection_ReplicaReduction(t *testing.T) {
	engine := NewEngine()
	snap := buildTestSnapshot()

	// Manifest reduces web-api from 3 replicas to 1.
	manifest := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-api
  namespace: default
spec:
  replicas: 1
`
	result, err := engine.AnalyzeManifest(manifest, snap)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.NewSPOFs) != 1 {
		t.Errorf("expected 1 new SPOF, got %d", len(result.NewSPOFs))
	}
	if len(result.NewSPOFs) > 0 && result.NewSPOFs[0].Name != "web-api" {
		t.Errorf("expected SPOF name 'web-api', got '%s'", result.NewSPOFs[0].Name)
	}

	// Should have an increase-replicas remediation.
	hasReplicaRemediation := false
	for _, rem := range result.Remediations {
		if rem.Type == "increase-replicas" {
			hasReplicaRemediation = true
		}
	}
	if !hasReplicaRemediation {
		t.Error("expected 'increase-replicas' remediation for replica=1 resource")
	}
}

func TestAnalyzeManifest_RemovedSPOF(t *testing.T) {
	engine := NewEngine()
	snap := buildTestSnapshot()

	// Set web-api to 1 replica and no HPA with dependents — makes it a SPOF.
	snap.NodeReplicas["Deployment/default/web-api"] = 1
	snap.NodeHasHPA["Deployment/default/web-api"] = false

	// Manifest scales it to 3 replicas.
	manifest := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-api
  namespace: default
spec:
  replicas: 3
`
	result, err := engine.AnalyzeManifest(manifest, snap)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.RemovedSPOFs) != 1 {
		t.Errorf("expected 1 removed SPOF, got %d", len(result.RemovedSPOFs))
	}
}

func TestAnalyzeManifest_HealthScoreDelta(t *testing.T) {
	engine := NewEngine()
	snap := buildTestSnapshot()

	manifest := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-api
  namespace: default
spec:
  replicas: 5
`
	result, err := engine.AnalyzeManifest(manifest, snap)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Health score before and after should be set.
	if result.HealthScoreBefore <= 0 {
		t.Error("expected positive health score before")
	}

	// Since web-api has high blast score (55), modifying it should reduce health.
	if result.HealthScoreDelta >= 0 {
		t.Errorf("expected negative health score delta for high-blast resource modification, got %f", result.HealthScoreDelta)
	}
}

func TestAnalyzeManifest_InvalidYAML(t *testing.T) {
	engine := NewEngine()
	snap := buildTestSnapshot()

	manifest := `
this is not: [valid yaml: {{
`
	_, err := engine.AnalyzeManifest(manifest, snap)
	if err == nil {
		t.Error("expected error for invalid YAML")
	}
}

func TestAnalyzeManifest_EmptyManifest(t *testing.T) {
	engine := NewEngine()
	snap := buildTestSnapshot()

	_, err := engine.AnalyzeManifest("", snap)
	if err == nil {
		t.Error("expected error for empty manifest")
	}
}

func TestAnalyzeManifest_DefaultNamespace(t *testing.T) {
	engine := NewEngine()
	snap := buildTestSnapshot()

	// Manifest without namespace should default to "default".
	manifest := `
apiVersion: v1
kind: Service
metadata:
  name: no-ns-svc
`
	result, err := engine.AnalyzeManifest(manifest, snap)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.AffectedResources[0].Namespace != "default" {
		t.Errorf("expected namespace 'default', got '%s'", result.AffectedResources[0].Namespace)
	}
}

func TestAnalyzeManifest_WarningsForHighBlast(t *testing.T) {
	engine := NewEngine()
	snap := buildTestSnapshot()

	// Modify web-api which has a score of 55 (>= 45, HIGH).
	manifest := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-api
  namespace: default
spec:
  replicas: 5
`
	result, err := engine.AnalyzeManifest(manifest, snap)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Warnings) == 0 {
		t.Error("expected at least one warning for high-blast resource modification")
	}
}

func TestParseMultiDocYAML_WithLeadingSeparator(t *testing.T) {
	manifest := `---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm1
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm2
`
	resources, err := parseMultiDocYAML(manifest)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resources) != 2 {
		t.Errorf("expected 2 resources, got %d", len(resources))
	}
}

func TestNormalizeKind(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Deployment", "Deployment"},
		{"deployment", "Deployment"},
		{"deployments", "Deployment"},
		{"StatefulSet", "StatefulSet"},
		{"service", "Service"},
		{"pvc", "PersistentVolumeClaim"},
		{"unknown", ""},
	}

	for _, tt := range tests {
		got := normalizeKind(tt.input)
		if got != tt.expected {
			t.Errorf("normalizeKind(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}
