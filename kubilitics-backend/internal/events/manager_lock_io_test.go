package events

// P1 fix (docs/PIPELINEMANAGER-LOCK-IO-INVESTIGATION.md): StartCluster used
// to run DetectClusterSize (a live, unbounded Kubernetes List call) while
// holding m.mu, the single mutex shared by the ENTIRE PipelineManager. A
// slow/unreachable cluster at connect/reconnect time could therefore freeze
// StartCluster/StopCluster/Health for every OTHER registered cluster
// indefinitely — the same "one bad cluster poisons unrelated clusters"
// class of bug already fixed for ListClusters (VALID-01) and
// ClusterGraphEngine (BLASTRADIUS-3). These tests prove the fix: no K8s I/O
// happens under m.mu, a hang is bounded by clusterSizingTimeout, and
// concurrent operations (same-cluster and cross-cluster) stay race-free.

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	corev1client "k8s.io/client-go/kubernetes/typed/core/v1"
)

func newTestPipelineDB(t *testing.T) *sqlx.DB {
	t.Helper()
	db, err := sqlx.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open in-memory sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// blockingPodsClientset wraps a real fake Clientset so that
// CoreV1().Pods(ns).List blocks until the test closes `unblock`, OR the
// caller's context is cancelled — whichever comes first. This is
// deliberately NOT a k8stesting.PrependReactor: client-go v0.35.1's
// testing.Action interface has no way to observe the caller's context
// (confirmed by reading testing/actions.go), so a reactor-based block can
// never be used to prove real ctx-cancellation propagation. Overriding the
// typed PodInterface directly closes that gap.
type blockingPodsClientset struct {
	kubernetes.Interface
	unblock chan struct{}

	startedOnce sync.Once
	started     chan struct{} // closed once the first List call is actually blocking

	mu       sync.Mutex
	lastErr  error // ctx.Err() observed by the blocked List call, if any
	listCall int
}

func newBlockingPodsClientset(inner kubernetes.Interface) *blockingPodsClientset {
	return &blockingPodsClientset{
		Interface: inner,
		unblock:   make(chan struct{}),
		started:   make(chan struct{}),
	}
}

func (c *blockingPodsClientset) CoreV1() corev1client.CoreV1Interface {
	return &blockingCoreV1{CoreV1Interface: c.Interface.CoreV1(), parent: c}
}

type blockingCoreV1 struct {
	corev1client.CoreV1Interface
	parent *blockingPodsClientset
}

func (b *blockingCoreV1) Pods(namespace string) corev1client.PodInterface {
	return &blockingPods{PodInterface: b.CoreV1Interface.Pods(namespace), parent: b.parent}
}

type blockingPods struct {
	corev1client.PodInterface
	parent *blockingPodsClientset
}

func (p *blockingPods) List(ctx context.Context, opts metav1.ListOptions) (*corev1.PodList, error) {
	p.parent.mu.Lock()
	p.parent.listCall++
	p.parent.mu.Unlock()
	p.parent.startedOnce.Do(func() { close(p.parent.started) })

	select {
	case <-p.parent.unblock:
		return p.PodInterface.List(ctx, opts)
	case <-ctx.Done():
		p.parent.mu.Lock()
		p.parent.lastErr = ctx.Err()
		p.parent.mu.Unlock()
		return nil, ctx.Err()
	}
}

// Test 1 + Test 3 + Test 4 combined: while cluster A is blocked inside
// sizing, cluster B's StartCluster, an unrelated cluster's StopCluster, and
// a Health() read must all complete promptly — none may wait on A's lock
// hold, because A's sizing now happens entirely outside m.mu.
func TestStartCluster_SlowClusterDoesNotBlockOtherClusters(t *testing.T) {
	m := NewPipelineManager(newTestPipelineDB(t))
	defer m.StopAll()

	slow := newBlockingPodsClientset(k8sfake.NewSimpleClientset())
	fastA := k8sfake.NewSimpleClientset()

	// Pre-start an unrelated third cluster so StopCluster has something to
	// stop concurrently with A's blocked sizing (Test 3).
	if err := m.StartCluster(fastA, "cluster-pre-existing"); err != nil {
		t.Fatalf("pre-start cluster-pre-existing: %v", err)
	}

	slowDone := make(chan error, 1)
	go func() {
		slowDone <- m.StartCluster(slow, "cluster-slow")
	}()

	select {
	case <-slow.started:
	case <-time.After(5 * time.Second):
		t.Fatal("slow cluster's sizing List call never started")
	}

	// Test 1: a DIFFERENT cluster's StartCluster must complete promptly.
	fastDone := make(chan error, 1)
	go func() {
		fastDone <- m.StartCluster(k8sfake.NewSimpleClientset(), "cluster-fast")
	}()
	select {
	case err := <-fastDone:
		if err != nil {
			t.Fatalf("cluster-fast StartCluster failed: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cluster-fast's StartCluster was blocked by cluster-slow's sizing — regression")
	}

	// Test 3: StopCluster for the unrelated pre-existing cluster must also
	// complete promptly while A is still blocked.
	stopDone := make(chan struct{})
	go func() {
		m.StopCluster("cluster-pre-existing")
		close(stopDone)
	}()
	select {
	case <-stopDone:
	case <-time.After(3 * time.Second):
		t.Fatal("StopCluster(cluster-pre-existing) was blocked by cluster-slow's sizing — regression")
	}

	// Test 4: Health() (a read over all pipelines, taking m.mu.RLock) must
	// also complete promptly while A is still blocked.
	healthDone := make(chan *SystemHealth, 1)
	go func() {
		healthDone <- m.Health(context.Background())
	}()
	select {
	case sh := <-healthDone:
		if sh == nil {
			t.Fatal("expected non-nil SystemHealth")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Health() was blocked by cluster-slow's sizing — regression")
	}

	// Release cluster-slow and confirm it eventually completes (not leaked
	// forever) once its own sizing is allowed to finish.
	close(slow.unblock)
	select {
	case err := <-slowDone:
		if err != nil {
			t.Fatalf("cluster-slow StartCluster failed once unblocked: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cluster-slow's StartCluster never completed after unblocking")
	}
}

// Test 2 + Test 6: a sizing call that never gets unblocked must still cause
// StartCluster to return within clusterSizingTimeout (not hang forever),
// and the context observed by the blocked List call must actually be
// cancelled with context.DeadlineExceeded — proving real propagation, not
// just an incidental return.
func TestStartCluster_SizingTimeoutIsEnforcedAndPropagatesCancellation(t *testing.T) {
	old := clusterSizingTimeout
	clusterSizingTimeout = 200 * time.Millisecond
	defer func() { clusterSizingTimeout = old }()

	m := NewPipelineManager(newTestPipelineDB(t))
	defer m.StopAll()

	// Never closed — the List call can only return via ctx cancellation.
	slow := newBlockingPodsClientset(k8sfake.NewSimpleClientset())

	start := time.Now()
	errCh := make(chan error, 1)
	go func() { errCh <- m.StartCluster(slow, "cluster-never-unblocked") }()

	select {
	case err := <-errCh:
		elapsed := time.Since(start)
		if elapsed > 2*time.Second {
			t.Fatalf("StartCluster took %v to return, expected close to clusterSizingTimeout (%v) — timeout not enforced", elapsed, clusterSizingTimeout)
		}
		// A timed-out sizing attempt must degrade safely (DetectClusterSize's
		// existing "any List error -> default to small" path), not fail the
		// whole StartCluster call — no new fallback behavior was invented.
		if err != nil {
			t.Fatalf("expected StartCluster to succeed with default tuning despite the sizing timeout, got: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("StartCluster never returned — sizing timeout was not enforced, goroutine is blocked indefinitely")
	}

	slow.mu.Lock()
	lastErr := slow.lastErr
	slow.mu.Unlock()
	if lastErr != context.DeadlineExceeded {
		t.Fatalf("expected the List call's observed ctx error to be context.DeadlineExceeded, got %v — cancellation did not actually propagate to the Kubernetes client call", lastErr)
	}

	// PipelineManager must remain fully usable afterward (no corrupted
	// state, no leaked lock).
	if err := m.StartCluster(k8sfake.NewSimpleClientset(), "cluster-after-timeout"); err != nil {
		t.Fatalf("PipelineManager unusable after a sizing timeout: %v", err)
	}
}

// Test 5: a healthy fake client must produce the same tuning/pipeline
// behavior as before this fix — the refactor must not change outcomes for
// the common case, only the concurrency/timeout characteristics.
func TestStartCluster_HealthyClusterBehaviorUnchanged(t *testing.T) {
	m := NewPipelineManager(newTestPipelineDB(t))
	defer m.StopAll()

	cs := k8sfake.NewSimpleClientset(
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "p1", Namespace: "default"}},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "p2", Namespace: "default"}},
	)
	if err := m.StartCluster(cs, "cluster-healthy"); err != nil {
		t.Fatalf("StartCluster: %v", err)
	}

	// Idempotent on a second call for the same cluster.
	if err := m.StartCluster(cs, "cluster-healthy"); err != nil {
		t.Fatalf("second StartCluster (idempotency) failed: %v", err)
	}

	sh := m.Health(context.Background())
	found := false
	for _, ph := range sh.Pipelines {
		if ph.ClusterID == "cluster-healthy" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected cluster-healthy's pipeline to appear in Health() output")
	}
}

// Test 7: concurrent StartCluster across MANY different clusters, plus
// repeated concurrent StartCluster for the SAME cluster (exercising the
// race-loser-stops-its-own-pipeline path added by this fix), must be
// race-free, produce no duplicate/corrupted state, and never deadlock. Run
// under `go test -race`.
func TestStartCluster_ConcurrentAcrossAndWithinClusters_RaceFree(t *testing.T) {
	m := NewPipelineManager(newTestPipelineDB(t))
	defer m.StopAll()

	const clusters = 10
	const callersPerCluster = 5

	var wg sync.WaitGroup
	start := make(chan struct{})
	for c := 0; c < clusters; c++ {
		clusterID := clusterIDFor(c)
		for i := 0; i < callersPerCluster; i++ {
			wg.Add(1)
			go func(id string) {
				defer wg.Done()
				<-start
				if err := m.StartCluster(k8sfake.NewSimpleClientset(), id); err != nil {
					t.Errorf("StartCluster(%s): %v", id, err)
				}
			}(clusterID)
		}
	}
	close(start)
	wg.Wait()

	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.pipelines) != clusters {
		t.Fatalf("expected exactly %d pipelines (one per cluster, despite %d concurrent callers each), got %d", clusters, callersPerCluster, len(m.pipelines))
	}
}

func clusterIDFor(i int) string {
	return "race-cluster-" + string(rune('A'+i))
}
