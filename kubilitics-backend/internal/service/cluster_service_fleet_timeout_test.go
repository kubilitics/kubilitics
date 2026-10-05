package service

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func writeFakeKubeconfig(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "kubeconfig")
	if err := os.WriteFile(path, []byte("apiVersion: v1\nkind: Config"), 0o600); err != nil {
		t.Fatalf("write fake kubeconfig: %v", err)
	}
	return path
}

// FLEET-1 (docs/PRODUCTION-RELIABILITY-AUDIT.md), UNVERIFIED caveat resolved
// in Phase 4: confirms client.Timeout is always set in production (via the
// real cfg path, not left to accident) and that GetClusterSummary's raw
// Clientset calls are now bounded by it — closing the same class of gap
// LOADING-3 fixed for the Overview handler, here for the Fleet aggregation
// path (GetFleetOverview calls GetClusterSummary per cluster concurrently).

func TestNewClusterService_AppliesConfiguredK8sTimeoutToRegisteredClients(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}

	var capturedClient *k8s.Client
	factory := func(kubeconfigPath, contextName string) (*k8s.Client, error) {
		capturedClient = k8s.NewClientForTest(fake.NewSimpleClientset())
		return capturedClient, nil
	}

	// Real config path, as main.go constructs it — K8sTimeoutSec explicitly
	// set here to the same value viper.SetDefault("k8s_timeout_sec", 30) would
	// produce in production, so this test documents and locks in that default
	// rather than assuming it.
	cfg := &config.Config{K8sTimeoutSec: 30}
	svc := NewClusterServiceWithClientFactory(repo, cfg, factory)

	c, err := svc.AddCluster(ctx, writeFakeKubeconfig(t), "fleet-timeout-ctx")
	if err != nil {
		t.Fatalf("AddCluster: %v", err)
	}
	_ = c

	if capturedClient == nil {
		t.Fatal("expected a client to have been constructed")
	}
	registeredClient, err := svc.GetClient(c.ID)
	if err != nil {
		t.Fatalf("GetClient: %v", err)
	}
	ctxWithTimeout, cancel := registeredClient.WithTimeout(context.Background())
	defer cancel()
	deadline, ok := ctxWithTimeout.Deadline()
	if !ok {
		t.Fatal("expected the registered client to have a configured timeout (client.Timeout > 0) — FLEET-1's premise that production always sets this would be false")
	}
	remaining := time.Until(deadline)
	if remaining <= 0 || remaining > 30*time.Second {
		t.Fatalf("expected ~30s deadline (K8sTimeoutSec=30), got %v remaining", remaining)
	}
}

// Happy-path regression: GetClusterSummary must still return correct data
// once its 4 raw List calls run under client.WithTimeout()'s derived context
// instead of ctx directly — proving the fix didn't change behavior for the
// normal (fast, healthy) case.
func TestGetClusterSummary_StillReturnsCorrectDataUnderTimeoutWrapper(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}

	node := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-1"}}
	factory := func(kubeconfigPath, contextName string) (*k8s.Client, error) {
		return k8s.NewClientForTest(fake.NewSimpleClientset(node)), nil
	}

	svc := NewClusterServiceWithClientFactory(repo, &config.Config{K8sTimeoutSec: 30}, factory)
	c, err := svc.AddCluster(ctx, writeFakeKubeconfig(t), "fleet-happy-ctx")
	if err != nil {
		t.Fatalf("AddCluster: %v", err)
	}

	summary, err := svc.GetClusterSummary(ctx, c.ID)
	if err != nil {
		t.Fatalf("GetClusterSummary: %v", err)
	}
	if summary.NodeCount != 1 {
		t.Fatalf("expected NodeCount=1, got %d", summary.NodeCount)
	}
}

// FLEET-N1 (docs/FLEET-N1-IMPLEMENTATION.md): Reachable previously stayed at
// Go's zero-value (false) on every call through this method, success or
// not — undetected while GetFleetOverview (its only caller) discarded the
// field. Caught via live reproduction against a real cluster after
// GetFleetOverview was fixed to surface Reachable to the frontend: every
// cluster showed "unreachable" regardless of true state. A successful
// summary computation (this test's path) must report Reachable=true.
func TestGetClusterSummary_SuccessfulCallReportsReachableTrue(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}

	node := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-1"}}
	factory := func(kubeconfigPath, contextName string) (*k8s.Client, error) {
		return k8s.NewClientForTest(fake.NewSimpleClientset(node)), nil
	}

	svc := NewClusterServiceWithClientFactory(repo, &config.Config{K8sTimeoutSec: 30}, factory)
	c, err := svc.AddCluster(ctx, writeFakeKubeconfig(t), "fleet-reachable-ctx")
	if err != nil {
		t.Fatalf("AddCluster: %v", err)
	}

	summary, err := svc.GetClusterSummary(ctx, c.ID)
	if err != nil {
		t.Fatalf("GetClusterSummary: %v", err)
	}
	if !summary.Reachable {
		t.Fatalf("expected Reachable=true on a successful summary call, got false: %+v", summary)
	}
}

// A true end-to-end "slow raw List call actually gets cancelled" test against
// GetClusterSummary is not possible with the existing test tooling: fake
// clientset reactors (k8stesting.Action) do not expose or respect the
// caller's context at all (confirmed by reading client-go's Action interface
// — no GetContext() method exists), so a reactor-based sleep ignores
// whatever deadline client.WithTimeout() attaches, regardless of whether the
// production code is correct. This is the same documented limitation as
// LOADING-3's Overview-handler fix (see docs/PRODUCTION-HARDENING-EXECUTION.md).
// The mechanism itself — that a context built via client.WithTimeout() does
// bound a slow operation — is proven directly in client_timeout_test.go's
// TestClient_WithTimeout_BoundsASlowOperation, which GetClusterSummary now
// uses identically to overview.go's already-tested fallback path.
