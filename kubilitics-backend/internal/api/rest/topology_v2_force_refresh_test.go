package rest

// VALID-07 (docs/TOPOLOGY-SCALE-INVESTIGATION.md): GetTopologyV2 (the actual
// default frontend Topology view, GET /clusters/{id}/topology/cluster)
// checked the package-level topologyCache unconditionally and had no
// force_refresh parsing/bypass at all — unlike V1's GetTopology, which
// already honors it. Two consecutive force_refresh=true requests returned
// byte-identical responses in ~25ms each (far below a genuine rebuild's
// 150-350ms), live-reproduced before this fix. This directly overlaps with
// the original customer symptom ("refresh repeatedly, nothing improves")
// for the actual default topology path, bounded by the 30s cache TTL (not
// indefinite, hence P1 not P0).
//
// These tests count actual List calls against a fake clientset — a
// structural proof of how many times BuildTopology really ran — rather
// than relying on timing/sleeps, per the brief's explicit instruction.

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gorilla/mux"
	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func newTopologyV2TestHandlerWithCountingClientset(t *testing.T) (router *mux.Router, clusterID string, podListCount *int32) {
	t.Helper()
	clusterID = uuid.New().String()
	var count int32
	cs := k8sfake.NewSimpleClientset(
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "p1"}},
	)
	cs.PrependReactor("list", "pods", func(k8stesting.Action) (bool, runtime.Object, error) {
		atomic.AddInt32(&count, 1)
		return false, nil, nil // not handled -> fall through to the real tracker-backed List
	})
	cluster := &models.Cluster{ID: clusterID, Name: clusterID, Context: clusterID, Status: "connected"}
	cs2 := &mockClusterService{
		clusterMap: map[string]*models.Cluster{clusterID: cluster},
		clusters:   []*models.Cluster{cluster},
		clientMap:  map[string]*k8s.Client{clusterID: k8s.NewClientForTest(cs)},
	}
	h := NewHandler(cs2, nil, nil, nil, &mockEventsService{}, nil, nil, nil, nil, nil, nil, nil)
	router = mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)
	return router, clusterID, &count
}

func doTopologyV2Request(router *mux.Router, clusterID, query string) *httptest.ResponseRecorder {
	url := "/api/v1/clusters/" + clusterID + "/topology/cluster"
	if query != "" {
		url += "?" + query
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// Without force_refresh: second request within the TTL must be a cache hit
// — exactly one real build (one "list pods" call) for two requests.
func TestGetTopologyV2_WithoutForceRefresh_SecondRequestIsCacheHit(t *testing.T) {
	router, clusterID, podListCount := newTopologyV2TestHandlerWithCountingClientset(t)

	r1 := doTopologyV2Request(router, clusterID, "")
	if r1.Code != http.StatusOK {
		t.Fatalf("request 1: status = %d, body = %s", r1.Code, r1.Body.String())
	}
	r2 := doTopologyV2Request(router, clusterID, "")
	if r2.Code != http.StatusOK {
		t.Fatalf("request 2: status = %d, body = %s", r2.Code, r2.Body.String())
	}

	if got := atomic.LoadInt32(podListCount); got != 1 {
		t.Fatalf("expected exactly 1 real build (1 'list pods' call) for 2 normal requests, got %d — cache is not being used", got)
	}
}

// THE REGRESSION: with force_refresh=true on both requests, each must
// trigger its own real build — exactly 2 "list pods" calls for 2 requests.
// Pre-fix, this fails with got=1 (both served from the same cached entry).
func TestGetTopologyV2_WithForceRefresh_EachRequestRebuilds(t *testing.T) {
	router, clusterID, podListCount := newTopologyV2TestHandlerWithCountingClientset(t)

	r1 := doTopologyV2Request(router, clusterID, "force_refresh=true")
	if r1.Code != http.StatusOK {
		t.Fatalf("request 1: status = %d, body = %s", r1.Code, r1.Body.String())
	}
	r2 := doTopologyV2Request(router, clusterID, "force_refresh=true")
	if r2.Code != http.StatusOK {
		t.Fatalf("request 2: status = %d, body = %s", r2.Code, r2.Body.String())
	}

	if got := atomic.LoadInt32(podListCount); got != 2 {
		t.Fatalf("expected exactly 2 real builds (2 'list pods' calls) for 2 force_refresh=true requests, got %d — force_refresh is being ignored (VALID-07 regression)", got)
	}
}

// A forced rebuild's result must still populate the cache, so a SUBSEQUENT
// normal (non-forced) request benefits from it instead of forcing a third
// build.
func TestGetTopologyV2_ForceRefresh_ThenNormalRequest_UsesCachedForcedResult(t *testing.T) {
	router, clusterID, podListCount := newTopologyV2TestHandlerWithCountingClientset(t)

	doTopologyV2Request(router, clusterID, "force_refresh=true")
	doTopologyV2Request(router, clusterID, "") // normal — should be a cache hit against the forced result

	if got := atomic.LoadInt32(podListCount); got != 1 {
		t.Fatalf("expected exactly 1 build (forced), with the normal request reusing its cached result; got %d builds", got)
	}
}

// Mixed sequence: normal, force_refresh, normal — the forced request must
// rebuild and refresh the cache; the final normal request must reuse THAT
// fresh result (not trigger its own build, and not somehow see a stale
// pre-force result).
func TestGetTopologyV2_MixedSequence_ForceRefreshDoesNotCorruptSubsequentCacheHit(t *testing.T) {
	router, clusterID, podListCount := newTopologyV2TestHandlerWithCountingClientset(t)

	doTopologyV2Request(router, clusterID, "")             // build #1
	doTopologyV2Request(router, clusterID, "force_refresh=true") // build #2
	r3 := doTopologyV2Request(router, clusterID, "")        // cache hit against build #2's result

	if r3.Code != http.StatusOK {
		t.Fatalf("request 3: status = %d, body = %s", r3.Code, r3.Body.String())
	}
	if got := atomic.LoadInt32(podListCount); got != 2 {
		t.Fatalf("expected exactly 2 builds total (normal, then forced; final normal is a cache hit), got %d", got)
	}
}

// Phase E — concurrency correctness: N concurrent force_refresh=true
// requests against the same cluster must each get a fully-formed, valid
// response (no partial/corrupt graph can escape — topologyCacheSet stores
// one complete *topologyCacheEntry pointer atomically via sync.Map, so a
// reader can only ever observe a fully-built entry or none at all), and
// must not deadlock or race. Does NOT assert a specific build count (no
// coalescing is implemented or expected — each forced request legitimately
// triggers its own build); the point is correctness under concurrency, not
// coalescing. Run under `go test -race`.
func TestGetTopologyV2_ConcurrentForceRefresh_AllValidNoRace(t *testing.T) {
	router, clusterID, podListCount := newTopologyV2TestHandlerWithCountingClientset(t)

	const n = 15
	var wg sync.WaitGroup
	codes := make([]int, n)
	bodies := make([]int, n) // response body length, as a cheap "non-empty, well-formed" proxy
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			rec := doTopologyV2Request(router, clusterID, "force_refresh=true")
			codes[idx] = rec.Code
			bodies[idx] = rec.Body.Len()
		}(i)
	}
	wg.Wait()

	for i, code := range codes {
		if code != http.StatusOK {
			t.Errorf("request %d: status = %d, want 200", i, code)
		}
		if bodies[i] == 0 {
			t.Errorf("request %d: empty response body", i)
		}
	}
	if got := atomic.LoadInt32(podListCount); got < 1 {
		t.Fatalf("expected at least 1 build to have occurred, got %d", got)
	}

	// The cache must end up in a valid, immediately-usable state: a
	// subsequent normal request must succeed and be a clean cache hit
	// (no additional build), proving no corrupted/partial entry was left
	// behind by the concurrent forced writes.
	before := atomic.LoadInt32(podListCount)
	rFinal := doTopologyV2Request(router, clusterID, "")
	if rFinal.Code != http.StatusOK {
		t.Fatalf("final normal request: status = %d, body = %s", rFinal.Code, rFinal.Body.String())
	}
	if after := atomic.LoadInt32(podListCount); after != before {
		t.Fatalf("final normal request triggered a build (count %d -> %d) — cache state left invalid by concurrent force_refresh writes", before, after)
	}
}
