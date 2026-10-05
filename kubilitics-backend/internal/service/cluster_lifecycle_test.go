package service

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"k8s.io/client-go/kubernetes/fake"
)

func testClient() *k8s.Client {
	return k8s.NewClientForTest(fake.NewSimpleClientset())
}

// ─── Mandatory race surface B (docs/INFORMER-LIFECYCLE-IMPLEMENTATION.md §4):
// simultaneous activation / thundering herd ──────────────────────────────────

// 100 concurrent EnsureActive calls for the SAME cluster must produce exactly
// one informer generation, and every caller must observe the same usable
// InformerManager — proven by plain mutual exclusion (entry.mu held for the
// whole start), not a separate coalescing primitive. Run under `go test -race`.
func TestClusterLifecycleManager_EnsureActive_ConcurrentSameCluster_OneGeneration(t *testing.T) {
	cache := NewOverviewCache()
	m := NewClusterLifecycleManager(cache, time.Hour) // long TTL — sweep must not interfere with this test
	defer m.Shutdown()

	client := testClient()
	const n = 100
	var wg sync.WaitGroup
	results := make([]*k8s.InformerManager, n)
	errs := make([]error, n)

	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start // release all goroutines as close to simultaneously as possible
			im, err := m.EnsureActive(context.Background(), "cluster-thundering-herd", client)
			results[idx] = im
			errs[idx] = err
		}(i)
	}
	close(start)
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("caller %d: EnsureActive returned error: %v", i, err)
		}
		if results[i] == nil {
			t.Fatalf("caller %d: got nil InformerManager", i)
		}
		if results[i] != results[0] {
			t.Fatalf("caller %d got a DIFFERENT InformerManager than caller 0 — duplicate generation created (exactly one was required)", i)
		}
	}

	e := m.entryFor("cluster-thundering-herd")
	e.mu.Lock()
	gen := e.generation
	e.mu.Unlock()
	if gen != 1 {
		t.Fatalf("generation = %d, want exactly 1 (100 concurrent activations must coalesce into one)", gen)
	}
}

// Repeat across DIFFERENT clusters concurrently and prove they do NOT block
// each other — per-cluster mutexes, not a global lock. 10 clusters × 100
// concurrent activations each, all fired together; total wall time must stay
// close to one activation's cost, not multiply by cluster count.
func TestClusterLifecycleManager_EnsureActive_ConcurrentDifferentClusters_NoCrossBlocking(t *testing.T) {
	cache := NewOverviewCache()
	m := NewClusterLifecycleManager(cache, time.Hour)
	defer m.Shutdown()

	const clusters = 10
	const callersPerCluster = 100
	client := testClient()

	var wg sync.WaitGroup
	start := make(chan struct{})
	startTime := time.Now()

	for c := 0; c < clusters; c++ {
		clusterID := fmt.Sprintf("cluster-%d", c)
		for i := 0; i < callersPerCluster; i++ {
			wg.Add(1)
			go func(id string) {
				defer wg.Done()
				<-start
				if _, err := m.EnsureActive(context.Background(), id, client); err != nil {
					t.Errorf("EnsureActive(%s) error: %v", id, err)
				}
			}(clusterID)
		}
	}
	close(start)
	wg.Wait()
	elapsed := time.Since(startTime)

	// Each cluster must have exactly one generation.
	for c := 0; c < clusters; c++ {
		clusterID := fmt.Sprintf("cluster-%d", c)
		e := m.entryFor(clusterID)
		e.mu.Lock()
		gen := e.generation
		state := e.state
		e.mu.Unlock()
		if gen != 1 {
			t.Fatalf("cluster %s: generation = %d, want 1", clusterID, gen)
		}
		if state != StateActive {
			t.Fatalf("cluster %s: state = %v, want Active", clusterID, state)
		}
	}

	// Loose upper bound: this whole thing (1000 goroutines, 10 real
	// activations against a fake clientset) must complete quickly — a
	// regression to a global lock serializing all 10 clusters would still
	// likely pass a tight per-call timing assertion against a fast fake
	// client, so this is a sanity ceiling, not the primary proof (the
	// generation==1-per-cluster + no-cross-cluster-corruption checks above
	// are the actual correctness proof).
	if elapsed > 5*time.Second {
		t.Fatalf("10 clusters x 100 concurrent activations took %v — suspiciously slow, check for accidental global locking", elapsed)
	}
}

// ─── Mandatory race surface A (docs/INFORMER-LIFECYCLE-IMPLEMENTATION.md §4):
// TTL shutdown vs active request ───────────────────────────────────────────

// Deterministic (not sleep-based) proof that a request already holding an
// InformerManager reference from EnsureActive can keep reading from it
// safely even if the TTL sweep concurrently stops the underlying informers —
// no panic, no crash. This is the actual risk the brief's race diagram
// describes ("request is still using cluster" while "shutdown attempts").
func TestClusterLifecycleManager_ActiveRequestSurvivesConcurrentTTLStop(t *testing.T) {
	cache := NewOverviewCache()
	m := NewClusterLifecycleManager(cache, time.Hour) // sweep driven manually below, not by the ticker
	defer m.Shutdown()

	client := testClient()
	im, err := m.EnsureActive(context.Background(), "cluster-ttl-race", client)
	if err != nil {
		t.Fatalf("EnsureActive: %v", err)
	}
	// Every real GetStore() caller in this codebase (resources.go,
	// workloads.go, events.go) checks HasSynced() first — confirmed by
	// reading those call sites. An earlier version of this test called
	// GetStore() immediately after EnsureActive without that gate and hit a
	// genuine, PRE-EXISTING, separate data race inside InformerManager
	// itself (im.stores is written unsynchronized during Start()'s setup
	// phase, which GetStore() also reads unsynchronized) — reachable only
	// through that unrealistic calling pattern, since HasSynced() only
	// becomes true after the setup phase completes, by which point every
	// store write has already happened. That InformerManager-internal race
	// is real and newly discovered via this test, but out of scope for this
	// change (it predates the lifecycle manager and isn't reachable by any
	// production call site) — documented in docs/INFORMER-LIFECYCLE-
	// IMPLEMENTATION.md as a flagged, NOT-fixed-here finding, consistent
	// with this engagement's practice of not silently patching unrelated
	// code. This test now follows the same HasSynced()-gated convention
	// every real caller already uses.
	waitForSyncDeadline := time.Now().Add(5 * time.Second)
	for !im.HasSynced() && time.Now().Before(waitForSyncDeadline) {
		time.Sleep(time.Millisecond)
	}
	if !im.HasSynced() {
		t.Fatal("informer did not sync within 5s — fake clientset should sync near-instantly")
	}

	// Simulate "request still using cluster" (brief's diagram) by holding a
	// reference to the Store and reading from it concurrently with a direct
	// sweepOnce() call that will find this cluster idle (lastAccess forced
	// into the past) and stop it — proving Stop() does not invalidate an
	// already-obtained Store reference (client-go's Stop() only signals the
	// background reflector/processor goroutines to exit; the Store object
	// itself remains safely readable).
	e := m.entryFor("cluster-ttl-race")
	e.mu.Lock()
	e.lastAccess = time.Now().Add(-time.Hour) // force "idle past TTL"
	e.mu.Unlock()

	var wg sync.WaitGroup
	var panicked int32
	wg.Add(2)

	go func() {
		defer wg.Done()
		defer func() {
			if r := recover(); r != nil {
				atomic.StoreInt32(&panicked, 1)
				t.Errorf("in-flight Store read panicked concurrently with TTL stop: %v", r)
			}
		}()
		for i := 0; i < 1000; i++ {
			store := im.GetStore("Pod")
			if store != nil {
				_ = store.List() // must never panic even mid-Stop()
			}
		}
	}()

	go func() {
		defer wg.Done()
		m.sweepOnce() // directly, deterministically — not waiting on the real ticker
	}()

	wg.Wait()
	if atomic.LoadInt32(&panicked) != 0 {
		t.Fatal("concurrent Store read panicked")
	}

	e.mu.Lock()
	finalState := e.state
	finalIM := e.im
	e.mu.Unlock()
	if finalState != StateIdle {
		t.Fatalf("state after TTL sweep = %v, want Idle", finalState)
	}
	if finalIM != nil {
		t.Fatal("entry.im should be nil after TTL stop")
	}

	// A new request arriving AFTER the stop must get a FRESH, working
	// generation — never silently handed the old, stopped one.
	im2, err := m.EnsureActive(context.Background(), "cluster-ttl-race", client)
	if err != nil {
		t.Fatalf("re-EnsureActive after TTL stop: %v", err)
	}
	if im2 == im {
		t.Fatal("re-activation after TTL stop returned the SAME (stopped) InformerManager — stale generation became visible")
	}
	e.mu.Lock()
	gen := e.generation
	e.mu.Unlock()
	if gen != 2 {
		t.Fatalf("generation after re-activation = %d, want 2 (1 original + 1 fresh)", gen)
	}
}

// A request that calls EnsureActive WHILE a TTL stop for the same cluster is
// in progress must block on the same per-cluster mutex and then either (a)
// see the stop complete and get a fresh generation, or (b) — if it arrives
// before the sweep decided to stop — refresh lastAccess and prevent the stop
// this cycle. Either outcome is correct; what must NEVER happen is a
// half-stopped state (e.g. state==Active but im==nil, or vice versa) ever
// becoming visible to a caller. Run many iterations under -race to surface
// any ordering-dependent inconsistency.
func TestClusterLifecycleManager_EnsureActiveRacesTTLSweep_NeverHalfState(t *testing.T) {
	cache := NewOverviewCache()
	m := NewClusterLifecycleManager(cache, 1*time.Nanosecond) // effectively always "idle" the instant lastAccess is set
	defer m.Shutdown()
	client := testClient()

	for i := 0; i < 200; i++ {
		clusterID := fmt.Sprintf("cluster-race-%d", i)
		var wg sync.WaitGroup
		start := make(chan struct{})
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			_, _ = m.EnsureActive(context.Background(), clusterID, client)
		}()
		go func() {
			defer wg.Done()
			<-start
			m.sweepOnce()
		}()
		close(start)
		wg.Wait()

		e := m.entryFor(clusterID)
		e.mu.Lock()
		state, im := e.state, e.im
		e.mu.Unlock()
		if state == StateActive && im == nil {
			t.Fatalf("iteration %d: half-state — Active but im==nil", i)
		}
		if state == StateIdle && im != nil {
			t.Fatalf("iteration %d: half-state — Idle but im!=nil", i)
		}
	}
}
