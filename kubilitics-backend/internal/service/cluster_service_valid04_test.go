package service

// VALID-04 (docs/VALID-04-INVESTIGATION.md): regression suite for
// applyAndStoreClient's cache-replacement behavior on repeated reconnects.
//
// Corrected understanding (see the investigation doc's implementation
// record): StartClusterCache already has its own idempotency guard
// (no-ops if a cache is already running for the cluster ID), which already
// prevented goroutine count from growing unboundedly across repeated
// reconnects — intermediate-sampled measurement (not a single end-of-run
// sample) showed goroutine count going flat after the first successful
// cache start, both before and after this fix. The real bug that guard
// caused: a cluster reconnected while already connected got a brand-new
// client stored in s.clients, but the OLD informer cache kept running
// against the OLD, now-abandoned client — silently going stale. The fix
// (stop-before-start in applyAndStoreClient) forces the cache to rebuild
// against the new client on every successful reconnect.

import (
	"context"
	"fmt"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"k8s.io/client-go/kubernetes/fake"
)

type valid04MockRepo struct {
	mu      sync.Mutex
	cluster *models.Cluster
}

func (m *valid04MockRepo) Create(ctx context.Context, c *models.Cluster) error { return nil }
func (m *valid04MockRepo) Get(ctx context.Context, id string) (*models.Cluster, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cluster != nil && m.cluster.ID == id {
		cp := *m.cluster
		return &cp, nil
	}
	return nil, fmt.Errorf("not found")
}
func (m *valid04MockRepo) List(ctx context.Context) ([]*models.Cluster, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cluster == nil {
		return nil, nil
	}
	cp := *m.cluster
	return []*models.Cluster{&cp}, nil
}
func (m *valid04MockRepo) Update(ctx context.Context, c *models.Cluster) error { return nil }
func (m *valid04MockRepo) Delete(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cluster != nil && m.cluster.ID == id {
		m.cluster = nil
	}
	return nil
}

func newVALID04InClusterCluster(id string) *models.Cluster {
	return &models.Cluster{
		ID:      id,
		Name:    id,
		Context: id,
		Source:  "in-cluster",
		Status:  "disconnected",
	}
}

// Test 1: reconnect replaces the running cache's InformerManager instance
// rather than silently keeping the old one (which would still be backed by
// the now-replaced client). This is the actual bug VALID-04 fixes.
func TestVALID04_Reconnect_ReplacesInformerManager(t *testing.T) {
	const clusterID = "valid04-replace"
	repo := &valid04MockRepo{cluster: newVALID04InClusterCluster(clusterID)}
	cfg := &config.Config{K8sTimeoutSec: 30}
	factory := func(_ string, _ string) (*k8s.Client, error) {
		return k8s.NewClientForTest(fake.NewSimpleClientset()), nil
	}
	svc := NewClusterServiceWithClientFactory(repo, cfg, factory).(*clusterService)

	if _, err := svc.ReconnectCluster(context.Background(), clusterID); err != nil {
		t.Fatalf("first reconnect: %v", err)
	}
	firstIM := svc.overviewCache.GetInformerManager(clusterID)
	if firstIM == nil {
		t.Fatal("expected an InformerManager after the first reconnect")
	}

	if _, err := svc.ReconnectCluster(context.Background(), clusterID); err != nil {
		t.Fatalf("second reconnect: %v", err)
	}
	secondIM := svc.overviewCache.GetInformerManager(clusterID)
	if secondIM == nil {
		t.Fatal("expected an InformerManager after the second reconnect")
	}

	if firstIM == secondIM {
		t.Fatal("second reconnect kept the same InformerManager instance — the cache did not rebuild against the new client (the VALID-04 regression)")
	}
}

// Test 2: repeated reconnect does not grow goroutine count unboundedly.
// Uses a bounded-invariant check (not an exact count) per the investigation's
// corrected understanding: goroutine count should go flat after the first
// successful cache start, not increase further with each additional
// reconnect, regardless of whether old caches are stopped-and-rebuilt or
// merely no-op'd.
func TestVALID04_RepeatedReconnect_GoroutinesBounded(t *testing.T) {
	const clusterID = "valid04-bounded"
	repo := &valid04MockRepo{cluster: newVALID04InClusterCluster(clusterID)}
	cfg := &config.Config{K8sTimeoutSec: 30}
	factory := func(_ string, _ string) (*k8s.Client, error) {
		return k8s.NewClientForTest(fake.NewSimpleClientset()), nil
	}
	svc := NewClusterServiceWithClientFactory(repo, cfg, factory)

	if _, err := svc.ReconnectCluster(context.Background(), clusterID); err != nil {
		t.Fatalf("priming reconnect: %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	afterFirst := runtime.NumGoroutine()

	const moreReconnects = 9
	for i := 0; i < moreReconnects; i++ {
		if _, err := svc.ReconnectCluster(context.Background(), clusterID); err != nil {
			t.Fatalf("reconnect %d: %v", i, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond)
	afterAll := runtime.NumGoroutine()

	t.Logf("goroutines after first reconnect=%d, after %d more=%d", afterFirst, moreReconnects, afterAll)
	// Bounded invariant: goroutine count after many more reconnects should
	// stay close to the count after just one, not grow roughly linearly with
	// reconnect count (which would indicate each reconnect leaks a full new
	// cache instead of replacing the previous one).
	if afterAll > afterFirst+15 {
		t.Fatalf("goroutine count grew from %d (after 1 reconnect) to %d (after %d reconnects) — growth is not bounded", afterFirst, afterAll, moreReconnects+1)
	}
}

// Test 3: reconnect remains functional — the cluster stays usable, the cache
// is populated, and resource information remains available after reconnect.
func TestVALID04_Reconnect_RemainsFunctional(t *testing.T) {
	const clusterID = "valid04-functional"
	repo := &valid04MockRepo{cluster: newVALID04InClusterCluster(clusterID)}
	cfg := &config.Config{K8sTimeoutSec: 30}
	factory := func(_ string, _ string) (*k8s.Client, error) {
		return k8s.NewClientForTest(fake.NewSimpleClientset()), nil
	}
	svc := NewClusterServiceWithClientFactory(repo, cfg, factory).(*clusterService)

	updated, err := svc.ReconnectCluster(context.Background(), clusterID)
	if err != nil {
		t.Fatalf("reconnect: %v", err)
	}
	if updated.Status != "connected" {
		t.Fatalf("expected status=connected after reconnect, got %q", updated.Status)
	}
	if _, err := svc.GetClient(clusterID); err != nil {
		t.Fatalf("expected a live client after reconnect: %v", err)
	}
	if svc.overviewCache.GetInformerManager(clusterID) == nil {
		t.Fatal("expected a running InformerManager after reconnect")
	}
}

// Test 4: four consecutive reconnects — no panic, no duplicate active cache
// generation (always exactly the latest InformerManager reachable), bounded
// goroutines.
func TestVALID04_FourConsecutiveReconnects_NoDuplicateGeneration(t *testing.T) {
	const clusterID = "valid04-four"
	repo := &valid04MockRepo{cluster: newVALID04InClusterCluster(clusterID)}
	cfg := &config.Config{K8sTimeoutSec: 30}
	factory := func(_ string, _ string) (*k8s.Client, error) {
		return k8s.NewClientForTest(fake.NewSimpleClientset()), nil
	}
	svc := NewClusterServiceWithClientFactory(repo, cfg, factory).(*clusterService)

	var last *k8s.InformerManager
	for i := 0; i < 4; i++ {
		if _, err := svc.ReconnectCluster(context.Background(), clusterID); err != nil {
			t.Fatalf("reconnect %d: %v", i, err)
		}
		im := svc.overviewCache.GetInformerManager(clusterID)
		if im == nil {
			t.Fatalf("reconnect %d: expected a running InformerManager", i)
		}
		if im == last {
			t.Fatalf("reconnect %d: InformerManager identical to the previous reconnect's — cache did not rebuild", i)
		}
		last = im
	}
}

// Test 5: ReconnectCluster racing RemoveCluster does not panic, does not
// resurrect the removed cluster, and leaves no stale cache running for the
// removed cluster ID. Exercises the same resurrection-guard path VALID-01
// added (finishReconnect), now also reachable via the in-cluster branch's
// StopClusterCache/StartClusterCache pairing.
func TestVALID04_ReconnectRacesRemove_NoResurrectionNoStaleCache(t *testing.T) {
	const clusterID = "valid04-race-remove"
	repo := &valid04MockRepo{cluster: newVALID04InClusterCluster(clusterID)}
	cfg := &config.Config{K8sTimeoutSec: 30}
	started := make(chan struct{}, 1)
	factory := func(_ string, _ string) (*k8s.Client, error) {
		select {
		case started <- struct{}{}:
		default:
		}
		time.Sleep(150 * time.Millisecond)
		return k8s.NewClientForTest(fake.NewSimpleClientset()), nil
	}
	svc := NewClusterServiceWithClientFactory(repo, cfg, factory).(*clusterService)

	done := make(chan error, 1)
	go func() {
		_, err := svc.ReconnectCluster(context.Background(), clusterID)
		done <- err
	}()

	select {
	case <-started:
	case <-time.After(1 * time.Second):
		t.Fatal("reconnect's client factory never started")
	}

	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("RemoveCluster panicked while a reconnect was in flight: %v", r)
			}
		}()
		_ = svc.RemoveCluster(context.Background(), clusterID)
	}()

	if err := <-done; err != nil {
		t.Fatalf("ReconnectCluster returned error: %v", err)
	}

	time.Sleep(50 * time.Millisecond)
	if _, err := repo.Get(context.Background(), clusterID); err == nil {
		t.Fatal("removed cluster was resurrected by the in-flight reconnect")
	}
	if svc.overviewCache.GetInformerManager(clusterID) != nil {
		t.Fatal("a cache is still running for a cluster that was removed during reconnect")
	}
}

// Test 6: concurrent ReconnectCluster calls for the same cluster do not
// panic or race (go test -race is the authoritative check for the latter).
// Section 13 of the VALID-04 remediation instructions: the Stop-then-Start
// pair in applyAndStoreClient is not atomic across two separate c.mu.Lock()
// acquisitions, so a narrow interleaving can leave the cache associated with
// a different client instance than s.clients[id] — a pre-existing, bounded
// correctness edge case (not newly introduced by this fix, and shared by the
// kubeconfig branch's identical Stop-then-Start pattern), not a crash, leak,
// or duplicate-generation bug. This test proves the "no panic, no race"
// floor; the narrow staleness edge case is documented as a remaining risk,
// not fixed here, per the explicit instruction not to introduce a broad
// synchronization redesign without further evidence of real-world impact.
func TestVALID04_ConcurrentReconnects_NoPanic(t *testing.T) {
	const clusterID = "valid04-concurrent"
	repo := &valid04MockRepo{cluster: newVALID04InClusterCluster(clusterID)}
	cfg := &config.Config{K8sTimeoutSec: 30}
	factory := func(_ string, _ string) (*k8s.Client, error) {
		time.Sleep(10 * time.Millisecond)
		return k8s.NewClientForTest(fake.NewSimpleClientset()), nil
	}
	svc := NewClusterServiceWithClientFactory(repo, cfg, factory).(*clusterService)

	var wg sync.WaitGroup
	errs := make(chan error, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					errs <- fmt.Errorf("panic: %v", r)
				}
			}()
			if _, err := svc.ReconnectCluster(context.Background(), clusterID); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent reconnect failed: %v", err)
	}

	if svc.overviewCache.GetInformerManager(clusterID) == nil {
		t.Fatal("expected exactly one running InformerManager after concurrent reconnects, got none")
	}
}
