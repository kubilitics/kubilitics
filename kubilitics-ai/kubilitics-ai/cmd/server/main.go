package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/config"
)

const (
	version = "0.1.0"
	banner  = `
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ██╗  ██╗██╗   ██╗██████╗ ██╗██╗     ██╗████████╗██╗ ██████╗███████╗
║   ██║ ██╔╝██║   ██║██╔══██╗██║██║     ██║╚══██╔══╝██║██╔════╝██╔════╝
║   █████╔╝ ██║   ██║██████╔╝██║██║     ██║   ██║   ██║██║     ███████╗
║   ██╔═██╗ ██║   ██║██╔══██╗██║██║     ██║   ██║   ██║██║     ╚════██║
║   ██║  ██╗╚██████╔╝██████╔╝██║███████╗██║   ██║   ██║╚██████╗███████║
║   ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝   ╚═╝ ╚═════╝╚══════╝
║                                                           ║
║                    AI Intelligence Layer                 ║
║                        Version %s                        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`
)

var (
	configPath = flag.String("config", "config.yaml", "Path to configuration file")
	port       = flag.Int("port", 0, "Server port (overrides config)")
	debugMode  = flag.Bool("debug", false, "Enable debug logging")
)

// HealthResponse represents the health check response
type HealthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

func main() {
	flag.Parse()

	// Print startup banner
	fmt.Printf(banner, version)
	fmt.Printf("\nStarting Kubilitics AI Intelligence Layer...\n")
	fmt.Printf("Version: %s\n", version)
	fmt.Printf("Configuration: %s\n\n", *configPath)

	// Create root context
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Load configuration
	fmt.Println("Loading configuration...")
	cfg, err := loadConfiguration(ctx, *configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: Failed to load configuration: %v\n", err)
		os.Exit(1)
	}

	// Apply CLI overrides
	if *port != 0 {
		cfg.Server.Port = *port
		fmt.Printf("Port overridden via CLI: %d\n", *port)
	}

	fmt.Printf("Server will listen on port: %d\n", cfg.Server.Port)
	fmt.Printf("Backend address: %s\n", cfg.Backend.Address)
	fmt.Printf("LLM Provider: %s\n", cfg.LLM.Provider)
	fmt.Printf("Autonomy Level: %d (%s)\n\n", cfg.Autonomy.DefaultLevel, autonomyLevelName(cfg.Autonomy.DefaultLevel))

	// Create HTTP server
	mux := http.NewServeMux()

	// Register health endpoints
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/healthz", healthHandler)

	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Channel to signal server errors
	serverErrors := make(chan error, 1)

	// Start HTTP server in goroutine
	go func() {
		fmt.Printf("✓ HTTP server starting on %s\n", server.Addr)
		serverErrors <- server.ListenAndServe()
	}()

	// Setup signal handling for graceful shutdown
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	// Wait for shutdown signal or server error
	select {
	case err := <-serverErrors:
		fmt.Fprintf(os.Stderr, "ERROR: Server failed to start: %v\n", err)
		os.Exit(1)

	case sig := <-shutdown:
		fmt.Printf("\n\nReceived signal: %v\n", sig)
		fmt.Println("Initiating graceful shutdown...")

		// Cancel root context
		cancel()

		// Give outstanding requests 30 seconds to complete
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()

		// Attempt graceful shutdown
		if err := server.Shutdown(shutdownCtx); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: Graceful shutdown failed: %v\n", err)
			fmt.Println("Forcing shutdown...")
			if err := server.Close(); err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: Failed to close server: %v\n", err)
			}
			os.Exit(1)
		}

		fmt.Println("✓ Server stopped gracefully")
		fmt.Println("✓ All connections closed")
		fmt.Println("Goodbye!")
	}
}

// loadConfiguration loads and validates configuration
func loadConfiguration(ctx context.Context, cfgPath string) (*config.Config, error) {
	// Create config manager
	mgr, err := config.NewConfigManager(cfgPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create config manager: %w", err)
	}

	// Load configuration
	if err := mgr.Load(ctx); err != nil {
		return nil, fmt.Errorf("failed to load configuration: %w", err)
	}

	// Validate configuration
	if err := mgr.Validate(ctx); err != nil {
		return nil, fmt.Errorf("configuration validation failed: %w", err)
	}

	// Get configuration
	cfg := mgr.Get(ctx)
	return cfg, nil
}

// healthHandler handles health check requests
func healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	response := HealthResponse{
		Status:  "healthy",
		Version: version,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	if err := json.NewEncoder(w).Encode(response); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: Failed to encode health response: %v\n", err)
	}
}

// autonomyLevelName returns the human-readable name for an autonomy level
func autonomyLevelName(level int) string {
	names := map[int]string{
		0: "Observe",
		1: "Diagnose",
		2: "Propose",
		3: "Simulate",
		4: "Act-with-Guard",
		5: "Full-Autonomous",
	}
	if name, ok := names[level]; ok {
		return name
	}
	return "Unknown"
}
