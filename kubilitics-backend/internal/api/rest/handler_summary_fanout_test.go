package rest

// Phase A (docs/BUILDCLUSTERSUMMARY-FANOUT-INVESTIGATION.md): buildClusterSummary's
// ~26-way List fan-out previously shared ctx = r.Context() with NO internal
// deadline anywhere in the call chain (confirmed by tracing GetClusterSummary
// -> resilient.WrapClusterHandler -> buildClusterSummary directly). A hung
// (not merely erroring) API server response for even one of the 26 resource
// types could block g.Wait() forever. These tests prove the fix
// (clusterSummaryTimeout wrapping ctx) without weakening the existing
// bounded-concurrency (maxConcurrentSummaryListCalls) or partial-result
// (failedListCalls -> HealthReason, not a hard error) semantics already in
// place from the earlier Phase I-B work.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// blockingPodsClientset mirrors the one added for the PipelineManager fix
// (internal/events/manager_lock_io_test.go) — a typed-client override, not a
// k8stesting.PrependReactor, because client-go v0.35.1's testing.Action
// interface has no way to observe the caller's context at all, so only a
// typed override can prove real ctx-cancellation propagation.
type blockingPodsClientset struct {
	kubernetes.Interface
	unblock chan struct{}
	started chan struct{}

	once sync.Once
	mu   sync.Mutex
	last error
}

func newBlockingPodsClientset(inner kubernetes.Interface) *blockingPodsClientset {
	return &blockingPodsClientset{Interface: inner, unblock: make(chan struct{}), started: make(chan struct{})}
}

func (c *blockingPodsClientset) CoreV1() corev1client.CoreV1Interface {
	return &blockingCoreV1{CoreV1Interface: c.Interface.CoreV1(), parent: c}
}

type blockingCoreV1 struct {
	corev1client.CoreV1Interface
	parent *blockingPodsClientset
}

func (b *blockingCoreV1) Pods(ns string) corev1client.PodInterface {
	return &blockingPods{PodInterface: b.CoreV1Interface.Pods(ns), parent: b.parent}
}

type blockingPods struct {
	corev1client.PodInterface
	parent *blockingPodsClientset
}

func (p *blockingPods) List(ctx context.Context, opts metav1.ListOptions) (*corev1.PodList, error) {
	p.parent.once.Do(func() { close(p.parent.started) })
	select {
	case <-p.parent.unblock:
		return p.PodInterface.List(ctx, opts)
	case <-ctx.Done():
		p.parent.mu.Lock()
		p.parent.last = ctx.Err()
		p.parent.mu.Unlock()
		return nil, ctx.Err()
	}
}

func (p *blockingPods) observedErr() error {
	p.parent.mu.Lock()
	defer p.parent.mu.Unlock()
	return p.parent.last
}

func newSummaryTestHandlerWithClient(t *testing.T, clusterID string, client *k8s.Client) (*Handler, *mux.Router) {
	t.Helper()
	cluster := &models.Cluster{ID: clusterID, Name: clusterID, Context: clusterID, Status: "connected"}
	mockSvc := &mockClusterService{
		clusterMap: map[string]*models.Cluster{clusterID: cluster},
		clusters:   []*models.Cluster{cluster},
		clientMap:  map[string]*k8s.Client{clusterID: client},
	}
	h := NewHandler(mockSvc, nil, nil, nil, &mockEventsService{}, nil, nil, nil, nil, nil, nil, nil)
	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)
	return h, router
}

func doSummaryRequest(router *mux.Router, clusterID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/summary", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

type summaryEnvelope struct {
	Data         *models.ClusterSummary `json:"data"`
	Reachable    bool                   `json:"reachable"`
	Stale        bool                   `json:"stale"`
	HealthStatus string                 `json:"health_status"`
}

// Test: one hung resource-type List call must not hang the entire summary
// indefinitely, must actually observe a real (not simulated) context
// cancellation, and must not corrupt the other 25 resource types' data —
// it degrades to a partial result (failedListCalls -> HealthReason), the
// EXISTING partial-result contract, not a new one.
func TestBuildClusterSummary_OneHungResourceTypeIsBoundedAndDoesNotCorruptOthers(t *testing.T) {
	old := clusterSummaryTimeout
	clusterSummaryTimeout = 300 * time.Millisecond
	defer func() { clusterSummaryTimeout = old }()

	clusterID := uuid.New().String()
	inner := k8sfake.NewSimpleClientset(
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "n1"}},
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "ns1"}},
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "svc1", Namespace: "ns1"}},
	)
	blocking := newBlockingPodsClientset(inner)
	client := k8s.NewClientForTest(blocking)

	_, router := newSummaryTestHandlerWithClient(t, clusterID, client)

	start := time.Now()
	rec := doSummaryRequest(router, clusterID)
	elapsed := time.Since(start)

	if elapsed > 2*time.Second {
		t.Fatalf("summary request took %v, expected close to clusterSummaryTimeout (%v) — one hung resource type blocked the whole summary", elapsed, clusterSummaryTimeout)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (partial-result degrade, not a hard failure), got %d: %s", rec.Code, rec.Body.String())
	}

	var env summaryEnvelope
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !env.Reachable {
		t.Fatalf("expected Reachable=true (nodes/namespaces succeeded; only pods hung) — got %+v", env)
	}
	if env.Data == nil {
		t.Fatal("expected a data payload even with one hung resource type")
	}
	if env.Data.NodeCount != 1 {
		t.Errorf("NodeCount = %d, want 1 (must not be corrupted by the hung pods call)", env.Data.NodeCount)
	}
	if env.Data.ServiceCount != 1 {
		t.Errorf("ServiceCount = %d, want 1 (a DIFFERENT concurrent call must not be affected by the hung pods call)", env.Data.ServiceCount)
	}
	if env.Data.PodCount != 0 {
		t.Errorf("PodCount = %d, want 0 (the hung call never produced data)", env.Data.PodCount)
	}
	if env.Data.HealthReason == "" {
		t.Error("expected HealthReason to note the failed pods list call (existing partial-result contract)")
	}

	// The blocked call must have observed a REAL context cancellation, not
	// merely returned because the test ended.
	pods, _ := blocking.CoreV1().Pods("").(*blockingPods)
	if err := pods.observedErr(); err != context.DeadlineExceeded {
		t.Fatalf("expected the blocked List call's observed ctx error to be context.DeadlineExceeded, got %v", err)
	}
}

// Test: concurrent summary requests against the SAME permanently-hanging
// cluster must not amplify unboundedly — each request is independently
// bounded by clusterSummaryTimeout, and goroutines must return to baseline
// once all requests complete (no permanent accumulation).
func TestBuildClusterSummary_ConcurrentRequestsAgainstHungClusterDoNotAmplify(t *testing.T) {
	old := clusterSummaryTimeout
	clusterSummaryTimeout = 300 * time.Millisecond
	defer func() { clusterSummaryTimeout = old }()

	clusterID := uuid.New().String()
	blocking := newBlockingPodsClientset(k8sfake.NewSimpleClientset())
	client := k8s.NewClientForTest(blocking)
	_, router := newSummaryTestHandlerWithClient(t, clusterID, client)

	runtime.GC()
	baseline := runtime.NumGoroutine()

	const concurrent = 15
	var wg sync.WaitGroup
	codes := make([]int, concurrent)
	start := time.Now()
	for i := 0; i < concurrent; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			codes[idx] = doSummaryRequest(router, clusterID).Code
		}(i)
	}
	wg.Wait()
	elapsed := time.Since(start)

	if elapsed > 2*time.Second {
		t.Fatalf("%d concurrent summary requests against a hung cluster took %v — expected close to one clusterSummaryTimeout (%v), not serialized/amplified", concurrent, elapsed, clusterSummaryTimeout)
	}
	for i, code := range codes {
		if code != http.StatusOK {
			t.Errorf("request %d: status = %d, want 200", i, code)
		}
	}

	time.Sleep(50 * time.Millisecond)
	runtime.GC()
	after := runtime.NumGoroutine()
	if after > baseline+20 { // generous slack for test/runtime scheduling noise
		t.Fatalf("goroutines before=%d after=%d (delta=%d) — possible leak from concurrent hung-cluster summary requests", baseline, after, after-baseline)
	}
}
