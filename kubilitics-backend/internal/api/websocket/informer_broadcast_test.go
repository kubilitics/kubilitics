package websocket

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
)

// TestSetupInformerHandlers_BroadcastsWithRealClusterID is the CONTAM-1 fix
// verification (docs/PRODUCTION-RELIABILITY-AUDIT.md, Phase 11
// docs/PRODUCTION-HARDENING-ROADMAP.md), exercising the real, previously-gapped
// path end to end: a real k8s.InformerManager backed by a fake clientset,
// wired through the actual (unmodified) SetupInformerHandlers registration
// code, with SetClusterID now supplying the authoritative identity. This
// proves TEST 1 (same-cluster delivery) through the actual publisher-side
// code path, not just the Hub directly (see contam1_isolation_test.go for
// the Hub-focused isolation matrix).
//
// This does NOT wire the handler into ServeWS or main.go's router — the
// production route remains exactly as dormant/inert as before this fix;
// only the correctness of the code that WOULD run if it were ever wired up
// is proven here, per Phase 11's explicit "do not activate" constraint.
//
// Historical note: before this fix, this test (then named
// TestSetupInformerHandlers_BroadcastsWithEmptyClusterID, added in Phase 9
// as a characterization test) proved the OPPOSITE — that a cluster-a-scoped
// subscriber received an event regardless of origin, because
// SetupInformerHandlers hardcoded clusterID="". That assertion has now
// flipped, exactly as Phase 9's test comment predicted it would once
// CONTAM-1 was fixed.
func TestSetupInformerHandlers_BroadcastsWithRealClusterID(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	hub := NewHub(ctx)
	go hub.Run()
	defer hub.Stop()

	clientset := fake.NewSimpleClientset()
	testClient := k8s.NewClientForTest(clientset)
	informerMgr := k8s.NewInformerManager(testClient)

	h := NewHandler(ctx, hub, informerMgr, &config.Config{}, nil)
	h.SetClusterID("cluster-a")
	h.SetupInformerHandlers()

	if err := informerMgr.Start(ctx); err != nil {
		t.Fatalf("InformerManager.Start failed: %v", err)
	}
	defer informerMgr.Stop()

	scopedToA := newScopedClient("scoped-a", "cluster-a")
	scopedToB := newScopedClient("scoped-b", "cluster-b")
	hub.register <- scopedToA
	hub.register <- scopedToB
	time.Sleep(10 * time.Millisecond)

	// Simulates the informer actually observing a Pod in this (cluster-a)
	// cluster — the real trigger SetupInformerHandlers' registered AddFunc
	// responds to in production.
	_, err := clientset.CoreV1().Pods("default").Create(ctx, &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "real-pod", Namespace: "default"},
	}, metav1.CreateOptions{})
	if err != nil {
		t.Fatalf("failed to create pod in fake clientset: %v", err)
	}

	drainOrTimeout(t, scopedToA.send, true, "a cluster-a subscriber must receive this cluster-a informer's Pod event")
	drainOrTimeout(t, scopedToB.send, false, "a cluster-b subscriber must NOT receive another cluster's informer event")
}
