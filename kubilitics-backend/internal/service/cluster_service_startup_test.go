package service

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// STARTUP-1 (docs/PRODUCTION-RELIABILITY-AUDIT.md): LoadClustersFromRepo used to
// connect to every persisted cluster sequentially, so N slow/unreachable
// clusters cost N x loadStartupTimeout (measured in docs/PRODUCTION-BASELINE.md:
// 3 clusters = 24s). These tests prove the bounded-concurrency fan-out fix:
// total wall time no longer scales linearly with cluster count, concurrency is
// actually bounded (not unbounded), and one cluster's failure never affects
// another's recorded status (isolation).

// newDelayingClientFactory returns a K8sClientFactory whose built clients each
// take `delay` (real sleep, via a fake-clientset reactor on the exact call
// TestConnection makes) to answer, and optionally fail instead of succeeding.
// inFlight/maxSeen (if non-nil) let a test observe how many connections were
// actually running concurrently.
func newDelayingClientFactory(delay time.Duration, fail bool, inFlight, maxSeen *int64) K8sClientFactory {
	return func(kubeconfigPath, contextName string) (*k8s.Client, error) {
		clientset := fake.NewSimpleClientset()
		clientset.PrependReactor("list", "namespaces", func(_ k8stesting.Action) (bool, runtime.Object, error) {
			if inFlight != nil {
				n := atomic.AddInt64(inFlight, 1)
				if maxSeen != nil {
					for {
						cur := atomic.LoadInt64(maxSeen)
						if n <= cur || atomic.CompareAndSwapInt64(maxSeen, cur, n) {
							break
						}
					}
				}
				defer atomic.AddInt64(inFlight, -1)
			}
			time.Sleep(delay)
			if fail {
				return true, nil, errors.New("simulated connection failure")
			}
			return false, nil, nil // not handled -> fake clientset's default list behavior runs
		})
		return k8s.NewClientForTest(clientset), nil
	}
}

func newPersistedCluster(id string) *models.Cluster {
	return &models.Cluster{
		ID:             id,
		Name:           id,
		Context:        id,
		KubeconfigPath: "/fake/kubeconfig", // non-empty so loadOneClusterFromRepo doesn't short-circuit to "disconnected"
		Source:         "kubeconfig",
	}
}

func TestLoadClustersFromRepo_ConcurrentNotSequential(t *testing.T) {
	const n = 5
	const delay = 150 * time.Millisecond

	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	for i := 0; i < n; i++ {
		c := newPersistedCluster(fmt.Sprintf("cluster-%d", i))
		repo.clusters[c.ID] = c
	}

	factory := newDelayingClientFactory(delay, false, nil, nil)
	svc := NewClusterServiceWithClientFactory(repo, nil, factory)

	start := time.Now()
	if err := svc.LoadClustersFromRepo(context.Background()); err != nil {
		t.Fatalf("LoadClustersFromRepo returned error: %v", err)
	}
	elapsed := time.Since(start)

	// Sequential would cost n*delay = 750ms. Concurrent (n=5 fits well under the
	// loadClustersConcurrency=10 bound) should cost roughly one delay's worth.
	if elapsed >= n*delay {
		t.Fatalf("LoadClustersFromRepo took %v for %d clusters at %v delay each — looks sequential (n*delay=%v), expected concurrent (~%v)", elapsed, n, delay, n*delay, delay)
	}
	t.Logf("MEASURED: %d clusters at %v delay each completed in %v (sequential would be %v)", n, delay, elapsed, n*delay)

	snap := repo.snapshot()
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("cluster-%d", i)
		if snap[id].Status != "connected" {
			t.Errorf("cluster %s: expected status connected, got %s", id, snap[id].Status)
		}
	}
}

func TestLoadClustersFromRepo_ConcurrencyIsBounded(t *testing.T) {
	const n = 25 // well above loadClustersConcurrency=10
	const delay = 60 * time.Millisecond

	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	for i := 0; i < n; i++ {
		c := newPersistedCluster(fmt.Sprintf("bounded-cluster-%d", i))
		repo.clusters[c.ID] = c
	}

	// fail=true: these clusters never reach "connected", so StartClusterCache
	// never launches its own background informer goroutines — otherwise those
	// goroutines' own List() calls would also hit this reactor and inflate the
	// observed concurrency with activity this bound was never meant to cover
	// (informer startup is a separate, intentionally-unbounded fire-and-forget
	// background task, unchanged by this fix). Failing cleanly isolates the
	// measurement to exactly the bounded connection-attempt fan-out.
	var inFlight, maxSeen int64
	factory := newDelayingClientFactory(delay, true, &inFlight, &maxSeen)
	svc := NewClusterServiceWithClientFactory(repo, nil, factory)

	if err := svc.LoadClustersFromRepo(context.Background()); err != nil {
		t.Fatalf("LoadClustersFromRepo returned error: %v", err)
	}

	observed := atomic.LoadInt64(&maxSeen)
	if observed > loadClustersConcurrency {
		t.Fatalf("observed max concurrent connections = %d, expected <= loadClustersConcurrency (%d)", observed, loadClustersConcurrency)
	}
	if observed < 2 {
		t.Fatalf("observed max concurrent connections = %d, expected real concurrency (>1) for %d clusters — fan-out may not be working", observed, n)
	}
	t.Logf("MEASURED: max concurrent connections observed = %d (bound = %d, cluster count = %d)", observed, loadClustersConcurrency, n)
}

func TestLoadClustersFromRepo_OneFailureDoesNotAffectOthers(t *testing.T) {
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	healthy1 := newPersistedCluster("healthy-1")
	healthy2 := newPersistedCluster("healthy-2")
	failing := newPersistedCluster("failing")
	repo.clusters[healthy1.ID] = healthy1
	repo.clusters[healthy2.ID] = healthy2
	repo.clusters[failing.ID] = failing

	// Per-cluster factory: "failing" always errors, the rest succeed quickly.
	factory := func(kubeconfigPath, contextName string) (*k8s.Client, error) {
		clientset := fake.NewSimpleClientset()
		if contextName == "failing" {
			clientset.PrependReactor("list", "namespaces", func(_ k8stesting.Action) (bool, runtime.Object, error) {
				return true, nil, errors.New("simulated: cluster unreachable")
			})
		}
		return k8s.NewClientForTest(clientset), nil
	}

	svc := NewClusterServiceWithClientFactory(repo, nil, factory)
	if err := svc.LoadClustersFromRepo(context.Background()); err != nil {
		t.Fatalf("LoadClustersFromRepo returned error: %v", err)
	}

	snap := repo.snapshot()
	if snap["healthy-1"].Status != "connected" {
		t.Errorf("healthy-1: expected connected, got %s", snap["healthy-1"].Status)
	}
	if snap["healthy-2"].Status != "connected" {
		t.Errorf("healthy-2: expected connected, got %s", snap["healthy-2"].Status)
	}
	if snap["failing"].Status == "connected" {
		t.Errorf("failing: expected a non-connected status, got %s", snap["failing"].Status)
	}

	// The failing cluster's client must never be registered live.
	if _, err := svc.GetClient("failing"); err == nil {
		t.Error("expected GetClient(\"failing\") to fail — the unreachable cluster's client must not be registered")
	}
	if _, err := svc.GetClient("healthy-1"); err != nil {
		t.Errorf("expected GetClient(\"healthy-1\") to succeed, got %v", err)
	}
}

// Informer lifecycle (docs/INFORMER-LIFECYCLE-IMPLEMENTATION.md §6): this is
// the core architectural change's own regression test — LoadClustersFromRepo
// must establish live clients for every reachable persisted cluster (as
// before — Status/GetClient behavior above is unchanged) WITHOUT starting
// any of their informer sets. Informers start lazily, only once something
// calls GetInformerManager/GetOverview (EnsureActive) for a specific
// cluster — never merely because the backend restarted with it persisted.
func TestLoadClustersFromRepo_DoesNotEagerlyStartInformers(t *testing.T) {
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	const n = 25
	for i := 0; i < n; i++ {
		c := newPersistedCluster(fmt.Sprintf("cluster-%d", i))
		repo.clusters[c.ID] = c
	}
	factory := func(kubeconfigPath, contextName string) (*k8s.Client, error) {
		return k8s.NewClientForTest(fake.NewSimpleClientset()), nil
	}

	svc := NewClusterServiceWithClientFactory(repo, nil, factory).(*clusterService)
	if err := svc.LoadClustersFromRepo(context.Background()); err != nil {
		t.Fatalf("LoadClustersFromRepo returned error: %v", err)
	}

	snap := repo.snapshot()
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("cluster-%d", i)
		if snap[id].Status != "connected" {
			t.Fatalf("%s: expected connected (client establishment is unchanged), got %s", id, snap[id].Status)
		}
		if _, err := svc.GetClient(id); err != nil {
			t.Fatalf("%s: expected a live client (unchanged), got error %v", id, err)
		}
		// The actual regression guard: overviewCache.GetInformerManager —
		// NOT svc.GetInformerManager, which would itself trigger lazy
		// activation (that's the whole point of this change) — must be nil
		// for every cluster right after startup load, proving informers
		// were never started as a side effect of merely loading the
		// persisted list.
		if im := svc.overviewCache.GetInformerManager(id); im != nil {
			t.Fatalf("%s: informers are running immediately after LoadClustersFromRepo — registration ≠ active was not preserved", id)
		}
	}

	// Confirm informers genuinely CAN start (lazily) for at least one of
	// them, via the real public path a request handler would use — proves
	// the above isn't merely "informers never start," only "not eagerly."
	im := svc.GetInformerManager("cluster-0")
	if im == nil {
		t.Fatal("GetInformerManager (which triggers lazy EnsureActive) returned nil for a client with a valid live client")
	}
}
