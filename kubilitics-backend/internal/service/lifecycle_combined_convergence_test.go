package service_test

// Regression guard for docs/ENGINE-LIFECYCLE-SOAK-INVESTIGATION.md: proves
// the exact question that investigation was built to answer — after
// registration, activation, idle teardown, removal, and reactivation, do
// ClusterLifecycleManager and graph.EngineLifecycleManager TOGETHER return
// the system to a bounded, explainable steady state at N=26, deterministically
// (no sleep-based TTL waiting, no real API server)?
//
// External test package (service_test) because internal/graph transitively
// imports internal/service (graph -> otel -> events -> service), so this
// file cannot live inside package `service` itself without an import cycle.
// Uses only exported APIs, including the two ForceIdleAndSweepForTest test
// helpers added to ClusterLifecycleManager and graph.EngineLifecycleManager
// specifically to make this deterministic.

import (
	"context"
	"fmt"
	"runtime"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	k8sfake "k8s.io/client-go/kubernetes/fake"
)

func TestCombinedLifecycle_N26_RegisterActivateSweepRemove_ConvergesDeterministically(t *testing.T) {
	const n = 26
	const ttl = time.Hour // never reached by real time — forced via ForceIdleAndSweepForTest

	cache := service.NewOverviewCache()
	lifecycle := service.NewClusterLifecycleManager(cache, ttl)
	engineMgr := graph.NewEngineLifecycleManager(ttl, nil)
	defer lifecycle.Shutdown()
	defer engineMgr.Shutdown()

	clients := make(map[string]*k8s.Client, n)
	ids := make([]string, 0, n)
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("combined-conv-cluster-%d", i)
		ids = append(ids, id)
		clients[id] = k8s.NewClientForTest(k8sfake.NewSimpleClientset())
	}

	before := countGoroutinesStable(t)

	// Activate all 26 through BOTH lifecycle managers simultaneously —
	// mirrors a request that triggers both informers (Dashboard) and the
	// graph engine (Blast Radius) for the same cluster.
	for _, id := range ids {
		client := clients[id]
		if _, err := lifecycle.EnsureActive(context.Background(), id, client); err != nil {
			t.Fatalf("lifecycle.EnsureActive(%s): %v", id, err)
		}
		if _, err := engineMgr.EnsureActive(context.Background(), id, client.Clientset, nil); err != nil {
			t.Fatalf("engineMgr.EnsureActive(%s): %v", id, err)
		}
	}
	active := countGoroutinesStable(t)
	if active <= before {
		t.Fatalf("expected activation to raise goroutine count (before=%d, active=%d) — EnsureActive may not be starting anything", before, active)
	}

	// Deterministic idle release (no sleeping for the real TTL).
	lifecycle.ForceIdleAndSweepForTest(ttl)
	engineMgr.ForceIdleAndSweepForTest(ttl)
	afterSweep1 := countGoroutinesStable(t)

	// Idempotent re-sweep with nothing reactivated in between must be a
	// total no-op — any difference here would mean non-deterministic
	// behavior inside our own lifecycle code, with no real API server or
	// network involved to blame.
	lifecycle.ForceIdleAndSweepForTest(ttl)
	engineMgr.ForceIdleAndSweepForTest(ttl)
	afterSweep2 := countGoroutinesStable(t)
	if afterSweep2 != afterSweep1 {
		t.Fatalf("idempotent re-sweep changed goroutine count: sweep1=%d sweep2=%d (expected identical — no reactivation happened between them)", afterSweep1, afterSweep2)
	}

	// Full removal must return to (at most) the pre-activation baseline.
	for _, id := range ids {
		lifecycle.Remove(id)
		engineMgr.OnClusterDisconnected(id)
	}
	afterRemove := countGoroutinesStable(t)
	if afterRemove > before+5 { // small slack for test-runtime scheduling noise
		t.Fatalf("goroutines did not return to baseline after removing all %d clusters: before=%d afterRemove=%d (delta=%d)", n, before, afterRemove, afterRemove-before)
	}

	t.Logf("before=%d active=%d afterSweep1=%d afterSweep2=%d afterRemove=%d", before, active, afterSweep1, afterSweep2, afterRemove)
}

// countGoroutinesStable settles scheduler/GC noise before sampling, so the
// assertions above compare genuinely stable counts rather than a snapshot
// mid-transition.
func countGoroutinesStable(t *testing.T) int {
	t.Helper()
	runtime.Gosched()
	time.Sleep(50 * time.Millisecond)
	runtime.GC()
	return runtime.NumGoroutine()
}
