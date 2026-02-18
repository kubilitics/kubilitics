package config

import (
	"os"
	"testing"
)

func TestLoad_Defaults(t *testing.T) {
	// Clear environment variables
	os.Clearenv()
	
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}
	if cfg == nil {
		t.Fatal("Config should not be nil")
	}
	
	// Check defaults
	if cfg.Port != 819 {
		t.Errorf("Expected default port 819, got %d", cfg.Port)
	}
	if cfg.DatabasePath != "./kubilitics.db" {
		t.Errorf("Expected default database path './kubilitics.db', got %s", cfg.DatabasePath)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("Expected default log level 'info', got %s", cfg.LogLevel)
	}
	if cfg.LogFormat != "json" {
		t.Errorf("Expected default log format 'json', got %s", cfg.LogFormat)
	}
	if cfg.AuthMode != "disabled" {
		t.Errorf("Expected default auth mode 'disabled', got %s", cfg.AuthMode)
	}
	if cfg.TLSEnabled {
		t.Error("Expected default TLS to be disabled")
	}
}

func TestLoad_EnvironmentVariables(t *testing.T) {
	// Set environment variables
	os.Setenv("KUBILITICS_PORT", "9000")
	os.Setenv("KUBILITICS_DATABASE_PATH", "/tmp/test.db")
	os.Setenv("KUBILITICS_LOG_LEVEL", "debug")
	os.Setenv("KUBILITICS_AUTH_MODE", "required")
	defer func() {
		os.Unsetenv("KUBILITICS_PORT")
		os.Unsetenv("KUBILITICS_DATABASE_PATH")
		os.Unsetenv("KUBILITICS_LOG_LEVEL")
		os.Unsetenv("KUBILITICS_AUTH_MODE")
	}()
	
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}
	
	if cfg.Port != 9000 {
		t.Errorf("Expected port 9000 from env, got %d", cfg.Port)
	}
	if cfg.DatabasePath != "/tmp/test.db" {
		t.Errorf("Expected database path '/tmp/test.db' from env, got %s", cfg.DatabasePath)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("Expected log level 'debug' from env, got %s", cfg.LogLevel)
	}
	if cfg.AuthMode != "required" {
		t.Errorf("Expected auth mode 'required' from env, got %s", cfg.AuthMode)
	}
}

func TestLoad_AllowedOriginsCommaSeparated(t *testing.T) {
	os.Setenv("KUBILITICS_ALLOWED_ORIGINS", "http://localhost:3000,https://example.com,http://localhost:5173")
	defer os.Unsetenv("KUBILITICS_ALLOWED_ORIGINS")
	
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}
	
	if len(cfg.AllowedOrigins) != 3 {
		t.Errorf("Expected 3 allowed origins, got %d", len(cfg.AllowedOrigins))
	}
	if cfg.AllowedOrigins[0] != "http://localhost:3000" {
		t.Errorf("Expected first origin 'http://localhost:3000', got %s", cfg.AllowedOrigins[0])
	}
	if cfg.AllowedOrigins[1] != "https://example.com" {
		t.Errorf("Expected second origin 'https://example.com', got %s", cfg.AllowedOrigins[1])
	}
	if cfg.AllowedOrigins[2] != "http://localhost:5173" {
		t.Errorf("Expected third origin 'http://localhost:5173', got %s", cfg.AllowedOrigins[2])
	}
}

func TestLoad_MissingConfigFile(t *testing.T) {
	// Clear environment and use non-existent config file
	os.Clearenv()
	
	cfg, err := Load()
	// Should not error even if config file doesn't exist
	if err != nil {
		t.Fatalf("Load should not error when config file is missing: %v", err)
	}
	if cfg == nil {
		t.Fatal("Config should not be nil even without config file")
	}
}
