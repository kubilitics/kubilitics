package rest

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
)

// TestRespondTimeout_IncrementsMetricAndPreservesResponse is the OBS-1
// (docs/PRODUCTION-HARDENING-ROADMAP.md, Phase 8) regression test.
// respondTimeout is the single choke point every context.DeadlineExceeded
// branch in this package now routes through; before this fix, a timeout was
// indistinguishable from any other error in metrics (only the generic
// http_requests_total{status} existed) and in the structured request log
// (which only records the generic http.StatusText for the status code, not
// the specific "why"). This proves the metric increments for the exact
// operation/cluster_id passed, and the HTTP response is unchanged from a
// plain respondError call.
func TestRespondTimeout_IncrementsMetricAndPreservesResponse(t *testing.T) {
	const operation = "obs1-test-operation"
	const clusterID = "obs1-test-cluster"

	before := testutil.ToFloat64(metrics.RequestTimeoutsTotal.WithLabelValues(operation, clusterID))

	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	respondTimeout(w, r, http.StatusServiceUnavailable, "", operation, clusterID, "Topology build timed out")

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status %d, got %d", http.StatusServiceUnavailable, w.Code)
	}
	if !strings.Contains(w.Body.String(), "Topology build timed out") {
		t.Fatalf("expected response body to contain the timeout message, got: %s", w.Body.String())
	}

	after := testutil.ToFloat64(metrics.RequestTimeoutsTotal.WithLabelValues(operation, clusterID))
	if after != before+1 {
		t.Fatalf("expected RequestTimeoutsTotal{operation=%q,cluster_id=%q} to increase by 1, before=%v after=%v", operation, clusterID, before, after)
	}
}

// TestRespondTimeout_WithErrorCode proves the structured-error-code path
// (used by respondK8sError's timeout branch) also increments the metric and
// returns the structured error body with the given code.
func TestRespondTimeout_WithErrorCode(t *testing.T) {
	const operation = "obs1-test-operation-coded"
	const clusterID = "obs1-test-cluster-coded"

	before := testutil.ToFloat64(metrics.RequestTimeoutsTotal.WithLabelValues(operation, clusterID))

	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	respondTimeout(w, r, http.StatusGatewayTimeout, ErrCodeTimeout, operation, clusterID, "Request to Kubernetes API timed out.")

	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected status %d, got %d", http.StatusGatewayTimeout, w.Code)
	}
	if !strings.Contains(w.Body.String(), ErrCodeTimeout) {
		t.Fatalf("expected response body to contain error code %q, got: %s", ErrCodeTimeout, w.Body.String())
	}

	after := testutil.ToFloat64(metrics.RequestTimeoutsTotal.WithLabelValues(operation, clusterID))
	if after != before+1 {
		t.Fatalf("expected RequestTimeoutsTotal{operation=%q,cluster_id=%q} to increase by 1, before=%v after=%v", operation, clusterID, before, after)
	}
}
