package k8s

// Phase 2D (docs/TOPOLOGY-CONCURRENCY-INVESTIGATION.md): client-go defaults
// rest.Config.QPS/Burst to 5/10 when unset — tuned for low-frequency
// controller reconcile loops, not a management-plane backend serving
// concurrent user requests against one shared per-cluster client. Live-
// measured: 10 concurrent topology builds against the default took 18.2s;
// the same burst at QPS=50/Burst=100 took 3.2s, with the real API server's
// own CPU staying under 20% throughout both (i.e. not simply shifting an
// overload the API server can't absorb). These tests prove
// SetDefaultClientRateLimit/applyDefaultClientRateLimit's semantics.

import (
	"testing"

	"k8s.io/client-go/rest"
)

func TestApplyDefaultClientRateLimit_AppliesConfiguredValues(t *testing.T) {
	defer SetDefaultClientRateLimit(0, 0) // restore zero-value (test isolation)

	SetDefaultClientRateLimit(50, 100)
	cfg := &rest.Config{}
	applyDefaultClientRateLimit(cfg)

	if cfg.QPS != 50 {
		t.Errorf("QPS = %v, want 50", cfg.QPS)
	}
	if cfg.Burst != 100 {
		t.Errorf("Burst = %v, want 100", cfg.Burst)
	}
}

func TestApplyDefaultClientRateLimit_ZeroLeavesClientGoDefaultInEffect(t *testing.T) {
	defer SetDefaultClientRateLimit(0, 0)

	SetDefaultClientRateLimit(0, 0) // e.g. never called, or explicitly configured to 0
	cfg := &rest.Config{}           // QPS/Burst unset -> client-go's own default (5/10) applies downstream
	applyDefaultClientRateLimit(cfg)

	if cfg.QPS != 0 {
		t.Errorf("QPS = %v, want 0 (left for client-go's own default)", cfg.QPS)
	}
	if cfg.Burst != 0 {
		t.Errorf("Burst = %v, want 0 (left for client-go's own default)", cfg.Burst)
	}
}

func TestApplyDefaultClientRateLimit_PartialOverride(t *testing.T) {
	defer SetDefaultClientRateLimit(0, 0)

	// Only QPS configured, Burst left at 0 -> only QPS should be touched.
	SetDefaultClientRateLimit(30, 0)
	cfg := &rest.Config{}
	applyDefaultClientRateLimit(cfg)

	if cfg.QPS != 30 {
		t.Errorf("QPS = %v, want 30", cfg.QPS)
	}
	if cfg.Burst != 0 {
		t.Errorf("Burst = %v, want 0 (not configured, client-go default applies)", cfg.Burst)
	}
}
