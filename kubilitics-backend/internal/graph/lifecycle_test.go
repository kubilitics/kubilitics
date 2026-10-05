package graph

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	k8sfake "k8s.io/client-go/kubernetes/fake"
)

// ─── Verification pass (docs/INFORMER-LIFECYCLE-IMPLEMENTATION.md
// "Verification Pass" section): regression tests for the newly-added
// EngineLifecycleManager, which replaces main.go's former eager,
// unconditional ClusterGraphEngine startup (the P1 finding — ~169
// goroutines/cluster at boot regardless of use, plus an unsynchronized
// concurrent map read/write between that goroutine and rest.Handler's
// request path). Mirrors service.ClusterLifecycleManager's own test
// coverage since it reuses the identical correctness mechanism (one mutex
// per entry held for the whole start-or-stop operation). ──────────────────

// 100 concurrent EnsureActive calls for the SAME cluster must produce
// exactly one engine instance — proven by plain mutual exclusion, not a
// separate coalescing primitive. Run under `go test -race`.
func TestEngineLifecycleManager_EnsureActive_ConcurrentSameCluster_OneEngine(t *testing.T) {
	m := NewEngineLifecycleManager(time.Hour, nil) // long TTL — sweep must not interfere
	defer m.Shutdown()

	cs := k8sfake.NewSimpleClientset()
	const n = 100
	var wg sync.WaitGroup
	results := make([]*ClusterGraphEngine, n)
	errs := make([]error, n)

	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			e, err := m.EnsureActive(context.Background(), "cluster-thundering-herd", cs, nil)
			results[idx] = e
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
			t.Fatalf("caller %d: got nil engine", i)
		}
		if results[i] != results[0] {
			t.Fatalf("caller %d got a DIFFERENT engine than caller 0 — duplicate instance created (exactly one was required)", i)
		}
	}
}

// Different clusters must not block each other — per-cluster mutexes, not a
// global lock.
func TestEngineLifecycleManager_EnsureActive_ConcurrentDifferentClusters_NoCrossBlocking(t *testing.T) {
	m := NewEngineLifecycleManager(time.Hour, nil)
	defer m.Shutdown()

	const clusters = 10
	const callersPerCluster = 20
	cs := k8sfake.NewSimpleClientset()

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
				if _, err := m.EnsureActive(context.Background(), id, cs, nil); err != nil {
					t.Errorf("EnsureActive(%s) error: %v", id, err)
				}
			}(clusterID)
		}
	}
	close(start)
	wg.Wait()
	elapsed := time.Since(startTime)

	for c := 0; c < clusters; c++ {
		clusterID := fmt.Sprintf("cluster-%d", c)
		if m.Get(clusterID) == nil {
			t.Fatalf("cluster %s: expected an active engine", clusterID)
		}
	}
	if elapsed > 5*time.Second {
		t.Fatalf("10 clusters x 20 concurrent activations took %v — suspiciously slow, check for accidental global locking", elapsed)
	}
}

// The core fix this test guards: registering/knowing about a cluster must
// never create an engine. Only EnsureActive does.
func TestEngineLifecycleManager_GetDoesNotCreate(t *testing.T) {
	m := NewEngineLifecycleManager(time.Hour, nil)
	defer m.Shutdown()

	if e := m.Get("never-activated-cluster"); e != nil {
		t.Fatal("Get() created an engine — only EnsureActive must ever do that")
	}
}

// TTL sweep must release (Stop + nil out) an idle engine, and the next
// EnsureActive for that cluster must create a FRESH engine, not resurrect
// the old (stopped) one.
func TestEngineLifecycleManager_IdleSweepReleasesAndReactivationIsFresh(t *testing.T) {
	m := NewEngineLifecycleManager(time.Hour, nil) // sweep driven manually below
	defer m.Shutdown()

	cs := k8sfake.NewSimpleClientset()
	e1, err := m.EnsureActive(context.Background(), "cluster-ttl", cs, nil)
	if err != nil {
		t.Fatalf("EnsureActive: %v", err)
	}

	// Force "idle past TTL" and sweep.
	entry := m.entryFor("cluster-ttl")
	entry.mu.Lock()
	entry.lastAccess = time.Now().Add(-time.Hour)
	entry.mu.Unlock()
	m.sweepOnce()

	if m.Get("cluster-ttl") != nil {
		t.Fatal("expected no active engine immediately after idle-TTL sweep")
	}

	e2, err := m.EnsureActive(context.Background(), "cluster-ttl", cs, nil)
	if err != nil {
		t.Fatalf("re-EnsureActive after TTL stop: %v", err)
	}
	if e2 == e1 {
		t.Fatal("re-activation after TTL stop returned the SAME (stopped) engine — stale generation became visible")
	}
}

// A request holding an engine reference from EnsureActive must not panic if
// the TTL sweep concurrently stops it — client-go's Stop() only signals
// background goroutines to exit; the already-obtained reference stays safe
// to read from (Snapshot() is lock-free atomic.Value).
func TestEngineLifecycleManager_ActiveReadSurvivesConcurrentTTLStop(t *testing.T) {
	m := NewEngineLifecycleManager(time.Hour, nil)
	defer m.Shutdown()

	cs := k8sfake.NewSimpleClientset()
	e, err := m.EnsureActive(context.Background(), "cluster-ttl-race", cs, nil)
	if err != nil {
		t.Fatalf("EnsureActive: %v", err)
	}

	entry := m.entryFor("cluster-ttl-race")
	entry.mu.Lock()
	entry.lastAccess = time.Now().Add(-time.Hour)
	entry.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			_ = e.Snapshot()
			_ = e.Status()
		}
	}()
	go func() {
		defer wg.Done()
		m.sweepOnce()
	}()
	wg.Wait()
}

// OnClusterDisconnected (cluster removal) must stop the engine and
// permanently tombstone the entry so a racing EnsureActive (e.g. an
// in-flight Blast Radius request that started just before removal) can
// never resurrect it — same reasoning as
// service.ClusterLifecycleManager.Remove's tombstone-forever design.
func TestEngineLifecycleManager_OnClusterDisconnected_TombstonesPermanently(t *testing.T) {
	m := NewEngineLifecycleManager(time.Hour, nil)
	defer m.Shutdown()

	cs := k8sfake.NewSimpleClientset()
	if _, err := m.EnsureActive(context.Background(), "cluster-removed", cs, nil); err != nil {
		t.Fatalf("EnsureActive: %v", err)
	}

	m.OnClusterDisconnected("cluster-removed")

	if m.Get("cluster-removed") != nil {
		t.Fatal("expected no active engine after OnClusterDisconnected")
	}
	if _, err := m.EnsureActive(context.Background(), "cluster-removed", cs, nil); err == nil {
		t.Fatal("expected EnsureActive to refuse reactivating a removed (tombstoned) cluster")
	}
}

// OnClusterConnected (reconnect) must stop an engine still bound to the OLD
// client so the NEXT Blast Radius request lazily creates a fresh engine
// against the NEW client, rather than silently serving a stale graph from
// an abandoned connection forever (VALID-04's "old client -> old
// generation" hazard, now also closed for this second lifecycle).
func TestEngineLifecycleManager_OnClusterConnected_StopsStaleEngineWithoutEagerRestart(t *testing.T) {
	m := NewEngineLifecycleManager(time.Hour, nil)
	defer m.Shutdown()

	oldCS := k8sfake.NewSimpleClientset()
	oldEngine, err := m.EnsureActive(context.Background(), "cluster-reconnect", oldCS, nil)
	if err != nil {
		t.Fatalf("EnsureActive: %v", err)
	}

	if err := m.OnClusterConnected(nil, "cluster-reconnect"); err != nil {
		t.Fatalf("OnClusterConnected: %v", err)
	}

	// Must not eagerly restart — the P1 finding this whole manager exists to fix.
	if m.Get("cluster-reconnect") != nil {
		t.Fatal("OnClusterConnected must not eagerly reactivate an engine — only EnsureActive may")
	}

	newCS := k8sfake.NewSimpleClientset()
	newEngine, err := m.EnsureActive(context.Background(), "cluster-reconnect", newCS, nil)
	if err != nil {
		t.Fatalf("EnsureActive after reconnect: %v", err)
	}
	if newEngine == oldEngine {
		t.Fatal("expected a fresh engine bound to the new client, got the old (stale-client) one")
	}
}

// Concurrent EnsureActive and OnClusterDisconnected for the same cluster
// must never leave a half-state visible: either the engine is fully active
// (and not removed) or fully stopped-and-tombstoned, never "removed but an
// engine reference still set" or vice versa.
func TestEngineLifecycleManager_EnsureActiveRacesRemoval_NeverHalfState(t *testing.T) {
	m := NewEngineLifecycleManager(time.Hour, nil)
	defer m.Shutdown()
	cs := k8sfake.NewSimpleClientset()

	for i := 0; i < 200; i++ {
		clusterID := fmt.Sprintf("cluster-race-%d", i)
		var wg sync.WaitGroup
		start := make(chan struct{})
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			_, _ = m.EnsureActive(context.Background(), clusterID, cs, nil)
		}()
		go func() {
			defer wg.Done()
			<-start
			m.OnClusterDisconnected(clusterID)
		}()
		close(start)
		wg.Wait()

		e := m.entryFor(clusterID)
		e.mu.Lock()
		removed, engine := e.removed, e.engine
		e.mu.Unlock()
		if removed && engine != nil {
			t.Fatalf("iteration %d: half-state — removed but engine != nil", i)
		}
	}
}
