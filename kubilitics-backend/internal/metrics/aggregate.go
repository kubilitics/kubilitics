// aggregate provides helpers to sum pod usage into controller totals.
// We parse the formatted strings (e.g. "10.50m", "32.00Mi") to avoid
// coupling the provider to aggregation logic.
package metrics

import (
	"strings"

	"k8s.io/apimachinery/pkg/api/resource"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// AggregatePodUsages sums CPU (millicores) and memory (Mi) from pod usages
// and returns formatted total CPU and total memory strings.
func AggregatePodUsages(pods []*models.PodUsage) (totalCPU, totalMemory string) {
	var cpuMilli, memMi float64
	for _, p := range pods {
		if p == nil {
			continue
		}
		c, _ := parseCPUToMilli(p.CPU)
		m, _ := parseMemoryToMi(p.Memory)
		cpuMilli += c
		memMi += m
	}
	return formatCPU(cpuMilli), formatMemoryMi(memMi)
}

// parseCPUToMilli parses "10.50m" -> 10.5, "1" or "1000m" style not supported here.
// METRICS-1 (docs/PRODUCTION-RELIABILITY-AUDIT.md): parseCPUToMilli/
// parseMemoryToMi previously blindly stripped a single trailing unit letter
// (without applying its scale factor) and parsed the remainder as a raw
// number — correct only by coincidence, because the only callers at the time
// always passed a fixed "<n>.00Mi"/"<n>.00m"-shaped string. Any caller
// passing a genuine Kubernetes quantity in a different unit (Ki, Gi, Ti, or
// bare millicores like "500m" vs whole cores like "1.5") silently got a
// value off by a power-of-1024 or power-of-1000. Now uses
// resource.ParseQuantity, the same already-correct pattern used in
// internal/api/grpc/service.go's parseMillicores/parseMemoryBytes.
func parseCPUToMilli(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, true
	}
	q, err := resource.ParseQuantity(s)
	if err != nil {
		return 0, false
	}
	return float64(q.MilliValue()), true
}

// parseMemoryToMi parses any valid Kubernetes memory quantity (e.g. "32Mi",
// "1Gi", "512Ki", "1073741824") and returns mebibytes, preserving this
// function's existing Mi-unit contract for its callers.
func parseMemoryToMi(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, true
	}
	q, err := resource.ParseQuantity(s)
	if err != nil {
		return 0, false
	}
	var bytes float64
	if v, ok := q.AsInt64(); ok {
		bytes = float64(v)
	} else {
		bytes = float64(q.Value())
	}
	return bytes / (1024 * 1024), true
}

// Exported aliases for use by history.go and service layer.
func ParseCPUToMilli(s string) (float64, bool)  { return parseCPUToMilli(s) }
func ParseMemoryToMi(s string) (float64, bool)  { return parseMemoryToMi(s) }
