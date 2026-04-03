package reports

import (
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testSnapshot builds a GraphSnapshot with realistic data for testing.
// Layout: 3 namespaces (default, backend, database)
//
//	default/Deployment/frontend -> default/Service/api -> backend/Deployment/api-server
//	backend/Deployment/api-server -> database/StatefulSet/postgres (SPOF: 1 replica)
//	backend/Deployment/api-server -> backend/ConfigMap/api-config
//	database/StatefulSet/postgres -> database/PersistentVolumeClaim/pg-data
//
// postgres is a SPOF (1 replica, multiple dependents, no HPA).
func testSnapshot() *graph.GraphSnapshot {
	nodes := map[string]models.ResourceRef{
		"Deployment/default/frontend":                  {Kind: "Deployment", Namespace: "default", Name: "frontend"},
		"Service/default/api":                          {Kind: "Service", Namespace: "default", Name: "api"},
		"Deployment/backend/api-server":                {Kind: "Deployment", Namespace: "backend", Name: "api-server"},
		"StatefulSet/database/postgres":                {Kind: "StatefulSet", Namespace: "database", Name: "postgres"},
		"ConfigMap/backend/api-config":                 {Kind: "ConfigMap", Namespace: "backend", Name: "api-config"},
		"PersistentVolumeClaim/database/pg-data":       {Kind: "PersistentVolumeClaim", Namespace: "database", Name: "pg-data"},
		"Service/backend/api-svc":                      {Kind: "Service", Namespace: "backend", Name: "api-svc"},
		"Deployment/default/worker":                    {Kind: "Deployment", Namespace: "default", Name: "worker"},
		"StatefulSet/database/redis":                   {Kind: "StatefulSet", Namespace: "database", Name: "redis"},
		"Service/database/redis-svc":                   {Kind: "Service", Namespace: "database", Name: "redis-svc"},
	}

	// Forward: what I depend on
	forward := map[string]map[string]bool{
		"Deployment/default/frontend":            {"Service/default/api": true},
		"Service/default/api":                    {"Deployment/backend/api-server": true},
		"Deployment/backend/api-server":          {"StatefulSet/database/postgres": true, "ConfigMap/backend/api-config": true},
		"StatefulSet/database/postgres":          {"PersistentVolumeClaim/database/pg-data": true},
		"Deployment/default/worker":              {"StatefulSet/database/redis": true, "StatefulSet/database/postgres": true},
		"StatefulSet/database/redis":             {},
		"Service/database/redis-svc":             {"StatefulSet/database/redis": true},
		"Service/backend/api-svc":                {"Deployment/backend/api-server": true},
	}

	// Reverse: what depends on me
	reverse := map[string]map[string]bool{
		"Service/default/api":                    {"Deployment/default/frontend": true},
		"Deployment/backend/api-server":          {"Service/default/api": true, "Service/backend/api-svc": true},
		"StatefulSet/database/postgres":          {"Deployment/backend/api-server": true, "Deployment/default/worker": true},
		"ConfigMap/backend/api-config":           {"Deployment/backend/api-server": true},
		"PersistentVolumeClaim/database/pg-data": {"StatefulSet/database/postgres": true},
		"StatefulSet/database/redis":             {"Deployment/default/worker": true, "Service/database/redis-svc": true},
	}

	edges := []models.BlastDependencyEdge{
		{Source: nodes["Deployment/default/frontend"], Target: nodes["Service/default/api"], Type: "network"},
		{Source: nodes["Service/default/api"], Target: nodes["Deployment/backend/api-server"], Type: "network"},
		{Source: nodes["Deployment/backend/api-server"], Target: nodes["StatefulSet/database/postgres"], Type: "dependency"},
		{Source: nodes["Deployment/backend/api-server"], Target: nodes["ConfigMap/backend/api-config"], Type: "config"},
		{Source: nodes["StatefulSet/database/postgres"], Target: nodes["PersistentVolumeClaim/database/pg-data"], Type: "storage"},
		{Source: nodes["Deployment/default/worker"], Target: nodes["StatefulSet/database/redis"], Type: "dependency"},
		{Source: nodes["Deployment/default/worker"], Target: nodes["StatefulSet/database/postgres"], Type: "dependency"},
		{Source: nodes["Service/database/redis-svc"], Target: nodes["StatefulSet/database/redis"], Type: "network"},
		{Source: nodes["Service/backend/api-svc"], Target: nodes["Deployment/backend/api-server"], Type: "network"},
	}

	nodeScores := map[string]float64{
		"Deployment/default/frontend":                  20.0,
		"Service/default/api":                          35.0,
		"Deployment/backend/api-server":                65.0,
		"StatefulSet/database/postgres":                85.0, // highest: SPOF + data store
		"ConfigMap/backend/api-config":                 10.0,
		"PersistentVolumeClaim/database/pg-data":       15.0,
		"Service/backend/api-svc":                      25.0,
		"Deployment/default/worker":                    30.0,
		"StatefulSet/database/redis":                   55.0,
		"Service/database/redis-svc":                   20.0,
	}

	return &graph.GraphSnapshot{
		Nodes:   nodes,
		Forward: forward,
		Reverse: reverse,
		Edges:   edges,

		NodeScores: nodeScores,
		NodeRisks: map[string][]models.RiskIndicator{
			"StatefulSet/database/postgres": {
				{Severity: "critical", Title: "Single Point of Failure", Detail: "1 replica with 2 dependents"},
			},
		},
		NodeReplicas: map[string]int{
			"Deployment/default/frontend":     3,
			"Deployment/backend/api-server":   2,
			"StatefulSet/database/postgres":   1, // SPOF
			"Deployment/default/worker":       2,
			"StatefulSet/database/redis":      1, // SPOF
		},
		NodeHasHPA: map[string]bool{
			"Deployment/default/frontend":   true,
			"Deployment/backend/api-server": false,
			"StatefulSet/database/postgres": false,
			"StatefulSet/database/redis":    false,
		},
		NodeHasPDB: map[string]bool{
			"Deployment/default/frontend":   true,
			"Deployment/backend/api-server": true,
		},
		NodeIngress: map[string][]string{},

		TotalWorkloads: 10,
		BuiltAt:        time.Now().UnixMilli(),
		Namespaces:     map[string]bool{"default": true, "backend": true, "database": true},
	}
}

func TestGenerateReport_AllDataPresent(t *testing.T) {
	gen := NewGenerator()
	snap := testSnapshot()

	report, err := gen.GenerateReport(ReportInput{
		ClusterID:   "test-cluster-id",
		ClusterName: "test-cluster",
		Snapshot:    snap,
	})

	require.NoError(t, err)
	require.NotNil(t, report)

	// Basic metadata
	assert.Equal(t, "test-cluster-id", report.ClusterID)
	assert.Equal(t, "test-cluster", report.ClusterName)
	assert.Equal(t, "json", report.Format)
	assert.False(t, report.GeneratedAt.IsZero())

	// Executive summary
	assert.Greater(t, report.ExecutiveSummary.TotalWorkloads, 0)
	assert.Greater(t, report.ExecutiveSummary.TotalSPOFs, 0, "should detect SPOFs")
	assert.NotEmpty(t, report.ExecutiveSummary.TopRisk)
	assert.NotEmpty(t, report.ExecutiveSummary.HealthLevel)

	// SPOF inventory
	assert.NotEmpty(t, report.SPOFInventory.Items, "should have SPOF entries")
	for _, item := range report.SPOFInventory.Items {
		assert.NotEmpty(t, item.Name)
		assert.NotEmpty(t, item.Kind)
		assert.NotEmpty(t, item.Reason)
		assert.NotEmpty(t, item.Remediation)
	}

	// Risk ranking
	assert.NotEmpty(t, report.RiskRanking.Namespaces, "should have namespace risk entries")

	// Blast radius map
	assert.NotEmpty(t, report.BlastRadiusMap.TopResources, "should have blast radius entries")

	// Topology drift (current snapshot only)
	assert.NotEmpty(t, report.TopologyDrift.Summary)

	// Recommendations
	assert.NotEmpty(t, report.Recommendations, "should generate recommendations")
}

func TestGenerateReport_NilSnapshot(t *testing.T) {
	gen := NewGenerator()

	_, err := gen.GenerateReport(ReportInput{
		ClusterID:   "test",
		ClusterName: "test",
		Snapshot:    nil,
	})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "graph snapshot is required")
}

func TestGenerateReport_RecommendationPriorityOrdering(t *testing.T) {
	gen := NewGenerator()
	snap := testSnapshot()

	report, err := gen.GenerateReport(ReportInput{
		ClusterID:   "test",
		ClusterName: "test",
		Snapshot:    snap,
	})

	require.NoError(t, err)
	require.NotEmpty(t, report.Recommendations)

	// Verify priority ordering: critical before high before medium before low
	priorityOrder := map[string]int{"critical": 0, "high": 1, "medium": 2, "low": 3}
	for i := 1; i < len(report.Recommendations); i++ {
		prev := priorityOrder[report.Recommendations[i-1].Priority]
		curr := priorityOrder[report.Recommendations[i].Priority]
		assert.LessOrEqual(t, prev, curr,
			"recommendations should be ordered by priority: %s should come before %s",
			report.Recommendations[i-1].Priority, report.Recommendations[i].Priority)
	}
}

func TestGenerateReport_TopNLimiting(t *testing.T) {
	gen := NewGenerator()

	// Build a large snapshot with many nodes to test limiting
	nodes := make(map[string]models.ResourceRef)
	forward := make(map[string]map[string]bool)
	reverse := make(map[string]map[string]bool)
	scores := make(map[string]float64)
	replicas := make(map[string]int)
	hasHPA := make(map[string]bool)

	// Create 30 SPOF deployments with dependents
	for i := 0; i < 30; i++ {
		depKey := "Deployment/default/" + depName(i)
		svcKey := "Service/default/" + svcName(i)
		nodes[depKey] = models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: depName(i)}
		nodes[svcKey] = models.ResourceRef{Kind: "Service", Namespace: "default", Name: svcName(i)}
		forward[svcKey] = map[string]bool{depKey: true}
		if reverse[depKey] == nil {
			reverse[depKey] = make(map[string]bool)
		}
		reverse[depKey][svcKey] = true
		scores[depKey] = float64(30 + i*2)
		scores[svcKey] = float64(10 + i)
		replicas[depKey] = 1 // SPOF
		hasHPA[depKey] = false
	}

	snap := &graph.GraphSnapshot{
		Nodes:          nodes,
		Forward:        forward,
		Reverse:        reverse,
		Edges:          []models.BlastDependencyEdge{},
		NodeScores:     scores,
		NodeRisks:      map[string][]models.RiskIndicator{},
		NodeReplicas:   replicas,
		NodeHasHPA:     hasHPA,
		NodeHasPDB:     map[string]bool{},
		NodeIngress:    map[string][]string{},
		TotalWorkloads: 60,
		BuiltAt:        time.Now().UnixMilli(),
		Namespaces:     map[string]bool{"default": true},
	}

	report, err := gen.GenerateReport(ReportInput{
		ClusterID:   "test",
		ClusterName: "test",
		Snapshot:    snap,
	})

	require.NoError(t, err)

	// SPOF inventory: limited to 20
	assert.LessOrEqual(t, len(report.SPOFInventory.Items), 20,
		"SPOF inventory should be limited to 20 entries")

	// Risk ranking: limited to 10
	assert.LessOrEqual(t, len(report.RiskRanking.Namespaces), 10,
		"Risk ranking should be limited to 10 namespaces")

	// Blast radius map: limited to 10
	assert.LessOrEqual(t, len(report.BlastRadiusMap.TopResources), 10,
		"Blast radius map should be limited to 10 resources")
}

func TestGenerateReport_EmptyGraph(t *testing.T) {
	gen := NewGenerator()

	snap := &graph.GraphSnapshot{
		Nodes:          make(map[string]models.ResourceRef),
		Forward:        make(map[string]map[string]bool),
		Reverse:        make(map[string]map[string]bool),
		Edges:          []models.BlastDependencyEdge{},
		NodeScores:     map[string]float64{},
		NodeRisks:      map[string][]models.RiskIndicator{},
		NodeReplicas:   map[string]int{},
		NodeHasHPA:     map[string]bool{},
		NodeHasPDB:     map[string]bool{},
		NodeIngress:    map[string][]string{},
		TotalWorkloads: 0,
		BuiltAt:        time.Now().UnixMilli(),
		Namespaces:     map[string]bool{},
	}

	report, err := gen.GenerateReport(ReportInput{
		ClusterID:   "empty",
		ClusterName: "empty-cluster",
		Snapshot:    snap,
	})

	require.NoError(t, err)
	require.NotNil(t, report)

	// Should gracefully handle empty data
	assert.Equal(t, 0, report.ExecutiveSummary.TotalWorkloads)
	assert.Equal(t, 0, report.ExecutiveSummary.TotalSPOFs)
	assert.NotNil(t, report.SPOFInventory.Items) // non-nil slice
	assert.NotNil(t, report.RiskRanking.Namespaces)
	assert.NotNil(t, report.BlastRadiusMap.TopResources)
	assert.NotNil(t, report.Recommendations)
}

func TestFormatForPDF(t *testing.T) {
	report := &ResilienceReport{
		ClusterID:   "test",
		ClusterName: "test-cluster",
		Format:      "json",
	}

	data, err := FormatForPDF(report)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"format":"pdf"`)
	assert.Contains(t, string(data), `"cluster_id":"test"`)
}

// depName generates a deployment name for test index.
func depName(i int) string {
	return "deploy-" + itoa(i)
}

// svcName generates a service name for test index.
func svcName(i int) string {
	return "svc-" + itoa(i)
}

// itoa converts int to string without importing strconv.
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	s := ""
	for i > 0 {
		s = string(rune('0'+i%10)) + s
		i /= 10
	}
	return s
}
