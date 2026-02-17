package server

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config represents the server configuration
type Config struct {
	// Server settings
	HTTPPort int    `json:"http_port"`
	GRPCPort int    `json:"grpc_port"`
	Host     string `json:"host"`

	// LLM settings
	LLMProvider string `json:"llm_provider"` // openai, anthropic, ollama, custom
	LLMAPIKey   string `json:"llm_api_key"`
	LLMModel    string `json:"llm_model"`
	LLMBaseURL  string `json:"llm_base_url"`

	// Kubernetes settings
	KubeConfigPath string `json:"kubeconfig_path"`
	InCluster      bool   `json:"in_cluster"`

	// Safety settings
	DefaultAutonomyLevel int  `json:"default_autonomy_level"` // 1-5
	EnableSafetyEngine   bool `json:"enable_safety_engine"`

	// MCP settings
	MCPEnabled bool `json:"mcp_enabled"`

	// Analytics settings
	AnalyticsEnabled bool `json:"analytics_enabled"`

	// WebSocket settings
	// AllowedOrigins is a comma-separated list of permitted WebSocket origins.
	// Use "*" to allow all origins (development only). Defaults to localhost origins.
	AllowedOrigins []string `json:"allowed_origins"`

	// Persistence settings (A-CORE-013)
	// DatabasePath is the path to the SQLite database file.
	// Use ":memory:" for in-memory (non-persistent) storage (default for testing).
	DatabasePath string `json:"database_path"`
}

// LoadConfig loads configuration from environment variables
func LoadConfig() (*Config, error) {
	cfg := &Config{
		// Defaults
		HTTPPort:             8080,
		GRPCPort:             9090,
		Host:                 "0.0.0.0",
		DefaultAutonomyLevel: 3, // Propose level
		EnableSafetyEngine:   true,
		MCPEnabled:           true,
		AnalyticsEnabled:     true,
		InCluster:            false,
	}

	// HTTP Port
	if port := os.Getenv("KUBILITICS_HTTP_PORT"); port != "" {
		p, err := strconv.Atoi(port)
		if err != nil {
			return nil, fmt.Errorf("invalid HTTP_PORT: %w", err)
		}
		cfg.HTTPPort = p
	}

	// GRPC Port
	if port := os.Getenv("KUBILITICS_GRPC_PORT"); port != "" {
		p, err := strconv.Atoi(port)
		if err != nil {
			return nil, fmt.Errorf("invalid GRPC_PORT: %w", err)
		}
		cfg.GRPCPort = p
	}

	// Host
	if host := os.Getenv("KUBILITICS_HOST"); host != "" {
		cfg.Host = host
	}

	// LLM Configuration
	cfg.LLMProvider = os.Getenv("KUBILITICS_LLM_PROVIDER")
	if cfg.LLMProvider == "" {
		cfg.LLMProvider = "openai" // Default to OpenAI
	}

	cfg.LLMAPIKey = os.Getenv("KUBILITICS_LLM_API_KEY")
	cfg.LLMModel = os.Getenv("KUBILITICS_LLM_MODEL")
	cfg.LLMBaseURL = os.Getenv("KUBILITICS_LLM_BASE_URL")

	// Kubernetes Configuration
	cfg.KubeConfigPath = os.Getenv("KUBECONFIG")
	if cfg.KubeConfigPath == "" {
		homeDir, err := os.UserHomeDir()
		if err == nil {
			cfg.KubeConfigPath = fmt.Sprintf("%s/.kube/config", homeDir)
		}
	}

	if os.Getenv("KUBERNETES_SERVICE_HOST") != "" {
		cfg.InCluster = true
	}

	// Autonomy Level
	if level := os.Getenv("KUBILITICS_AUTONOMY_LEVEL"); level != "" {
		l, err := strconv.Atoi(level)
		if err != nil || l < 1 || l > 5 {
			return nil, fmt.Errorf("invalid AUTONOMY_LEVEL (must be 1-5): %s", level)
		}
		cfg.DefaultAutonomyLevel = l
	}

	// Safety Engine
	if safety := os.Getenv("KUBILITICS_ENABLE_SAFETY"); safety != "" {
		cfg.EnableSafetyEngine = safety == "true" || safety == "1"
	}

	// MCP
	if mcp := os.Getenv("KUBILITICS_ENABLE_MCP"); mcp != "" {
		cfg.MCPEnabled = mcp == "true" || mcp == "1"
	}

	// Analytics
	if analytics := os.Getenv("KUBILITICS_ENABLE_ANALYTICS"); analytics != "" {
		cfg.AnalyticsEnabled = analytics == "true" || analytics == "1"
	}

	// Database path (A-CORE-013)
	cfg.DatabasePath = os.Getenv("KUBILITICS_DATABASE_PATH")
	// Default to a local file for production use; ":memory:" is used when not set in tests.

	// WebSocket allowed origins (comma-separated)
	if origins := os.Getenv("KUBILITICS_WS_ALLOWED_ORIGINS"); origins != "" {
		for _, o := range splitCSV(origins) {
			if o != "" {
				cfg.AllowedOrigins = append(cfg.AllowedOrigins, o)
			}
		}
	}

	// Validate
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

// splitCSV splits a comma-separated string into trimmed non-empty parts.
func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			result = append(result, t)
		}
	}
	return result
}

// Validate validates the configuration
func (c *Config) Validate() error {
	// Validate ports
	if c.HTTPPort < 1 || c.HTTPPort > 65535 {
		return fmt.Errorf("invalid HTTP port: %d", c.HTTPPort)
	}
	if c.GRPCPort < 1 || c.GRPCPort > 65535 {
		return fmt.Errorf("invalid GRPC port: %d", c.GRPCPort)
	}

	// Validate LLM provider
	validProviders := map[string]bool{
		"openai":    true,
		"anthropic": true,
		"ollama":    true,
		"custom":    true,
	}
	if !validProviders[c.LLMProvider] {
		return fmt.Errorf("invalid LLM provider: %s (valid: openai, anthropic, ollama, custom)", c.LLMProvider)
	}

	// Validate provider-specific requirements
	if c.LLMProvider == "openai" || c.LLMProvider == "anthropic" {
		if c.LLMAPIKey == "" {
			return fmt.Errorf("%s provider requires KUBILITICS_LLM_API_KEY", c.LLMProvider)
		}
	}

	if c.LLMProvider == "custom" {
		if c.LLMBaseURL == "" {
			return fmt.Errorf("custom provider requires KUBILITICS_LLM_BASE_URL")
		}
	}

	// Validate autonomy level
	if c.DefaultAutonomyLevel < 1 || c.DefaultAutonomyLevel > 5 {
		return fmt.Errorf("invalid autonomy level: %d (must be 1-5)", c.DefaultAutonomyLevel)
	}

	return nil
}
