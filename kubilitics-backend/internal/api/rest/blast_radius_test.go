package rest

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// noopTopologyService satisfies service.TopologyService with no-ops. The
// graph engine's onRebuild callback calls InvalidateForCluster on every
// debounced rebuild (triggered as soon as the fake clientset's informers
// sync), so a real (non-nil) implementation is required or that callback
// panics on a nil interface in a background goroutine.
type noopTopologyService struct{}

func (noopTopologyService) GetTopology(context.Context, string, models.TopologyFilters, int, bool) (*models.TopologyGraph, error) {
	return nil, nil
}
func (noopTopologyService) GetTopologyWithClient(context.Context, *k8s.Client, string, models.TopologyFilters, int, bool) (*models.TopologyGraph, error) {
	return nil, nil
}
func (noopTopologyService) GetResourceTopology(context.Context, string, string, string, string) (*models.TopologyGraph, error) {
	return nil, nil
}
func (noopTopologyService) GetResourceTopologyWithClient(context.Context, *k8s.Client, string, string, string, string) (*models.TopologyGraph, error) {
	return nil, nil
}
func (noopTopologyService) ExportTopology(context.Context, string, string) ([]byte, error) {
	return nil, nil
}
func (noopTopologyService) ExportTopologyWithClient(context.Context, *k8s.Client, string, string) ([]byte, error) {
	return nil, nil
}
func (noopTopologyService) InvalidateForCluster(string) {}

// slowReconnectClusterService wraps mockClusterService and makes
// GetOrReconnectClient block on blockCh for exactly one clusterID, signaling
// started once it has begun blocking. This simulates BLASTRADIUS-3's
// "cold-starting/unreachable cluster" scenario deterministically (via
// channel synchronization, not sleeps or fake-clientset reactor timing,
// which internal/graph and internal/api/rest tests have previously found
// cannot observe context-cancellation/blocking behavior — see Phase 4).
type slowReconnectClusterService struct {
	mockClusterService
	slowClusterID string
	blockCh       chan struct{}
	started       chan string
}

func (m *slowReconnectClusterService) GetOrReconnectClient(ctx context.Context, id string) (*k8s.Client, error) {
	if id == m.slowClusterID {
		m.started <- id
		<-m.blockCh
	}
	return m.GetClient(id)
}

// TestGetOrStartGraphEngine_SlowClusterDoesNotBlockOtherClusters is the
// BLASTRADIUS-3 regression test. Before the fix, getOrStartGraphEngine held
// the single map-wide write lock across client resolution for the cold-
// starting cluster, so a second cluster's lookup — even though its engine
// could start immediately — would block until the first cluster's (slow)
// client resolution finished. Reverting the fix (restoring the single
// Mutex-held-across-getClientFromRequest implementation) makes this test
// fail with a timeout on the fast cluster.
func TestGetOrStartGraphEngine_SlowClusterDoesNotBlockOtherClusters(t *testing.T) {
	const slowID = "slow-cluster"
	const fastID = "fast-cluster"

	cs := &slowReconnectClusterService{
		mockClusterService: mockClusterService{
			clusterMap: map[string]*models.Cluster{
				slowID: {ID: slowID, Name: slowID},
				fastID: {ID: fastID, Name: fastID},
			},
			clientMap: map[string]*k8s.Client{},
		},
		slowClusterID: slowID,
		blockCh:       make(chan struct{}),
		started:       make(chan string, 1),
	}

	h := NewHandler(cs, noopTopologyService{}, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	h.graphEngineMgr = graph.NewEngineLifecycleManager(time.Hour, nil)

	slowDone := make(chan *graph.ClusterGraphEngine, 1)
	go func() {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		slowDone <- h.getOrStartGraphEngine(req, slowID)
	}()

	select {
	case <-cs.started:
	case <-time.After(5 * time.Second):
		t.Fatal("slow cluster's client resolution never started")
	}

	fastDone := make(chan *graph.ClusterGraphEngine, 1)
	go func() {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		fastDone <- h.getOrStartGraphEngine(req, fastID)
	}()

	select {
	case engine := <-fastDone:
		if engine == nil {
			t.Fatal("expected a non-nil engine for the fast cluster")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("fast cluster's getOrStartGraphEngine was blocked by the slow cluster's cold start — BLASTRADIUS-3 regression")
	}

	close(cs.blockCh)

	select {
	case engine := <-slowDone:
		if engine == nil {
			t.Fatal("expected a non-nil engine for the slow cluster once unblocked")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("slow cluster's getOrStartGraphEngine never completed after unblocking")
	}
}

// TestGetOrStartGraphEngine_ConcurrentSameClusterCoalesces proves the
// singleflight replacement for the old TOCTOU double-checked-locking map
// insert still gives the original guarantee: concurrent callers for the SAME
// clusterID get exactly one engine, not one each racing to overwrite the map.
func TestGetOrStartGraphEngine_ConcurrentSameClusterCoalesces(t *testing.T) {
	const clusterID = "same-cluster"
	cs := &mockClusterService{
		clusterMap: map[string]*models.Cluster{clusterID: {ID: clusterID, Name: clusterID}},
		clientMap:  map[string]*k8s.Client{},
	}
	h := NewHandler(cs, noopTopologyService{}, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	h.graphEngineMgr = graph.NewEngineLifecycleManager(time.Hour, nil)

	const n = 10
	results := make(chan *graph.ClusterGraphEngine, n)
	for i := 0; i < n; i++ {
		go func() {
			req := httptest.NewRequest(http.MethodGet, "/x", nil)
			results <- h.getOrStartGraphEngine(req, clusterID)
		}()
	}

	first := <-results
	if first == nil {
		t.Fatal("expected a non-nil engine")
	}
	for i := 1; i < n; i++ {
		engine := <-results
		if engine != first {
			t.Fatalf("expected all %d concurrent callers to receive the SAME engine instance, got a different one at call %d", n, i)
		}
	}
}

// TestComputeBlastRadiusWithTimeout_NormalCaseUnaffected confirms the
// timeout wrapper is transparent on the (now typical, post-optimization)
// fast path — same result and error as calling ComputeBlastRadiusWithMode
// directly.
func TestComputeBlastRadiusWithTimeout_NormalCaseUnaffected(t *testing.T) {
	snap := graph.BuildSnapshot(&graph.ClusterResources{}, false, nil, nil)
	target := models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "nonexistent"}

	direct, directErr := snap.ComputeBlastRadiusWithMode(target, graph.FailureModeWorkloadDeletion)
	wrapped, wrappedErr := computeBlastRadiusWithTimeout(context.Background(), snap, target, graph.FailureModeWorkloadDeletion)

	if (directErr == nil) != (wrappedErr == nil) {
		t.Fatalf("error presence mismatch: direct=%v wrapped=%v", directErr, wrappedErr)
	}
	if directErr != nil && wrappedErr != nil && directErr.Error() != wrappedErr.Error() {
		t.Errorf("error message mismatch: direct=%q wrapped=%q", directErr.Error(), wrappedErr.Error())
	}
	if (direct == nil) != (wrapped == nil) {
		t.Fatalf("result presence mismatch: direct=%v wrapped=%v", direct, wrapped)
	}
}

// TestComputeBlastRadiusWithTimeout_RespectsExpiredContext proves the
// watchdog branch actually fires: an already-expired context must return
// context.DeadlineExceeded rather than waiting for (or silently ignoring)
// the computation goroutine, which is the GetBlastRadius handler's cue to
// respond with a visible timeout instead of leaving the client to "get
// lost" waiting forever — the exact symptom this wrapper exists to prevent.
func TestComputeBlastRadiusWithTimeout_RespectsExpiredContext(t *testing.T) {
	snap := graph.BuildSnapshot(&graph.ClusterResources{}, false, nil, nil)
	target := models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "nonexistent"}

	ctx, cancel := context.WithTimeout(context.Background(), 0)
	defer cancel()
	<-ctx.Done() // guarantee the deadline has actually elapsed before calling

	_, err := computeBlastRadiusWithTimeout(ctx, snap, target, graph.FailureModeWorkloadDeletion)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected context.DeadlineExceeded, got %v", err)
	}
}
