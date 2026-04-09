# Blast Radius Engine v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the graph-traversal blast radius engine with a failure impact simulation engine that classifies resources as broken/degraded/self-healing based on actual Service endpoint availability.

**Architecture:** New classification engine (`classify.go`) sits between the graph snapshot and the API response. It receives a target resource + failure mode, computes lost pods, evaluates Service endpoint health, propagates impact through Ingress and OTel-traced consumers, and produces weighted blast radius %. The old BFS-based scoring is replaced with a 4-sub-score composite model (resilience, exposure, recovery, impact) in `scoring.go`. Infrastructure-critical components get override rules in `infrastructure.go`. Natural language verdicts are generated in `verdict.go`.

**Tech Stack:** Go 1.22, Kubernetes client-go informers, SQLite (OTel span storage), existing `internal/otel` package for service map.

**Spec:** `docs/superpowers/specs/2026-04-09-blast-radius-engine-v2-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `internal/models/blast_radius.go` | Modify | Add new structs: SubScores, ImpactSummary, ServiceImpact, IngressImpact, ConsumerImpact, ScoreBreakdown, ScoringFactor, AuditTrail, ServiceImpactAudit, SubScoreDetail. Update BlastRadiusResult. |
| `internal/graph/infrastructure.go` | Create | Critical system component definitions, matching, and classification override logic |
| `internal/graph/classify.go` | Create | Impact classification engine: computeLostPods, classifyServiceImpact, classifyIngressImpact, classifyConsumerImpact, classifyControllers, computeBlastRadiusPercent |
| `internal/graph/scoring_v2.go` | Create | New composite scoring: computeResilience, computeExposure, computeRecovery, computeOverallCriticality |
| `internal/graph/verdict.go` | Create | Natural language verdict generator |
| `internal/graph/snapshot.go` | Modify | Replace computeSingleResourceBlast with new classification engine. Update GraphSnapshot struct to hold Endpoints data. |
| `internal/graph/builder.go` | Modify | Remove 4 inference functions, add Endpoints collection to ClusterResources, wire OTel service map |
| `internal/graph/engine.go` | Modify | Add Endpoints informer to Start(), add Endpoints to collectResources() |
| `internal/graph/scoring.go` | Modify | Keep failure mode constants and PageRank (still used for graph). Remove computeBaseScore, applyFailureMode, computeCriticalityScore. |
| `internal/api/rest/blast_radius.go` | Modify | Add failure mode auto-detection, ?audit=true support |
| `internal/graph/classify_test.go` | Create | Impact classification tests |
| `internal/graph/infrastructure_test.go` | Create | Infrastructure component tests |
| `internal/graph/scoring_v2_test.go` | Create | Composite scoring tests |
| `internal/graph/verdict_test.go` | Create | Verdict generation tests |

---

## Task 1: New Data Models

**Files:**
- Modify: `internal/models/blast_radius.go`

- [ ] **Step 1: Read the current file**

Read `internal/models/blast_radius.go` to confirm current struct layout before modifying.

- [ ] **Step 2: Add new structs and update BlastRadiusResult**

Add after the existing `BlastRadiusSummaryEntry` struct (after line 108):

```go
// SubScores holds the four transparent sub-scores for the composite criticality model.
type SubScores struct {
	Resilience SubScoreDetail `json:"resilience"`
	Exposure   SubScoreDetail `json:"exposure"`
	Recovery   SubScoreDetail `json:"recovery"`
	Impact     SubScoreDetail `json:"impact"`
}

// SubScoreDetail holds a single sub-score with its contributing factors.
type SubScoreDetail struct {
	Score      int             `json:"score"`
	Factors    []ScoringFactor `json:"factors"`
	Source     string          `json:"source,omitempty"`     // "otel" | "k8s-native"
	Confidence string          `json:"confidence,omitempty"` // "high" | "low"
}

// ScoringFactor is one contributing factor to a sub-score.
type ScoringFactor struct {
	Name   string  `json:"name"`
	Value  string  `json:"value"`
	Effect float64 `json:"effect"`
	Note   string  `json:"note"`
}

// ScoreBreakdown is the full explainability structure for the criticality score.
type ScoreBreakdown struct {
	Resilience SubScoreDetail `json:"resilience"`
	Exposure   SubScoreDetail `json:"exposure"`
	Recovery   SubScoreDetail `json:"recovery"`
	Impact     SubScoreDetail `json:"impact"`
	Overall    float64        `json:"overall"`
	Level      string         `json:"level"`
}

// ImpactSummary summarizes the classification results across the cluster.
type ImpactSummary struct {
	BrokenCount      int      `json:"brokenCount"`
	DegradedCount    int      `json:"degradedCount"`
	SelfHealingCount int      `json:"selfHealingCount"`
	TotalWorkloads   int      `json:"totalWorkloads"`
	CapacityNotes    []string `json:"capacityNotes"`
}

// ServiceImpact is the impact classification for a single Service.
type ServiceImpact struct {
	Service            ResourceRef `json:"service"`
	Classification     string      `json:"classification"` // "broken" | "degraded" | "self-healing"
	TotalEndpoints     int         `json:"totalEndpoints"`
	RemainingEndpoints int         `json:"remainingEndpoints"`
	Threshold          float64     `json:"threshold"`
	ThresholdSource    string      `json:"thresholdSource"` // "pdb:my-pdb" | "default:50%"
	Note               string      `json:"note"`
}

// IngressImpact is the impact classification for a single Ingress.
type IngressImpact struct {
	Ingress        ResourceRef `json:"ingress"`
	Classification string      `json:"classification"`
	Host           string      `json:"host"`
	BackendService string      `json:"backendService"`
	Note           string      `json:"note"`
}

// ConsumerImpact is the impact classification for a consumer workload identified via OTel traces.
type ConsumerImpact struct {
	Workload       ResourceRef `json:"workload"`
	Classification string      `json:"classification"`
	DependsOn      string      `json:"dependsOn"`
	Note           string      `json:"note"`
}

// AuditTrail is the full calculation trace returned when ?audit=true is set.
type AuditTrail struct {
	Timestamp            string              `json:"timestamp"`
	TargetResource       ResourceRef         `json:"targetResource"`
	FailureMode          string              `json:"failureMode"`
	GraphStalenessMs     int64               `json:"graphStalenessMs"`
	TraceDataAgeMs       *int64              `json:"traceDataAgeMs,omitempty"`
	LostPods             []ResourceRef       `json:"lostPods"`
	ServiceImpacts       []ServiceImpactAudit `json:"serviceImpacts"`
	IngressImpacts       []IngressImpact     `json:"ingressImpacts"`
	ConsumerImpacts      []ConsumerImpact    `json:"consumerImpacts,omitempty"`
	ScoreBreakdown       ScoreBreakdown      `json:"scoreBreakdown"`
	ClusterWorkloadCount int                 `json:"clusterWorkloadCount"`
	CoverageLevel        string              `json:"coverageLevel"`
}

// ServiceImpactAudit is the detailed audit entry for a single Service's impact computation.
type ServiceImpactAudit struct {
	Service         string  `json:"service"`
	TotalEndpoints  int     `json:"totalEndpoints"`
	LostEndpoints   int     `json:"lostEndpoints"`
	RemainingPct    float64 `json:"remainingPercent"`
	Threshold       float64 `json:"threshold"`
	ThresholdSource string  `json:"thresholdSource"`
	Classification  string  `json:"classification"`
}
```

- [ ] **Step 3: Update BlastRadiusResult struct**

Replace the existing `BlastRadiusResult` struct (lines 4-31) with:

```go
// BlastRadiusResult is the complete blast-radius analysis response for a target resource.
type BlastRadiusResult struct {
	// Target
	TargetResource ResourceRef `json:"targetResource"`
	FailureMode    string      `json:"failureMode"`

	// Core metrics
	BlastRadiusPercent float64 `json:"blastRadiusPercent"`
	CriticalityScore   float64 `json:"criticalityScore"`
	CriticalityLevel   string  `json:"criticalityLevel"`

	// Sub-scores
	SubScores SubScores `json:"subScores"`

	// Impact classification
	ImpactSummary     ImpactSummary    `json:"impactSummary"`
	AffectedServices  []ServiceImpact  `json:"affectedServices"`
	AffectedIngresses []IngressImpact  `json:"affectedIngresses,omitempty"`
	AffectedConsumers []ConsumerImpact `json:"affectedConsumers,omitempty"`

	// Explainability
	ScoreBreakdown ScoreBreakdown `json:"scoreBreakdown"`
	Verdict        string         `json:"verdict"`
	AuditTrail     *AuditTrail    `json:"auditTrail,omitempty"`

	// Coverage
	CoverageLevel string `json:"coverageLevel"` // "high" | "partial"
	CoverageNote  string `json:"coverageNote,omitempty"`

	// Resource characteristics
	ReplicaCount     int    `json:"replicaCount"`
	IsSPOF           bool   `json:"isSPOF"`
	HasHPA           bool   `json:"hasHPA"`
	HasPDB           bool   `json:"hasPDB"`
	IsIngressExposed bool   `json:"isIngressExposed"`
	IngressHosts     []string `json:"ingressHosts"`
	Remediations     []Remediation `json:"remediations"`

	// Existing fields kept for backward compat / topology rendering
	FanIn              int  `json:"fanIn"`
	FanOut             int  `json:"fanOut"`
	TotalAffected      int  `json:"totalAffected"`
	AffectedNamespaces int  `json:"affectedNamespaces"`

	Waves           []BlastWave           `json:"waves"`
	DependencyChain []BlastDependencyEdge `json:"dependencyChain"`
	RiskIndicators  []RiskIndicator       `json:"riskIndicators"`

	// Graph metadata
	GraphNodeCount   int   `json:"graphNodeCount"`
	GraphEdgeCount   int   `json:"graphEdgeCount"`
	GraphStalenessMs int64 `json:"graphStalenessMs"`
}
```

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go build ./internal/models/...`
Expected: PASS (no errors)

- [ ] **Step 5: Commit**

```bash
git add internal/models/blast_radius.go
git commit -m "feat(blast-radius): add v2 data models — sub-scores, impact classification, audit trail"
```

---

## Task 2: Infrastructure Component Definitions

**Files:**
- Create: `internal/graph/infrastructure.go`
- Create: `internal/graph/infrastructure_test.go`

- [ ] **Step 1: Write the test file**

Create `internal/graph/infrastructure_test.go`:

```go
package graph

import "testing"

func TestIsCriticalSystemComponent(t *testing.T) {
	tests := []struct {
		name      string
		kind      string
		namespace string
		resName   string
		wantMatch bool
		wantScope string
	}{
		{"coredns deployment", "Deployment", "kube-system", "coredns", true, "cluster-wide"},
		{"kube-proxy daemonset", "DaemonSet", "kube-system", "kube-proxy", true, "node-level"},
		{"etcd pod", "Pod", "kube-system", "etcd-control-plane", true, "control-plane"},
		{"kube-apiserver", "Pod", "kube-system", "kube-apiserver-control-plane", true, "control-plane"},
		{"metrics-server", "Deployment", "kube-system", "metrics-server", true, "cluster-wide"},
		{"user workload in kube-system", "Deployment", "kube-system", "my-custom-thing", false, ""},
		{"coredns in wrong namespace", "Deployment", "default", "coredns", false, ""},
		{"random app", "Deployment", "default", "my-app", false, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			comp, ok := matchCriticalComponent(tt.namespace, tt.resName)
			if ok != tt.wantMatch {
				t.Errorf("matchCriticalComponent(%s, %s) matched=%v, want %v", tt.namespace, tt.resName, ok, tt.wantMatch)
			}
			if ok && comp.ImpactScope != tt.wantScope {
				t.Errorf("scope=%s, want %s", comp.ImpactScope, tt.wantScope)
			}
		})
	}
}

func TestIsKubeSystemResource(t *testing.T) {
	if !isKubeSystemResource("kube-system") {
		t.Error("expected kube-system to be true")
	}
	if isKubeSystemResource("default") {
		t.Error("expected default to be false")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -run TestIsCriticalSystem -v`
Expected: FAIL (functions not defined)

- [ ] **Step 3: Implement infrastructure.go**

Create `internal/graph/infrastructure.go`:

```go
package graph

import "strings"

// CriticalComponent defines a known Kubernetes system component with its impact scope.
type CriticalComponent struct {
	ImpactScope string // "cluster-wide" | "node-level" | "control-plane"
	Description string
}

// criticalSystemComponents maps component name prefixes to their definitions.
// Names are matched as prefixes to handle suffixed names like "etcd-control-plane".
var criticalSystemComponents = map[string]CriticalComponent{
	"coredns":                 {ImpactScope: "cluster-wide", Description: "DNS resolution for all services"},
	"kube-proxy":              {ImpactScope: "node-level", Description: "Service networking and iptables rules"},
	"kube-apiserver":          {ImpactScope: "control-plane", Description: "All K8s API operations"},
	"etcd":                    {ImpactScope: "control-plane", Description: "Cluster state store"},
	"kube-controller-manager": {ImpactScope: "control-plane", Description: "Controller reconciliation loops"},
	"kube-scheduler":          {ImpactScope: "control-plane", Description: "Pod scheduling"},
	"metrics-server":          {ImpactScope: "cluster-wide", Description: "HPA and resource metrics"},
}

// matchCriticalComponent checks if a resource in kube-system matches a known critical component.
// Returns the component definition and true if matched, or zero value and false if not.
func matchCriticalComponent(namespace, name string) (CriticalComponent, bool) {
	if namespace != "kube-system" {
		return CriticalComponent{}, false
	}
	lowerName := strings.ToLower(name)
	for prefix, comp := range criticalSystemComponents {
		if strings.HasPrefix(lowerName, prefix) {
			return comp, true
		}
	}
	return CriticalComponent{}, false
}

// isKubeSystemResource returns true if the namespace is kube-system.
func isKubeSystemResource(namespace string) bool {
	return namespace == "kube-system"
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -run TestIsCriticalSystem -v`
Expected: PASS

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -run TestIsKubeSystem -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/graph/infrastructure.go internal/graph/infrastructure_test.go
git commit -m "feat(blast-radius): add critical system component definitions"
```

---

## Task 3: Impact Classification Engine

**Files:**
- Create: `internal/graph/classify.go`
- Create: `internal/graph/classify_test.go`

- [ ] **Step 1: Write classification test file**

Create `internal/graph/classify_test.go`:

```go
package graph

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func TestComputeLostPods_PodCrash(t *testing.T) {
	snap := &GraphSnapshot{}
	snap.EnsureMaps()
	snap.Nodes["Pod/default/pod-1"] = models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "pod-1"}

	lost := computeLostPods(snap, models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "pod-1"}, FailureModePodCrash)
	if len(lost) != 1 || lost["Pod/default/pod-1"] != true {
		t.Errorf("expected exactly pod-1 lost, got %v", lost)
	}
}

func TestComputeLostPods_WorkloadDeletion(t *testing.T) {
	snap := &GraphSnapshot{}
	snap.EnsureMaps()
	snap.Nodes["Deployment/default/app"] = models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "app"}
	snap.Nodes["Pod/default/app-abc-1"] = models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "app-abc-1"}
	snap.Nodes["Pod/default/app-abc-2"] = models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "app-abc-2"}
	snap.Nodes["Pod/default/other-pod"] = models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "other-pod"}

	// Pod → RS → Deployment ownership chain
	snap.PodOwners = map[string]string{
		"Pod/default/app-abc-1": "Deployment/default/app",
		"Pod/default/app-abc-2": "Deployment/default/app",
		"Pod/default/other-pod": "Deployment/default/other",
	}

	lost := computeLostPods(snap, models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "app"}, FailureModeWorkloadDeletion)
	if len(lost) != 2 {
		t.Errorf("expected 2 lost pods, got %d: %v", len(lost), lost)
	}
	if !lost["Pod/default/app-abc-1"] || !lost["Pod/default/app-abc-2"] {
		t.Errorf("expected app pods lost, got %v", lost)
	}
}

func TestClassifyServiceImpact_Broken(t *testing.T) {
	// Service with 1 endpoint, pod is lost → broken
	endpoints := map[string][]corev1.EndpointAddress{
		"Service/default/svc-a": {
			{IP: "10.0.0.1", TargetRef: &corev1.ObjectReference{Kind: "Pod", Name: "pod-1", Namespace: "default"}},
		},
	}
	lostPods := map[string]bool{"Pod/default/pod-1": true}

	impacts := classifyServiceImpact(endpoints, lostPods, nil)
	if len(impacts) != 1 {
		t.Fatalf("expected 1 impact, got %d", len(impacts))
	}
	if impacts[0].Classification != "broken" {
		t.Errorf("expected broken, got %s", impacts[0].Classification)
	}
	if impacts[0].RemainingEndpoints != 0 {
		t.Errorf("expected 0 remaining, got %d", impacts[0].RemainingEndpoints)
	}
}

func TestClassifyServiceImpact_SelfHealing(t *testing.T) {
	// Service with 4 endpoints, lose 1 → 75% remaining, above 50% threshold → self-healing
	endpoints := map[string][]corev1.EndpointAddress{
		"Service/default/svc-a": {
			{IP: "10.0.0.1", TargetRef: &corev1.ObjectReference{Kind: "Pod", Name: "pod-1", Namespace: "default"}},
			{IP: "10.0.0.2", TargetRef: &corev1.ObjectReference{Kind: "Pod", Name: "pod-2", Namespace: "default"}},
			{IP: "10.0.0.3", TargetRef: &corev1.ObjectReference{Kind: "Pod", Name: "pod-3", Namespace: "default"}},
			{IP: "10.0.0.4", TargetRef: &corev1.ObjectReference{Kind: "Pod", Name: "pod-4", Namespace: "default"}},
		},
	}
	lostPods := map[string]bool{"Pod/default/pod-1": true}

	impacts := classifyServiceImpact(endpoints, lostPods, nil)
	if len(impacts) != 1 {
		t.Fatalf("expected 1 impact, got %d", len(impacts))
	}
	if impacts[0].Classification != "self-healing" {
		t.Errorf("expected self-healing, got %s", impacts[0].Classification)
	}
}

func TestClassifyServiceImpact_DegradedWithPDB(t *testing.T) {
	// Service with 3 endpoints, lose 2 → 33% remaining
	// PDB minAvailable=2 → threshold = 2/3 = 66.7% → 33% < 66.7% → degraded
	minAvail := intstr.FromInt32(2)
	pdbs := []policyv1.PodDisruptionBudget{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "my-pdb", Namespace: "default"},
			Spec: policyv1.PodDisruptionBudgetSpec{
				MinAvailable: &minAvail,
				Selector:     &metav1.LabelSelector{MatchLabels: map[string]string{"app": "svc-a"}},
			},
		},
	}
	endpoints := map[string][]corev1.EndpointAddress{
		"Service/default/svc-a": {
			{IP: "10.0.0.1", TargetRef: &corev1.ObjectReference{Kind: "Pod", Name: "pod-1", Namespace: "default"}},
			{IP: "10.0.0.2", TargetRef: &corev1.ObjectReference{Kind: "Pod", Name: "pod-2", Namespace: "default"}},
			{IP: "10.0.0.3", TargetRef: &corev1.ObjectReference{Kind: "Pod", Name: "pod-3", Namespace: "default"}},
		},
	}
	lostPods := map[string]bool{"Pod/default/pod-1": true, "Pod/default/pod-2": true}

	impacts := classifyServiceImpact(endpoints, lostPods, pdbs)
	if len(impacts) != 1 {
		t.Fatalf("expected 1 impact, got %d", len(impacts))
	}
	if impacts[0].Classification != "degraded" {
		t.Errorf("expected degraded, got %s", impacts[0].Classification)
	}
	if impacts[0].ThresholdSource != "pdb:my-pdb" {
		t.Errorf("expected pdb source, got %s", impacts[0].ThresholdSource)
	}
}

func TestClassifyServiceImpact_NoImpact(t *testing.T) {
	// Service endpoints don't reference the lost pod → no impact
	endpoints := map[string][]corev1.EndpointAddress{
		"Service/default/svc-a": {
			{IP: "10.0.0.1", TargetRef: &corev1.ObjectReference{Kind: "Pod", Name: "pod-2", Namespace: "default"}},
		},
	}
	lostPods := map[string]bool{"Pod/default/pod-1": true}

	impacts := classifyServiceImpact(endpoints, lostPods, nil)
	if len(impacts) != 0 {
		t.Errorf("expected 0 impacts, got %d", len(impacts))
	}
}

func TestComputeBlastRadiusPercent(t *testing.T) {
	impacts := []models.ServiceImpact{
		{Classification: "broken"},
		{Classification: "degraded"},
		{Classification: "self-healing"},
	}
	// numerator = 1.0 + 0.5 + 0.0 = 1.5
	// denominator = 10 total workloads
	pct := computeBlastRadiusPercent(impacts, nil, nil, 10)
	expected := 15.0 // (1.5 / 10) * 100
	if pct != expected {
		t.Errorf("expected %.1f%%, got %.1f%%", expected, pct)
	}
}

func TestComputeBlastRadiusPercent_ZeroDenominator(t *testing.T) {
	pct := computeBlastRadiusPercent(nil, nil, nil, 0)
	if pct != 0 {
		t.Errorf("expected 0, got %f", pct)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -run TestComputeLostPods -v 2>&1 | head -20`
Expected: FAIL (functions not defined)

- [ ] **Step 3: Implement classify.go**

Create `internal/graph/classify.go`:

```go
package graph

import (
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/otel"

	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

// ClassificationResult holds the full output of the impact classification engine.
type ClassificationResult struct {
	LostPods          map[string]bool
	ServiceImpacts    []models.ServiceImpact
	IngressImpacts    []models.IngressImpact
	ConsumerImpacts   []models.ConsumerImpact
	BlastRadiusPct    float64
	ImpactSummary     models.ImpactSummary
	CoverageLevel     string // "high" | "partial"
	CoverageNote      string
}

// classifyImpact is the top-level classification entry point.
// It runs Steps 1-7 from the spec and returns a complete ClassificationResult.
func classifyImpact(
	snap *GraphSnapshot,
	target models.ResourceRef,
	failureMode string,
	endpoints map[string][]corev1.EndpointAddress,
	pdbs []policyv1.PodDisruptionBudget,
	serviceMap *otel.ServiceMap,
	totalWorkloads int,
) *ClassificationResult {
	// Step 1: Compute lost pods
	lostPods := computeLostPods(snap, target, failureMode)

	// Step 1b: DaemonSet node-scoped handling
	// If target is a DaemonSet pod under pod-crash, it's node-scoped — unlikely to break Services
	// The Service endpoint classification in Step 2 handles this naturally (1/N endpoints lost)
	// but we record the node-scoped note for the UI
	isDaemonSetPodCrash := false
	if failureMode == FailureModePodCrash && target.Kind == "Pod" {
		if ownerKey, ok := snap.PodOwners[refKey(target)]; ok {
			if ownerRef, exists := snap.Nodes[ownerKey]; exists && ownerRef.Kind == "DaemonSet" {
				isDaemonSetPodCrash = true
			}
		}
	}
	_ = isDaemonSetPodCrash // used in summary note generation below

	// Step 2: Classify Service impact
	svcImpacts := classifyServiceImpact(endpoints, lostPods, pdbs)

	// Step 3: Classify Ingress impact
	ingImpacts := classifyIngressImpact(snap, svcImpacts)

	// Step 4: Classify consumer workloads (OTel only)
	var consumerImpacts []models.ConsumerImpact
	coverageLevel := "partial"
	coverageNote := "Consumer dependencies unavailable — no trace data. Impact shown is Service/Ingress-level only."

	if serviceMap != nil && len(serviceMap.Edges) > 0 {
		consumerImpacts = classifyConsumerImpact(snap, svcImpacts, serviceMap)
		coverageLevel = "high"
		coverageNote = ""
	}

	// Step 5: Apply infrastructure overrides
	svcImpacts = applyInfrastructureOverrides(snap, svcImpacts)

	// Step 6: Compute blast radius %
	blastPct := computeBlastRadiusPercent(svcImpacts, ingImpacts, consumerImpacts, totalWorkloads)

	// Step 7: Apply control-plane override (broken control-plane = 100%)
	blastPct = applyControlPlaneOverride(snap, target, lostPods, svcImpacts, blastPct)

	// Build impact summary
	summary := buildImpactSummary(svcImpacts, ingImpacts, consumerImpacts, totalWorkloads)

	return &ClassificationResult{
		LostPods:        lostPods,
		ServiceImpacts:  svcImpacts,
		IngressImpacts:  ingImpacts,
		ConsumerImpacts: consumerImpacts,
		BlastRadiusPct:  blastPct,
		ImpactSummary:   summary,
		CoverageLevel:   coverageLevel,
		CoverageNote:    coverageNote,
	}
}

// computeLostPods determines which pods are lost under the given failure mode.
func computeLostPods(snap *GraphSnapshot, target models.ResourceRef, failureMode string) map[string]bool {
	lost := make(map[string]bool)

	switch failureMode {
	case FailureModePodCrash:
		if target.Kind == "Pod" {
			lost[refKey(target)] = true
		}

	case FailureModeWorkloadDeletion:
		// Find all pods owned by this workload
		targetKey := refKey(target)
		for podKey, ownerKey := range snap.PodOwners {
			if ownerKey == targetKey {
				lost[podKey] = true
			}
		}
		// If target is a Pod itself (workload-deletion of a pod = same as pod-crash)
		if target.Kind == "Pod" {
			lost[refKey(target)] = true
		}

	case FailureModeNamespaceDeletion:
		ns := target.Namespace
		if target.Kind == "Namespace" {
			ns = target.Name
		}
		for key, ref := range snap.Nodes {
			if ref.Kind == "Pod" && ref.Namespace == ns {
				lost[key] = true
			}
		}
	}

	return lost
}

// classifyServiceImpact evaluates every Service's endpoint health against lost pods.
func classifyServiceImpact(
	endpoints map[string][]corev1.EndpointAddress,
	lostPods map[string]bool,
	pdbs []policyv1.PodDisruptionBudget,
) []models.ServiceImpact {
	var impacts []models.ServiceImpact

	for svcKey, addrs := range endpoints {
		totalReady := len(addrs)
		if totalReady == 0 {
			continue
		}

		lostCount := 0
		for _, addr := range addrs {
			if addr.TargetRef != nil {
				podKey := fmt.Sprintf("Pod/%s/%s", addr.TargetRef.Namespace, addr.TargetRef.Name)
				if lostPods[podKey] {
					lostCount++
				}
			}
		}

		if lostCount == 0 {
			continue // this service is not affected
		}

		remaining := totalReady - lostCount

		// Determine threshold from PDB or default
		threshold := 0.5
		thresholdSource := "default:50%"

		if pdbs != nil {
			// Find PDB that matches pods behind this service
			for _, pdb := range pdbs {
				if pdb.Namespace != extractNamespace(svcKey) {
					continue
				}
				// Check if any lost pod's labels match the PDB selector
				if pdb.Spec.MinAvailable != nil {
					t := resolveIntOrPercent(*pdb.Spec.MinAvailable, totalReady)
					if t > 0 {
						threshold = t
						thresholdSource = fmt.Sprintf("pdb:%s", pdb.Name)
						break
					}
				}
				if pdb.Spec.MaxUnavailable != nil {
					maxUnavail := resolveIntOrPercent(*pdb.Spec.MaxUnavailable, totalReady)
					threshold = 1.0 - maxUnavail
					thresholdSource = fmt.Sprintf("pdb:%s", pdb.Name)
					break
				}
			}
		}

		// Parse svcKey to get ResourceRef
		parts := strings.SplitN(svcKey, "/", 3)
		svcRef := models.ResourceRef{Kind: parts[0], Namespace: parts[1], Name: parts[2]}

		var classification, note string
		if remaining == 0 {
			classification = "broken"
			note = fmt.Sprintf("No endpoints available — service %s unreachable", svcRef.Name)
		} else if float64(remaining)/float64(totalReady) < threshold {
			classification = "degraded"
			note = fmt.Sprintf("Service %s: %d/%d endpoints — below minimum threshold", svcRef.Name, remaining, totalReady)
		} else {
			classification = "self-healing"
			note = fmt.Sprintf("Service %s: %d/%d endpoints — above threshold", svcRef.Name, remaining, totalReady)
		}

		impacts = append(impacts, models.ServiceImpact{
			Service:            svcRef,
			Classification:     classification,
			TotalEndpoints:     totalReady,
			RemainingEndpoints: remaining,
			Threshold:          threshold,
			ThresholdSource:    thresholdSource,
			Note:               note,
		})
	}

	return impacts
}

// classifyIngressImpact evaluates Ingress resources based on their backend Service classifications.
func classifyIngressImpact(snap *GraphSnapshot, svcImpacts []models.ServiceImpact) []models.IngressImpact {
	// Build lookup: service key -> classification
	svcClass := make(map[string]string)
	for _, si := range svcImpacts {
		svcClass[refKey(si.Service)] = si.Classification
	}

	var impacts []models.IngressImpact

	// Walk Ingress → Service edges in the graph
	for key, ref := range snap.Nodes {
		if ref.Kind != "Ingress" {
			continue
		}
		// Check forward edges from this Ingress to Services
		worstClassification := ""
		worstService := ""
		host := ""

		for targetKey := range snap.Forward[key] {
			targetRef := snap.Nodes[targetKey]
			if targetRef.Kind != "Service" {
				continue
			}
			if cls, ok := svcClass[targetKey]; ok {
				if classificationWorse(cls, worstClassification) {
					worstClassification = cls
					worstService = targetRef.Name
				}
			}
		}

		if worstClassification == "" {
			continue // no affected backend
		}

		var note string
		switch worstClassification {
		case "broken":
			note = fmt.Sprintf("Ingress %s: backend %s has no endpoints", ref.Name, worstService)
		case "degraded":
			note = fmt.Sprintf("Ingress %s: backend %s at reduced capacity", ref.Name, worstService)
		default:
			note = fmt.Sprintf("Ingress %s: backends healthy", ref.Name)
		}

		impacts = append(impacts, models.IngressImpact{
			Ingress:        ref,
			Classification: worstClassification,
			Host:           host,
			BackendService: worstService,
			Note:           note,
		})
	}

	return impacts
}

// classifyConsumerImpact uses OTel service map to find workloads that consume broken/degraded services.
func classifyConsumerImpact(snap *GraphSnapshot, svcImpacts []models.ServiceImpact, serviceMap *otel.ServiceMap) []models.ConsumerImpact {
	// Build lookup: OTel service name -> classification
	// Map K8s Service name to classification
	svcClass := make(map[string]string) // service name -> classification
	for _, si := range svcImpacts {
		if si.Classification == "self-healing" {
			continue
		}
		svcClass[si.Service.Name] = si.Classification
	}

	if len(svcClass) == 0 {
		return nil
	}

	var impacts []models.ConsumerImpact

	for _, edge := range serviceMap.Edges {
		cls, affected := svcClass[edge.Target]
		if !affected {
			continue
		}

		// Try to resolve OTel source service to K8s workload
		workload := resolveOTelServiceToWorkload(snap, edge.Source)
		if workload == nil {
			continue
		}

		impacts = append(impacts, models.ConsumerImpact{
			Workload:       *workload,
			Classification: cls,
			DependsOn:      edge.Target,
			Note:           fmt.Sprintf("Depends on %s which is %s", edge.Target, cls),
		})
	}

	return impacts
}

// resolveOTelServiceToWorkload attempts to match an OTel service name to a K8s workload.
// Convention: OTel service.name typically matches the Deployment name.
func resolveOTelServiceToWorkload(snap *GraphSnapshot, otelServiceName string) *models.ResourceRef {
	// Try Deployment match first (most common)
	for _, ref := range snap.Nodes {
		if ref.Kind == "Deployment" && strings.EqualFold(ref.Name, otelServiceName) {
			return &ref
		}
	}
	// Try StatefulSet
	for _, ref := range snap.Nodes {
		if ref.Kind == "StatefulSet" && strings.EqualFold(ref.Name, otelServiceName) {
			return &ref
		}
	}
	// Try DaemonSet
	for _, ref := range snap.Nodes {
		if ref.Kind == "DaemonSet" && strings.EqualFold(ref.Name, otelServiceName) {
			return &ref
		}
	}
	return nil
}

// applyInfrastructureOverrides adjusts classifications for kube-system critical components.
func applyInfrastructureOverrides(snap *GraphSnapshot, svcImpacts []models.ServiceImpact) []models.ServiceImpact {
	for i := range svcImpacts {
		comp, isCritical := matchCriticalComponent(svcImpacts[i].Service.Namespace, svcImpacts[i].Service.Name)
		if isCritical && (svcImpacts[i].Classification == "degraded" || svcImpacts[i].Classification == "broken") {
			svcImpacts[i].Note += fmt.Sprintf(" — critical system component (%s), %s", comp.ImpactScope, comp.Description)
		}
	}
	return svcImpacts
}

// applyControlPlaneOverride sets blast radius to 100% if a control-plane component is broken.
func applyControlPlaneOverride(snap *GraphSnapshot, target models.ResourceRef, lostPods map[string]bool, svcImpacts []models.ServiceImpact, blastPct float64) float64 {
	// Check if the target itself is a control-plane component
	comp, isCritical := matchCriticalComponent(target.Namespace, target.Name)
	if isCritical && comp.ImpactScope == "control-plane" {
		// For control-plane, any loss is catastrophic
		return 100.0
	}

	// Check if any lost pod belongs to a control-plane component
	for podKey := range lostPods {
		ref := snap.Nodes[podKey]
		comp, isCritical := matchCriticalComponent(ref.Namespace, ref.Name)
		if isCritical && comp.ImpactScope == "control-plane" {
			return 100.0
		}
	}

	return blastPct
}

// computeBlastRadiusPercent computes the weighted blast radius percentage.
// Non-critical kube-system resources get a 1.5x weight multiplier.
func computeBlastRadiusPercent(
	svcImpacts []models.ServiceImpact,
	ingImpacts []models.IngressImpact,
	consumerImpacts []models.ConsumerImpact,
	totalWorkloads int,
) float64 {
	if totalWorkloads == 0 {
		return 0
	}

	numerator := 0.0
	for _, si := range svcImpacts {
		weight := classificationWeight(si.Classification)
		// Apply 1.5x multiplier for non-critical kube-system resources
		if weight > 0 && isKubeSystemResource(si.Service.Namespace) {
			if _, isCritical := matchCriticalComponent(si.Service.Namespace, si.Service.Name); !isCritical {
				weight *= 1.5
			}
		}
		numerator += weight
	}
	for _, ci := range consumerImpacts {
		numerator += classificationWeight(ci.Classification)
	}
	// Ingress impacts are not counted separately — they propagate from Services

	return (numerator / float64(totalWorkloads)) * 100.0
}

// buildImpactSummary creates the summary counts and capacity notes.
func buildImpactSummary(
	svcImpacts []models.ServiceImpact,
	ingImpacts []models.IngressImpact,
	consumerImpacts []models.ConsumerImpact,
	totalWorkloads int,
) models.ImpactSummary {
	summary := models.ImpactSummary{TotalWorkloads: totalWorkloads}

	for _, si := range svcImpacts {
		switch si.Classification {
		case "broken":
			summary.BrokenCount++
		case "degraded":
			summary.DegradedCount++
		case "self-healing":
			summary.SelfHealingCount++
		}
		if si.Classification != "self-healing" {
			summary.CapacityNotes = append(summary.CapacityNotes, si.Note)
		}
	}

	for _, ci := range consumerImpacts {
		switch ci.Classification {
		case "broken":
			summary.BrokenCount++
		case "degraded":
			summary.DegradedCount++
		}
	}

	if summary.CapacityNotes == nil {
		summary.CapacityNotes = []string{}
	}

	return summary
}

// --- Helpers ---

func classificationWeight(cls string) float64 {
	switch cls {
	case "broken":
		return 1.0
	case "degraded":
		return 0.5
	default:
		return 0.0
	}
}

func classificationWorse(a, b string) bool {
	return classificationRank(a) > classificationRank(b)
}

func classificationRank(cls string) int {
	switch cls {
	case "broken":
		return 3
	case "degraded":
		return 2
	case "self-healing":
		return 1
	default:
		return 0
	}
}

func extractNamespace(refKey string) string {
	parts := strings.SplitN(refKey, "/", 3)
	if len(parts) >= 2 {
		return parts[1]
	}
	return ""
}

// resolveIntOrPercent converts an IntOrString PDB value to a ratio (0.0-1.0).
func resolveIntOrPercent(val intstr.IntOrString, total int) float64 {
	if total == 0 {
		return 0
	}
	if val.Type == intstr.Int {
		return float64(val.IntVal) / float64(total)
	}
	// Percentage string like "50%"
	pctStr := strings.TrimSuffix(val.StrVal, "%")
	var pct float64
	fmt.Sscanf(pctStr, "%f", &pct)
	return pct / 100.0
}
```

- [ ] **Step 4: Add PodOwners field to GraphSnapshot**

In `internal/graph/snapshot.go`, add to the `GraphSnapshot` struct (after line 30, after `NodeIngress`):

```go
	PodOwners    map[string]string            // podKey -> owning workload key (resolved through RS)
```

Update `EnsureMaps()` to initialize it:

```go
	if s.PodOwners == nil {
		s.PodOwners = make(map[string]string)
	}
```

- [ ] **Step 5: Add Endpoints field to GraphSnapshot**

In `internal/graph/snapshot.go`, add to the `GraphSnapshot` struct:

```go
	ServiceEndpoints map[string][]corev1.EndpointAddress // svcKey -> ready addresses
```

Update `EnsureMaps()`:

```go
	if s.ServiceEndpoints == nil {
		s.ServiceEndpoints = make(map[string][]corev1.EndpointAddress)
	}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -run "TestComputeLostPods|TestClassifyServiceImpact|TestComputeBlastRadiusPercent" -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add internal/graph/classify.go internal/graph/classify_test.go internal/graph/snapshot.go
git commit -m "feat(blast-radius): add impact classification engine — broken/degraded/self-healing"
```

---

## Task 4: Composite Scoring Model

**Files:**
- Create: `internal/graph/scoring_v2.go`
- Create: `internal/graph/scoring_v2_test.go`

- [ ] **Step 1: Write scoring test file**

Create `internal/graph/scoring_v2_test.go`:

```go
package graph

import (
	"math"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestComputeResilience_WellProtected(t *testing.T) {
	// 5 replicas + HPA + PDB → high resilience
	detail := computeResilience(ResilienceInput{
		Kind: "Deployment", Replicas: 5, HasHPA: true, HasPDB: true, HasController: true,
	})
	if detail.Score < 80 {
		t.Errorf("expected resilience >= 80 for well-protected deployment, got %d", detail.Score)
	}
}

func TestComputeResilience_SingleReplica(t *testing.T) {
	detail := computeResilience(ResilienceInput{
		Kind: "Deployment", Replicas: 1, HasHPA: false, HasPDB: false, HasController: true,
	})
	if detail.Score > 45 {
		t.Errorf("expected resilience <= 45 for single replica no HPA/PDB, got %d", detail.Score)
	}
}

func TestComputeResilience_NakedPod(t *testing.T) {
	detail := computeResilience(ResilienceInput{
		Kind: "Pod", Replicas: 0, HasHPA: false, HasPDB: false, HasController: false,
	})
	if detail.Score > 40 {
		t.Errorf("expected low resilience for naked pod, got %d", detail.Score)
	}
}

func TestComputeResilience_DaemonSet(t *testing.T) {
	detail := computeResilience(ResilienceInput{
		Kind: "DaemonSet", Replicas: 10, HasHPA: false, HasPDB: false, HasController: true,
	})
	if detail.Score < 70 {
		t.Errorf("expected DaemonSet resilience >= 70, got %d", detail.Score)
	}
}

func TestComputeExposure_IngressExposed(t *testing.T) {
	detail := computeExposure(ExposureInput{
		IsIngressExposed: true, ConsumerCount: 3, CrossNsCount: 2,
		TraceDataAvailable: true, IsCriticalSystem: false,
	})
	if detail.Score < 50 {
		t.Errorf("expected high exposure for ingress+consumers, got %d", detail.Score)
	}
}

func TestComputeExposure_CriticalSystem(t *testing.T) {
	detail := computeExposure(ExposureInput{
		IsIngressExposed: false, ConsumerCount: 0, CrossNsCount: 1,
		TraceDataAvailable: false, IsCriticalSystem: true,
	})
	if detail.Score < 80 {
		t.Errorf("expected critical system exposure >= 80, got %d", detail.Score)
	}
}

func TestComputeRecovery_StatefulSet(t *testing.T) {
	detail := computeRecovery(RecoveryInput{
		Kind: "StatefulSet", Replicas: 3, HasController: true, HasPVC: true, IsControlPlane: false,
	})
	// StatefulSet -20, PVC -10, headroom penalty ~-6.7 → ~63
	if detail.Score > 70 {
		t.Errorf("expected StatefulSet recovery < 70, got %d", detail.Score)
	}
}

func TestComputeOverallCriticality_LowImpact(t *testing.T) {
	scores := models.SubScores{
		Resilience: models.SubScoreDetail{Score: 50},
		Exposure:   models.SubScoreDetail{Score: 5},
		Recovery:   models.SubScoreDetail{Score: 90},
		Impact:     models.SubScoreDetail{Score: 0},
	}
	crit := computeOverallCriticality(scores)
	if crit > 25 {
		t.Errorf("expected low criticality for zero-impact workload, got %.1f", crit)
	}
}

func TestComputeOverallCriticality_HighImpact(t *testing.T) {
	scores := models.SubScores{
		Resilience: models.SubScoreDetail{Score: 10},
		Exposure:   models.SubScoreDetail{Score: 80},
		Recovery:   models.SubScoreDetail{Score: 20},
		Impact:     models.SubScoreDetail{Score: 80},
	}
	crit := computeOverallCriticality(scores)
	if crit < 60 {
		t.Errorf("expected high criticality for high-impact exposed workload, got %.1f", crit)
	}
}

func TestCriticalityLevel(t *testing.T) {
	tests := []struct {
		score float64
		want  string
	}{
		{80, "critical"},
		{55, "high"},
		{30, "medium"},
		{10, "low"},
	}
	for _, tt := range tests {
		got := criticalityLevelV2(tt.score)
		if got != tt.want {
			t.Errorf("criticalityLevelV2(%.0f) = %s, want %s", tt.score, got, tt.want)
		}
	}
	_ = math.Min // suppress unused import if needed
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -run "TestComputeResilience|TestComputeExposure|TestComputeRecovery|TestComputeOverallCriticality|TestCriticalityLevel" -v 2>&1 | head -10`
Expected: FAIL

- [ ] **Step 3: Implement scoring_v2.go**

Create `internal/graph/scoring_v2.go`:

```go
package graph

import (
	"fmt"
	"math"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// --- Input types ---

type ResilienceInput struct {
	Kind          string
	Replicas      int
	HasHPA        bool
	HasPDB        bool
	HasController bool // false for naked pods
}

type ExposureInput struct {
	IsIngressExposed   bool
	ConsumerCount      int
	CrossNsCount       int
	K8sFanIn           int
	TraceDataAvailable bool
	IsCriticalSystem   bool
}

type RecoveryInput struct {
	Kind           string
	Replicas       int
	HasController  bool
	HasPVC         bool
	IsControlPlane bool
}

// --- Resilience (0-100) ---

func computeResilience(in ResilienceInput) models.SubScoreDetail {
	score := 100.0
	var factors []models.ScoringFactor

	switch in.Kind {
	case "Deployment", "StatefulSet":
		penalty := 40.0 * (1.0 / math.Max(float64(in.Replicas), 1.0))
		score -= penalty
		factors = append(factors, models.ScoringFactor{
			Name: "replica_count", Value: fmt.Sprintf("%d", in.Replicas),
			Effect: -penalty, Note: fmt.Sprintf("%d replica(s)", in.Replicas),
		})

		if !in.HasHPA {
			score -= 15
			factors = append(factors, models.ScoringFactor{
				Name: "hpa", Value: "absent", Effect: -15, Note: "No autoscaler configured",
			})
		} else {
			factors = append(factors, models.ScoringFactor{
				Name: "hpa", Value: "present", Effect: 0, Note: "Autoscaler configured",
			})
		}

		if !in.HasPDB && in.Replicas > 1 {
			score -= 15
			factors = append(factors, models.ScoringFactor{
				Name: "pdb", Value: "absent", Effect: -15, Note: "No disruption budget",
			})
		} else if in.HasPDB {
			factors = append(factors, models.ScoringFactor{
				Name: "pdb", Value: "present", Effect: 0, Note: "Disruption budget configured",
			})
		}

	case "DaemonSet":
		// DaemonSets are inherently distributed — replicas = desired node count from DaemonSet.Status
		// The Replicas field for DaemonSets is populated from ds.Status.DesiredNumberScheduled
		// in getReplicaCountFromResources() (builder.go:264-268)
		score = math.Max(score, 70)
		factors = append(factors, models.ScoringFactor{
			Name: "kind", Value: "DaemonSet", Effect: 0,
			Note: fmt.Sprintf("Inherently distributed across %d nodes", in.Replicas),
		})

	case "Pod":
		if !in.HasController {
			score -= 20
			factors = append(factors, models.ScoringFactor{
				Name: "controller", Value: "none", Effect: -20, Note: "Naked pod — no self-healing",
			})
		}

	case "Service":
		// Services don't have replicas themselves — this is handled by backing workload
		factors = append(factors, models.ScoringFactor{
			Name: "kind", Value: "Service", Effect: 0, Note: "Resilience from backing workload",
		})

	case "Job", "CronJob":
		factors = append(factors, models.ScoringFactor{
			Name: "kind", Value: in.Kind, Effect: 0, Note: "Transient workload",
		})
	}

	score = math.Max(math.Min(score, 100), 0)
	return models.SubScoreDetail{
		Score:   int(math.Round(score)),
		Factors: factors,
	}
}

// --- Exposure (0-100) ---

func computeExposure(in ExposureInput) models.SubScoreDetail {
	score := 0.0
	var factors []models.ScoringFactor
	source := "k8s-native"
	confidence := "low"

	if in.IsIngressExposed {
		score += 35
		factors = append(factors, models.ScoringFactor{
			Name: "ingress", Value: "exposed", Effect: 35, Note: "Internet-facing via Ingress",
		})
	}

	if in.TraceDataAvailable {
		consumerScore := math.Min(float64(in.ConsumerCount)*8, 30)
		score += consumerScore
		factors = append(factors, models.ScoringFactor{
			Name: "consumers", Value: fmt.Sprintf("%d", in.ConsumerCount),
			Effect: consumerScore, Note: fmt.Sprintf("%d service(s) call this (from traces)", in.ConsumerCount),
		})
		source = "otel"
		confidence = "high"
	} else {
		fanInScore := math.Min(float64(in.K8sFanIn)*5, 20)
		score += fanInScore
		factors = append(factors, models.ScoringFactor{
			Name: "fan_in", Value: fmt.Sprintf("%d", in.K8sFanIn),
			Effect: fanInScore, Note: fmt.Sprintf("%d K8s-level dependent(s)", in.K8sFanIn),
		})
	}

	if in.CrossNsCount > 1 {
		crossNsScore := math.Min(float64(in.CrossNsCount-1)*5, 15)
		score += crossNsScore
		factors = append(factors, models.ScoringFactor{
			Name: "cross_namespace", Value: fmt.Sprintf("%d", in.CrossNsCount),
			Effect: crossNsScore, Note: fmt.Sprintf("%d namespace(s) depend on this", in.CrossNsCount),
		})
	}

	if in.IsCriticalSystem {
		score = math.Max(score, 80)
		factors = append(factors, models.ScoringFactor{
			Name: "critical_system", Value: "true", Effect: 0, Note: "Critical system component — floor applied",
		})
	}

	score = math.Max(math.Min(score, 100), 0)
	return models.SubScoreDetail{
		Score:      int(math.Round(score)),
		Factors:    factors,
		Source:     source,
		Confidence: confidence,
	}
}

// --- Recovery (0-100) ---

func computeRecovery(in RecoveryInput) models.SubScoreDetail {
	score := 100.0
	var factors []models.ScoringFactor

	if in.Kind == "Pod" && !in.HasController {
		score -= 50
		factors = append(factors, models.ScoringFactor{
			Name: "controller", Value: "none", Effect: -50, Note: "Manual intervention required",
		})
	}
	if in.Kind == "StatefulSet" {
		score -= 20
		factors = append(factors, models.ScoringFactor{
			Name: "kind", Value: "StatefulSet", Effect: -20, Note: "Ordered restart, data reattachment",
		})
	}
	if in.Kind == "DaemonSet" {
		score -= 5
		factors = append(factors, models.ScoringFactor{
			Name: "kind", Value: "DaemonSet", Effect: -5, Note: "Node-scoped recovery",
		})
	}

	// Headroom penalty
	headroomPenalty := 20.0 * (1.0 / math.Max(float64(in.Replicas), 1.0))
	score -= headroomPenalty
	factors = append(factors, models.ScoringFactor{
		Name: "headroom", Value: fmt.Sprintf("%d replicas", in.Replicas),
		Effect: -headroomPenalty, Note: fmt.Sprintf("Recovery headroom with %d replica(s)", in.Replicas),
	})

	if in.HasPVC {
		score -= 10
		factors = append(factors, models.ScoringFactor{
			Name: "pvc", Value: "attached", Effect: -10, Note: "Data volume reattachment delay",
		})
	}

	if in.IsControlPlane {
		score -= 30
		factors = append(factors, models.ScoringFactor{
			Name: "control_plane", Value: "true", Effect: -30, Note: "Control plane — may require manual recovery",
		})
	}

	score = math.Max(math.Min(score, 100), 0)
	return models.SubScoreDetail{
		Score:   int(math.Round(score)),
		Factors: factors,
	}
}

// --- Overall Criticality ---

func computeOverallCriticality(scores models.SubScores) float64 {
	resilience := float64(scores.Resilience.Score)
	exposure := float64(scores.Exposure.Score)
	recovery := float64(scores.Recovery.Score)
	impact := float64(scores.Impact.Score)

	// Max-of to prevent double-penalization
	failureDimension := math.Max(
		(100-resilience)*0.25,
		impact*0.30,
	)

	criticality := failureDimension + exposure*0.30 + (100-recovery)*0.15

	// Normalize to 0-100 (max possible raw = 0.75 * 100)
	criticality = criticality / 0.75
	return math.Min(math.Max(criticality, 0), 100)
}

func criticalityLevelV2(score float64) string {
	switch {
	case score > 70:
		return "critical"
	case score >= 45:
		return "high"
	case score >= 20:
		return "medium"
	default:
		return "low"
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -run "TestComputeResilience|TestComputeExposure|TestComputeRecovery|TestComputeOverallCriticality|TestCriticalityLevel" -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/graph/scoring_v2.go internal/graph/scoring_v2_test.go
git commit -m "feat(blast-radius): add composite scoring model — resilience, exposure, recovery, impact"
```

---

## Task 5: Verdict Generator

**Files:**
- Create: `internal/graph/verdict.go`
- Create: `internal/graph/verdict_test.go`

- [ ] **Step 1: Write verdict test file**

Create `internal/graph/verdict_test.go`:

```go
package graph

import (
	"strings"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestGenerateVerdict_ZeroImpact(t *testing.T) {
	result := &models.BlastRadiusResult{
		TargetResource: models.ResourceRef{Kind: "Pod", Name: "my-pod"},
		CriticalityLevel: "low",
		CriticalityScore: 15,
		ReplicaCount: 3,
		HasHPA: true,
		HasPDB: true,
		ImpactSummary: models.ImpactSummary{
			BrokenCount: 0, DegradedCount: 0, SelfHealingCount: 1,
		},
		CoverageLevel: "high",
	}
	verdict := generateVerdict(result)
	if !strings.Contains(verdict, "LOW") {
		t.Errorf("expected LOW in verdict, got: %s", verdict)
	}
	if !strings.Contains(verdict, "no services lose functionality") {
		t.Errorf("expected 'no services lose functionality', got: %s", verdict)
	}
}

func TestGenerateVerdict_BrokenServices(t *testing.T) {
	result := &models.BlastRadiusResult{
		TargetResource: models.ResourceRef{Kind: "Deployment", Name: "api"},
		CriticalityLevel: "critical",
		CriticalityScore: 85,
		ReplicaCount: 1,
		HasHPA: false,
		HasPDB: false,
		IsIngressExposed: true,
		ImpactSummary: models.ImpactSummary{
			BrokenCount: 2, DegradedCount: 1,
		},
		CoverageLevel: "high",
	}
	verdict := generateVerdict(result)
	if !strings.Contains(verdict, "CRITICAL") {
		t.Errorf("expected CRITICAL in verdict, got: %s", verdict)
	}
	if !strings.Contains(verdict, "2 service(s) would become unreachable") {
		t.Errorf("expected broken count, got: %s", verdict)
	}
	if !strings.Contains(verdict, "internet-facing") {
		t.Errorf("expected internet-facing mention, got: %s", verdict)
	}
}

func TestGenerateVerdict_PartialCoverage(t *testing.T) {
	result := &models.BlastRadiusResult{
		TargetResource: models.ResourceRef{Kind: "Service", Name: "svc"},
		CriticalityLevel: "medium",
		CriticalityScore: 30,
		CoverageLevel: "partial",
	}
	verdict := generateVerdict(result)
	if !strings.Contains(verdict, "tracing") {
		t.Errorf("expected tracing note for partial coverage, got: %s", verdict)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -run TestGenerateVerdict -v 2>&1 | head -10`
Expected: FAIL

- [ ] **Step 3: Implement verdict.go**

Create `internal/graph/verdict.go`:

```go
package graph

import (
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// generateVerdict produces a deterministic natural language explanation of the blast radius result.
func generateVerdict(result *models.BlastRadiusResult) string {
	var parts []string

	// Opening: what and how bad
	parts = append(parts, fmt.Sprintf(
		"This %s has %s criticality (score: %.0f).",
		result.TargetResource.Kind,
		strings.ToUpper(result.CriticalityLevel),
		result.CriticalityScore,
	))

	// Resilience context
	protections := []string{}
	if result.HasHPA {
		protections = append(protections, "HPA")
	}
	if result.HasPDB {
		protections = append(protections, "PDB")
	}

	if result.ReplicaCount > 0 {
		if len(protections) > 0 {
			parts = append(parts, fmt.Sprintf(
				"It has %d replica(s) with %s.",
				result.ReplicaCount, strings.Join(protections, " and "),
			))
		} else {
			parts = append(parts, fmt.Sprintf(
				"It has %d replica(s), no HPA, no PDB.",
				result.ReplicaCount,
			))
		}
	}

	// Exposure
	if result.IsIngressExposed {
		parts = append(parts, "It is internet-facing via Ingress.")
	}

	// Impact
	broken := result.ImpactSummary.BrokenCount
	degraded := result.ImpactSummary.DegradedCount

	if broken == 0 && degraded == 0 {
		parts = append(parts, "Under this failure mode, no services lose functionality.")
	} else {
		if broken > 0 {
			parts = append(parts, fmt.Sprintf("%d service(s) would become unreachable.", broken))
		}
		if degraded > 0 {
			parts = append(parts, fmt.Sprintf("%d service(s) would operate at reduced capacity.", degraded))
		}
	}

	// Coverage caveat
	if result.CoverageLevel == "partial" {
		parts = append(parts, "Note: Consumer dependencies not available — enable distributed tracing for full analysis.")
	}

	return strings.Join(parts, " ")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -run TestGenerateVerdict -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add internal/graph/verdict.go internal/graph/verdict_test.go
git commit -m "feat(blast-radius): add natural language verdict generator"
```

---

## Task 6: Add Endpoints to Graph Engine

**Files:**
- Modify: `internal/graph/builder.go` (ClusterResources struct, BuildSnapshot)
- Modify: `internal/graph/engine.go` (collectResources, Start)

- [ ] **Step 1: Add Endpoints to ClusterResources**

In `internal/graph/builder.go`, add to the `ClusterResources` struct (after line 33, after PDBs):

```go
	Endpoints    []corev1.Endpoints
```

- [ ] **Step 2: Add Endpoints informer to engine Start()**

In `internal/graph/engine.go`, the `Start()` method registers informers. Add Endpoints informer. Read the file to find the exact location in `Start()` where Core informers are registered (around line 70-80), and add:

```go
	// Endpoints
	e.factory.Core().V1().Endpoints().Informer().AddEventHandler(handler)
```

- [ ] **Step 3: Add Endpoints collection to collectResources()**

In `internal/graph/engine.go`, inside `collectResources()`, after Services collection (after line 203), add:

```go
	endpointsList, err := e.factory.Core().V1().Endpoints().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list endpoints", "error", err)
		return nil
	}
	for _, ep := range endpointsList {
		res.Endpoints = append(res.Endpoints, *ep)
	}
```

- [ ] **Step 4: Build ServiceEndpoints map in BuildSnapshot**

In `internal/graph/builder.go`, in `BuildSnapshot()`, after Step 5 scoring loop (after line 213), add a new step to build the endpoints map:

```go
	// --- Step 5b: Build Service -> ready endpoints map ---
	serviceEndpoints := make(map[string][]corev1.EndpointAddress)
	for _, ep := range res.Endpoints {
		svcKey := fmt.Sprintf("Service/%s/%s", ep.Namespace, ep.Name)
		for _, subset := range ep.Subsets {
			serviceEndpoints[svcKey] = append(serviceEndpoints[svcKey], subset.Addresses...)
		}
	}
```

Add the import for `"fmt"` at the top of builder.go if not already present.

Include `ServiceEndpoints: serviceEndpoints` in the returned `GraphSnapshot` struct literal (around line 222).

- [ ] **Step 5: Wire OTel service map into engine rebuild**

In `internal/graph/engine.go`, the `rebuild()` method should fetch the OTel service map and store it in the snapshot. The engine needs access to the OTel store. Add an `otelStore` field to `ClusterGraphEngine`:

```go
otelStore *otel.Store // may be nil if OTel not configured
```

In `rebuild()`, after building the snapshot, fetch and attach the service map:

```go
if e.otelStore != nil {
    now := time.Now().UnixMilli()
    dayAgo := now - 24*60*60*1000
    svcMap, err := e.otelStore.GetServiceMap(context.Background(), e.clusterID, dayAgo, now)
    if err == nil && svcMap != nil {
        snap.OTelServiceMap = svcMap
    }
}
```

Add a `SetOTelStore` method to the engine:

```go
func (e *ClusterGraphEngine) SetOTelStore(store *otel.Store) {
    e.otelStore = store
}
```

Wire it up in the REST handler's `getOrStartGraphEngine()` where the engine is created.

- [ ] **Step 6: Build PodOwners map in BuildSnapshot**

In `internal/graph/builder.go`, after the inference functions run (after line 74), add:

```go
	// Build PodOwners: pod key → ultimate workload owner key
	podOwnersMap := make(map[string]string)
	for podKey, ownerKeys := range podOwners {
		// podOwners from inferOwnerRefDeps maps pod key → owner key
		// Resolve RS → Deployment chain
		for ownerKey := range ownerKeys {
			ownerRef := nodes[ownerKey]
			if ownerRef.Kind == "ReplicaSet" {
				// Check if RS is owned by a Deployment
				for grandOwnerKey := range reverse[ownerKey] {
					grandOwner := nodes[grandOwnerKey]
					if grandOwner.Kind == "Deployment" {
						podOwnersMap[podKey] = grandOwnerKey
						break
					}
				}
				if _, ok := podOwnersMap[podKey]; !ok {
					podOwnersMap[podKey] = ownerKey
				}
			} else {
				podOwnersMap[podKey] = ownerKey
			}
		}
	}
```

Note: The `podOwners` variable is already returned by `inferOwnerRefDeps()`. Check its type — it's `map[string]map[string]bool` (pod key → set of owner keys). Adjust the loop accordingly.

Include `PodOwners: podOwnersMap` in the returned `GraphSnapshot`.

- [ ] **Step 6: Verify compilation**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go build ./...`
Expected: PASS

- [ ] **Step 7: Run existing tests to ensure no regressions**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -v 2>&1 | tail -20`
Expected: All existing tests PASS

- [ ] **Step 8: Commit**

```bash
git add internal/graph/builder.go internal/graph/engine.go internal/graph/snapshot.go
git commit -m "feat(blast-radius): add Endpoints informer and ServiceEndpoints/PodOwners to graph"
```

---

## Task 7: Remove Old Inference Functions

**Files:**
- Modify: `internal/graph/builder.go`
- Modify: `internal/graph/inference.go`

- [ ] **Step 1: Remove inference calls from BuildSnapshot**

In `internal/graph/builder.go`, remove lines 57-74 (the calls to inferEnvVarDeps, inferVolumeMountDeps, inferNetworkPolicyDeps, inferIstioDeps):

```go
	// REMOVE these 4 function calls:
	// inferEnvVarDeps(...)
	// inferVolumeMountDeps(...)
	// inferNetworkPolicyDeps(...)
	// inferIstioDeps(...)
```

Also remove the `hasIstio`, `virtualServices`, `destinationRules` parameters from `BuildSnapshot()` signature since they're only used by inferIstioDeps. Update the call site in `engine.go` `rebuild()` accordingly.

- [ ] **Step 2: Remove the 4 inference functions from inference.go**

Read `internal/graph/inference.go` to identify the exact line ranges for:
- `inferEnvVarDeps` function
- `inferVolumeMountDeps` function
- `inferNetworkPolicyDeps` function
- `inferIstioDeps` function

Delete these functions entirely. Keep `inferOwnerRefDeps`, `inferSelectorDeps`, `inferIngressDeps`, and all helper functions they use.

- [ ] **Step 3: Update engine.go rebuild() call**

In `internal/graph/engine.go`, the `rebuild()` method calls `BuildSnapshot`. Update it to match the new signature (without Istio params).

- [ ] **Step 4: Verify compilation and tests**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go build ./... && go test ./internal/graph/ -v 2>&1 | tail -20`
Expected: Compile succeeds. Some old tests may need updating if they tested removed functions.

- [ ] **Step 5: Remove tests for deleted inference functions**

In `internal/graph/inference_test.go`, remove tests for `inferEnvVarDeps`, `inferVolumeMountDeps`, `inferNetworkPolicyDeps`, `inferIstioDeps`.

- [ ] **Step 6: Run all tests**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -v`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add internal/graph/builder.go internal/graph/inference.go internal/graph/inference_test.go internal/graph/engine.go
git commit -m "refactor(blast-radius): remove unreliable inference functions — env-var, volume, netpol, istio"
```

---

## Task 8: Wire Classification Engine into Snapshot

**Files:**
- Modify: `internal/graph/snapshot.go`

- [ ] **Step 1: Read current computeSingleResourceBlast**

Read `internal/graph/snapshot.go` lines 282-454 to understand the full function being replaced.

- [ ] **Step 2: Replace computeSingleResourceBlast**

Rewrite `computeSingleResourceBlast` to use the new classification engine. The function should:

1. Call `classifyImpact()` with the snapshot's ServiceEndpoints, PDBs (from ClusterResources stored in snapshot), and OTel service map
2. Call `computeResilience()`, `computeExposure()`, `computeRecovery()` to get sub-scores
3. Set Impact sub-score from blast radius %
4. Call `computeOverallCriticality()` for the final score
5. Call `generateVerdict()` for the NL explanation
6. Build and return the updated `BlastRadiusResult`

Key changes:
- Replace BFS-based `affectedDepths` with `classifyImpact()` result
- Replace `computeBaseScore()` + `applyFailureMode()` with composite scoring
- Add SubScores, ImpactSummary, AffectedServices, Verdict to result
- Keep Waves and DependencyChain for backward compat (topology rendering)

```go
func (s *GraphSnapshot) computeSingleResourceBlast(target models.ResourceRef, failureMode string) (*models.BlastRadiusResult, error) {
	key := refKey(target)
	if _, ok := s.Nodes[key]; !ok {
		return nil, fmt.Errorf("resource %s not found in graph", key)
	}

	// --- Impact Classification ---
	cr := classifyImpact(s, target, failureMode, s.ServiceEndpoints, s.PDBs, s.OTelServiceMap, s.TotalWorkloads)

	// --- Gather resource metadata ---
	replicas := s.NodeReplicas[key]
	hasHPA := s.NodeHasHPA[key]
	hasPDB := s.NodeHasPDB[key]
	ingressHosts := s.NodeIngress[key]
	fanIn := len(s.Reverse[key])
	fanOut := len(s.Forward[key])

	// Resolve Pod metadata up to owning workload
	if target.Kind == "Pod" && replicas == 0 {
		if ownerKey, ok := s.PodOwners[key]; ok {
			ownerRef := s.Nodes[ownerKey]
			if r := s.NodeReplicas[ownerKey]; r > 0 {
				replicas = r
			}
			if s.NodeHasHPA[ownerKey] { hasHPA = true }
			if s.NodeHasPDB[ownerKey] { hasPDB = true }
			_ = ownerRef
		}
	}

	// Check infrastructure status
	_, isCriticalSystem := matchCriticalComponent(target.Namespace, target.Name)
	comp, _ := matchCriticalComponent(target.Namespace, target.Name)
	isControlPlane := isCriticalSystem && comp.ImpactScope == "control-plane"

	// Has PVC?
	hasPVC := false
	for _, ref := range s.Nodes {
		if ref.Kind == "PersistentVolumeClaim" && ref.Namespace == target.Namespace {
			hasPVC = true
			break
		}
	}

	hasController := target.Kind != "Pod" || s.PodOwners[key] != ""

	// --- Compute Sub-Scores ---
	resilienceDetail := computeResilience(ResilienceInput{
		Kind: target.Kind, Replicas: replicas, HasHPA: hasHPA, HasPDB: hasPDB, HasController: hasController,
	})

	// Count OTel consumers
	consumerCount := 0
	traceAvailable := s.OTelServiceMap != nil && len(s.OTelServiceMap.Edges) > 0
	if traceAvailable {
		for _, edge := range s.OTelServiceMap.Edges {
			if strings.EqualFold(edge.Target, target.Name) {
				consumerCount++
			}
		}
	}

	// Cross-namespace count from classification
	crossNsCount := 0
	nsSet := make(map[string]bool)
	for _, si := range cr.ServiceImpacts {
		nsSet[si.Service.Namespace] = true
	}
	crossNsCount = len(nsSet)

	exposureDetail := computeExposure(ExposureInput{
		IsIngressExposed: len(ingressHosts) > 0, ConsumerCount: consumerCount,
		CrossNsCount: crossNsCount, K8sFanIn: fanIn,
		TraceDataAvailable: traceAvailable, IsCriticalSystem: isCriticalSystem,
	})

	recoveryDetail := computeRecovery(RecoveryInput{
		Kind: target.Kind, Replicas: replicas, HasController: hasController,
		HasPVC: hasPVC, IsControlPlane: isControlPlane,
	})

	impactDetail := models.SubScoreDetail{
		Score:   int(math.Round(cr.BlastRadiusPct)),
		Factors: []models.ScoringFactor{{Name: "blast_radius", Value: fmt.Sprintf("%.1f%%", cr.BlastRadiusPct), Effect: cr.BlastRadiusPct, Note: "Computed blast radius percentage"}},
	}

	subScores := models.SubScores{
		Resilience: resilienceDetail,
		Exposure:   exposureDetail,
		Recovery:   recoveryDetail,
		Impact:     impactDetail,
	}

	criticality := computeOverallCriticality(subScores)
	level := criticalityLevelV2(criticality)

	// SPOF
	isSPOF := replicas <= 1 && !hasHPA && fanIn > 0

	// --- Keep backward compat fields (waves, dependency chain) ---
	affectedDepths := bfsWalkWithDepth(s.Reverse, key)
	forwardReachable := bfsWalk(s.Forward, key)

	waveMap := make(map[int][]models.AffectedResource)
	affectedNS := make(map[string]bool)
	for aKey, depth := range affectedDepths {
		ref := s.Nodes[aKey]
		affectedNS[ref.Namespace] = true
		impact := "transitive"
		if depth == 1 { impact = "direct" }
		waveMap[depth] = append(waveMap[depth], models.AffectedResource{
			Kind: ref.Kind, Name: ref.Name, Namespace: ref.Namespace,
			Impact: impact, WaveDepth: depth, FailurePath: s.buildFailurePath(key, aKey),
		})
	}
	var depths []int
	for d := range waveMap { depths = append(depths, d) }
	sort.Ints(depths)
	waves := make([]models.BlastWave, 0, len(depths))
	for _, d := range depths {
		resources := waveMap[d]
		sort.Slice(resources, func(i, j int) bool {
			return resources[i].Kind+"/"+resources[i].Namespace+"/"+resources[i].Name <
				resources[j].Kind+"/"+resources[j].Namespace+"/"+resources[j].Name
		})
		waves = append(waves, models.BlastWave{Depth: d, Resources: resources})
	}

	allRelevant := make(map[string]bool)
	allRelevant[key] = true
	for k := range affectedDepths { allRelevant[k] = true }
	for k := range forwardReachable { allRelevant[k] = true }
	var chain []models.BlastDependencyEdge
	for _, e := range s.Edges {
		sk := refKey(e.Source)
		tk := refKey(e.Target)
		if allRelevant[sk] && allRelevant[tk] { chain = append(chain, e) }
	}

	// Remediations
	isDataStore := target.Kind == "StatefulSet"
	remediations := ComputeRemediations(isSPOF, hasPDB, hasHPA, replicas, fanIn, crossNsCount, isDataStore)

	// Build result
	result := &models.BlastRadiusResult{
		TargetResource:     target,
		FailureMode:        failureMode,
		BlastRadiusPercent: cr.BlastRadiusPct,
		CriticalityScore:   criticality,
		CriticalityLevel:   level,

		SubScores:     subScores,
		ImpactSummary: cr.ImpactSummary,
		AffectedServices:  cr.ServiceImpacts,
		AffectedIngresses: cr.IngressImpacts,
		AffectedConsumers: cr.ConsumerImpacts,

		ScoreBreakdown: models.ScoreBreakdown{
			Resilience: resilienceDetail, Exposure: exposureDetail,
			Recovery: recoveryDetail, Impact: impactDetail,
			Overall: criticality, Level: level,
		},
		Verdict:       "", // set below
		CoverageLevel: cr.CoverageLevel,
		CoverageNote:  cr.CoverageNote,

		ReplicaCount: replicas, IsSPOF: isSPOF,
		HasHPA: hasHPA, HasPDB: hasPDB,
		IsIngressExposed: len(ingressHosts) > 0,
		IngressHosts: ensureStringSlice(ingressHosts),
		Remediations: ensureRemediationSlice(remediations),

		FanIn: fanIn, FanOut: fanOut,
		TotalAffected: len(affectedDepths),
		AffectedNamespaces: len(affectedNS),

		Waves:           ensureSlice(waves),
		DependencyChain: ensureEdgeSlice(chain),
		RiskIndicators:  ensureRiskSlice(s.NodeRisks[key]),

		GraphNodeCount:   len(s.Nodes),
		GraphEdgeCount:   len(s.Edges),
		GraphStalenessMs: time.Now().UnixMilli() - s.BuiltAt,
	}

	result.Verdict = generateVerdict(result)

	return result, nil
}
```

- [ ] **Step 3: Add OTelServiceMap and PDBs fields to GraphSnapshot**

In `internal/graph/snapshot.go`, add to the GraphSnapshot struct:

```go
	OTelServiceMap *otel.ServiceMap
	PDBs           []policyv1.PodDisruptionBudget
```

Add the import for the otel package and policyv1.

Update `EnsureMaps()` accordingly.

Store PDBs in BuildSnapshot: `PDBs: res.PDBs` in the returned struct.

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go build ./...`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -v 2>&1 | tail -30`
Expected: Existing tests may need updates for new GraphSnapshot fields. Fix any failures.

- [ ] **Step 6: Commit**

```bash
git add internal/graph/snapshot.go
git commit -m "feat(blast-radius): wire classification engine into computeSingleResourceBlast"
```

---

## Task 9: Update API Handler

**Files:**
- Modify: `internal/api/rest/blast_radius.go`

- [ ] **Step 1: Add failure mode auto-detection**

Read the current `GetBlastRadius` handler. Add auto-detection logic before the `ComputeBlastRadiusWithMode` call:

```go
// Auto-detect failure mode if not specified
failureMode := r.URL.Query().Get("failure_mode")
if failureMode == "" {
	switch kind {
	case "Pod":
		failureMode = graph.FailureModePodCrash
	case "Namespace":
		failureMode = graph.FailureModeNamespaceDeletion
	default:
		failureMode = graph.FailureModeWorkloadDeletion
	}
}
```

- [ ] **Step 2: Add ?audit=true support**

After computing the result, check for audit param:

```go
// Strip audit trail if not requested
if r.URL.Query().Get("audit") != "true" {
	result.AuditTrail = nil
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go build ./...`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add internal/api/rest/blast_radius.go
git commit -m "feat(blast-radius): add failure mode auto-detection and audit param support"
```

---

## Task 10: Clean Up Old Scoring Code

**Files:**
- Modify: `internal/graph/scoring.go`

- [ ] **Step 1: Remove deprecated functions**

Remove from `scoring.go`:
- `computeBaseScore()` (lines 40-84)
- `computeCriticalityScore()` (lines 89-91)
- `applyFailureMode()` (lines 97-109)
- `scoringParams` struct (lines 27-36)

Keep:
- Failure mode constants (lines 10-14)
- `ValidFailureMode()` (lines 17-24)
- `simplePageRank()` and `pageRankOnKeys()` (still used for graph centrality in builder.go)

- [ ] **Step 2: Update builder.go scoring calls**

In `builder.go`, the Step 5 loop calls `computeCriticalityScore()`. Replace it with the new composite scoring. Since scoring now happens at query time (not build time), remove the per-node score computation from BuildSnapshot. Keep the metadata collection (replicas, HPA, PDB, ingress) but remove the `nodeScores` precomputation.

Alternatively, compute a lightweight score at build time for the summary endpoint using the new model.

- [ ] **Step 3: Verify compilation and tests**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go build ./... && go test ./internal/graph/ -v 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add internal/graph/scoring.go internal/graph/builder.go
git commit -m "refactor(blast-radius): remove old scoring model, keep PageRank and failure mode constants"
```

---

## Task 11: Integration Test — Real-World Scenarios

**Files:**
- Create: `internal/graph/integration_test.go`

- [ ] **Step 1: Write integration test covering the 7 required scenarios**

Create `internal/graph/integration_test.go` with tests that build a complete GraphSnapshot from constructed ClusterResources and verify blast radius results:

```go
package graph

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Helper to build a minimal cluster with a Deployment, RS, Pods, Service, Endpoints
func buildTestCluster(replicaCount int32) *GraphSnapshot {
	replicas := replicaCount
	res := &ClusterResources{
		Deployments: []appsv1.Deployment{{
			ObjectMeta: metav1.ObjectMeta{Name: "app", Namespace: "default"},
			Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
		}},
		// ... construct Pods, Services, Endpoints matching the deployment
	}
	snap := BuildSnapshot(res)
	return snap
}

func TestScenario_PodCrashWithReplicas(t *testing.T) {
	// Pod crash with replicas > 1 → minimal impact
	// Build a cluster with 3-replica deployment
	// Compute blast radius for one pod with pod-crash mode
	// Assert: blastRadiusPercent near 0, criticalityLevel = "low"
	t.Skip("TODO: implement with full cluster fixtures")
}

func TestScenario_SingleReplicaPodCrash(t *testing.T) {
	// Single replica pod → high risk
	// Assert: Service broken, high criticality
	t.Skip("TODO: implement with full cluster fixtures")
}

func TestScenario_ServiceLosingAllEndpoints(t *testing.T) {
	// Service losing all endpoints → critical
	t.Skip("TODO: implement with full cluster fixtures")
}

func TestScenario_IngressLosingBackend(t *testing.T) {
	// Ingress losing backend → user-facing outage
	t.Skip("TODO: implement with full cluster fixtures")
}

func TestScenario_NamespaceDeletion(t *testing.T) {
	// Namespace deletion → catastrophic
	t.Skip("TODO: implement with full cluster fixtures")
}

func TestScenario_StatefulSetFailure(t *testing.T) {
	// StatefulSet → slow recovery reflected in score
	t.Skip("TODO: implement with full cluster fixtures")
}

func TestScenario_ControlPlaneComponent(t *testing.T) {
	// kube-system component failure → blast radius = 100%
	t.Skip("TODO: implement with full cluster fixtures")
}
```

Note: The implementation engineer should fill in the full cluster fixtures for each test. The `t.Skip` ensures CI doesn't fail while they're being built out. Each test should construct a complete `ClusterResources`, call `BuildSnapshot`, then `ComputeBlastRadiusWithMode`, and assert the specific expected values from the spec's scenario table.

- [ ] **Step 2: Run to verify structure compiles**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go test ./internal/graph/ -run TestScenario -v`
Expected: All skip with "TODO" messages

- [ ] **Step 3: Commit**

```bash
git add internal/graph/integration_test.go
git commit -m "test(blast-radius): add integration test scaffolding for 7 real-world scenarios"
```

---

## Task 12: Update GetSummary for New Scoring

**Files:**
- Modify: `internal/graph/snapshot.go` (GetSummary method)

- [ ] **Step 1: Update GetSummary to use composite scoring**

The `GetSummary` method (lines 544-596) currently uses the old `criticalityLevel()` and precomputed node scores. Update it to use `criticalityLevelV2()` and the new sub-score model. Since summary is for the top-N list, compute a lightweight score per node using the new composite model.

- [ ] **Step 2: Verify compilation and test**

Run: `cd /Users/koti/myFuture/Kubernetes/kubilitics/kubilitics-backend && go build ./... && go test ./internal/graph/ -run TestGetSummary -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add internal/graph/snapshot.go
git commit -m "feat(blast-radius): update GetSummary to use composite scoring model"
```

---

## Summary

| Task | Component | Estimated Complexity |
|---|---|---|
| 1 | Data models | Small |
| 2 | Infrastructure definitions | Small |
| 3 | Classification engine | Large (core) |
| 4 | Composite scoring | Medium |
| 5 | Verdict generator | Small |
| 6 | Endpoints in graph engine | Medium |
| 7 | Remove old inference | Medium |
| 8 | Wire into snapshot | Large (integration) |
| 9 | API handler updates | Small |
| 10 | Clean up old scoring | Medium |
| 11 | Integration tests | Medium |
| 12 | Update GetSummary | Small |

Total: 12 tasks, ~35-40 steps. Tasks 1-5 are independent and can be parallelized. Tasks 6-8 must be sequential. Tasks 9-12 can follow in any order after 8.
