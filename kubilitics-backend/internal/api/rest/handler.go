package rest

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/drawio"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"github.com/kubilitics/kubilitics-backend/internal/topology"
	"github.com/kubilitics/kubilitics-backend/internal/api/middleware"
	"golang.org/x/time/rate"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Handler manages HTTP request handlers
type Handler struct {
	clusterService        service.ClusterService
	topologyService       service.TopologyService
	logsService           service.LogsService
	eventsService         service.EventsService
	metricsService        service.MetricsService
	unifiedMetricsService *service.UnifiedMetricsService
	projSvc               service.ProjectService
	cfg                   *config.Config
	repo                  *repository.SQLiteRepository // BE-AUTHZ-001: for RBAC filtering (can be nil if auth disabled)
	kcliLimiterMu         sync.Mutex
	kcliLimiters          map[string]*rate.Limiter
	kcliStreamMu          sync.Mutex
	kcliStreamActive      map[string]int
}

// NewHandler creates a new HTTP handler. unifiedMetricsService can be nil; then metrics summary uses legacy per-resource endpoints. projSvc can be nil; then project routes return 501. repo can be nil if auth is disabled.
func NewHandler(cs service.ClusterService, ts service.TopologyService, cfg *config.Config, logsService service.LogsService, eventsService service.EventsService, metricsService service.MetricsService, unifiedMetricsService *service.UnifiedMetricsService, projSvc service.ProjectService, repo *repository.SQLiteRepository) *Handler {
	if cfg == nil {
		cfg = &config.Config{}
	}
	return &Handler{
		clusterService:        cs,
		topologyService:       ts,
		logsService:           logsService,
		eventsService:         eventsService,
		metricsService:        metricsService,
		unifiedMetricsService: unifiedMetricsService,
		projSvc:               projSvc,
		cfg:                   cfg,
		repo:                  repo,
		kcliLimiters:          map[string]*rate.Limiter{},
		kcliStreamActive:      map[string]int{},
	}
}

// resolveClusterID returns clusterID if GetClient(clusterID) succeeds; otherwise looks up by Context or Name (e.g. "docker-desktop") so frontend can pass either backend UUID or context name.
func (h *Handler) resolveClusterID(ctx context.Context, clusterID string) (string, error) {
	if _, err := h.clusterService.GetClient(clusterID); err == nil {
		return clusterID, nil
	}
	clusters, listErr := h.clusterService.ListClusters(ctx)
	if listErr != nil {
		return "", listErr
	}
	for _, c := range clusters {
		if c.Context == clusterID || c.Name == clusterID {
			return c.ID, nil
		}
	}
	return "", fmt.Errorf("cluster not found: %s", clusterID)
}

// wrapWithRBAC wraps a handler with RBAC middleware if auth is enabled (BE-AUTHZ-001).
func (h *Handler) wrapWithRBAC(handler http.HandlerFunc, minRole string) http.Handler {
	if h.cfg.AuthMode == "" || h.cfg.AuthMode == "disabled" || h.repo == nil {
		return http.HandlerFunc(handler)
	}
	switch minRole {
	case auth.RoleAdmin:
		return middleware.RequireAdmin(h.repo)(http.HandlerFunc(handler))
	case auth.RoleOperator:
		return middleware.RequireOperator(h.repo)(http.HandlerFunc(handler))
	case auth.RoleViewer:
		return middleware.RequireViewer(h.repo)(http.HandlerFunc(handler))
	default:
		return http.HandlerFunc(handler)
	}
}

func SetupRoutes(router *mux.Router, h *Handler) {
	// API versioning discovery
	router.HandleFunc("/versions", h.GetVersions).Methods("GET")

	// Cluster discovery MUST be registered before {clusterId} parameter route
	router.HandleFunc("/clusters/discover", h.DiscoverClusters).Methods("GET")

	// Capabilities (e.g. resource topology kinds) so clients can verify backend support
	router.HandleFunc("/capabilities", h.GetCapabilities).Methods("GET")

	// Audit log (BE-SEC-002): admin-only, append-only; ?format=csv for export
	router.Handle("/audit-log", h.wrapWithRBAC(h.ListAuditLog, auth.RoleAdmin)).Methods("GET")

	// Project routes (multi-cluster, multi-tenancy)
	router.Handle("/projects", h.wrapWithRBAC(h.ListProjects, auth.RoleViewer)).Methods("GET")
	router.Handle("/projects", h.wrapWithRBAC(h.CreateProject, auth.RoleAdmin)).Methods("POST")
	router.Handle("/projects/{projectId}", h.wrapWithRBAC(h.GetProject, auth.RoleViewer)).Methods("GET")
	router.Handle("/projects/{projectId}", h.wrapWithRBAC(h.UpdateProject, auth.RoleAdmin)).Methods("PATCH")
	router.Handle("/projects/{projectId}", h.wrapWithRBAC(h.DeleteProject, auth.RoleAdmin)).Methods("DELETE")
	router.Handle("/projects/{projectId}/clusters", h.wrapWithRBAC(h.AddClusterToProject, auth.RoleAdmin)).Methods("POST")
	router.Handle("/projects/{projectId}/clusters/{clusterId}", h.wrapWithRBAC(h.RemoveClusterFromProject, auth.RoleAdmin)).Methods("DELETE")
	router.Handle("/projects/{projectId}/namespaces", h.wrapWithRBAC(h.AddNamespaceToProject, auth.RoleAdmin)).Methods("POST")
	router.Handle("/projects/{projectId}/namespaces/{clusterId}/{namespaceName}", h.wrapWithRBAC(h.RemoveNamespaceFromProject, auth.RoleAdmin)).Methods("DELETE")

	// Cluster routes (BE-AUTHZ-001: GET = viewer, POST/DELETE = admin)
	router.Handle("/clusters", h.wrapWithRBAC(h.ListClusters, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters", h.wrapWithRBAC(h.AddCluster, auth.RoleAdmin)).Methods("POST")
	router.Handle("/clusters/{clusterId}", h.wrapWithRBAC(h.GetCluster, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}", h.wrapWithRBAC(h.RemoveCluster, auth.RoleAdmin)).Methods("DELETE")
	router.Handle("/clusters/{clusterId}/summary", h.wrapWithRBAC(h.GetClusterSummary, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/overview", h.wrapWithRBAC(h.GetClusterOverview, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/workloads", h.wrapWithRBAC(h.GetWorkloadsOverview, auth.RoleViewer)).Methods("GET")

	// Topology routes (BE-AUTHZ-001: GET = viewer, POST export = operator)
	router.Handle("/clusters/{clusterId}/topology", h.wrapWithRBAC(h.GetTopology, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/topology/resource/{kind}/{namespace}/{name}", h.wrapWithRBAC(h.GetResourceTopology, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/topology/export", h.wrapWithRBAC(h.ExportTopology, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/topology/export/drawio", h.wrapWithRBAC(h.GetTopologyExportDrawio, auth.RoleViewer)).Methods("GET")

	// Global search (command palette): GET /clusters/{clusterId}/search?q=...&limit=25
	router.Handle("/clusters/{clusterId}/search", h.wrapWithRBAC(h.GetSearch, auth.RoleViewer)).Methods("GET")

	// Cluster features (e.g. MetalLB detection)
	router.Handle("/clusters/{clusterId}/features/metallb", h.wrapWithRBAC(h.GetMetalLBFeature, auth.RoleViewer)).Methods("GET")

	// CRD instances: list custom resources by CRD name (must be before generic resources)
	router.Handle("/clusters/{clusterId}/crd-instances/{crdName}", h.wrapWithRBAC(h.ListCRDInstances, auth.RoleViewer)).Methods("GET")

	// Resource routes — specific subpaths must be registered before the generic {kind}/{namespace}/{name} route
	// BE-AUTHZ-001: GET = viewer, POST/PATCH/DELETE = operator
	router.Handle("/clusters/{clusterId}/resources/{kind}", h.wrapWithRBAC(h.ListResources, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollout-history", h.wrapWithRBAC(h.GetDeploymentRolloutHistory, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollback", h.wrapWithRBAC(h.PostDeploymentRollback, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/trigger", h.wrapWithRBAC(h.PostCronJobTrigger, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/jobs", h.wrapWithRBAC(h.GetCronJobJobs, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/jobs/{namespace}/{name}/retry", h.wrapWithRBAC(h.PostJobRetry, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/resources/services/{namespace}/{name}/endpoints", h.wrapWithRBAC(h.GetServiceEndpoints, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/configmaps/{namespace}/{name}/consumers", h.wrapWithRBAC(h.GetConfigMapConsumers, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/secrets/{namespace}/{name}/consumers", h.wrapWithRBAC(h.GetSecretConsumers, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/secrets/{namespace}/{name}/tls-info", h.wrapWithRBAC(h.GetSecretTLSInfo, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/persistentvolumeclaims/{namespace}/{name}/consumers", h.wrapWithRBAC(h.GetPVCConsumers, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/storageclasses/pv-counts", h.wrapWithRBAC(h.GetStorageClassPVCounts, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/namespaces/counts", h.wrapWithRBAC(h.GetNamespaceCounts, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/serviceaccounts/token-counts", h.wrapWithRBAC(h.GetServiceAccountTokenCounts, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/{kind}/{namespace}/{name}", h.wrapWithRBAC(h.GetResource, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/{kind}/{namespace}/{name}", h.wrapWithRBAC(h.PatchResource, auth.RoleOperator)).Methods("PATCH")
	router.Handle("/clusters/{clusterId}/resources/{kind}/{namespace}/{name}", h.wrapWithRBAC(h.DeleteResource, auth.RoleOperator)).Methods("DELETE")
	router.Handle("/clusters/{clusterId}/apply", h.wrapWithRBAC(h.ApplyManifest, auth.RoleOperator)).Methods("POST")

	// Logs routes (BE-AUTHZ-001: viewer can read logs)
	router.Handle("/clusters/{clusterId}/logs/{namespace}/{pod}", h.wrapWithRBAC(h.GetPodLogs, auth.RoleViewer)).Methods("GET")

	// Metrics routes: unified summary first (resource-agnostic), then legacy per-resource
	router.Handle("/clusters/{clusterId}/metrics/summary", h.wrapWithRBAC(h.GetMetricsSummary, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics", h.wrapWithRBAC(h.GetClusterMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/nodes/{nodeName}", h.wrapWithRBAC(h.GetNodeMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/deployment/{name}", h.wrapWithRBAC(h.GetDeploymentMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/replicaset/{name}", h.wrapWithRBAC(h.GetReplicaSetMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/statefulset/{name}", h.wrapWithRBAC(h.GetStatefulSetMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/daemonset/{name}", h.wrapWithRBAC(h.GetDaemonSetMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/job/{name}", h.wrapWithRBAC(h.GetJobMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/cronjob/{name}", h.wrapWithRBAC(h.GetCronJobMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/{pod}", h.wrapWithRBAC(h.GetPodMetrics, auth.RoleViewer)).Methods("GET")

	// Events routes
	router.Handle("/clusters/{clusterId}/events", h.wrapWithRBAC(h.GetEvents, auth.RoleViewer)).Methods("GET")

	// Pod exec (WebSocket) - BE-AUTHZ-001: operator required
	router.Handle("/clusters/{clusterId}/pods/{namespace}/{name}/exec", h.wrapWithRBAC(h.GetPodExec, auth.RoleOperator)).Methods("GET")

	// Cluster shell (run kubectl commands) - BE-AUTHZ-001: operator required
	router.Handle("/clusters/{clusterId}/shell", h.wrapWithRBAC(h.PostShell, auth.RoleOperator)).Methods("POST")
	// Cluster shell metadata (effective context/namespace + capabilities)
	router.Handle("/clusters/{clusterId}/shell/status", h.wrapWithRBAC(h.GetShellStatus, auth.RoleViewer)).Methods("GET")
	// Cluster shell stream (WebSocket PTY — full interactive kubectl cloud shell)
	router.Handle("/clusters/{clusterId}/shell/stream", h.wrapWithRBAC(h.GetShellStream, auth.RoleOperator)).Methods("GET")
	// Shell completion (IDE-style Tab; optional for dropdown)
	router.Handle("/clusters/{clusterId}/shell/complete", h.wrapWithRBAC(h.GetShellComplete, auth.RoleViewer)).Methods("GET")
	// kcli server-side execution (embedded mode foundation) - BE-AUTHZ-001: operator required
	router.Handle("/clusters/{clusterId}/kcli/exec", h.wrapWithRBAC(h.PostKCLIExec, auth.RoleOperator)).Methods("POST")
	// kcli stream (WebSocket PTY, default mode=ui) - BE-AUTHZ-001: operator required
	router.Handle("/clusters/{clusterId}/kcli/stream", h.wrapWithRBAC(h.GetKCLIStream, auth.RoleOperator)).Methods("GET")
	// kcli completion (IDE-style Tab)
	router.Handle("/clusters/{clusterId}/kcli/complete", h.wrapWithRBAC(h.GetKCLIComplete, auth.RoleViewer)).Methods("GET")
	// kcli TUI/session state for frontend sync
	router.Handle("/clusters/{clusterId}/kcli/tui/state", h.wrapWithRBAC(h.GetKCLITUIState, auth.RoleViewer)).Methods("GET")

	// Download kubeconfig for a cluster - BE-AUTHZ-001: viewer can read kubeconfig
	router.Handle("/clusters/{clusterId}/kubeconfig", h.wrapWithRBAC(h.GetKubeconfig, auth.RoleViewer)).Methods("GET")

	// Health check
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
	}).Methods("GET")

	// API 404: return JSON so frontend never sees Go default "404 page not found"
	router.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		respondError(w, http.StatusNotFound, "Not found")
	})
}

// ListClusters handles GET /clusters (BE-AUTHZ-001: filters by user permissions).
func (h *Handler) ListClusters(w http.ResponseWriter, r *http.Request) {
	clusters, err := h.clusterService.ListClusters(r.Context())
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	// BE-AUTHZ-001: Filter clusters by user permissions if auth enabled
	if h.cfg.AuthMode != "" && h.cfg.AuthMode != "disabled" && h.repo != nil {
		claims := auth.ClaimsFromContext(r.Context())
		if claims != nil {
			// Admin sees all clusters
			if claims.Role == auth.RoleAdmin {
				respondJSON(w, http.StatusOK, clusters)
				return
			}
			// Get user's cluster permissions
			perms, _ := h.repo.ListClusterPermissionsByUser(r.Context(), claims.UserID)
			permMap := make(map[string]bool)
			for _, p := range perms {
				permMap[p.ClusterID] = true
			}
			// Filter: user sees clusters they have explicit permission for, or all if no permissions set (backward compat)
			if len(permMap) > 0 {
				filtered := make([]*models.Cluster, 0, len(clusters))
				for _, c := range clusters {
					if permMap[c.ID] {
						filtered = append(filtered, c)
					}
				}
				clusters = filtered
			}
		}
	}
	respondJSON(w, http.StatusOK, clusters)
}

// DiscoverClusters handles GET /clusters/discover
func (h *Handler) DiscoverClusters(w http.ResponseWriter, r *http.Request) {
	clusters, err := h.clusterService.DiscoverClusters(r.Context())
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, clusters)
}

// GetCluster handles GET /clusters/{clusterId}. clusterId may be backend UUID or context/name (e.g. docker-desktop).
func (h *Handler) GetCluster(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	// Headlamp/Lens model: if kubeconfig provided, return cluster info without storing
	kubeconfigBytes, contextName, err := h.getKubeconfigFromRequest(r)
	if err == nil && len(kubeconfigBytes) > 0 {
		// Create temporary client to get cluster info
		client, err := k8s.NewClientFromBytes(kubeconfigBytes, contextName)
		if err != nil {
			respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, fmt.Sprintf("Invalid kubeconfig: %v", err))
			return
		}
		
		info, err := client.GetClusterInfo(r.Context())
		if err != nil {
			respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
			return
		}
		
		// Return cluster info without storing (Headlamp/Lens stateless model)
		clusterInfo := map[string]interface{}{
			"id":        clusterID,
			"name":      contextName,
			"context":   contextName,
			"serverURL": info["server_url"],
			"version":   info["version"],
			"status":    "connected",
		}
		respondJSON(w, http.StatusOK, clusterInfo)
		return
	}

	// Fall back to stored cluster (backward compatibility)
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}

	cluster, err := h.clusterService.GetCluster(r.Context(), resolvedID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, cluster)
}

// AddCluster handles POST /clusters (Headlamp/Lens model: stateless, no backend storage).
// Accepts kubeconfig_base64 with optional context name.
// In Headlamp/Lens model, clusters are stored client-side, backend just validates and returns info.
func (h *Handler) AddCluster(w http.ResponseWriter, r *http.Request) {
	var req struct {
		KubeconfigPath   string `json:"kubeconfig_path"`    // Legacy: file path on server
		KubeconfigBase64 string `json:"kubeconfig_base64"`  // Headlamp/Lens: base64 kubeconfig
		Context          string `json:"context"`            // Optional context name
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Headlamp/Lens model: use kubeconfig from request, don't store on backend
	if req.KubeconfigBase64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(req.KubeconfigBase64)
		if err != nil {
			respondError(w, http.StatusBadRequest, "Invalid kubeconfig_base64")
			return
		}

		// Create client to validate kubeconfig
		client, err := k8s.NewClientFromBytes(decoded, req.Context)
		if err != nil {
			respondError(w, http.StatusBadRequest, fmt.Sprintf("Invalid kubeconfig: %v", err))
			return
		}

		// Test connection
		if err := client.TestConnection(r.Context()); err != nil {
			respondError(w, http.StatusBadRequest, fmt.Sprintf("Connection test failed: %v", err))
			return
		}

		// Get cluster info
		info, err := client.GetClusterInfo(r.Context())
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}

		// Return cluster info without storing (Headlamp/Lens stateless model)
		clusterInfo := map[string]interface{}{
			"id":        uuid.New().String(), // Generate ID for frontend reference
			"name":      req.Context,
			"context":   req.Context,
			"serverURL": info["server_url"],
			"version":   info["version"],
			"status":    "connected",
		}
		respondJSON(w, http.StatusOK, clusterInfo) // 200 OK, not 201 Created (not stored)
		return
	}

	// Legacy: store cluster on backend (for backward compatibility)
	kubeconfigPath := req.KubeconfigPath
	if kubeconfigPath == "" {
		respondError(w, http.StatusBadRequest, "Either kubeconfig_path or kubeconfig_base64 required")
		return
	}

	cluster, err := h.clusterService.AddCluster(r.Context(), kubeconfigPath, req.Context)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, cluster)
}

// RemoveCluster handles DELETE /clusters/{clusterId}. clusterId may be backend UUID or context/name.
func (h *Handler) RemoveCluster(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	if err := h.clusterService.RemoveCluster(r.Context(), resolvedID); err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "Cluster removed"})
}

// GetClusterSummary handles GET /clusters/{clusterId}/summary. clusterId may be backend UUID or context/name.
func (h *Handler) GetClusterSummary(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	// getClientFromRequest returns client (from kubeconfig or stored cluster); build summary from it
	info, infoErr := client.GetClusterInfo(r.Context())
	if infoErr != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, infoErr.Error(), requestID)
		return
	}
	pods, _ := client.Clientset.CoreV1().Pods("").List(r.Context(), metav1.ListOptions{})
	deployments, _ := client.Clientset.AppsV1().Deployments("").List(r.Context(), metav1.ListOptions{})
	services, _ := client.Clientset.CoreV1().Services("").List(r.Context(), metav1.ListOptions{})
	summary := &models.ClusterSummary{
		ID:              clusterID,
		Name:            clusterID,
		NodeCount:       info["node_count"].(int),
		NamespaceCount:  info["namespace_count"].(int),
		PodCount:        len(pods.Items),
		DeploymentCount: len(deployments.Items),
		ServiceCount:    len(services.Items),
		HealthStatus:    "healthy",
	}
	respondJSON(w, http.StatusOK, summary)
}

// GetCapabilities returns backend capabilities (e.g. resource topology kinds). GET /api/v1/capabilities.
func (h *Handler) GetCapabilities(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"resource_topology_kinds": topology.ResourceTopologyKinds,
	})
}

// GetTopology handles GET /clusters/{clusterId}/topology with timeout and metrics (B2.2, B2.3).
func (h *Handler) GetTopology(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	namespace := r.URL.Query().Get("namespace")
	filters := models.TopologyFilters{Namespace: namespace}

	// BE-SCALE-002: Support force_refresh query param to bypass cache
	forceRefresh := r.URL.Query().Get("force_refresh") == "true"

	maxNodes := 0
	if h.cfg != nil && h.cfg.TopologyMaxNodes > 0 {
		maxNodes = h.cfg.TopologyMaxNodes
	}

	timeoutSec := 30
	if h.cfg != nil && h.cfg.TopologyTimeoutSec > 0 {
		timeoutSec = h.cfg.TopologyTimeoutSec
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	// getClientFromRequest returns client (from kubeconfig or stored cluster); use it for topology
	start := time.Now()
	topology, err := h.topologyService.GetTopologyWithClient(ctx, client, clusterID, filters, maxNodes, forceRefresh)
	metrics.TopologyBuildDurationSeconds.Observe(time.Since(start).Seconds())

	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusServiceUnavailable, "Topology build timed out")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, topology)
}

// GetResourceTopology handles GET /clusters/{clusterId}/topology/resource/{kind}/{namespace}/{name}.
// For cluster-scoped resources (Node, PV, StorageClass, etc.) use namespace "-" or "_".
func (h *Handler) GetResourceTopology(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	kind := strings.TrimSpace(vars["kind"])
	namespace := strings.TrimSpace(vars["namespace"])
	name := strings.TrimSpace(vars["name"])
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	if kind == "" || name == "" {
		respondError(w, http.StatusBadRequest, "kind and name are required")
		return
	}
	if namespace == "-" || namespace == "_" {
		namespace = ""
	}

	// Normalize kind so "jobs" -> "Job", "statefulsets" -> "StatefulSet", etc. (single place for API contract).
	kind = topology.NormalizeResourceKind(kind)

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	timeoutSec := 30
	if h.cfg != nil && h.cfg.TopologyTimeoutSec > 0 {
		timeoutSec = h.cfg.TopologyTimeoutSec
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	// getClientFromRequest returns client (from kubeconfig or stored cluster); use it for resource topology
	graph, err := h.topologyService.GetResourceTopologyWithClient(ctx, client, clusterID, kind, namespace, name)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusServiceUnavailable, "Resource topology build timed out")
			return
		}
		if errors.Is(err, topology.ErrResourceNotFound) {
			respondError(w, http.StatusNotFound, "Resource not found")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, graph)
}

// ExportTopology handles POST /clusters/{clusterId}/topology/export (BE-FUNC-001).
// Format via query param ?format=json|svg|drawio|png or JSON body {"format": "..."}. Default: json.
func (h *Handler) ExportTopology(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	format := r.URL.Query().Get("format")
	if format == "" && r.Body != nil {
		var req struct {
			Format string `json:"format"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Format != "" {
			format = req.Format
		}
	}
	if format == "" {
		format = "json"
	}

	// getClientFromRequest returns client (from kubeconfig or stored cluster); use it for export
	data, err := h.topologyService.ExportTopologyWithClient(r.Context(), client, clusterID, format)
	if err != nil {
		if errors.Is(err, service.ErrExportNotImplemented) {
			respondError(w, http.StatusBadRequest, "Unsupported format. Use format=json|svg|drawio|png")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Content-Type and Content-Disposition per format (BE-FUNC-001)
	var contentType, filename string
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "json":
		contentType = "application/json"
		filename = "topology.json"
	case "svg":
		contentType = "image/svg+xml"
		filename = "topology.svg"
	case "drawio":
		contentType = "application/xml"
		filename = "topology.drawio.xml"
	case "png":
		contentType = "image/png"
		filename = "topology.png"
	default:
		contentType = "application/octet-stream"
		filename = "topology." + format
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.Write(data)
}

// GetTopologyExportDrawio handles GET /clusters/{clusterId}/topology/export/drawio
// Returns { url, mermaid } for opening the topology in draw.io.
func (h *Handler) GetTopologyExportDrawio(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	format := r.URL.Query().Get("format")
	if format == "" {
		format = "mermaid"
	}
	if format != "mermaid" && format != "xml" {
		respondError(w, http.StatusBadRequest, "format must be mermaid or xml")
		return
	}

	topology, err := h.topologyService.GetTopologyWithClient(r.Context(), client, clusterID, models.TopologyFilters{}, 0, false)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	mermaid := drawio.TopologyGraphToMermaid(topology)
	drawioURL, err := drawio.GenerateDrawioURL(mermaid)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate draw.io URL: "+err.Error())
		return
	}

	resp := map[string]interface{}{
		"url": drawioURL,
	}
	if format == "mermaid" {
		resp["mermaid"] = mermaid
	}
	respondJSON(w, http.StatusOK, resp)
}

// pathVarsKey is the context key for path params set by rollout path-intercept middleware.
type pathVarsKey struct{}

// SetPathVars sets clusterId/namespace/name (or other path params) on the request context so handlers can read them when mux.Vars is empty.
func SetPathVars(r *http.Request, vars map[string]string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), &pathVarsKey{}, vars))
}

// GetPathVars returns path params from context (set by middleware) or from mux.Vars(r).
func GetPathVars(r *http.Request) map[string]string {
	if v := r.Context().Value(&pathVarsKey{}); v != nil {
		if m, ok := v.(map[string]string); ok {
			return m
		}
	}
	return mux.Vars(r)
}

// Helper functions
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}

// respondErrorWithRequestID is a convenience wrapper that includes request ID from context
func respondErrorWithRequestID(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	requestID := logger.FromContext(r.Context())
	respondErrorWithCode(w, status, code, message, requestID)
}
