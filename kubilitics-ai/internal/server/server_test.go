package server

import (
	"context"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestLoadConfig(t *testing.T) {
	// Set minimal required environment variables
	os.Setenv("KUBILITICS_LLM_PROVIDER", "openai")
	os.Setenv("KUBILITICS_LLM_API_KEY", "test-key")
	defer os.Unsetenv("KUBILITICS_LLM_PROVIDER")
	defer os.Unsetenv("KUBILITICS_LLM_API_KEY")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error: %v", err)
	}

	if cfg.LLMProvider != "openai" {
		t.Errorf("Expected LLMProvider 'openai', got '%s'", cfg.LLMProvider)
	}

	if cfg.HTTPPort != 8080 {
		t.Errorf("Expected default HTTPPort 8080, got %d", cfg.HTTPPort)
	}

	if cfg.DefaultAutonomyLevel != 3 {
		t.Errorf("Expected default autonomy level 3, got %d", cfg.DefaultAutonomyLevel)
	}
}

func TestLoadConfig_CustomPorts(t *testing.T) {
	os.Setenv("KUBILITICS_HTTP_PORT", "9000")
	os.Setenv("KUBILITICS_GRPC_PORT", "9001")
	os.Setenv("KUBILITICS_LLM_PROVIDER", "openai")
	os.Setenv("KUBILITICS_LLM_API_KEY", "test-key")
	defer os.Unsetenv("KUBILITICS_HTTP_PORT")
	defer os.Unsetenv("KUBILITICS_GRPC_PORT")
	defer os.Unsetenv("KUBILITICS_LLM_PROVIDER")
	defer os.Unsetenv("KUBILITICS_LLM_API_KEY")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error: %v", err)
	}

	if cfg.HTTPPort != 9000 {
		t.Errorf("Expected HTTPPort 9000, got %d", cfg.HTTPPort)
	}

	if cfg.GRPCPort != 9001 {
		t.Errorf("Expected GRPCPort 9001, got %d", cfg.GRPCPort)
	}
}

func TestConfigValidation_InvalidProvider(t *testing.T) {
	os.Setenv("KUBILITICS_LLM_PROVIDER", "invalid-provider")
	defer os.Unsetenv("KUBILITICS_LLM_PROVIDER")

	_, err := LoadConfig()
	if err == nil {
		t.Error("Expected error for invalid provider, got nil")
	}
}

func TestConfigValidation_MissingAPIKey(t *testing.T) {
	os.Setenv("KUBILITICS_LLM_PROVIDER", "openai")
	os.Unsetenv("KUBILITICS_LLM_API_KEY")
	defer os.Unsetenv("KUBILITICS_LLM_PROVIDER")

	_, err := LoadConfig()
	if err == nil {
		t.Error("Expected error for missing API key, got nil")
	}
}

func TestNewServer(t *testing.T) {
	cfg := &Config{
		HTTPPort:             8080,
		GRPCPort:             9090,
		Host:                 "localhost",
		LLMProvider:          "openai",
		LLMAPIKey:            "test-key",
		LLMModel:             "gpt-4o",
		DefaultAutonomyLevel: 3,
		EnableSafetyEngine:   true,
		AnalyticsEnabled:     true,
	}

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	if srv == nil {
		t.Fatal("NewServer() returned nil")
	}

	// Check components initialized
	if srv.llmAdapter == nil {
		t.Error("LLM adapter not initialized")
	}

	if srv.safetyEngine == nil {
		t.Error("Safety engine not initialized")
	}

	if srv.analyticsEngine == nil {
		t.Error("Analytics engine not initialized")
	}
}

func TestNewServer_NilConfig(t *testing.T) {
	_, err := NewServer(nil)
	if err == nil {
		t.Error("Expected error for nil config, got nil")
	}
}

func TestServerLifecycle(t *testing.T) {
	// Use a different port to avoid conflicts
	cfg := &Config{
		HTTPPort:             18080,
		GRPCPort:             19090,
		Host:                 "localhost",
		LLMProvider:          "openai",
		LLMAPIKey:            "test-key",
		LLMModel:             "gpt-4o",
		DefaultAutonomyLevel: 3,
		EnableSafetyEngine:   true,
		AnalyticsEnabled:     true,
	}

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	// Start server
	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Wait a bit for server to be ready
	time.Sleep(100 * time.Millisecond)

	// Check server is running
	if !srv.IsRunning() {
		t.Error("Server should be running after Start()")
	}

	// Test health endpoint
	resp, err := http.Get("http://localhost:18080/health")
	if err != nil {
		t.Errorf("Health check failed: %v", err)
	} else {
		if resp.StatusCode != http.StatusOK {
			t.Errorf("Expected status 200, got %d", resp.StatusCode)
		}
		resp.Body.Close()
	}

	// Stop server
	if err := srv.Stop(); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}

	// Check server is stopped
	if srv.IsRunning() {
		t.Error("Server should not be running after Stop()")
	}
}

func TestHealthEndpoint(t *testing.T) {
	cfg := &Config{
		HTTPPort:             18081,
		GRPCPort:             19091,
		Host:                 "localhost",
		LLMProvider:          "openai",
		LLMAPIKey:            "test-key",
		LLMModel:             "gpt-4o",
		DefaultAutonomyLevel: 3,
		EnableSafetyEngine:   false,
		AnalyticsEnabled:     false,
	}

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer srv.Stop()

	time.Sleep(100 * time.Millisecond)

	resp, err := http.Get("http://localhost:18081/health")
	if err != nil {
		t.Fatalf("GET /health failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	t.Logf("Health response: %s", string(body))
}

func TestReadyEndpoint(t *testing.T) {
	cfg := &Config{
		HTTPPort:             18082,
		GRPCPort:             19092,
		Host:                 "localhost",
		LLMProvider:          "openai",
		LLMAPIKey:            "test-key",
		LLMModel:             "gpt-4o",
		DefaultAutonomyLevel: 3,
		EnableSafetyEngine:   false,
		AnalyticsEnabled:     false,
	}

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer srv.Stop()

	time.Sleep(100 * time.Millisecond)

	resp, err := http.Get("http://localhost:18082/ready")
	if err != nil {
		t.Fatalf("GET /ready failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	t.Logf("Ready response: %s", string(body))
}

func TestInfoEndpoint(t *testing.T) {
	// Use OpenAI instead of Ollama to avoid connection issues in tests
	cfg := &Config{
		HTTPPort:             18083,
		GRPCPort:             19093,
		Host:                 "localhost",
		LLMProvider:          "openai",
		LLMAPIKey:            "test-key",
		LLMModel:             "gpt-4o",
		DefaultAutonomyLevel: 3,
		EnableSafetyEngine:   true,
		AnalyticsEnabled:     true,
	}

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer srv.Stop()

	time.Sleep(100 * time.Millisecond)

	resp, err := http.Get("http://localhost:18083/info")
	if err != nil {
		t.Fatalf("GET /info failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	t.Logf("Info response: %s", string(body))
}

func TestGetComponents(t *testing.T) {
	cfg := &Config{
		HTTPPort:             18084,
		GRPCPort:             19094,
		Host:                 "localhost",
		LLMProvider:          "openai",
		LLMAPIKey:            "test-key",
		LLMModel:             "gpt-4o",
		DefaultAutonomyLevel: 3,
		EnableSafetyEngine:   true,
		AnalyticsEnabled:     true,
	}

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	// Check components are accessible
	if srv.GetLLMAdapter() == nil {
		t.Error("GetLLMAdapter() returned nil")
	}

	if srv.GetSafetyEngine() == nil {
		t.Error("GetSafetyEngine() returned nil")
	}

	if srv.GetAnalyticsEngine() == nil {
		t.Error("GetAnalyticsEngine() returned nil")
	}
}

func TestOllamaProvider(t *testing.T) {
	// Skip if Ollama is not running
	t.Skip("Skipping Ollama test - requires Ollama running on localhost:11434")

	cfg := &Config{
		HTTPPort:   18085,
		GRPCPort:   19095,
		Host:       "localhost",
		LLMProvider: "ollama",
		LLMModel:   "llama3",
		LLMBaseURL: "http://localhost:11434",
		DefaultAutonomyLevel: 3,
		EnableSafetyEngine:   false,
		AnalyticsEnabled:     false,
	}

	// This will work even if Ollama is not running
	// The client will be created but connections will fail gracefully
	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() with Ollama error: %v", err)
	}

	if srv.llmAdapter == nil {
		t.Error("Ollama LLM adapter not initialized")
	}
}

func TestServerDoubleStart(t *testing.T) {
	cfg := &Config{
		HTTPPort:             18086,
		GRPCPort:             19096,
		Host:                 "localhost",
		LLMProvider:          "openai",
		LLMAPIKey:            "test-key",
		LLMModel:             "gpt-4o",
		DefaultAutonomyLevel: 3,
		EnableSafetyEngine:   false,
		AnalyticsEnabled:     false,
	}

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	// First start should succeed
	if err := srv.Start(); err != nil {
		t.Fatalf("First Start() error: %v", err)
	}
	defer srv.Stop()

	// Second start should fail
	err = srv.Start()
	if err == nil {
		t.Error("Expected error for double Start(), got nil")
	}
}

func TestServerStopBeforeStart(t *testing.T) {
	cfg := &Config{
		HTTPPort:             18087,
		GRPCPort:             19097,
		Host:                 "localhost",
		LLMProvider:          "openai",
		LLMAPIKey:            "test-key",
		LLMModel:             "gpt-4o",
		DefaultAutonomyLevel: 3,
		EnableSafetyEngine:   false,
		AnalyticsEnabled:     false,
	}

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	// Stop before start should fail
	err = srv.Stop()
	if err == nil {
		t.Error("Expected error for Stop() before Start(), got nil")
	}
}

func TestServerContext(t *testing.T) {
	cfg := &Config{
		HTTPPort:             18088,
		GRPCPort:             19098,
		Host:                 "localhost",
		LLMProvider:          "openai",
		LLMAPIKey:            "test-key",
		LLMModel:             "gpt-4o",
		DefaultAutonomyLevel: 3,
		EnableSafetyEngine:   false,
		AnalyticsEnabled:     false,
	}

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Wait in background
	waitDone := make(chan struct{})
	go func() {
		srv.Wait()
		close(waitDone)
	}()

	// Stop server
	if err := srv.Stop(); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}

	// Wait should unblock
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	select {
	case <-waitDone:
		// Success - Wait() returned
	case <-ctx.Done():
		t.Error("Wait() did not return after Stop()")
	}
}
