package k8s

import (
	"context"
	"testing"
	"time"

	"k8s.io/client-go/kubernetes/fake"
)

// LOADING-3/LOADING-4 (docs/PRODUCTION-RELIABILITY-AUDIT.md): callers outside
// this package (e.g. the Overview handler's fallback path) must be able to
// apply the same deadline every other client call already gets. WithTimeout
// is the exported form of the internal withTimeout helper used by
// TestConnection/GetClusterInfo/ListResources.
func TestClient_WithTimeout_AppliesConfiguredDeadline(t *testing.T) {
	c := &Client{Timeout: 50 * time.Millisecond}

	ctx, cancel := c.WithTimeout(context.Background())
	defer cancel()

	deadline, ok := ctx.Deadline()
	if !ok {
		t.Fatal("expected ctx to carry a deadline when Timeout > 0")
	}
	remaining := time.Until(deadline)
	if remaining <= 0 || remaining > 50*time.Millisecond {
		t.Fatalf("expected deadline ~50ms out, got %v remaining", remaining)
	}
}

func TestClient_WithTimeout_NoOpWhenTimeoutUnset(t *testing.T) {
	c := &Client{} // Timeout == 0

	parent := context.Background()
	ctx, cancel := c.WithTimeout(parent)
	defer cancel()

	if _, ok := ctx.Deadline(); ok {
		t.Fatal("expected no deadline to be added when c.Timeout == 0")
	}
}

// HEALTH-2 (docs/PRODUCTION-RELIABILITY-AUDIT.md): LastCheckedAt must advance
// on every TestConnection attempt, success or failure — it's the "was this
// ever actually checked, and when" signal the presence layer was missing.
func TestClient_LastCheckedAt_AdvancesOnEveryAttempt(t *testing.T) {
	c := NewClientForTest(fake.NewSimpleClientset())
	if !c.LastCheckedAt().IsZero() {
		t.Fatal("expected LastCheckedAt to be zero before any check has run")
	}

	before := time.Now()
	if err := c.TestConnection(context.Background()); err != nil {
		t.Fatalf("unexpected TestConnection error against fake clientset: %v", err)
	}
	checked := c.LastCheckedAt()
	if checked.Before(before) {
		t.Fatalf("expected LastCheckedAt (%v) to be at or after the call start (%v)", checked, before)
	}

	healthy, lastSuccess, lastErr, _ := c.HealthStatus()
	if !healthy || lastErr != nil {
		t.Fatalf("expected a successful check against the fake clientset, got healthy=%v err=%v", healthy, lastErr)
	}
	if lastSuccess.Before(before) {
		t.Fatalf("expected lastSuccess (%v) to be at or after the call start (%v)", lastSuccess, before)
	}
}

// Behavioral proof that a context built via WithTimeout actually bounds a
// slow operation — the shape of what overview.go's fallback List calls now
// get, where previously they had no deadline of their own at all.
func TestClient_WithTimeout_BoundsASlowOperation(t *testing.T) {
	c := &Client{Timeout: 20 * time.Millisecond}
	ctx, cancel := c.WithTimeout(context.Background())
	defer cancel()

	start := time.Now()
	select {
	case <-ctx.Done():
		elapsed := time.Since(start)
		if elapsed > 200*time.Millisecond {
			t.Fatalf("ctx took %v to cancel, expected ~20ms", elapsed)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("ctx.Done() never fired — the slow operation would have hung indefinitely")
	}
}
