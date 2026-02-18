package server

// handlers_config.go — Runtime LLM provider configuration endpoint.
//
// Implements doc 06 (06-ai-toggle-and-byollm-design.md) Section 4:
//   GET  /api/v1/config/provider  — read current provider/model (no key echoed)
//   POST /api/v1/config/provider  — hot-wire a new LLM adapter at runtime
//
// Security posture:
//   - Loopback-only: requests from non-127.0.0.1/::1 origins are rejected 403.
//   - API keys are NEVER echoed in the response (only a masked preview on POST).
//   - On success the LLM adapter is rebuilt in-place (zero-downtime hot-wire).
//   - The config.LLM.Configured flag is updated so /health reflects the change.
//
// Supported providers: anthropic | openai | ollama | custom
//
// POST request body (JSON):
//
//	{
//	  "provider":  "anthropic",           // required
//	  "api_key":   "sk-ant-...",           // optional (not required for ollama)
//	  "model":     "claude-3-5-sonnet",    // optional — falls back to provider default
//	  "base_url":  "http://localhost:11434" // required for ollama / custom
//	}
//
// POST response (200):
//
//	{
//	  "provider":    "anthropic",
//	  "model":       "claude-3-5-sonnet",
//	  "configured":  true,
//	  "key_preview": "sk-ant-...●●●●XXXX"
//	}
//
// GET response (200):
//
//	{
//	  "provider":   "anthropic",
//	  "model":      "claude-3-5-sonnet",
//	  "configured": true
//	}
//
// Error responses: 400 bad request, 403 forbidden (non-loopback), 405 method not allowed, 500 internal.

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/db"
	"github.com/kubilitics/kubilitics-ai/internal/llm/adapter"
	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// configProviderRequest is the JSON body accepted by POST /api/v1/config/provider.
type configProviderRequest struct {
	Provider string `json:"provider"` // anthropic | openai | ollama | custom
	APIKey   string `json:"api_key"`  // sensitive — never echoed back
	Model    string `json:"model"`    // optional; empty ⇒ provider default
	BaseURL  string `json:"base_url"` // required for ollama / custom
}

// configProviderResponse is the JSON body returned on POST success.
// The api_key is intentionally absent; only a masked preview is included.
type configProviderResponse struct {
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	Configured bool   `json:"configured"`
	KeyPreview string `json:"key_preview,omitempty"` // e.g. "sk-ant-...●●●●1234"
}

// configProviderGetResponse is the safe read-only view returned by GET.
// No api_key is ever included.
type configProviderGetResponse struct {
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	Configured bool   `json:"configured"`
	BaseURL    string `json:"base_url,omitempty"` // only for ollama / custom
}

// handleConfigProvider is the single route handler for /api/v1/config/provider.
//
//	GET  — returns current provider/model (no key); loopback-only.
//	POST — hot-wires a new LLM adapter at runtime; loopback-only.
func (s *Server) handleConfigProvider(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleGetConfigProvider(w, r)
	case http.MethodPost:
		s.handlePostConfigProvider(w, r)
	default:
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// handleGetConfigProvider handles GET /api/v1/config/provider.
// Returns the currently active provider/model so the Settings UI can populate
// its form without the user having to re-enter values on every app launch.
func (s *Server) handleGetConfigProvider(w http.ResponseWriter, r *http.Request) {
	if !isLoopback(r) {
		http.Error(w, `{"error":"forbidden: endpoint only available from loopback"}`, http.StatusForbidden)
		return
	}

	s.mu.RLock()
	provider := s.config.LLM.Provider
	configured := s.config.LLM.Configured

	var model, baseURL string
	switch provider {
	case "openai":
		model, _ = s.config.LLM.OpenAI["model"].(string)
	case "anthropic":
		model, _ = s.config.LLM.Anthropic["model"].(string)
	case "ollama":
		model, _ = s.config.LLM.Ollama["model"].(string)
		baseURL, _ = s.config.LLM.Ollama["base_url"].(string)
	case "custom":
		model, _ = s.config.LLM.Custom["model"].(string)
		baseURL, _ = s.config.LLM.Custom["base_url"].(string)
	}
	s.mu.RUnlock()

	resp := configProviderGetResponse{
		Provider:   provider,
		Model:      model,
		Configured: configured,
		BaseURL:    baseURL,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		fmt.Printf("[WARN] handleGetConfigProvider: encode response: %v\n", err)
	}
}

// handlePostConfigProvider handles POST /api/v1/config/provider.
// It re-wires the LLM adapter at runtime without restarting the service.
func (s *Server) handlePostConfigProvider(w http.ResponseWriter, r *http.Request) {
	// ── Loopback-only guard (doc 06, Section 4) ───────────────────────────────
	if !isLoopback(r) {
		http.Error(w, `{"error":"forbidden: endpoint only available from loopback"}`, http.StatusForbidden)
		return
	}

	// ── Parse request ─────────────────────────────────────────────────────────
	var req configProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid JSON: %s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	req.Provider = strings.TrimSpace(strings.ToLower(req.Provider))
	req.Model = strings.TrimSpace(req.Model)
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	req.APIKey = strings.TrimSpace(req.APIKey)

	// ── Validate provider ─────────────────────────────────────────────────────
	switch req.Provider {
	case "anthropic", "openai", "ollama", "custom":
		// valid
	case "":
		http.Error(w, `{"error":"provider is required"}`, http.StatusBadRequest)
		return
	default:
		http.Error(w, fmt.Sprintf(`{"error":"unsupported provider %q; valid values: anthropic, openai, ollama, custom"}`, req.Provider), http.StatusBadRequest)
		return
	}

	// ── Provider-specific validation ──────────────────────────────────────────
	switch req.Provider {
	case "ollama", "custom":
		if req.BaseURL == "" {
			http.Error(w, fmt.Sprintf(`{"error":"base_url is required for provider %q"}`, req.Provider), http.StatusBadRequest)
			return
		}
	}

	// ── Resolve model default ─────────────────────────────────────────────────
	model := req.Model
	if model == "" {
		model = defaultModelForProvider(req.Provider)
	}

	// ── Build new LLM adapter ─────────────────────────────────────────────────
	llmConfig := &adapter.Config{
		Provider: adapter.ProviderType(req.Provider),
		APIKey:   req.APIKey,
		Model:    model,
		BaseURL:  req.BaseURL,
	}

	newAdapter, err := adapter.NewLLMAdapter(llmConfig)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"failed to create LLM adapter: %s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	// ── Hot-wire the adapter and update config ────────────────────────────────
	s.mu.Lock()
	s.llmAdapter = newAdapter

	// Keep the in-memory config in sync so /health and /info reflect the change.
	s.config.LLM.Provider = req.Provider
	s.config.LLM.Configured = true

	switch req.Provider {
	case "openai":
		if s.config.LLM.OpenAI == nil {
			s.config.LLM.OpenAI = make(map[string]interface{})
		}
		s.config.LLM.OpenAI["api_key"] = req.APIKey
		s.config.LLM.OpenAI["model"] = model
	case "anthropic":
		if s.config.LLM.Anthropic == nil {
			s.config.LLM.Anthropic = make(map[string]interface{})
		}
		s.config.LLM.Anthropic["api_key"] = req.APIKey
		s.config.LLM.Anthropic["model"] = model
	case "ollama":
		if s.config.LLM.Ollama == nil {
			s.config.LLM.Ollama = make(map[string]interface{})
		}
		s.config.LLM.Ollama["base_url"] = req.BaseURL
		s.config.LLM.Ollama["model"] = model
	case "custom":
		if s.config.LLM.Custom == nil {
			s.config.LLM.Custom = make(map[string]interface{})
		}
		s.config.LLM.Custom["base_url"] = req.BaseURL
		s.config.LLM.Custom["model"] = model
		if req.APIKey != "" {
			s.config.LLM.Custom["api_key"] = req.APIKey
		}
	}
	s.mu.Unlock()

	// ── Persist to SQLite so config survives restarts ─────────────────────────
	// The api_key is written only to the local SQLite file (app data dir,
	// readable only by the current OS user). It is never sent over the network.
	if s.store != nil {
		cfgRec := &db.LLMConfigRecord{
			Provider:  req.Provider,
			Model:     model,
			APIKey:    req.APIKey,
			BaseURL:   req.BaseURL,
			UpdatedAt: time.Now().UTC(),
		}
		if saveErr := s.store.SaveLLMConfig(context.Background(), cfgRec); saveErr != nil {
			// Non-fatal: hot-wire already succeeded; just log the persistence failure.
			fmt.Printf("[WARN] handlePostConfigProvider: failed to persist config to DB: %v\n", saveErr)
		} else {
			fmt.Printf("[INFO] LLM config persisted to DB: provider=%s model=%s\n", req.Provider, model)
		}
	}

	// ── Build masked key preview (never echo the full key) ────────────────────
	keyPreview := maskAPIKey(req.APIKey)

	// ── Respond ───────────────────────────────────────────────────────────────
	resp := configProviderResponse{
		Provider:   req.Provider,
		Model:      model,
		Configured: true,
		KeyPreview: keyPreview,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		fmt.Printf("[WARN] handlePostConfigProvider: encode response: %v\n", err)
	}

	fmt.Printf("[INFO] LLM provider configured via API: provider=%s model=%s\n", req.Provider, model)
}

// isLoopback returns true iff the request originated from the loopback interface
// (IPv4 127.x.x.x or IPv6 ::1).
func isLoopback(r *http.Request) bool {
	// Strip port from RemoteAddr ("host:port" or "[::1]:port").
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		// Fall back to using RemoteAddr directly (no port present).
		host = r.RemoteAddr
	}

	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}

// maskAPIKey returns a safe display string that reveals only the last 4 chars.
// If the key is empty or very short, returns a generic placeholder.
//
// Examples:
//
//	"sk-ant-api03-abc123...XYZ"  → "sk-ant-api...●●●●XYZ"
//	""                           → ""
func maskAPIKey(key string) string {
	if key == "" {
		return ""
	}
	const tailLen = 4
	if len(key) <= tailLen+4 {
		return "●●●●" + key[len(key)-min(tailLen, len(key)):]
	}
	prefixEnd := 10
	if prefixEnd > len(key)-tailLen {
		prefixEnd = len(key) - tailLen
	}
	return key[:prefixEnd] + "...●●●●" + key[len(key)-tailLen:]
}

// defaultModelForProvider returns the recommended default model for each provider.
func defaultModelForProvider(provider string) string {
	switch provider {
	case "anthropic":
		return "claude-3-5-sonnet-20241022"
	case "openai":
		return "gpt-4o"
	case "ollama":
		return "llama3.2"
	case "custom":
		return "" // custom endpoints vary; let the caller specify
	default:
		return ""
	}
}

// validateAPIKeyRequest is the JSON body accepted by POST /api/v1/config/validate.
type validateAPIKeyRequest struct {
	Provider string `json:"provider"` // anthropic | openai | ollama | custom
	APIKey   string `json:"api_key"`   // API key to validate
	Model    string `json:"model"`    // optional; empty ⇒ provider default
	BaseURL  string `json:"base_url"` // required for ollama / custom
}

// validateAPIKeyResponse is the JSON body returned by POST /api/v1/config/validate.
type validateAPIKeyResponse struct {
	Valid   bool   `json:"valid"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

// handleValidateAPIKey handles POST /api/v1/config/validate.
// It validates an API key by creating a temporary adapter and making a test API call,
// without saving the configuration.
func (s *Server) handleValidateAPIKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	// ── Loopback-only guard ─────────────────────────────────────────────────────
	if !isLoopback(r) {
		http.Error(w, `{"error":"forbidden: endpoint only available from loopback"}`, http.StatusForbidden)
		return
	}

	// ── Parse request ─────────────────────────────────────────────────────────
	var req validateAPIKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid JSON: %s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	req.Provider = strings.TrimSpace(strings.ToLower(req.Provider))
	req.Model = strings.TrimSpace(req.Model)
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	req.APIKey = strings.TrimSpace(req.APIKey)

	// ── Validate provider ─────────────────────────────────────────────────────
	switch req.Provider {
	case "anthropic", "openai", "ollama", "custom":
		// valid
	case "":
		http.Error(w, `{"error":"provider is required"}`, http.StatusBadRequest)
		return
	default:
		http.Error(w, fmt.Sprintf(`{"error":"unsupported provider %q; valid values: anthropic, openai, ollama, custom"}`, req.Provider), http.StatusBadRequest)
		return
	}

	// ── Provider-specific validation ──────────────────────────────────────────
	switch req.Provider {
	case "ollama", "custom":
		if req.BaseURL == "" {
			http.Error(w, fmt.Sprintf(`{"error":"base_url is required for provider %q"}`, req.Provider), http.StatusBadRequest)
			return
		}
	case "anthropic", "openai":
		if req.APIKey == "" {
			http.Error(w, `{"error":"api_key is required"}`, http.StatusBadRequest)
			return
		}
	}

	// ── Resolve model default ─────────────────────────────────────────────────
	model := req.Model
	if model == "" {
		model = defaultModelForProvider(req.Provider)
	}

	// ── Build temporary LLM adapter ───────────────────────────────────────────
	llmConfig := &adapter.Config{
		Provider: adapter.ProviderType(req.Provider),
		APIKey:   req.APIKey,
		Model:    model,
		BaseURL:  req.BaseURL,
	}

	tempAdapter, err := adapter.NewLLMAdapter(llmConfig)
	if err != nil {
		resp := validateAPIKeyResponse{
			Valid: false,
			Error: fmt.Sprintf("failed to create adapter: %s", err.Error()),
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
		return
	}

	// ── Make a test API call to validate the key ──────────────────────────────
	// Use a minimal test message to avoid unnecessary costs
	testCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	testMessages := []types.Message{
		{
			Role:    "user",
			Content: "test",
		},
	}

	_, _, err = tempAdapter.Complete(testCtx, testMessages, nil)
	if err != nil {
		// Check if it's an authentication error
		errMsg := err.Error()
		isAuthError := strings.Contains(errMsg, "401") ||
			strings.Contains(errMsg, "403") ||
			strings.Contains(errMsg, "unauthorized") ||
			strings.Contains(errMsg, "forbidden") ||
			strings.Contains(errMsg, "invalid") ||
			strings.Contains(errMsg, "authentication")

		resp := validateAPIKeyResponse{
			Valid: false,
			Error: errMsg,
		}
		if isAuthError {
			resp.Message = "API key appears to be invalid or expired"
		} else {
			resp.Message = "API key validation failed"
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
		return
	}

	// ── Success ───────────────────────────────────────────────────────────────
	resp := validateAPIKeyResponse{
		Valid:   true,
		Message: "API key is valid",
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}
