package service

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/tools/cache"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// COUNTS-1 (docs/PRODUCTION-RELIABILITY-AUDIT.md): the live pod counter in
// OverviewCache is the only resource counter that doesn't recompute from the
// informer store on every event — instead it tracks per-pod phase
// incrementally for O(1) updates. That's a deliberate performance choice
// (pods can number in the thousands; the Running/Pending/Succeeded/Failed
// breakdown needs per-pod state, not just a count), but it means the counter
// can drift from the canonical store if client-go delivers a
// cache.DeletedFinalStateUnknown-wrapped delete (previously silently ignored)
// or any other missed-event edge case. These tests cover the full lifecycle
// matrix: normal delete, tombstone delete, duplicate delete, re-add, and
// convergence via the new periodic store-reconciliation safety net.

func newTestOverviewCacheWithCluster(clusterID string) *OverviewCache {
	c := NewOverviewCache()
	c.overviews[clusterID] = &models.ClusterOverview{
		Counts:    models.OverviewCounts{},
		PodStatus: models.OverviewPodStatus{},
		Alerts:    models.OverviewAlerts{Top3: []models.OverviewAlert{}},
	}
	c.podPhases[clusterID] = make(map[string]corev1.PodPhase)
	return c
}

func testPod(uid, phase string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: uid, UID: types.UID(uid)},
		Status:     corev1.PodStatus{Phase: corev1.PodPhase(phase)},
	}
}

func TestUpdatePodStatus_NormalAddAndDelete(t *testing.T) {
	const clusterID = "c1"
	c := newTestOverviewCacheWithCluster(clusterID)

	c.updatePodStatus(clusterID, "ADDED", testPod("pod-a", "Running"))
	ov, _ := c.GetOverview(clusterID)
	if ov.Counts.Pods != 1 {
		t.Fatalf("after ADDED: expected Pods=1, got %d", ov.Counts.Pods)
	}
	if ov.PodStatus.Running != 1 {
		t.Fatalf("after ADDED: expected Running=1, got %d", ov.PodStatus.Running)
	}

	c.updatePodStatus(clusterID, "DELETED", testPod("pod-a", "Running"))
	ov, _ = c.GetOverview(clusterID)
	if ov.Counts.Pods != 0 {
		t.Fatalf("after normal DELETED: expected Pods=0, got %d", ov.Counts.Pods)
	}
	if ov.PodStatus.Running != 0 {
		t.Fatalf("after normal DELETED: expected Running=0, got %d", ov.PodStatus.Running)
	}
}

// The core COUNTS-1 fix: a DeletedFinalStateUnknown-wrapped delete must
// decrement the counter exactly like a normal delete.
func TestUpdatePodStatus_TombstoneDelete_Decrements(t *testing.T) {
	const clusterID = "c1"
	c := newTestOverviewCacheWithCluster(clusterID)

	pod := testPod("pod-a", "Running")
	c.updatePodStatus(clusterID, "ADDED", pod)

	wrapped := cache.DeletedFinalStateUnknown{Key: "pod-a", Obj: pod}
	c.updatePodStatus(clusterID, "DELETED", wrapped)

	ov, _ := c.GetOverview(clusterID)
	if ov.Counts.Pods != 0 {
		t.Fatalf("after tombstone DELETED: expected Pods=0 (bug: stuck at 1), got %d", ov.Counts.Pods)
	}
	if ov.PodStatus.Running != 0 {
		t.Fatalf("after tombstone DELETED: expected Running=0, got %d", ov.PodStatus.Running)
	}
}

// Duplicate delete (same UID deleted twice, e.g. a redundant tombstone
// following a normal delete) must not push the counter negative.
func TestUpdatePodStatus_DuplicateDelete_NoNegativeCount(t *testing.T) {
	const clusterID = "c1"
	c := newTestOverviewCacheWithCluster(clusterID)

	pod := testPod("pod-a", "Running")
	c.updatePodStatus(clusterID, "ADDED", pod)
	c.updatePodStatus(clusterID, "DELETED", pod)
	// Redundant second delete for the same (already-removed) UID.
	c.updatePodStatus(clusterID, "DELETED", pod)
	// And a redundant tombstone delete for good measure.
	c.updatePodStatus(clusterID, "DELETED", cache.DeletedFinalStateUnknown{Key: "pod-a", Obj: pod})

	ov, _ := c.GetOverview(clusterID)
	if ov.Counts.Pods != 0 {
		t.Fatalf("expected Pods=0 after duplicate deletes, got %d", ov.Counts.Pods)
	}
	if ov.Counts.Pods < 0 {
		t.Fatal("pod count went negative")
	}
}

// Re-addition after a delete (a fresh pod, new UID, as K8s always assigns)
// must produce a correct count — not double-count, not skip.
func TestUpdatePodStatus_ReAddAfterDelete(t *testing.T) {
	const clusterID = "c1"
	c := newTestOverviewCacheWithCluster(clusterID)

	pod1 := testPod("pod-a", "Running")
	c.updatePodStatus(clusterID, "ADDED", pod1)
	c.updatePodStatus(clusterID, "DELETED", pod1)

	pod2 := testPod("pod-b", "Running") // replacement pod, new UID
	c.updatePodStatus(clusterID, "ADDED", pod2)

	ov, _ := c.GetOverview(clusterID)
	if ov.Counts.Pods != 1 {
		t.Fatalf("expected Pods=1 after delete+re-add, got %d", ov.Counts.Pods)
	}
}

// MODIFIED phase transitions must move counts between buckets correctly
// (existing behavior, previously untested).
func TestUpdatePodStatus_PhaseTransition(t *testing.T) {
	const clusterID = "c1"
	c := newTestOverviewCacheWithCluster(clusterID)

	c.updatePodStatus(clusterID, "ADDED", testPod("pod-a", "Pending"))
	ov, _ := c.GetOverview(clusterID)
	if ov.PodStatus.Pending != 1 || ov.PodStatus.Running != 0 {
		t.Fatalf("expected Pending=1,Running=0 after ADDED Pending, got Pending=%d Running=%d", ov.PodStatus.Pending, ov.PodStatus.Running)
	}

	c.updatePodStatus(clusterID, "MODIFIED", testPod("pod-a", "Running"))
	ov, _ = c.GetOverview(clusterID)
	if ov.PodStatus.Pending != 0 || ov.PodStatus.Running != 1 {
		t.Fatalf("expected Pending=0,Running=1 after MODIFIED to Running, got Pending=%d Running=%d", ov.PodStatus.Pending, ov.PodStatus.Running)
	}
	if ov.Counts.Pods != 1 {
		t.Fatalf("MODIFIED must not change the total pod count, got %d", ov.Counts.Pods)
	}
}

// Zero resources: an empty cluster must report Pods=0, not panic or leave a
// stale nonzero value.
func TestUpdatePodStatus_ZeroResources(t *testing.T) {
	const clusterID = "c1"
	c := newTestOverviewCacheWithCluster(clusterID)
	ov, _ := c.GetOverview(clusterID)
	if ov.Counts.Pods != 0 {
		t.Fatalf("expected Pods=0 for a cluster with no pods, got %d", ov.Counts.Pods)
	}
}

// Cache resync/rebuild convergence: reconcilePodCountsFromStore must bring
// the counter back to the informer store's truth even after it has drifted
// (simulated here by directly corrupting the incremental counters, standing
// in for whatever missed-event class caused the drift).
func TestReconcilePodCountsFromStore_ConvergesToInformerTruth(t *testing.T) {
	const clusterID = "c1"
	pods := []interface{}{
		testPod("pod-a", "Running"),
		testPod("pod-b", "Running"),
		testPod("pod-c", "Pending"),
	}
	clientset := fake.NewSimpleClientset(pods[0].(*corev1.Pod), pods[1].(*corev1.Pod), pods[2].(*corev1.Pod))
	client := k8s.NewClientForTest(clientset)

	c := NewOverviewCache()
	if err := c.StartClusterCache(context.Background(), clusterID, client); err != nil {
		t.Fatalf("StartClusterCache: %v", err)
	}
	defer c.StopClusterCache(clusterID)

	// Wait for the informer to sync so GetStore("Pod") is populated.
	deadline := time.Now().Add(5 * time.Second)
	for {
		im := c.GetInformerManager(clusterID)
		if im != nil && im.HasSynced() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("informer did not sync in time")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Simulate drift: corrupt the incremental counter directly, standing in
	// for whatever missed-event class caused Counts.Pods to diverge from the
	// store (e.g. an event delivered while the handler briefly wasn't
	// registered, or any future edge case beyond the tombstone fix above).
	c.mu.Lock()
	c.overviews[clusterID].Counts.Pods = 999
	c.overviews[clusterID].PodStatus.Running = 999
	c.mu.Unlock()

	c.reconcilePodCountsFromStore(clusterID)

	ov, _ := c.GetOverview(clusterID)
	if ov.Counts.Pods != 3 {
		t.Fatalf("expected reconciliation to converge Pods to the store's truth (3), got %d", ov.Counts.Pods)
	}
	if ov.PodStatus.Running != 2 || ov.PodStatus.Pending != 1 {
		t.Fatalf("expected Running=2,Pending=1 after reconciliation, got Running=%d Pending=%d", ov.PodStatus.Running, ov.PodStatus.Pending)
	}
}

// StopClusterCache must halt the reconciliation goroutine promptly, not leak
// it running against a cluster that no longer exists.
func TestRunPodCountReconciliation_StopsPromptlyOnStopClusterCache(t *testing.T) {
	const clusterID = "c1"
	clientset := fake.NewSimpleClientset()
	client := k8s.NewClientForTest(clientset)

	c := NewOverviewCache()
	if err := c.StartClusterCache(context.Background(), clusterID, client); err != nil {
		t.Fatalf("StartClusterCache: %v", err)
	}

	c.mu.RLock()
	stopCh, ok := c.stopChs[clusterID]
	c.mu.RUnlock()
	if !ok {
		t.Fatal("expected a reconciliation stop channel to be registered")
	}

	c.StopClusterCache(clusterID)

	select {
	case <-stopCh:
		// closed, as expected
	case <-time.After(1 * time.Second):
		t.Fatal("StopClusterCache did not close the reconciliation stop channel promptly")
	}
}
