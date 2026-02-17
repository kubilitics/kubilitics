package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"

	"github.com/kubilitics/kubilitics-backend/internal/api/middleware"
	"github.com/kubilitics/kubilitics-backend/internal/api/rest"
	"github.com/kubilitics/kubilitics-backend/internal/api/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/topologycache"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"github.com/kubilitics/kubilitics-backend/internal/topology"
)

func main() {
	log.Println("🚀 Kubilitics Backend starting...")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Printf("⚠️  Warning: Failed to load config: %v. Using defaults.", err)
		cfg = &config.Config{
			Port:           8080,
			DatabasePath:   "./kubilitics.db",
			LogLevel:       "info",
			AllowedOrigins: []string{"*"},
		}
	}

	log.Printf("📋 Configuration loaded: port=%d, db=%s", cfg.Port, cfg.DatabasePath)

	// Initialize database
	log.Println("💾 Initializing database...")
	repo, err := repository.NewSQLiteRepository(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("❌ Failed to initialize database: %v", err)
	}
	defer repo.Close()

	// Run migrations (001, 002, 003, ...)
	for _, name := range []string{"001_initial_schema.sql", "002_add_cluster_provider.sql", "003_projects.sql", "004_simplify_project_clusters.sql"} {
		migrationSQL, err := os.ReadFile(filepath.Join("migrations", name))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			log.Printf("⚠️  Warning: Could not read migration %s: %v", name, err)
			continue
		}
		if err := repo.RunMigrations(string(migrationSQL)); err != nil {
			log.Printf("⚠️  Warning: Failed to run migration %s: %v", name, err)
		} else {
			log.Printf("✅ Migration %s completed", name)
		}
	}

	// Initialize services (cluster repo for persistence)
	log.Println("⚙️  Initializing services...")
	clusterService := service.NewClusterService(repo, cfg)
	if err := clusterService.LoadClustersFromRepo(ctx); err != nil {
		log.Printf("⚠️  Failed to load clusters from repo: %v", err)
	}
	// Auto-load clusters from default kubeconfig when DB is empty (Docker Desktop, kind, etc.)
	if cfg.KubeconfigAutoLoad {
		list, _ := clusterService.ListClusters(ctx)
		if len(list) == 0 {
			kubeconfigPath := cfg.KubeconfigPath
			if kubeconfigPath == "" {
				kubeconfigPath = os.Getenv("KUBECONFIG")
			}
			if kubeconfigPath == "" {
				if home, _ := os.UserHomeDir(); home != "" {
					kubeconfigPath = filepath.Join(home, ".kube", "config")
				}
			}
			if kubeconfigPath != "" {
				contexts, _, err := k8s.GetKubeconfigContexts(kubeconfigPath)
				if err != nil {
					log.Printf("⚠️  Could not list kubeconfig contexts: %v", err)
				} else {
					for _, contextName := range contexts {
						_, err := clusterService.AddCluster(ctx, kubeconfigPath, contextName)
						if err != nil {
							log.Printf("⚠️  Could not add cluster %q: %v", contextName, err)
						} else {
							log.Printf("✅ Auto-added cluster context: %s", contextName)
						}
					}
				}
			}
		}
	}
	// Log registered clusters so operators see what is available; all resource APIs use these clusters.
	list, _ := clusterService.ListClusters(ctx)
	if len(list) > 0 {
		names := make([]string, 0, len(list))
		for _, c := range list {
			ctxName := c.Context
			if ctxName == "" {
				ctxName = c.Name
			}
			if ctxName == "" {
				ctxName = c.ID
			}
			names = append(names, ctxName)
		}
		log.Printf("📋 Registered %d cluster(s): %s — list/get/patch/delete, metrics, events, logs, topology, scale, exec, shell complete available for all resources", len(list), strings.Join(names, ", "))
	} else {
		log.Println("📋 No clusters registered yet — add via Connect (POST /api/v1/clusters) or ensure kubeconfig_auto_load and default kubeconfig are set")
	}
	var topologyCache *topologycache.Cache
	if cfg != nil && cfg.TopologyCacheTTLSec > 0 {
		topologyCache = topologycache.New(time.Duration(cfg.TopologyCacheTTLSec) * time.Second)
	} else {
		topologyCache = topologycache.New(0)
	}
	topologyService := service.NewTopologyService(clusterService, topologyCache)
	logsService := service.NewLogsService(clusterService)
	eventsService := service.NewEventsService(clusterService)
	metricsService := service.NewMetricsService(clusterService)
	unifiedMetricsService := service.NewUnifiedMetricsService(
		clusterService,
		metrics.NewMetricsServerProvider(),
		metrics.NewControllerMetricsResolver(),
		metrics.NewInMemoryMetricsCache(30*time.Second),
	)
	_ = service.NewExportService(topologyService)

	log.Println("✅ Services initialized")

	// Initialize WebSocket hub (C1.3: topology cache invalidation on resource events)
	log.Println("🔌 Initializing WebSocket hub...")
	wsHub := websocket.NewHub(ctx)
	wsHub.SetTopologyInvalidator(topologyCache.InvalidateForClusterNamespace)
	go wsHub.Run()
	log.Println("✅ WebSocket hub started")

	// Note: Kubernetes informer setup would be done when a cluster is added
	// For now, we'll initialize it when needed

	// Setup HTTP router
	log.Printf("📊 Resource topology supported for: %v", topology.ResourceTopologyKinds)
	// Fail fast if Node is missing (e.g. old binary); prevents 500 on Node detail topology.
	hasNode := false
	for _, k := range topology.ResourceTopologyKinds {
		if k == "Node" {
			hasNode = true
			break
		}
	}
	if !hasNode {
		log.Fatal("topology: Node must be in ResourceTopologyKinds; rebuild backend from current source (make clean && make backend)")
	}
	projectService := service.NewProjectService(repo, repo)
	router := mux.NewRouter()
	handler := rest.NewHandler(clusterService, topologyService, cfg, logsService, eventsService, metricsService, unifiedMetricsService, projectService)

	// Deployment rollout routes on main router (full path) so they always match regardless of subrouter path handling
	router.HandleFunc("/api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollout-history", handler.GetDeploymentRolloutHistory).Methods("GET")
	router.HandleFunc("/api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollback", handler.PostDeploymentRollback).Methods("POST")
	router.HandleFunc("/api/v1/clusters/{clusterId}/shell/stream", handler.GetShellStream).Methods("GET")

	// actualPort is set after we bind; health handler includes it for discovery (e.g. desktop)
	var actualPort int

	// Health check (no request ID needed for health); includes topology_kinds so frontend can detect support
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		body := map[string]interface{}{
			"status":         "healthy",
			"service":        "kubilitics-backend",
			"version":        "1.0.0",
			"topology_kinds": topology.ResourceTopologyKinds,
		}
		if actualPort != 0 {
			body["port"] = actualPort
		}
		_ = json.NewEncoder(w).Encode(body)
	}).Methods("GET")

	// Prometheus metrics (enterprise observability)
	router.Handle("/metrics", promhttp.Handler()).Methods("GET")

	// API routes
	apiRouter := router.PathPrefix("/api/v1").Subrouter()
	rest.SetupRoutes(apiRouter, handler)

	// WebSocket routes
	wsHandler := websocket.NewHandler(ctx, wsHub, nil) // informerMgr will be set per cluster
	router.HandleFunc("/ws/resources", wsHandler.ServeWS).Methods("GET")

	// Main router 404: return JSON so frontend never sees Go default "404 page not found"
	router.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Not found"})
	})

	// Enterprise middleware: secure headers (D1.2), request ID, structured log, metrics, recovery
	router.Use(middleware.SecureHeaders)
	router.Use(middleware.RequestID)
	router.Use(middleware.StructuredLog)
	router.Use(recoveryMiddleware)

	// Rollout path-intercept: handle rollout-history and rollback before the router so they never 404
	routerWrapped := rolloutPathInterceptor(handler, router)

	// Setup CORS
	c := cors.New(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization", "X-Request-ID", "X-Confirm-Destructive"},
		AllowCredentials: true,
	})
	handlerWithCORS := c.Handler(routerWrapped)

	readTimeout := 15 * time.Second
	writeTimeout := 15 * time.Second
	if cfg.RequestTimeoutSec > 0 {
		readTimeout = time.Duration(cfg.RequestTimeoutSec) * time.Second
		writeTimeout = time.Duration(cfg.RequestTimeoutSec) * time.Second
	}
	shutdownTimeout := 10 * time.Second
	if cfg.ShutdownTimeoutSec > 0 {
		shutdownTimeout = time.Duration(cfg.ShutdownTimeoutSec) * time.Second
	}

	// Bind to first available port in [cfg.Port, cfg.Port+99], cap at 8199
	maxPort := cfg.Port + 99
	if maxPort > 8199 {
		maxPort = 8199
	}
	var listener net.Listener
	for port := cfg.Port; port <= maxPort; port++ {
		l, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
		if err != nil {
			var errno *syscall.Errno
			if errors.As(err, &errno) && *errno == syscall.EADDRINUSE {
				continue
			}
			log.Fatalf("❌ Failed to listen: %v", err)
		}
		listener = l
		actualPort = port
		break
	}
	if listener == nil {
		log.Fatalf("❌ No port available in range %d..%d", cfg.Port, maxPort)
	}
	defer listener.Close()

	srv := &http.Server{
		Handler:      handlerWithCORS,
		ReadTimeout:  readTimeout,
		WriteTimeout: writeTimeout,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		log.Printf("🌐 Server listening on http://localhost:%d", actualPort)
		log.Printf("📡 API available at http://localhost:%d/api/v1", actualPort)
		log.Printf("🔌 WebSocket at ws://localhost:%d/ws/resources", actualPort)
		log.Printf("❤️  Health check at http://localhost:%d/health", actualPort)
		log.Printf("📊 Metrics at http://localhost:%d/metrics", actualPort)
		log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("❌ Server failed: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("")
	log.Println("🛑 Shutting down server...")

	// Stop WebSocket hub
	wsHub.Stop()
	log.Println("✅ WebSocket hub stopped")

	// Graceful shutdown: drain in-flight requests
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("⚠️  Server forced to shutdown: %v", err)
	}

	log.Println("✅ Server exited gracefully")
}

func recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("💥 Panic recovered: %v", err)
				http.Error(w, "Internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// rolloutPathInterceptor handles GET .../rollout-history and POST .../rollback before the router so they never 404.
// Path: /api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollout-history or /rollback
func rolloutPathInterceptor(restHandler *rest.Handler, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.Contains(path, "shell/stream") {
			log.Printf("Interceptor: Incoming shell stream request: %s %s", r.Method, path)
		}
		if path == "" {
			path = "/"
		}
		segs := strings.Split(strings.Trim(path, "/"), "/")
		if len(segs) >= 9 && segs[0] == "api" && segs[1] == "v1" && segs[2] == "clusters" && segs[4] == "resources" && segs[5] == "deployments" {
			clusterID := segs[3]
			namespace := segs[6]
			name := segs[7]
			suffix := segs[8]
			if suffix == "rollout-history" && r.Method == http.MethodGet {
				r = rest.SetPathVars(r, map[string]string{"clusterId": clusterID, "namespace": namespace, "name": name})
				restHandler.GetDeploymentRolloutHistory(w, r)
				return
			}
			if suffix == "rollback" && r.Method == http.MethodPost {
				r = rest.SetPathVars(r, map[string]string{"clusterId": clusterID, "namespace": namespace, "name": name})
				restHandler.PostDeploymentRollback(w, r)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
