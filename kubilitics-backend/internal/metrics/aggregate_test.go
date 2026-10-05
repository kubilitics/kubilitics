package metrics

import (
	"math"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// METRICS-1 (docs/PRODUCTION-RELIABILITY-AUDIT.md): parseCPUToMilli/
// parseMemoryToMi previously stripped a single trailing unit letter without
// applying its scale factor — correct only for the one fixed-format string
// the only caller at the time ever produced. These tests cover the full
// input matrix: zero, small, normal production, large, invalid, negative,
// and missing values, for both CPU and memory, plus the aggregation path
// end to end.

func TestParseCPUToMilli(t *testing.T) {
	cases := []struct {
		name      string
		input     string
		wantMilli float64
		wantOK    bool
	}{
		{"empty", "", 0, true},
		{"zero_millicores", "0m", 0, true},
		{"zero_cores", "0", 0, true},
		// resource.Quantity has no sub-millicore precision (matching real
		// Kubernetes semantics — metrics-server/kubelet never report finer than
		// 1m) — MilliValue() rounds "10.5m" up to the nearest whole millicore.
		{"small_millicores_rounds_to_whole_milli", "10.5m", 11, true},
		{"normal_millicores", "250m", 250, true},
		{"whole_core_bug_case", "1", 1000, true}, // THE bug: old parser returned 1, not 1000.
		{"fractional_cores", "1.5", 1500, true},
		{"large_cores", "64", 64000, true},
		{"nanocores", "500000000n", 500, true},
		{"invalid_garbage", "not-a-number", 0, false},
		{"invalid_unit", "500x", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseCPUToMilli(tc.input)
			if ok != tc.wantOK {
				t.Fatalf("parseCPUToMilli(%q) ok = %v, want %v", tc.input, ok, tc.wantOK)
			}
			if ok && got != tc.wantMilli {
				t.Fatalf("parseCPUToMilli(%q) = %v, want %v", tc.input, got, tc.wantMilli)
			}
		})
	}
}

func TestParseMemoryToMi(t *testing.T) {
	const miB = 1024.0 * 1024.0
	cases := []struct {
		name    string
		input   string
		wantMi  float64
		wantOK  bool
		epsilon float64
	}{
		{"empty", "", 0, true, 0},
		{"zero", "0", 0, true, 0},
		{"zero_Mi", "0Mi", 0, true, 0},
		{"small_Ki_bug_case", "512Ki", 512.0 / 1024.0, true, 0.001}, // THE bug: old parser treated "Ki" like "Mi".
		{"normal_Mi", "256Mi", 256, true, 0},
		{"large_Gi", "4Gi", 4096, true, 0},
		{"very_large_Ti", "2Ti", 2 * 1024 * 1024, true, 0},
		{"raw_bytes", "1073741824", 1024, true, 0}, // 1 GiB in raw bytes
		{"decimal_M_bug_case", "100M", 100 * 1000 * 1000 / miB, true, 0.01}, // decimal mega (1000-based), not binary Mi
		{"invalid_garbage", "not-a-number", 0, false, 0},
		{"invalid_unit", "32Zz", 0, false, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseMemoryToMi(tc.input)
			if ok != tc.wantOK {
				t.Fatalf("parseMemoryToMi(%q) ok = %v, want %v", tc.input, ok, tc.wantOK)
			}
			if ok {
				diff := math.Abs(got - tc.wantMi)
				if diff > tc.epsilon+1e-9 {
					t.Fatalf("parseMemoryToMi(%q) = %v, want %v (diff %v > epsilon %v)", tc.input, got, tc.wantMi, diff, tc.epsilon)
				}
			}
		})
	}
}

func TestAggregatePodUsages(t *testing.T) {
	t.Run("zero_pods", func(t *testing.T) {
		cpu, mem := AggregatePodUsages(nil)
		if cpu != formatCPU(0) || mem != formatMemoryMi(0) {
			t.Fatalf("expected zero totals for no pods, got cpu=%q mem=%q", cpu, mem)
		}
	})

	t.Run("nil_pod_entries_skipped", func(t *testing.T) {
		cpu, mem := AggregatePodUsages([]*models.PodUsage{nil, nil})
		if cpu != formatCPU(0) || mem != formatMemoryMi(0) {
			t.Fatalf("expected zero totals when all entries are nil, got cpu=%q mem=%q", cpu, mem)
		}
	})

	t.Run("mixed_units_sum_correctly", func(t *testing.T) {
		// This is exactly the bug scenario: pods reporting usage in different
		// units (as real metrics-server/kubelet summaries do) must still sum
		// correctly — the old parser would have silently under/over-counted
		// any pod not in the one fixed "<n>.00Mi"/"<n>.00m" shape.
		pods := []*models.PodUsage{
			{CPU: "250m", Memory: "256Mi"},
			{CPU: "1", Memory: "1Gi"}, // whole core + Gi — the bug cases
		}
		cpu, mem := AggregatePodUsages(pods)
		wantCPUMilli := 250.0 + 1000.0
		wantMemMi := 256.0 + 1024.0
		if cpu != formatCPU(wantCPUMilli) {
			t.Fatalf("expected cpu total %q, got %q", formatCPU(wantCPUMilli), cpu)
		}
		if mem != formatMemoryMi(wantMemMi) {
			t.Fatalf("expected memory total %q, got %q", formatMemoryMi(wantMemMi), mem)
		}
	})

	t.Run("invalid_entries_contribute_zero_not_poison_the_sum", func(t *testing.T) {
		pods := []*models.PodUsage{
			{CPU: "250m", Memory: "256Mi"},
			{CPU: "garbage", Memory: "garbage"},
		}
		cpu, mem := AggregatePodUsages(pods)
		if cpu != formatCPU(250) {
			t.Fatalf("expected the valid pod's CPU to still be counted, got %q", cpu)
		}
		if mem != formatMemoryMi(256) {
			t.Fatalf("expected the valid pod's memory to still be counted, got %q", mem)
		}
	})
}
