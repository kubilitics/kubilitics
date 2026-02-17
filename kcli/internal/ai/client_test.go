package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestOpenAIProviderAnalyze(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sk-test-key" {
			t.Fatalf("unexpected auth header: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"openai-ok"}}]}`))
	}))
	defer server.Close()

	c := New(Config{Enabled: true, Provider: ProviderOpenAI, Endpoint: server.URL, APIKey: "sk-test-key", Model: "gpt-4o-mini", Timeout: 2 * time.Second})
	got, err := c.Analyze(context.Background(), "why", "pod/api")
	if err != nil {
		t.Fatalf("Analyze error: %v", err)
	}
	if got != "openai-ok" {
		t.Fatalf("unexpected result: %q", got)
	}
}

func TestAnthropicProviderQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("x-api-key"); got != "sk-ant-test" {
			t.Fatalf("unexpected anthropic key header: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"anthropic-ok"}]}`))
	}))
	defer server.Close()

	c := New(Config{Enabled: true, Provider: ProviderAnthropic, Endpoint: server.URL, APIKey: "sk-ant-test", Timeout: 2 * time.Second})
	got, err := c.Analyze(context.Background(), "explain", "deployment/api")
	if err != nil {
		t.Fatalf("Analyze error: %v", err)
	}
	if got != "anthropic-ok" {
		t.Fatalf("unexpected result: %q", got)
	}
}

func TestAzureProviderSuggestFix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/openai/deployments/gpt4/chat/completions") {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("api-key"); got != "azure-super-key" {
			t.Fatalf("unexpected api-key header: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"azure-ok"}}]}`))
	}))
	defer server.Close()

	c := New(Config{Enabled: true, Provider: ProviderAzureOpenAI, Endpoint: server.URL, APIKey: "azure-super-key", AzureDeployment: "gpt4", Timeout: 2 * time.Second})
	got, err := c.Analyze(context.Background(), "suggest-fix", "deployment/api")
	if err != nil {
		t.Fatalf("Analyze error: %v", err)
	}
	if got != "azure-ok" {
		t.Fatalf("unexpected result: %q", got)
	}
}

func TestOllamaProvider(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message":{"content":"ollama-ok"}}`))
	}))
	defer server.Close()

	c := New(Config{Enabled: true, Provider: ProviderOllama, Endpoint: server.URL, Timeout: 2 * time.Second})
	got, err := c.Analyze(context.Background(), "query", "which pods are crashing")
	if err != nil {
		t.Fatalf("Analyze error: %v", err)
	}
	if got != "ollama-ok" {
		t.Fatalf("unexpected result: %q", got)
	}
}

func TestCustomProvider(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":"custom-ok"}`))
	}))
	defer server.Close()

	c := New(Config{Enabled: true, Provider: ProviderCustom, Endpoint: server.URL, Timeout: 2 * time.Second})
	got, err := c.Analyze(context.Background(), "why", "pod/api")
	if err != nil {
		t.Fatalf("Analyze error: %v", err)
	}
	if got != "custom-ok" {
		t.Fatalf("unexpected result: %q", got)
	}
}

func TestAPIKeyValidation(t *testing.T) {
	c := New(Config{Enabled: true, Provider: ProviderOpenAI, APIKey: "bad-key", Endpoint: "https://api.openai.com", Timeout: time.Second})
	if _, err := c.Analyze(context.Background(), "why", "pod/api"); err == nil {
		t.Fatal("expected API key validation error")
	}

	c = New(Config{Enabled: true, Provider: ProviderAzureOpenAI, APIKey: "valid-key-123456", Endpoint: "https://example.openai.azure.com", Timeout: time.Second})
	if _, err := c.Analyze(context.Background(), "why", "pod/api"); err == nil || !strings.Contains(err.Error(), "deployment") {
		t.Fatalf("expected azure deployment validation error, got: %v", err)
	}
}

func TestProviderSwitchingFromEnv(t *testing.T) {
	t.Setenv("KCLI_AI_PROVIDER", ProviderOllama)
	t.Setenv("KCLI_OLLAMA_ENDPOINT", "http://localhost:11434")
	c := NewFromEnv(2 * time.Second)
	if !c.Enabled() {
		t.Fatal("expected client enabled when provider is configured")
	}
	if c.ProviderName() != ProviderOllama {
		t.Fatalf("unexpected provider: %s", c.ProviderName())
	}
}

func TestAnalyzeCachingAndUsage(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":"cached-ok"}`))
	}))
	defer server.Close()

	c := New(Config{Enabled: true, Provider: ProviderCustom, Endpoint: server.URL, Timeout: 2 * time.Second})
	got1, err := c.Analyze(context.Background(), "why", "pod/api")
	if err != nil {
		t.Fatalf("first analyze error: %v", err)
	}
	got2, err := c.Analyze(context.Background(), "why", "pod/api")
	if err != nil {
		t.Fatalf("second analyze error: %v", err)
	}
	if got1 != "cached-ok" || got2 != "cached-ok" {
		t.Fatalf("unexpected results: %q %q", got1, got2)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("expected one provider call due to cache, got %d", calls)
	}
	u := c.Usage()
	if u.TotalCalls != 2 || u.CacheHits != 1 {
		t.Fatalf("unexpected usage: %+v", u)
	}
}

func TestAnalyzeTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":"slow"}`))
	}))
	defer server.Close()

	c := New(Config{Enabled: true, Provider: ProviderCustom, Endpoint: server.URL, Timeout: 500 * time.Millisecond})
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := c.Analyze(ctx, "why", "pod/api")
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if time.Since(start) > 150*time.Millisecond {
		t.Fatalf("analyze exceeded expected timeout window: %s", time.Since(start))
	}
}

func TestBudgetHardLimitBlocks(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := RecordUsageDelta(Usage{TotalCalls: 10, EstimatedCostUSD: 60}, time.Now()); err != nil {
		t.Fatalf("seed usage: %v", err)
	}

	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":"should-not-run"}`))
	}))
	defer server.Close()

	c := New(Config{Enabled: true, Provider: ProviderCustom, Endpoint: server.URL, BudgetMonthlyUSD: 50, SoftLimitPercent: 80, Timeout: 2 * time.Second})
	_, err := c.Analyze(context.Background(), "why", "pod/api")
	if err == nil || !strings.Contains(err.Error(), "budget exceeded") {
		t.Fatalf("expected budget exceeded error, got: %v", err)
	}
	if atomic.LoadInt32(&calls) != 0 {
		t.Fatalf("provider should not be called when hard limit reached; calls=%d", calls)
	}
}

func TestSoftLimitNotice(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := RecordUsageDelta(Usage{TotalCalls: 1, EstimatedCostUSD: 45}, time.Now()); err != nil {
		t.Fatalf("seed usage: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":"ok"}`))
	}))
	defer server.Close()

	c := New(Config{Enabled: true, Provider: ProviderCustom, Endpoint: server.URL, BudgetMonthlyUSD: 50, SoftLimitPercent: 80, Timeout: 2 * time.Second})
	out, err := c.Analyze(context.Background(), "why", "pod/api")
	if err != nil {
		t.Fatalf("analyze error: %v", err)
	}
	if !strings.Contains(out, "[ai-budget]") {
		t.Fatalf("expected soft-limit notice in output, got: %q", out)
	}
}

func TestCacheHitRateAbove70Percent(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":"cache-test-ok"}`))
	}))
	defer server.Close()

	c := New(Config{Enabled: true, Provider: ProviderCustom, Endpoint: server.URL, Timeout: 2 * time.Second})
	total := 20
	for i := 0; i < total; i++ {
		if _, err := c.Analyze(context.Background(), "why", "pod/api"); err != nil {
			t.Fatalf("analyze failed at iter %d: %v", i, err)
		}
	}
	u := c.Usage()
	hitRate := float64(u.CacheHits) / float64(total) * 100.0
	if hitRate < 70 {
		t.Fatalf("expected cache hit rate >=70%%, got %.1f%% (usage=%+v)", hitRate, u)
	}
}
