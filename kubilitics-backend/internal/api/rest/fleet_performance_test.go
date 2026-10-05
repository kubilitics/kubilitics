package rest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// NOTE on what this file does NOT test, and why: an earlier version of this
// test attempted to observe buildClusterSummary's internal List-call
// concurrency directly, via a k8stesting.ReactionFunc that recorded the max
// number of simultaneous in-flight calls. It always observed exactly 1,
// regardless of maxConcurrentSummaryListCalls's value — traced to
// k8stesting.Fake.Invokes (client-go/testing/fake.go) holding c.Lock() for
// the entire reactor-chain execution, including any artificial delay placed
// inside a reactor. The fake clientset structurally serializes every Action
// through one mutex, so no test built on it (reactor-based or timing-based)
// can distinguish "bounded to N" from "unbounded" — both produce identical,
// fully-serialized behavior. This is the same class of fake-clientset
// limitation already documented in cluster_service_fleet_timeout_test.go for
// context-cancellation testing, encountered independently here for
// concurrency observation. The inner (buildClusterSummary) bound is
// CODE-PROVEN (errgroup.SetLimit(maxConcurrentSummaryListCalls) is visible
// in the diff) and FUNCTIONALLY-test-proven (existing summary-correctness
// tests pass unchanged against the refactored errgroup-based version) but
// its exact concurrency ceiling is UNVERIFIED by an automated test in this
// repo — seeing it would require a hand-rolled fake clientset that doesn't
// route through k8stesting.Fake at all, out of scope for this pass.
//
// GetFleetOverview's OUTER (per-cluster) bound does NOT have this problem —
// GetClusterSummary is a plain Go method call on the mock service, not a
// client-go Action, so no shared Fake lock is involved. See
// TestGetFleetOverview_PerClusterFanOutIsBounded below, which genuinely
// exercises and proves that bound via wall-clock timing.

// delayedFleetMockClusterService wraps fleetMockClusterService to add a
// fixed, artificial delay to every GetClusterSummary call — used to make
// GetFleetOverview's own per-cluster concurrency bound observable via
// wall-clock timing (GetClusterSummary here is a plain Go call, not a
// client-go Action the fake clientset's reactors could intercept).
type delayedFleetMockClusterService struct {
	fleetMockClusterService
	delay time.Duration
}

func (m *delayedFleetMockClusterService) GetClusterSummary(ctx context.Context, id string) (*models.ClusterSummary, error) {
	time.Sleep(m.delay)
	return m.fleetMockClusterService.GetClusterSummary(ctx, id)
}

// Phase I-B: GetFleetOverview's own per-cluster fan-out must also stay
// bounded. N clusters, each artificially delayed, must take roughly
// ceil(N/limit) delay-periods — not run fully in parallel (which an
// unbounded implementation would, finishing in ~1 delay period regardless
// of N).
func TestGetFleetOverview_PerClusterFanOutIsBounded(t *testing.T) {
	const n = 30
	const perClusterDelay = 20 * time.Millisecond

	clusters := make([]*models.Cluster, 0, n)
	summaries := make(map[string]*models.ClusterSummary, n)
	for i := 0; i < n; i++ {
		id := "cluster-" + string(rune('a'+i))
		clusters = append(clusters, &models.Cluster{ID: id, Name: id})
		summaries[id] = &models.ClusterSummary{NodeCount: 1, HealthStatus: "healthy", Reachable: true}
	}
	cs := &delayedFleetMockClusterService{
		fleetMockClusterService: fleetMockClusterService{
			mockClusterService: mockClusterService{clusters: clusters},
			summaries:          summaries,
		},
		delay: perClusterDelay,
	}
	h := &Handler{clusterService: cs}

	req := httptest.NewRequest(http.MethodGet, "/fleet/overview", nil)
	rec := httptest.NewRecorder()

	start := time.Now()
	h.GetFleetOverview(rec, req)
	elapsed := time.Since(start)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	// A floor comfortably below the exact theoretical minimum
	// (ceil(n/limit)*delay) to avoid timing flakiness, but high enough that
	// a fully unbounded implementation (finishes in ~1 delay period) fails it.
	minExpectedBatches := n/maxConcurrentFleetClusterSummaries - 1 // tolerance
	minExpected := time.Duration(minExpectedBatches) * perClusterDelay
	if elapsed < minExpected {
		t.Fatalf("GetFleetOverview took %v for %d clusters (limit=%d) — want >= %v; fan-out does not appear bounded", elapsed, n, maxConcurrentFleetClusterSummaries, minExpected)
	}
	t.Logf("GetFleetOverview(%d clusters, limit=%d, %v/cluster) took %v", n, maxConcurrentFleetClusterSummaries, perClusterDelay, elapsed)
}

// Phase I-B failure-topology matrix, cases C/D: 10% and 50% of a fleet
// unreachable. The healthy majority's data must remain complete and
// correct regardless of the unreachable fraction — isolation must not
// degrade as the failure ratio grows.
func TestGetFleetOverview_MixedHealthyUnreachableRatios(t *testing.T) {
	for _, tc := range []struct {
		name           string
		total, unreach int
	}{
		{"10 percent unreachable", 20, 2},
		{"50 percent unreachable", 20, 10},
	} {
		t.Run(tc.name, func(t *testing.T) {
			clusters := make([]*models.Cluster, 0, tc.total)
			summaries := map[string]*models.ClusterSummary{}
			errs := map[string]error{}
			for i := 0; i < tc.total; i++ {
				id := "cluster-" + string(rune('a'+i))
				clusters = append(clusters, &models.Cluster{ID: id, Name: id})
				if i < tc.unreach {
					errs[id] = context.DeadlineExceeded
				} else {
					summaries[id] = &models.ClusterSummary{NodeCount: 2, PodCount: 10, HealthStatus: "healthy", Reachable: true}
				}
			}
			cs := &fleetMockClusterService{
				mockClusterService: mockClusterService{clusters: clusters},
				summaries:          summaries,
				summaryErrs:        errs,
			}
			resp := doFleetOverview(t, newFleetHandler(cs))

			wantHealthy := tc.total - tc.unreach
			if resp.Totals.Healthy != wantHealthy {
				t.Fatalf("Totals.Healthy = %d, want %d", resp.Totals.Healthy, wantHealthy)
			}
			if resp.Totals.Unhealthy != tc.unreach {
				t.Fatalf("Totals.Unhealthy = %d, want %d", resp.Totals.Unhealthy, tc.unreach)
			}
			if len(resp.Clusters) != tc.total {
				t.Fatalf("len(Clusters) = %d, want %d", len(resp.Clusters), tc.total)
			}
			for _, c := range resp.Clusters {
				if _, shouldFail := errs[c.ID]; shouldFail {
					if c.Reachable {
						t.Fatalf("cluster %s should be Reachable=false: %+v", c.ID, c)
					}
				} else {
					if !c.Reachable || c.Pods != 10 {
						t.Fatalf("healthy cluster %s corrupted by the unreachable ones: %+v", c.ID, c)
					}
				}
			}
		})
	}
}

// Phase I-B failure-topology matrix, case E: one extremely slow cluster
// must not multiply total response time by the fleet size — bounded
// concurrency means its slot is just one of maxConcurrentFleetClusterSummaries
// running at once, not a serialization point for the whole fleet.
func TestGetFleetOverview_OneSlowClusterDoesNotMultiplyTotalLatency(t *testing.T) {
	const n = 20
	const slowDelay = 100 * time.Millisecond
	const fastDelay = 2 * time.Millisecond

	clusters := make([]*models.Cluster, 0, n)
	summaries := make(map[string]*models.ClusterSummary, n)
	for i := 0; i < n; i++ {
		id := "cluster-" + string(rune('a'+i))
		clusters = append(clusters, &models.Cluster{ID: id, Name: id})
		summaries[id] = &models.ClusterSummary{NodeCount: 1, HealthStatus: "healthy", Reachable: true}
	}
	slowID := clusters[0].ID
	cs := &perClusterDelayMockClusterService{
		fleetMockClusterService: fleetMockClusterService{
			mockClusterService: mockClusterService{clusters: clusters},
			summaries:          summaries,
		},
		delays:       map[string]time.Duration{slowID: slowDelay},
		defaultDelay: fastDelay,
	}
	h := &Handler{clusterService: cs}

	req := httptest.NewRequest(http.MethodGet, "/fleet/overview", nil)
	rec := httptest.NewRecorder()
	start := time.Now()
	h.GetFleetOverview(rec, req)
	elapsed := time.Since(start)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	// With bounded concurrency, total time should be dominated by the one
	// slow cluster's own delay (it runs concurrently with the others, not
	// serialized after them) — NOT n*slowDelay, which is what a
	// one-slow-cluster-blocks-everything implementation would produce.
	maxAcceptable := slowDelay + 5*fastDelay // generous slack, still far below n*slowDelay=2s
	if elapsed > maxAcceptable {
		t.Fatalf("GetFleetOverview took %v with one slow cluster among %d — want <= %v (the slow cluster must not serialize the whole fleet)", elapsed, n, maxAcceptable)
	}
	t.Logf("GetFleetOverview(%d clusters, 1 slow @ %v) took %v", n, slowDelay, elapsed)
}

type perClusterDelayMockClusterService struct {
	fleetMockClusterService
	delays       map[string]time.Duration
	defaultDelay time.Duration
}

func (m *perClusterDelayMockClusterService) GetClusterSummary(ctx context.Context, id string) (*models.ClusterSummary, error) {
	d := m.defaultDelay
	if custom, ok := m.delays[id]; ok {
		d = custom
	}
	time.Sleep(d)
	return m.fleetMockClusterService.GetClusterSummary(ctx, id)
}

// Phase I-B failure-topology matrix, case F: multiple simultaneous Fleet
// requests (e.g. two browser tabs, or a poll firing while a manual refresh
// is in flight) must not race, panic, or corrupt each other's results — run
// under `go test -race`.
func TestGetFleetOverview_ConcurrentRequestsDoNotRaceOrCorrupt(t *testing.T) {
	const n = 15
	const concurrentRequests = 8

	clusters := make([]*models.Cluster, 0, n)
	summaries := make(map[string]*models.ClusterSummary, n)
	for i := 0; i < n; i++ {
		id := "cluster-" + string(rune('a'+i))
		clusters = append(clusters, &models.Cluster{ID: id, Name: id})
		summaries[id] = &models.ClusterSummary{NodeCount: 1, PodCount: 5, HealthStatus: "healthy", Reachable: true}
	}
	cs := &fleetMockClusterService{mockClusterService: mockClusterService{clusters: clusters}, summaries: summaries}
	h := newFleetHandler(cs)

	// t.Fatalf is unsafe to call from a non-test goroutine, so each worker
	// performs the raw request itself (not via the doFleetOverview helper)
	// and reports only the decoded response or an error string back to the
	// main goroutine, which does all assertions.
	var wg sync.WaitGroup
	results := make([]FleetOverviewResponse, concurrentRequests)
	errs := make([]string, concurrentRequests)
	for i := 0; i < concurrentRequests; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, "/fleet/overview", nil)
			rec := httptest.NewRecorder()
			h.GetFleetOverview(rec, req)
			if rec.Code != http.StatusOK {
				errs[idx] = fmt.Sprintf("status = %d, body = %s", rec.Code, rec.Body.String())
				return
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &results[idx]); err != nil {
				errs[idx] = fmt.Sprintf("decode: %v", err)
			}
		}(i)
	}
	wg.Wait()

	for i, e := range errs {
		if e != "" {
			t.Fatalf("request %d failed: %s", i, e)
		}
	}
	for i, resp := range results {
		if len(resp.Clusters) != n {
			t.Fatalf("request %d: got %d clusters, want %d", i, len(resp.Clusters), n)
		}
		if resp.Totals.Healthy != n {
			t.Fatalf("request %d: Totals.Healthy = %d, want %d", i, resp.Totals.Healthy, n)
		}
	}
}
