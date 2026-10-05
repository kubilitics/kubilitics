package service

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"k8s.io/client-go/kubernetes/fake"
)


// VALID-01 (docs/VALID-01-INVESTIGATION.md): regression suite proving a
// cluster with no live client never blocks ListClusters' response, while
// clusters that already have a live client remain exactly as fast and
// correct as before.

// countingClientFactory wraps client construction with a call counter and an
// optional artificial delay/failure, so tests can both (a) prove
// GetOrReconnectClient's singleflight+negative-cache actually suppress
// duplicate/repeated reconnect attempts, and (b) simulate a slow or
// unreachable cluster deterministically.
type countingClientFactory struct {
	mu    sync.Mutex
	calls int
	delay time.Duration
	fail  bool
}

func (f *countingClientFactory) build(_ string, _ string) (*k8s.Client, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	if f.fail {
		return nil, errors.New("simulated connection failure")
	}
	return k8s.NewClientForTest(fake.NewSimpleClientset()), nil
}

func (f *countingClientFactory) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// waitUntil polls cond every 5ms until it returns true or timeout elapses.
// Deterministic (bounded, condition-based), not a fixed sleep.
func waitUntil(t *testing.T, timeout time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return cond()
}

// newUnreachableCluster builds a cluster row with Source: "in-cluster".
// ReconnectCluster's "kubeconfig" source path calls the real k8s.NewClient
// directly (bypassing the injectable clientFactory entirely — only the
// in-cluster path routes through buildClientForCluster/clientFactory). Using
// "in-cluster" here is what makes these tests' countingClientFactory
// actually observe/control the reconnect attempt; it is a test-fixture
// choice, not a claim about how real unreachable clusters are configured in
// production (which are overwhelmingly "kubeconfig"-sourced — the
// ListClusters-level fix under test does not depend on Source at all, since
// it branches purely on whether a live client already exists).
func newUnreachableCluster(id string) *models.Cluster {
	return &models.Cluster{
		ID:     id,
		Name:   id,
		Source: "in-cluster",
		Status: "disconnected", // already-known state, same as a real AddCluster failure would persist
	}
}

func newHealthyClusterWithLiveClient(t *testing.T, svc *clusterService, id string) *models.Cluster {
	t.Helper()
	c := &models.Cluster{
		ID:             id,
		Name:           id,
		Context:        id,
		KubeconfigPath: "/fake/kubeconfig",
		Source:         "kubeconfig",
		Status:         "connected",
	}
	svc.mu.Lock()
	svc.clients[id] = k8s.NewClientForTest(fake.NewSimpleClientset())
	svc.mu.Unlock()
	return c
}

// ─── 1. Healthy cluster is not blocked by an unreachable cluster ──────────

func TestListClusters_HealthyNotBlockedByUnreachable(t *testing.T) {
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{}}
	factory := &countingClientFactory{fail: true, delay: 4 * time.Second} // simulates the ~10s unroutable-IP case
	svc := newClusterService(repo, nil, factory.build).(*clusterService)

	healthy := newHealthyClusterWithLiveClient(t, svc, "healthy")
	unreachable := newUnreachableCluster("unreachable")
	_ = repo.Create(context.Background(), healthy)
	_ = repo.Create(context.Background(), unreachable)

	start := time.Now()
	clusters, err := svc.ListClusters(context.Background())
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("ListClusters returned error: %v", err)
	}
	if elapsed > 1*time.Second {
		t.Fatalf("ListClusters took %v — expected it to return promptly without waiting for the unreachable cluster's %v reconnect attempt", elapsed, factory.delay)
	}

	var sawHealthy bool
	for _, c := range clusters {
		if c.ID == "healthy" {
			sawHealthy = true
			if c.Status != "connected" {
				t.Errorf("expected healthy cluster to report status=connected, got %q", c.Status)
			}
		}
	}
	if !sawHealthy {
		t.Fatal("expected the healthy cluster to be present in the response")
	}
}

// ─── 2. Healthy cluster is not blocked by a slow (not just failing) cluster ─

func TestListClusters_HealthyNotBlockedBySlowCluster(t *testing.T) {
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{}}
	factory := &countingClientFactory{fail: false, delay: 3 * time.Second} // slow but eventually succeeds
	svc := newClusterService(repo, nil, factory.build).(*clusterService)

	healthy := newHealthyClusterWithLiveClient(t, svc, "healthy")
	slow := newUnreachableCluster("slow")
	_ = repo.Create(context.Background(), healthy)
	_ = repo.Create(context.Background(), slow)

	start := time.Now()
	_, err := svc.ListClusters(context.Background())
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("ListClusters returned error: %v", err)
	}
	if elapsed > 1*time.Second {
		t.Fatalf("ListClusters took %v — a slow-but-eventually-successful cluster must not delay the response either", elapsed)
	}
}

// ─── 3. Multiple healthy clusters return without waiting for a failing one ─

func TestListClusters_MultipleHealthyClustersUnaffectedByOneFailure(t *testing.T) {
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{}}
	factory := &countingClientFactory{fail: true, delay: 4 * time.Second}
	svc := newClusterService(repo, nil, factory.build).(*clusterService)

	for i := 0; i < 5; i++ {
		id := fmt.Sprintf("healthy-%d", i)
		c := newHealthyClusterWithLiveClient(t, svc, id)
		_ = repo.Create(context.Background(), c)
	}
	_ = repo.Create(context.Background(), newUnreachableCluster("bad"))

	start := time.Now()
	clusters, err := svc.ListClusters(context.Background())
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("ListClusters returned error: %v", err)
	}
	if elapsed > 1*time.Second {
		t.Fatalf("ListClusters took %v with 5 healthy + 1 unreachable cluster — expected fast response", elapsed)
	}
	connected := 0
	for _, c := range clusters {
		if c.Status == "connected" {
			connected++
		}
	}
	if connected != 5 {
		t.Fatalf("expected 5 clusters reporting connected, got %d", connected)
	}
}

// ─── 4. Unreachable cluster receives truthful state, never fabricated healthy ─

func TestListClusters_UnreachableClusterNeverFabricatedHealthy(t *testing.T) {
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{}}
	factory := &countingClientFactory{fail: true}
	svc := newClusterService(repo, nil, factory.build).(*clusterService)

	_ = repo.Create(context.Background(), newUnreachableCluster("bad"))

	clusters, err := svc.ListClusters(context.Background())
	if err != nil {
		t.Fatalf("ListClusters returned error: %v", err)
	}
	if len(clusters) != 1 {
		t.Fatalf("expected 1 cluster, got %d", len(clusters))
	}
	if clusters[0].Status == "connected" {
		t.Fatalf("unreachable cluster must never be reported as connected, got status=%q", clusters[0].Status)
	}
}

// ─── 5. All clusters unreachable still produces a bounded response ────────

func TestListClusters_AllUnreachable_StillBounded(t *testing.T) {
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{}}
	factory := &countingClientFactory{fail: true, delay: 4 * time.Second}
	svc := newClusterService(repo, nil, factory.build).(*clusterService)

	for i := 0; i < 5; i++ {
		_ = repo.Create(context.Background(), newUnreachableCluster(fmt.Sprintf("bad-%d", i)))
	}

	start := time.Now()
	clusters, err := svc.ListClusters(context.Background())
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("ListClusters returned error: %v", err)
	}
	if elapsed > 1*time.Second {
		t.Fatalf("ListClusters took %v with all 5 clusters unreachable — expected a fast, bounded response regardless", elapsed)
	}
	if len(clusters) != 5 {
		t.Fatalf("expected 5 clusters in response, got %d", len(clusters))
	}
	for _, c := range clusters {
		if c.Status == "connected" {
			t.Errorf("cluster %s falsely reported connected", c.ID)
		}
	}
}

// ─── 6. Existing known health/freshness state is preserved ────────────────

func TestListClusters_PreservesLastKnownPersistedState(t *testing.T) {
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{}}
	factory := &countingClientFactory{fail: true}
	svc := newClusterService(repo, nil, factory.build).(*clusterService)

	last := time.Now().Add(-5 * time.Minute)
	c := &models.Cluster{
		ID: "stale", Name: "stale", Context: "stale", KubeconfigPath: "/fake/kubeconfig",
		Source: "kubeconfig", Status: "disconnected", LastConnected: last, NodeCount: 3, NamespaceCount: 7,
	}
	_ = repo.Create(context.Background(), c)

	clusters, err := svc.ListClusters(context.Background())
	if err != nil {
		t.Fatalf("ListClusters returned error: %v", err)
	}
	if len(clusters) != 1 {
		t.Fatalf("expected 1 cluster, got %d", len(clusters))
	}
	got := clusters[0]
	if !got.LastConnected.Equal(last) {
		t.Errorf("expected LastConnected to be preserved as the last-known value %v, got %v", last, got.LastConnected)
	}
	if got.NodeCount != 3 || got.NamespaceCount != 7 {
		t.Errorf("expected last-known NodeCount/NamespaceCount (3/7) to be preserved immediately, got %d/%d", got.NodeCount, got.NamespaceCount)
	}
}

// ─── 7. GetOrReconnectClient's singleflight/negative-cache behavior is actually exercised ─

func TestListClusters_ReusesNegativeCache_DoesNotRedialOnRepeatedCalls(t *testing.T) {
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{}}
	factory := &countingClientFactory{fail: true}
	svc := newClusterService(repo, nil, factory.build).(*clusterService)

	_ = repo.Create(context.Background(), newUnreachableCluster("bad"))

	// First call kicks off a background reconnect (fire-and-forget).
	if _, err := svc.ListClusters(context.Background()); err != nil {
		t.Fatalf("ListClusters returned error: %v", err)
	}
	// Wait for the background attempt to actually register a failure in the
	// negative cache (deterministic condition, not a fixed sleep).
	waitUntil(t, 2*time.Second, func() bool {
		_, ok := svc.reconnectFailCache.Load("bad")
		return ok
	})
	callsAfterFirst := factory.count()
	if callsAfterFirst == 0 {
		t.Fatal("expected at least one real connection attempt after the first ListClusters call")
	}

	// Repeated ListClusters calls within the negative-cache TTL must not
	// trigger additional real connection attempts.
	for i := 0; i < 5; i++ {
		if _, err := svc.ListClusters(context.Background()); err != nil {
			t.Fatalf("ListClusters returned error: %v", err)
		}
	}
	time.Sleep(50 * time.Millisecond) // let any (incorrectly) fired background goroutines reach the factory
	if got := factory.count(); got != callsAfterFirst {
		t.Fatalf("expected no additional connection attempts within the negative-cache TTL (still %d), got %d — negative cache is not being honored", callsAfterFirst, got)
	}
}

// ─── 8. Concurrent ListClusters requests do not create unbounded work ─────

func TestListClusters_ConcurrentCalls_SingleflightCoalesces(t *testing.T) {
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{}}
	factory := &countingClientFactory{fail: false, delay: 150 * time.Millisecond}
	svc := newClusterService(repo, nil, factory.build).(*clusterService)

	_ = repo.Create(context.Background(), newUnreachableCluster("bad"))

	const n = 20
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			_, _ = svc.ListClusters(context.Background())
		}()
	}
	wg.Wait()

	// All 20 concurrent calls return promptly (none joins the background
	// reconnect's wait group); give the coalesced background attempt time to
	// finish, then confirm only a small, bounded number of REAL connection
	// attempts occurred — not 20.
	waitUntil(t, 2*time.Second, func() bool { return factory.count() > 0 })
	time.Sleep(200 * time.Millisecond)
	if got := factory.count(); got > 2 {
		t.Fatalf("expected singleflight to coalesce 20 concurrent ListClusters calls' background reconnects into ~1 real attempt, got %d", got)
	}
}

// ─── 9. Cluster removal during enrichment is safe ──────────────────────────

func TestListClusters_ClusterRemovedDuringBackgroundReconnect_NoPanic(t *testing.T) {
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{}}
	started := make(chan struct{}, 1)
	factory := &countingClientFactory{fail: false, delay: 300 * time.Millisecond}
	svc := newClusterService(repo, nil, func(p, c string) (*k8s.Client, error) {
		select {
		case started <- struct{}{}:
		default:
		}
		return factory.build(p, c)
	}).(*clusterService)

	_ = repo.Create(context.Background(), newUnreachableCluster("removable"))

	if _, err := svc.ListClusters(context.Background()); err != nil {
		t.Fatalf("ListClusters returned error: %v", err)
	}

	select {
	case <-started:
	case <-time.After(1 * time.Second):
		t.Fatal("background reconnect never started")
	}

	// Remove the cluster while the background reconnect is still in flight
	// (factory is mid-delay).
	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("RemoveCluster panicked during concurrent background reconnect: %v", r)
			}
		}()
		_ = svc.RemoveCluster(context.Background(), "removable")
	}()

	// Give the background goroutine time to finish and attempt its (now
	// no-op, since the row is gone) persistence — must not panic.
	time.Sleep(500 * time.Millisecond)

	repo.mu.Lock()
	_, stillPresent := repo.clusters["removable"]
	repo.mu.Unlock()
	if stillPresent {
		t.Fatal("removed cluster should not have been resurrected by the in-flight background reconnect")
	}
}

// ─── 10. Cluster re-addition during/after enrichment is safe ──────────────

func TestListClusters_NewClusterAddedWhileAnotherReconnects_NoCrossContamination(t *testing.T) {
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{}}
	factory := &countingClientFactory{fail: true, delay: 200 * time.Millisecond}
	svc := newClusterService(repo, nil, factory.build).(*clusterService)

	_ = repo.Create(context.Background(), newUnreachableCluster("first"))
	if _, err := svc.ListClusters(context.Background()); err != nil {
		t.Fatalf("ListClusters returned error: %v", err)
	}

	// Add a second, distinct cluster while the first's background reconnect
	// may still be in flight (IDs are always distinct — new clusters get a
	// fresh UUID in production; this models that).
	second := newHealthyClusterWithLiveClient(t, svc, "second")
	_ = repo.Create(context.Background(), second)

	clusters, err := svc.ListClusters(context.Background())
	if err != nil {
		t.Fatalf("ListClusters returned error: %v", err)
	}
	var sawSecondConnected bool
	for _, c := range clusters {
		if c.ID == "second" && c.Status == "connected" {
			sawSecondConnected = true
		}
		if c.ID == "first" && c.Status == "connected" {
			t.Error("the unrelated, still-unreachable 'first' cluster must not be contaminated by 'second's connected state")
		}
	}
	if !sawSecondConnected {
		t.Error("expected 'second' (healthy) to report connected, unaffected by 'first's reconnect")
	}
}

// ─── 11. No goroutine leaks ────────────────────────────────────────────────

func TestListClusters_NoGoroutineLeak(t *testing.T) {
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{}}
	factory := &countingClientFactory{fail: true, delay: 50 * time.Millisecond}
	svc := newClusterService(repo, nil, factory.build).(*clusterService)

	for i := 0; i < 10; i++ {
		_ = repo.Create(context.Background(), newUnreachableCluster(fmt.Sprintf("bad-%d", i)))
	}

	// Settle first: earlier tests in this file spawn their own background
	// reconnect/informer goroutines (some with multi-hundred-ms delays) that
	// may not have fully unwound yet. Without this, "before" can be taken
	// mid-unwind, making an unrelated prior test's cleanup look like a leak
	// caused by this one. Wait for the count to stabilize before sampling.
	before := runtime.NumGoroutine()
	for i := 0; i < 40; i++ {
		time.Sleep(25 * time.Millisecond)
		n := runtime.NumGoroutine()
		if n == before {
			break
		}
		before = n
	}
	if _, err := svc.ListClusters(context.Background()); err != nil {
		t.Fatalf("ListClusters returned error: %v", err)
	}

	// All background goroutines must terminate on their own within a bounded
	// window (they're bounded by backgroundReconnectBudget internally, well
	// under this test's timeout).
	ok := waitUntil(t, 3*time.Second, func() bool {
		return runtime.NumGoroutine() <= before+2 // small slack for test/runtime scheduling noise
	})
	if !ok {
		t.Fatalf("goroutine count did not return to baseline: before=%d after=%d — possible leak", before, runtime.NumGoroutine())
	}
}

// ─── 12. No data races — exercised via `go test -race` across this file ───
// (no dedicated test function: every test above runs under -race in CI/this
// package's standard test invocation, which is the mechanism this
// requirement is verified by.)
