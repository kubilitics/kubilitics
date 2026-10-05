package k8s

import (
	"context"
	"errors"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"k8s.io/apimachinery/pkg/runtime"
	k8stesting "k8s.io/client-go/testing"

	"k8s.io/client-go/kubernetes/fake"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
)

// TestTestConnection_RecordsHealthCheckDuration is the OBS-2
// (docs/PRODUCTION-HARDENING-ROADMAP.md, Phase 8) regression test: every
// TestConnection call — the same call that updates LastCheckedAt (HEALTH-2's
// freshness field) — must also observe a sample into
// ClusterHealthCheckDurationSeconds for that cluster_id.
func TestTestConnection_RecordsHealthCheckDuration(t *testing.T) {
	const clusterID = "obs2-duration-cluster"
	clientset := fake.NewSimpleClientset()
	client := NewClientForTest(clientset)
	client.SetClusterID(clusterID)

	before := testutil.CollectAndCount(metrics.ClusterHealthCheckDurationSeconds)

	if err := client.TestConnection(context.Background()); err != nil {
		t.Fatalf("TestConnection returned unexpected error against fake clientset: %v", err)
	}

	after := testutil.CollectAndCount(metrics.ClusterHealthCheckDurationSeconds)
	if after <= before {
		t.Fatalf("expected ClusterHealthCheckDurationSeconds to gain at least one sample, before=%d after=%d", before, after)
	}
}

// TestTestConnection_RecordsHealthCheckFailure is the companion OBS-2 test:
// a failed health check must increment ClusterHealthCheckFailuresTotal for
// that specific cluster_id, not globally.
func TestTestConnection_RecordsHealthCheckFailure(t *testing.T) {
	const clusterID = "obs2-failure-cluster"
	clientset := fake.NewSimpleClientset()
	clientset.PrependReactor("list", "namespaces", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("simulated apiserver failure")
	})
	client := NewClientForTest(clientset)
	client.SetClusterID(clusterID)
	client.circuitBreaker.Reset()

	before := testutil.ToFloat64(metrics.ClusterHealthCheckFailuresTotal.WithLabelValues(clusterID))

	if err := client.TestConnection(context.Background()); err == nil {
		t.Fatal("expected TestConnection to fail against a clientset configured to error")
	}

	after := testutil.ToFloat64(metrics.ClusterHealthCheckFailuresTotal.WithLabelValues(clusterID))
	if after != before+1 {
		t.Fatalf("expected ClusterHealthCheckFailuresTotal{cluster_id=%q} to increase by 1, before=%v after=%v", clusterID, before, after)
	}
}
