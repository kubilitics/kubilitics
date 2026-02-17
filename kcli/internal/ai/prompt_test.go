package ai

import (
	"strings"
	"testing"
	"time"
)

func TestBuildPromptTemplates(t *testing.T) {
	cases := []string{"explain", "why", "suggest-fix", "summarize-events", "query"}
	for _, action := range cases {
		p := BuildPrompt(PromptRequest{Action: action, Target: "prod/pod/api-0", Query: "which pods failing"})
		if strings.TrimSpace(p.System) == "" || strings.TrimSpace(p.User) == "" {
			t.Fatalf("empty prompt for action %s", action)
		}
		if p.EstimatedTokens <= 0 {
			t.Fatalf("token estimate must be >0 for action %s", action)
		}
	}
}

func TestContextBuilderParsesTarget(t *testing.T) {
	ctx := buildContext("payments/deployment/api", &ClusterContext{Context: "prod", Namespace: "payments"})
	checks := []string{"kubeContext=prod", "namespace=payments", "parsed.kind=deployment", "parsed.name=api"}
	for _, want := range checks {
		if !strings.Contains(ctx, want) {
			t.Fatalf("context missing %q: %s", want, ctx)
		}
	}
}

func TestSensitiveDataStripped(t *testing.T) {
	in := "password=supersecret token:abc123 api_key=xyz -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"
	out := sanitizeSensitive(in)
	if strings.Contains(out, "supersecret") || strings.Contains(out, "abc123") || strings.Contains(out, "xyz") {
		t.Fatalf("sensitive values not stripped: %q", out)
	}
	if !strings.Contains(out, "[REDACTED]") {
		t.Fatalf("expected redaction marker: %q", out)
	}
}

func TestEstimateTokens(t *testing.T) {
	if got := estimateTokens(""); got != 0 {
		t.Fatalf("expected 0 tokens for empty text, got %d", got)
	}
	if got := estimateTokens("kubernetes incident response runbook"); got <= 0 {
		t.Fatalf("expected positive tokens, got %d", got)
	}
}

func TestContextBuildPerformance(t *testing.T) {
	start := time.Now()
	for i := 0; i < 2000; i++ {
		_ = BuildPrompt(PromptRequest{
			Action: "why",
			Target: "prod/deployment/api",
			Cluster: &ClusterContext{
				Context:   "prod-cluster",
				Namespace: "payments",
				Snapshot:  "pod restarts increasing",
			},
		})
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("prompt/context build too slow: %s", elapsed)
	}
}
