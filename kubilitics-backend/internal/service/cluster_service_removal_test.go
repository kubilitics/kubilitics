package service

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// LIFECYCLE-1 (docs/PRODUCTION-RELIABILITY-AUDIT.md): the audit found
// RemoveCluster already correct — it only touches local state (repo, in-memory
// client map, overview cache) and never dials the remote cluster. This test
// locks that guarantee in with an automated regression (previously
// unverified by any test), per the Phase 2 roadmap's explicit instruction to
// "add the regression test locking in LIFECYCLE-1's already-correct guarantee."
func TestClusterService_RemoveCluster_NeverDialsRemoteCluster(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}

	dialed := false
	factory := func(kubeconfigPath, contextName string) (*k8s.Client, error) {
		clientset := fake.NewSimpleClientset()
		// Catches ANY call made through this client's Clientset after
		// construction — Remove must not make one.
		clientset.PrependReactor("*", "*", func(_ k8stesting.Action) (bool, runtime.Object, error) {
			dialed = true
			return false, nil, nil
		})
		return k8s.NewClientForTest(clientset), nil
	}
	svc := NewClusterServiceWithClientFactory(repo, nil, factory)

	dir := t.TempDir()
	path := filepath.Join(dir, "kubeconfig")
	if err := os.WriteFile(path, []byte("apiVersion: v1\nkind: Config"), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	c, err := svc.AddCluster(ctx, path, "remove-test-ctx")
	if err != nil {
		t.Fatalf("AddCluster: %v", err)
	}

	// AddCluster's own one-time connectivity check legitimately dials the
	// (fake) cluster — reset the flag so the assertion below is scoped
	// exclusively to RemoveCluster's own behavior.
	dialed = false

	if err := svc.RemoveCluster(ctx, c.ID); err != nil {
		t.Fatalf("RemoveCluster: %v", err)
	}
	if dialed {
		t.Fatal("RemoveCluster dialed the remote cluster — local removal must not depend on remote reachability")
	}

	// The cluster must actually be gone from both the repo and the in-memory
	// client registry.
	if _, err := repo.Get(ctx, c.ID); err == nil {
		t.Error("expected cluster to be deleted from the repo")
	}
	if _, err := svc.GetClient(c.ID); err == nil {
		t.Error("expected the in-memory client to be removed")
	}

	// Idempotency: removing an already-removed cluster must fail cleanly
	// (not hang, not panic, not dial anything) — never "stuck in PENDING."
	dialed = false
	if err := svc.RemoveCluster(ctx, c.ID); err == nil {
		t.Error("expected an error removing an already-removed cluster")
	}
	if dialed {
		t.Fatal("removing an already-removed cluster must not dial anything either")
	}
}
