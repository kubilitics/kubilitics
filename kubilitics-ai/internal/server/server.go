package server

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/analytics"
	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/cost"
	"github.com/kubilitics/kubilitics-ai/internal/db"
	"github.com/kubilitics/kubilitics-ai/internal/llm/budget"
	"github.com/kubilitics/kubilitics-ai/internal/security"
	appconfig "github.com/kubilitics/kubilitics-ai/internal/config"
	"github.com/kubilitics/kubilitics-ai/internal/integration/backend"
	"github.com/kubilitics/kubilitics-ai/internal/integration/events"
	"github.com/kubilitics/kubilitics-ai/internal/llm/adapter"
	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
	mcpserver "github.com/kubilitics/kubilitics-ai/internal/mcp/server"
	reasoningcontext "github.com/kubilitics/kubilitics-ai/internal/reasoning/context"
	reasoningengine "github.com/kubilitics/kubilitics-ai/internal/reasoning/engine"
	reasoningprompt "github.com/kubilitics/kubilitics-ai/internal/reasoning/prompt"
	"github.com/kubilitics/kubilitics-ai/internal/memory/temporal"
	"github.com/kubilitics/kubilitics-ai/internal/memory/vector"
	"github.com/kubilitics/kubilitics-ai/internal/memory/worldmodel"
	"github.com/kubilitics/kubilitics-ai/internal/safety"
)

// Server represents the Kubilitics AI server
type Server struct {
	config *Config

	// Core components
	llmAdapter        adapter.LLMAdapter
	mcpServer         mcpserver.MCPServer
	toolExecutor      *mcpToolExecutor
	safetyEngine      *safety.Engine
	analyticsEngine   *analytics.Engine
	conversationStore *ConversationStore
	reasoningEngine   reasoningengine.ReasoningEngine

	// Backend integration (A-CORE-008)
	backendProxy *backend.Proxy
	eventHandler events.EventHandler

	// Memory layer (A-CORE-009)
	worldModel    *worldmodel.WorldModel
	queryAPI      *worldmodel.QueryAPI
	temporalStore temporal.TemporalStore
	vectorStore   vector.VectorStore

	// Analytics pipeline (A-CORE-010)
	analyticsPipeline *analytics.Pipeline

	// Cost intelligence pipeline (A-CORE-011)
	costPipeline *cost.CostPipeline

	// Security analysis engine (A-CORE-012)
	securityEngine *security.SecurityEngine

	// Persistence store (A-CORE-013)
	store db.Store

	// Token budget tracker (A-CORE-014)
	budgetTracker budget.BudgetTracker

	// HTTP server
	httpServer *http.Server

	// Lifecycle
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	// State
	mu      sync.RWMutex
	running bool
}

// NewServer creates a new Kubilitics AI server
func NewServer(cfg *Config) (*Server, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config cannot be nil")
	}

	ctx, cancel := context.WithCancel(context.Background())

	srv := &Server{
		config:  cfg,
		ctx:     ctx,
		cancel:  cancel,
		running: false,
	}

	// Initialize components
	if err := srv.initializeComponents(); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to initialize components: %w", err)
	}

	return srv, nil
}

// initializeComponents initializes all server components
func (s *Server) initializeComponents() error {
	// 1. Initialize LLM Adapter
	llmConfig := &adapter.Config{
		Provider: adapter.ProviderType(s.config.LLMProvider),
		APIKey:   s.config.LLMAPIKey,
		Model:    s.config.LLMModel,
		BaseURL:  s.config.LLMBaseURL,
	}

	llmAdapter, err := adapter.NewLLMAdapter(llmConfig)
	if err != nil {
		return fmt.Errorf("failed to initialize LLM adapter: %w", err)
	}
	s.llmAdapter = llmAdapter

	// 2. Initialize Safety Engine (if enabled)
	if s.config.EnableSafetyEngine {
		safetyEngine, err := safety.NewEngine()
		if err != nil {
			return fmt.Errorf("failed to initialize safety engine: %w", err)
		}
		s.safetyEngine = safetyEngine
	}

	// 3. Initialize Analytics Engine (if enabled)
	if s.config.AnalyticsEnabled {
		s.analyticsEngine = analytics.NewEngine()
	}

	// 4. Initialize Conversation Store (always on)
	s.conversationStore = NewConversationStore()

	// 5. Initialize MCP server (if enabled)
	if s.config.MCPEnabled {
		// Build minimal appconfig.Config from our server Config.
		mcpCfg := &appconfig.Config{}
		mcpCfg.Backend.HTTPBaseURL = s.config.LLMBaseURL // best-effort; proxy uses its own env

		// Audit logger — use default (logs to stderr / files).
		auditLogger, err := audit.NewLogger(nil)
		if err != nil {
			// Non-fatal: log and proceed without MCP tooling.
			fmt.Printf("warning: failed to create audit logger: %v\n", err)
		} else {
			// Backend proxy — connects to kubilitics-backend over HTTP.
			backendProxy, err := backend.NewProxy(mcpCfg, auditLogger)
			if err != nil {
				fmt.Printf("warning: failed to create backend proxy: %v\n", err)
			} else {
				mcp, err := mcpserver.NewMCPServer(mcpCfg, backendProxy, auditLogger)
				if err != nil {
					fmt.Printf("warning: failed to initialize MCP server: %v\n", err)
				} else {
					s.mcpServer = mcp
					s.toolExecutor = newMCPToolExecutor(mcp)
				}
			}
		}
	}

	// 6. Initialize Reasoning Engine
	{
		auditLogger, _ := audit.NewLogger(nil)
		mcpCfg := &appconfig.Config{}
		bProxy, _ := backend.NewProxy(mcpCfg, auditLogger)

		// Wire backend proxy and event handler for A-CORE-008.
		s.backendProxy = bProxy
		s.eventHandler = events.NewEventHandler()

		// 7. Initialize Memory layer (A-CORE-009)
		s.worldModel = worldmodel.NewWorldModel()
		s.queryAPI = worldmodel.NewQueryAPI(s.worldModel)
		s.temporalStore = temporal.NewTemporalStore()
		s.vectorStore = vector.NewVectorStore()

		// 8. Initialize Analytics Pipeline (A-CORE-010)
		// The pipeline uses bProxy as MetricsFetcher; it starts background scraping lazily.
		s.analyticsPipeline = analytics.NewPipeline(bProxy)

		// 9. Initialize Cost Intelligence Pipeline (A-CORE-011)
		// Uses bProxy as ResourceFetcher for live cluster resource scraping.
		s.costPipeline = cost.NewCostPipeline(bProxy, cost.ProviderGeneric)

		// 10. Initialize Security Analysis Engine (A-CORE-012)
		// Uses bProxy as ResourceFetcher for live RBAC, pod security, network policy, and secret analysis.
		s.securityEngine = security.NewSecurityEngine(bProxy)

		// 11. Initialize Persistence Store (A-CORE-013)
		// SQLite-backed store for audit logs, conversations, anomaly history, and cost snapshots.
		dbPath := s.config.DatabasePath
		if dbPath == "" {
			dbPath = ":memory:"
		}
		if store, err := db.NewSQLiteStore(dbPath); err == nil {
			s.store = store
		}

		// 12. Initialize Token Budget Tracker (A-CORE-014)
		// In-memory tracker with configurable per-user and global limits.
		s.budgetTracker = budget.NewBudgetTracker()

		ctxBuilder := reasoningcontext.NewContextBuilderWithProxy(bProxy)
		promptMgr := reasoningprompt.NewPromptManager()

		// Build tool schemas from MCP server if available
		var toolSchemas []types.Tool
		if s.mcpServer != nil {
			mcpTools, err := s.mcpServer.ListTools(context.Background())
			if err == nil {
				for _, t := range mcpTools {
					toolSchemas = append(toolSchemas, types.Tool{
						Name:        t.Name,
						Description: t.Description,
						Parameters:  toMap(t.InputSchema),
					})
				}
			}
		}

		s.reasoningEngine = reasoningengine.NewReasoningEngine(
			ctxBuilder,
			promptMgr,
			s.llmAdapter,
			s.toolExecutor,
			toolSchemas,
			auditLogger,
		)
	}

	return nil
}

// Start starts the server
func (s *Server) Start() error {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return fmt.Errorf("server is already running")
	}
	s.running = true
	s.mu.Unlock()

	// Setup HTTP server
	mux := http.NewServeMux()
	s.registerHandlers(mux)

	s.httpServer = &http.Server{
		Addr:         fmt.Sprintf("%s:%d", s.config.Host, s.config.HTTPPort),
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start HTTP server
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		fmt.Printf("Starting HTTP server on %s:%d\n", s.config.Host, s.config.HTTPPort)
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("HTTP server error: %v\n", err)
		}
	}()

	fmt.Println("Kubilitics AI Server started successfully")
	fmt.Printf("  LLM Provider: %s\n", s.config.LLMProvider)
	fmt.Printf("  Safety Engine: %v\n", s.config.EnableSafetyEngine)
	fmt.Printf("  Analytics: %v\n", s.config.AnalyticsEnabled)
	fmt.Printf("  Autonomy Level: %d\n", s.config.DefaultAutonomyLevel)

	return nil
}

// Stop gracefully stops the server
func (s *Server) Stop() error {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return fmt.Errorf("server is not running")
	}
	s.running = false
	s.mu.Unlock()

	fmt.Println("Stopping Kubilitics AI Server...")

	// Shutdown HTTP server
	if s.httpServer != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
			fmt.Printf("Error shutting down HTTP server: %v\n", err)
		}
	}

	// Cancel context
	s.cancel()

	// Wait for goroutines
	s.wg.Wait()

	fmt.Println("Kubilitics AI Server stopped")
	return nil
}

// Wait blocks until the server is stopped
func (s *Server) Wait() {
	<-s.ctx.Done()
}

// IsRunning returns whether the server is running
func (s *Server) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

// GetLLMAdapter returns the LLM adapter
func (s *Server) GetLLMAdapter() adapter.LLMAdapter {
	return s.llmAdapter
}

// GetMCPServer returns the MCP server (may be nil if not enabled or init failed).
func (s *Server) GetMCPServer() mcpserver.MCPServer {
	return s.mcpServer
}

// GetToolExecutor returns the tool executor (may be nil).
func (s *Server) GetToolExecutor() *mcpToolExecutor {
	return s.toolExecutor
}

// GetSafetyEngine returns the safety engine
func (s *Server) GetSafetyEngine() *safety.Engine {
	return s.safetyEngine
}

// GetAnalyticsEngine returns the analytics engine
func (s *Server) GetAnalyticsEngine() *analytics.Engine {
	return s.analyticsEngine
}

// GetReasoningEngine returns the reasoning engine.
func (s *Server) GetReasoningEngine() reasoningengine.ReasoningEngine {
	return s.reasoningEngine
}

// registerHandlers registers HTTP handlers
func (s *Server) registerHandlers(mux *http.ServeMux) {
	// Health check
	mux.HandleFunc("/health", s.handleHealth)

	// Readiness check
	mux.HandleFunc("/ready", s.handleReady)

	// Info endpoint
	mux.HandleFunc("/info", s.handleInfo)

	// LLM endpoints
	mux.HandleFunc("/api/v1/llm/complete", s.handleLLMComplete)
	mux.HandleFunc("/api/v1/llm/stream", s.handleLLMStream)

	// Safety endpoints
	if s.safetyEngine != nil {
		mux.HandleFunc("/api/v1/safety/evaluate", s.handleSafetyEvaluate)
		mux.HandleFunc("/api/v1/safety/rules", s.handleSafetyRules)
		mux.HandleFunc("/api/v1/safety/policies", s.handleSafetyPolicies)
		mux.HandleFunc("/api/v1/safety/policies/", s.handleSafetyPolicyByName)
		mux.HandleFunc("/api/v1/safety/autonomy/", s.handleSafetyAutonomy)
		mux.HandleFunc("/api/v1/safety/approvals", s.handleSafetyApprovals)
		mux.HandleFunc("/api/v1/safety/approvals/", s.handleSafetyApprovals)
	}

	// Analytics endpoints (simple engine-backed)
	if s.analyticsEngine != nil {
		mux.HandleFunc("/api/v1/analytics/anomalies", s.handleAnalyticsAnomalies)
		mux.HandleFunc("/api/v1/analytics/trends", s.handleAnalyticsTrends)
		mux.HandleFunc("/api/v1/analytics/recommendations", s.handleAnalyticsRecommendations)
	}

	// ML analytics endpoints (A-CORE-ML) — always available, no engine dependency.
	// These handlers (ml_handlers.go) implement Isolation Forest anomaly detection
	// and ARIMA time-series forecasting using only in-process math.
	mux.HandleFunc("/api/v1/analytics/ml/anomalies", s.handleMLAnomalies)
	mux.HandleFunc("/api/v1/analytics/ml/models", s.handleMLModels)
	mux.HandleFunc("/api/v1/analytics/forecast", s.handleForecast)

	// Wizard AI suggestion endpoints (E-PLAT-006)
	mux.HandleFunc("/api/v1/wizards/", s.handleWizardDispatch)
	mux.HandleFunc("/api/v1/wizards/suggest", s.handleWizardDispatch)
	mux.HandleFunc("/api/v1/wizards/validate", s.handleWizardDispatch)

	// Topology AI analysis endpoints (E-PLAT-001)
	mux.HandleFunc("/api/v1/topology/analyze", s.handleTopologyAnalyze)
	mux.HandleFunc("/api/v1/topology/critical-path", s.handleCriticalPath)
	mux.HandleFunc("/api/v1/topology/node-explain", s.handleNodeExplain)

	// WebSocket endpoint for AI chat
	mux.HandleFunc("/ws/chat", s.handleWebSocket)

	// Conversation endpoints
	mux.HandleFunc("/api/v1/conversations", s.handleConversationsList)
	mux.HandleFunc("/api/v1/conversations/", s.handleConversationGet)

	// Investigation endpoints (A-CORE-005)
	mux.HandleFunc("/api/v1/investigations", s.handleInvestigations)
	mux.HandleFunc("/api/v1/investigations/", s.handleInvestigationByID)
	mux.HandleFunc("/ws/investigations/", s.handleInvestigationStream)

	// Backend status and events endpoints (A-CORE-008)
	mux.HandleFunc("/api/v1/backend/status", s.handleBackendStatus)
	mux.HandleFunc("/api/v1/backend/events", s.handleBackendEvents)

	// Memory endpoints (A-CORE-009)
	mux.HandleFunc("/api/v1/memory/", s.handleMemory)
	mux.HandleFunc("/api/v1/memory", s.handleMemory)

	// Analytics pipeline endpoints (A-CORE-010)
	mux.HandleFunc("/api/v1/analytics/pipeline/", s.handleAnalyticsPipeline)
	mux.HandleFunc("/api/v1/analytics/pipeline", s.handleAnalyticsPipeline)

	// Cost intelligence endpoints (A-CORE-011)
	mux.HandleFunc("/api/v1/cost/", s.handleCostDispatch)
	mux.HandleFunc("/api/v1/cost", s.handleCostDispatch)

	// Security analysis endpoints (A-CORE-012)
	mux.HandleFunc("/api/v1/security/", s.handleSecurityDispatch)
	mux.HandleFunc("/api/v1/security", s.handleSecurityDispatch)

	// Persistence layer endpoints (A-CORE-013)
	mux.HandleFunc("/api/v1/persistence/", s.handlePersistenceDispatch)
	mux.HandleFunc("/api/v1/persistence", s.handlePersistenceDispatch)

	// Token budget endpoints (A-CORE-014)
	mux.HandleFunc("/api/v1/budget/", s.handleBudgetDispatch)
	mux.HandleFunc("/api/v1/budget", s.handleBudgetDispatch)
}

// handleHealth handles health check requests
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"healthy","timestamp":"` + time.Now().Format(time.RFC3339) + `"}`))
}

// handleReady handles readiness check requests
func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.RLock()
	ready := s.running && s.llmAdapter != nil
	s.mu.RUnlock()

	if !ready {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte(`{"status":"not_ready"}`))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ready","timestamp":"` + time.Now().Format(time.RFC3339) + `"}`))
}

// handleInfo handles info requests
func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	info := fmt.Sprintf(`{
		"name":"Kubilitics AI",
		"version":"0.1.0",
		"llm_provider":"%s",
		"safety_engine_enabled":%v,
		"analytics_enabled":%v,
		"autonomy_level":%d,
		"timestamp":"%s"
	}`,
		s.config.LLMProvider,
		s.config.EnableSafetyEngine,
		s.config.AnalyticsEnabled,
		s.config.DefaultAutonomyLevel,
		time.Now().Format(time.RFC3339),
	)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(info))
}

// toMap safely converts an interface{} to map[string]interface{}.
func toMap(v interface{}) map[string]interface{} {
	if v == nil {
		return nil
	}
	if m, ok := v.(map[string]interface{}); ok {
		return m
	}
	return nil
}

// API endpoint handlers are implemented in handlers.go and websocket.go
