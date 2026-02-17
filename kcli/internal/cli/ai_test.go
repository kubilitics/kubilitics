package cli

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/kubilitics/kcli/internal/ai"
	kcfg "github.com/kubilitics/kcli/internal/config"
)

func TestAIConfigCommandPersists(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	root := NewRootCommand()
	buf := &bytes.Buffer{}
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs([]string{"ai", "config", "--provider=openai", "--model=gpt-4o-mini", "--budget=70", "--soft-limit=85", "--enable"})
	if err := root.Execute(); err != nil {
		t.Fatalf("ai config command failed: %v", err)
	}

	cfg, err := kcfg.Load()
	if err != nil {
		t.Fatalf("load config after ai config: %v", err)
	}
	if !cfg.AI.Enabled || cfg.AI.Provider != "openai" || cfg.AI.Model != "gpt-4o-mini" {
		t.Fatalf("unexpected ai config: %+v", cfg.AI)
	}
	if cfg.AI.BudgetMonthlyUSD != 70 || cfg.AI.SoftLimitPercent != 85 {
		t.Fatalf("unexpected budget settings: %+v", cfg.AI)
	}
}

func TestAIUsageAndCostCommands(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := ai.RecordUsageDelta(ai.Usage{TotalCalls: 3, CacheHits: 1, PromptTokens: 120, CompletionTokens: 80, EstimatedCostUSD: 1.25}, time.Now()); err != nil {
		t.Fatalf("seed usage: %v", err)
	}

	root := NewRootCommand()
	buf := &bytes.Buffer{}
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs([]string{"ai", "usage"})
	if err := root.Execute(); err != nil {
		t.Fatalf("ai usage failed: %v", err)
	}
	if !strings.Contains(buf.String(), "Calls: 3") || !strings.Contains(buf.String(), "Estimated cost") {
		t.Fatalf("unexpected usage output: %q", buf.String())
	}

	root = NewRootCommand()
	buf.Reset()
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs([]string{"ai", "cost"})
	if err := root.Execute(); err != nil {
		t.Fatalf("ai cost failed: %v", err)
	}
	if !strings.Contains(buf.String(), "Cost: $1.2500") {
		t.Fatalf("unexpected cost output: %q", buf.String())
	}
}

func TestAICommandGracefulDegradationOnProviderError(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("KCLI_AI_PROVIDER", "invalid-provider")

	root := NewRootCommand()
	buf := &bytes.Buffer{}
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs([]string{"ai", "why", "pod/api"})
	if err := root.Execute(); err != nil {
		t.Fatalf("expected graceful degradation, got error: %v", err)
	}
	if !strings.Contains(buf.String(), "AI unavailable") {
		t.Fatalf("expected degraded AI unavailable message, got: %q", buf.String())
	}
}
