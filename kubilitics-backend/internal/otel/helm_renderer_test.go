package otel

import (
	"strings"
	"testing"
)

func TestRenderKubiliticsOtelChart_InterpolatesClusterID(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	out, err := r.Render(RenderOptions{
		ClusterID:  "test-cluster-abc",
		BackendURL: "http://kubilitics.example.com",
		Namespace:  "kubilitics-system",
	})
	if err != nil {
		t.Fatalf("render failed: %v", err)
	}
	if !strings.Contains(out, "test-cluster-abc") {
		t.Errorf("expected cluster ID in rendered output, not found")
	}
	if !strings.Contains(out, "kubilitics.example.com") {
		t.Errorf("expected backend URL in rendered output, not found")
	}
	if !strings.Contains(out, "kind: Deployment") {
		t.Errorf("expected Deployment in rendered output")
	}
	if !strings.Contains(out, "kind: ConfigMap") {
		t.Errorf("expected ConfigMap in rendered output")
	}
}

func TestRenderKubiliticsOtelChart_FailsWithoutClusterID(t *testing.T) {
	r := NewHelmRenderer(testChartPath(t))
	_, err := r.Render(RenderOptions{
		BackendURL: "http://example.com",
		Namespace:  "kubilitics-system",
	})
	if err == nil {
		t.Fatal("expected error when ClusterID is empty")
	}
	if !strings.Contains(err.Error(), "clusterId") && !strings.Contains(err.Error(), "REQUIRED") {
		t.Errorf("expected error to mention clusterId or REQUIRED, got: %v", err)
	}
}

// testChartPath finds the chart relative to the repo root regardless of
// where tests are invoked from.
func testChartPath(t *testing.T) string {
	t.Helper()
	// The test runs from kubilitics-backend/internal/otel/. Walk up to repo root.
	return "../../../charts/kubilitics-otel"
}
