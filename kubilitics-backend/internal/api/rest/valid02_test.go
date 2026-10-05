package rest

// VALID-02 (docs/VALID-02-INVESTIGATION.md): regression suite proving
// resolveClusterID no longer performs its own reconnect attempt ahead of
// getClientFromRequest's single reconnect authority (GetOrReconnectClient).
// Before the fix, an unreachable stored cluster paid for two sequential
// reconnect attempts (~30s + ~33s, live-reproduced as ~63s total). After the
// fix, resolveClusterID is a pure, non-reconnecting lookup and only one
// reconnect attempt (GetOrReconnectClient's, architecturally ~3s-bounded)
// occurs on the request path.

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/hashicorp/golang-lru/v2/expirable"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"k8s.io/client-go/kubernetes/fake"
)

type valid02CountingFactory struct {
	mu    sync.Mutex
	calls int
	delay time.Duration
	fail  bool
}

func (f *valid02CountingFactory) build(_ string, _ string) (*k8s.Client, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	if f.fail {
		return nil, fmt.Errorf("simulated unreachable cluster")
	}
	return k8s.NewClientForTest(fake.NewSimpleClientset()), nil
}

func (f *valid02CountingFactory) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// newVALID02UnreachableCluster uses Source:"in-cluster" deliberately —
// ReconnectCluster's "kubeconfig" source path calls k8s.NewClient directly,
// bypassing the injectable clientFactory; only the in-cluster path routes
// through buildClientForCluster/clientFactory, which this suite needs to
// observe and count reconnect attempts.
func newVALID02UnreachableCluster(id string) *models.Cluster {
	return &models.Cluster{
		ID:      id,
		Name:    id,
		Context: id,
		Source:  "in-cluster",
		Status:  "disconnected",
	}
}

func newVALID02HealthyCluster(id string) *models.Cluster {
	return &models.Cluster{
		ID:      id,
		Name:    id,
		Context: id,
		Source:  "in-cluster",
		Status:  "connected",
	}
}

// valid02SelectiveFactory fails (slowly) only for a specific context name,
// succeeding immediately for everything else — lets a test seed one healthy
// cluster while another cluster remains genuinely unreachable.
type valid02SelectiveFactory struct {
	failContext string
	delay       time.Duration
}

func (f *valid02SelectiveFactory) build(_ string, contextName string) (*k8s.Client, error) {
	if contextName == f.failContext {
		if f.delay > 0 {
			time.Sleep(f.delay)
		}
		return nil, fmt.Errorf("simulated unreachable cluster: %s", contextName)
	}
	return k8s.NewClientForTest(fake.NewSimpleClientset()), nil
}

func newVALID02Handler(repo *mockClusterRepo, factory *valid02CountingFactory) (*Handler, service.ClusterService) {
	cfg := &config.Config{K8sTimeoutSec: 30}
	cs := service.NewClusterServiceWithClientFactory(repo, cfg, factory.build)
	return &Handler{
		cfg:            cfg,
		clusterService: cs,
		k8sClientCache: expirable.NewLRU[string, *k8s.Client](100, nil, time.Minute*10),
	}, cs
}

// Test 1: resolveClusterID for an unreachable stored cluster must not block
// on a reconnect attempt. Pre-fix, this called GetCluster -> tryReconnectCluster
// (bounded only by the 30s client timeout). Post-fix, it is a pure ListClusters
// lookup and must return in milliseconds regardless of the cluster's reachability.
func TestVALID02_ResolveClusterID_DoesNotReconnect(t *testing.T) {
	const clusterID = "valid02-unreachable-1"
	repo := &mockClusterRepo{
		list: []*models.Cluster{newVALID02UnreachableCluster(clusterID)},
		get:  map[string]*models.Cluster{clusterID: newVALID02UnreachableCluster(clusterID)},
	}
	factory := &valid02CountingFactory{fail: true, delay: 2 * time.Second}
	h, _ := newVALID02Handler(repo, factory)

	start := time.Now()
	resolvedID, err := h.resolveClusterID(context.Background(), clusterID)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("resolveClusterID returned error: %v", err)
	}
	if resolvedID != clusterID {
		t.Fatalf("resolvedID = %q, want %q", resolvedID, clusterID)
	}
	if elapsed > 500*time.Millisecond {
		t.Fatalf("resolveClusterID took %s — expected a fast, non-reconnecting lookup (regression: resolveClusterID is blocking on reconnect again)", elapsed)
	}
}

// Test 2: the full GetClusterSummary request path (resolveClusterID +
// getClientFromRequest) must not perform two sequential reconnect attempts
// against the same unreachable cluster. Pre-fix this measured ~63s
// (30s + 33s, live-reproduced); post-fix only getClientFromRequest's single
// GetOrReconnectClient attempt should run.
func TestVALID02_Summary_DoesNotDuplicateReconnect(t *testing.T) {
	const clusterID = "valid02-unreachable-2"
	repo := &mockClusterRepo{
		list: []*models.Cluster{newVALID02UnreachableCluster(clusterID)},
		get:  map[string]*models.Cluster{clusterID: newVALID02UnreachableCluster(clusterID)},
	}
	// 300ms delay: clearly distinguishes "one reconnect attempt" (~300ms+overhead)
	// from "two sequential attempts" (~600ms+) without slowing the suite down.
	factory := &valid02CountingFactory{fail: true, delay: 300 * time.Millisecond}
	h, _ := newVALID02Handler(repo, factory)

	r := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/summary", nil)
	r = mux.SetURLVars(r, map[string]string{"clusterId": clusterID})

	start := time.Now()
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		t.Fatalf("resolveClusterID: %v", err)
	}
	r = mux.SetURLVars(r, map[string]string{"clusterId": resolvedID})
	_, clientErr := h.getClientFromRequest(r.Context(), r, resolvedID, h.cfg)
	elapsed := time.Since(start)

	if clientErr == nil {
		t.Fatalf("expected getClientFromRequest to fail for an unreachable cluster")
	}
	// One reconnect attempt ~300ms. Two sequential attempts (the VALID-02
	// regression) would be ~600ms+. 450ms gives headroom for scheduling
	// noise while still clearly rejecting the duplicate-reconnect pattern.
	if elapsed > 450*time.Millisecond {
		t.Fatalf("summary path took %s — expected ~1 reconnect attempt (~300ms), not a duplicated sequential reconnect (regression: VALID-02 reintroduced)", elapsed)
	}
}

// Test 3: a reachable stored cluster's resolution and summary-path behavior
// is unchanged by the fix.
func TestVALID02_ResolveClusterID_HealthyClusterUnaffected(t *testing.T) {
	const clusterID = "valid02-healthy-1"
	repo := &mockClusterRepo{
		list: []*models.Cluster{newVALID02HealthyCluster(clusterID)},
		get:  map[string]*models.Cluster{clusterID: newVALID02HealthyCluster(clusterID)},
	}
	factory := &valid02CountingFactory{fail: false}
	h, cs := newVALID02Handler(repo, factory)

	// Give the cluster a live client, matching "already connected" reality.
	if _, err := cs.GetOrReconnectClient(context.Background(), clusterID); err != nil {
		t.Fatalf("seeding live client: %v", err)
	}

	start := time.Now()
	resolvedID, err := h.resolveClusterID(context.Background(), clusterID)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("resolveClusterID: %v", err)
	}
	if resolvedID != clusterID {
		t.Fatalf("resolvedID = %q, want %q", resolvedID, clusterID)
	}
	if elapsed > 100*time.Millisecond {
		t.Fatalf("resolveClusterID for a healthy cluster took %s — should be near-instant (memory-cache hit)", elapsed)
	}
}

// Test 4: the request-supplied-kubeconfig (Headlamp-style) path through
// getClientFromRequest is untouched by this fix — resolveClusterID's change
// only affects the stored-cluster fallback branch.
func TestVALID02_GetClientFromRequest_RequestSuppliedKubeconfigUnaffected(t *testing.T) {
	repo := &mockClusterRepo{}
	factory := &valid02CountingFactory{}
	h, _ := newVALID02Handler(repo, factory)

	kubeconfig := `
apiVersion: v1
kind: Config
current-context: demo-ctx
contexts:
- name: demo-ctx
  context:
    cluster: demo
    user: demo-user
clusters:
- name: demo
  cluster:
    server: https://127.0.0.1:6443
users:
- name: demo-user
  user:
    token: fake
`
	r := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/demo-ctx/summary", nil)
	r.Header.Set("X-Kubeconfig", base64.StdEncoding.EncodeToString([]byte(kubeconfig)))
	r.Header.Set("X-Kubeconfig-Context", "demo-ctx")
	r = mux.SetURLVars(r, map[string]string{"clusterId": "demo-ctx"})

	client, err := h.getClientFromRequest(r.Context(), r, "demo-ctx", h.cfg)
	if err != nil {
		t.Fatalf("getClientFromRequest with request-supplied kubeconfig: %v", err)
	}
	if client == nil {
		t.Fatal("expected a non-nil client from request-supplied kubeconfig")
	}
	// Must never touch the stored-cluster reconnect path for this branch.
	if factory.count() != 0 {
		t.Fatalf("request-supplied kubeconfig path unexpectedly used the stored-cluster clientFactory (count=%d)", factory.count())
	}
}

// Test 5: one unreachable cluster's summary request must not serialize
// behind a healthy cluster's summary or a Fleet-style ListClusters call.
func TestVALID02_ConcurrentClusterIsolation(t *testing.T) {
	const unreachableID = "valid02-unreachable-3"
	const healthyID = "valid02-healthy-2"
	repo := &mockClusterRepo{
		list: []*models.Cluster{
			newVALID02UnreachableCluster(unreachableID),
			newVALID02HealthyCluster(healthyID),
		},
		get: map[string]*models.Cluster{
			unreachableID: newVALID02UnreachableCluster(unreachableID),
			healthyID:     newVALID02HealthyCluster(healthyID),
		},
	}
	factory := &valid02SelectiveFactory{failContext: unreachableID, delay: 1 * time.Second}
	cfg := &config.Config{K8sTimeoutSec: 30}
	cs := service.NewClusterServiceWithClientFactory(repo, cfg, factory.build)
	h := &Handler{cfg: cfg, clusterService: cs, k8sClientCache: expirable.NewLRU[string, *k8s.Client](100, nil, time.Minute*10)}
	if _, err := cs.GetOrReconnectClient(context.Background(), healthyID); err != nil {
		t.Fatalf("seeding healthy client: %v", err)
	}

	var wg sync.WaitGroup
	results := make(map[string]time.Duration)
	var mu sync.Mutex
	run := func(name string, fn func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			start := time.Now()
			fn()
			mu.Lock()
			results[name] = time.Since(start)
			mu.Unlock()
		}()
	}

	run("unreachable-resolve", func() {
		_, _ = h.resolveClusterID(context.Background(), unreachableID)
	})
	run("healthy-resolve", func() {
		_, _ = h.resolveClusterID(context.Background(), healthyID)
	})
	run("list-clusters", func() {
		_, _ = cs.ListClusters(context.Background())
	})
	wg.Wait()

	for _, name := range []string{"healthy-resolve", "list-clusters"} {
		if results[name] > 300*time.Millisecond {
			t.Fatalf("%s took %s while an unreachable cluster was resolving — expected isolation, not serialization", name, results[name])
		}
	}
}

// Test 6: context cancellation propagates through getClientFromRequest's
// fallback into GetOrReconnectClient, without any context.Background()
// substitution on the request-scoped path. Uses a real, unroutable address
// (not the injectable factory, which has no context parameter and so cannot
// observe cancellation by construction) so the underlying client.TestConnection
// call genuinely has something to be cancelled out of — the same technique
// used in the VALID-02 forensic investigation.
func TestVALID02_GetClientFromRequest_CancellationPropagates(t *testing.T) {
	const clusterID = "valid02-unreachable-cancel"
	kubeconfig := `
apiVersion: v1
kind: Config
current-context: valid02-cancel-ctx
contexts:
- name: valid02-cancel-ctx
  context:
    cluster: valid02-cancel-cluster
    user: valid02-cancel-user
clusters:
- name: valid02-cancel-cluster
  cluster:
    server: https://10.255.255.1:6443
users:
- name: valid02-cancel-user
  user:
    token: fake
`
	tmpFile := filepath.Join(t.TempDir(), "kubeconfig.yaml")
	if err := os.WriteFile(tmpFile, []byte(kubeconfig), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	cluster := &models.Cluster{
		ID:             clusterID,
		Name:           clusterID,
		Context:        "valid02-cancel-ctx",
		KubeconfigPath: tmpFile,
		Source:         "kubeconfig",
		Status:         "disconnected",
	}
	repo := &mockClusterRepo{
		list: []*models.Cluster{cluster},
		get:  map[string]*models.Cluster{clusterID: cluster},
	}
	cfg := &config.Config{K8sTimeoutSec: 30}
	cs := service.NewClusterService(repo, cfg)
	h := &Handler{cfg: cfg, clusterService: cs, k8sClientCache: expirable.NewLRU[string, *k8s.Client](100, nil, time.Minute*10)}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	r := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/summary", nil)
	r = r.WithContext(ctx)
	r = mux.SetURLVars(r, map[string]string{"clusterId": clusterID})

	start := time.Now()
	_, err := h.getClientFromRequest(ctx, r, clusterID, h.cfg)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected an error once the request context was cancelled")
	}
	// GetOrReconnectClient's own reconnectTimeout bound is 3s; a context
	// cancelled at 50ms must cut that short, not run the full 3s.
	if elapsed > 2*time.Second {
		t.Fatalf("getClientFromRequest took %s after context cancellation at 50ms — cancellation did not propagate (regression: context.Background() substitution)", elapsed)
	}
}
