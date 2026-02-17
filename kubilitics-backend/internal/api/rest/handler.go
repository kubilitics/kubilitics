package rest

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/drawio"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"github.com/kubilitics/kubilitics-backend/internal/topology"
	"golang.org/x/time/rate"
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
	kcliLimiterMu         sync.Mutex
	kcliLimiters          map[string]*rate.Limiter
	kcliStreamMu          sync.Mutex
	kcliStreamActive      map[string]int
}

// NewHandler creates a new HTTP handler. unifiedMetricsService can be nil; then metrics summary uses legacy per-resource endpoints. projSvc can be nil; then project routes return 501.
func NewHandler(cs service.ClusterService, ts service.TopologyService, cfg *config.Config, logsService service.LogsService, eventsService service.EventsService, metricsService service.MetricsService, unifiedMetricsService *service.UnifiedMetricsService, projSvc service.ProjectService) *Handler {
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

func SetupRoutes(router *mux.Router, h *Handler) {
	// Cluster discovery MUST be registered before {clusterId} parameter route
	router.HandleFunc("/clusters/discover", h.DiscoverClusters).Methods("GET")

	// Capabilities (e.g. resource topology kinds) so clients can verify backend support
	router.HandleFunc("/capabilities", h.GetCapabilities).Methods("GET")

	// Project routes (multi-cluster, multi-tenancy)
	router.HandleFunc("/projects", h.ListProjects).Methods("GET")
	router.HandleFunc("/projects", h.CreateProject).Methods("POST")
	router.HandleFunc("/projects/{projectId}", h.GetProject).Methods("GET")
	router.HandleFunc("/projects/{projectId}", h.UpdateProject).Methods("PATCH")
	router.HandleFunc("/projects/{projectId}", h.DeleteProject).Methods("DELETE")
	router.HandleFunc("/projects/{projectId}/clusters", h.AddClusterToProject).Methods("POST")
	router.HandleFunc("/projects/{projectId}/clusters/{clusterId}", h.RemoveClusterFromProject).Methods("DELETE")
	router.HandleFunc("/projects/{projectId}/namespaces", h.AddNamespaceToProject).Methods("POST")
	router.HandleFunc("/projects/{projectId}/namespaces/{clusterId}/{namespaceName}", h.RemoveNamespaceFromProject).Methods("DELETE")

	// Cluster routes
	router.HandleFunc("/clusters", h.ListClusters).Methods("GET")
	router.HandleFunc("/clusters", h.AddCluster).Methods("POST")
	router.HandleFunc("/clusters/{clusterId}", h.GetCluster).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}", h.RemoveCluster).Methods("DELETE")
	router.HandleFunc("/clusters/{clusterId}/summary", h.GetClusterSummary).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/overview", h.GetClusterOverview).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/workloads", h.GetWorkloadsOverview).Methods("GET")

	// Topology routes
	router.HandleFunc("/clusters/{clusterId}/topology", h.GetTopology).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/topology/resource/{kind}/{namespace}/{name}", h.GetResourceTopology).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/topology/export", h.ExportTopology).Methods("POST")
	router.HandleFunc("/clusters/{clusterId}/topology/export/drawio", h.GetTopologyExportDrawio).Methods("GET")

	// Global search (command palette): GET /clusters/{clusterId}/search?q=...&limit=25
	router.HandleFunc("/clusters/{clusterId}/search", h.GetSearch).Methods("GET")

	// Cluster features (e.g. MetalLB detection)
	router.HandleFunc("/clusters/{clusterId}/features/metallb", h.GetMetalLBFeature).Methods("GET")

	// CRD instances: list custom resources by CRD name (must be before generic resources)
	router.HandleFunc("/clusters/{clusterId}/crd-instances/{crdName}", h.ListCRDInstances).Methods("GET")

	// Resource routes — specific subpaths must be registered before the generic {kind}/{namespace}/{name} route
	router.HandleFunc("/clusters/{clusterId}/resources/{kind}", h.ListResources).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollout-history", h.GetDeploymentRolloutHistory).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollback", h.PostDeploymentRollback).Methods("POST")
	router.HandleFunc("/clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/trigger", h.PostCronJobTrigger).Methods("POST")
	router.HandleFunc("/clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/jobs", h.GetCronJobJobs).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/jobs/{namespace}/{name}/retry", h.PostJobRetry).Methods("POST")
	router.HandleFunc("/clusters/{clusterId}/resources/services/{namespace}/{name}/endpoints", h.GetServiceEndpoints).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/configmaps/{namespace}/{name}/consumers", h.GetConfigMapConsumers).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/secrets/{namespace}/{name}/consumers", h.GetSecretConsumers).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/secrets/{namespace}/{name}/tls-info", h.GetSecretTLSInfo).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/persistentvolumeclaims/{namespace}/{name}/consumers", h.GetPVCConsumers).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/storageclasses/pv-counts", h.GetStorageClassPVCounts).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/namespaces/counts", h.GetNamespaceCounts).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/serviceaccounts/token-counts", h.GetServiceAccountTokenCounts).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/{kind}/{namespace}/{name}", h.GetResource).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/resources/{kind}/{namespace}/{name}", h.PatchResource).Methods("PATCH")
	router.HandleFunc("/clusters/{clusterId}/resources/{kind}/{namespace}/{name}", h.DeleteResource).Methods("DELETE")
	router.HandleFunc("/clusters/{clusterId}/apply", h.ApplyManifest).Methods("POST")

	// Logs routes
	router.HandleFunc("/clusters/{clusterId}/logs/{namespace}/{pod}", h.GetPodLogs).Methods("GET")

	// Metrics routes: unified summary first (resource-agnostic), then legacy per-resource
	router.HandleFunc("/clusters/{clusterId}/metrics/summary", h.GetMetricsSummary).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/metrics", h.GetClusterMetrics).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/metrics/nodes/{nodeName}", h.GetNodeMetrics).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/metrics/{namespace}/deployment/{name}", h.GetDeploymentMetrics).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/metrics/{namespace}/replicaset/{name}", h.GetReplicaSetMetrics).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/metrics/{namespace}/statefulset/{name}", h.GetStatefulSetMetrics).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/metrics/{namespace}/daemonset/{name}", h.GetDaemonSetMetrics).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/metrics/{namespace}/job/{name}", h.GetJobMetrics).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/metrics/{namespace}/cronjob/{name}", h.GetCronJobMetrics).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/metrics/{namespace}/{pod}", h.GetPodMetrics).Methods("GET")

	// Events routes
	router.HandleFunc("/clusters/{clusterId}/events", h.GetEvents).Methods("GET")

	// Pod exec (WebSocket)
	router.HandleFunc("/clusters/{clusterId}/pods/{namespace}/{name}/exec", h.GetPodExec).Methods("GET")

	// Cluster shell (run kubectl commands)
	router.HandleFunc("/clusters/{clusterId}/shell", h.PostShell).Methods("POST")
	// Cluster shell metadata (effective context/namespace + capabilities)
	router.HandleFunc("/clusters/{clusterId}/shell/status", h.GetShellStatus).Methods("GET")
	// Cluster shell stream (WebSocket PTY — full interactive kubectl cloud shell)
	router.HandleFunc("/clusters/{clusterId}/shell/stream", h.GetShellStream).Methods("GET")
	// Shell completion (IDE-style Tab; optional for dropdown)
	router.HandleFunc("/clusters/{clusterId}/shell/complete", h.GetShellComplete).Methods("GET")
	// kcli server-side execution (embedded mode foundation)
	router.HandleFunc("/clusters/{clusterId}/kcli/exec", h.PostKCLIExec).Methods("POST")
	// kcli stream (WebSocket PTY, default mode=ui)
	router.HandleFunc("/clusters/{clusterId}/kcli/stream", h.GetKCLIStream).Methods("GET")
	// kcli completion (IDE-style Tab)
	router.HandleFunc("/clusters/{clusterId}/kcli/complete", h.GetKCLIComplete).Methods("GET")
	// kcli TUI/session state for frontend sync
	router.HandleFunc("/clusters/{clusterId}/kcli/tui/state", h.GetKCLITUIState).Methods("GET")

	// Download kubeconfig for a cluster
	router.HandleFunc("/clusters/{clusterId}/kubeconfig", h.GetKubeconfig).Methods("GET")

	// Health check
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
	}).Methods("GET")

	// API 404: return JSON so frontend never sees Go default "404 page not found"
	router.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		respondError(w, http.StatusNotFound, "Not found")
	})
}

// ListClusters handles GET /clusters
func (h *Handler) ListClusters(w http.ResponseWriter, r *http.Request) {
	clusters, err := h.clusterService.ListClusters(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, clusters)
}

// DiscoverClusters handles GET /clusters/discover
func (h *Handler) DiscoverClusters(w http.ResponseWriter, r *http.Request) {
	clusters, err := h.clusterService.DiscoverClusters(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
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
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	cluster, err := h.clusterService.GetCluster(r.Context(), resolvedID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, cluster)
}

// AddCluster handles POST /clusters. Accepts kubeconfig_path (file path on server) or
// kubeconfig_base64 (uploaded content) with context name.
func (h *Handler) AddCluster(w http.ResponseWriter, r *http.Request) {
	var req struct {
		KubeconfigPath   string `json:"kubeconfig_path"`
		KubeconfigBase64 string `json:"kubeconfig_base64"`
		Context          string `json:"context"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	kubeconfigPath := req.KubeconfigPath
	if req.KubeconfigBase64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(req.KubeconfigBase64)
		if err != nil {
			respondError(w, http.StatusBadRequest, "Invalid kubeconfig_base64")
			return
		}
		uploadDir := filepath.Join(os.TempDir(), "kubilitics-uploads")
		if err := os.MkdirAll(uploadDir, 0700); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to create upload directory")
			return
		}
		tmpPath := filepath.Join(uploadDir, "kubeconfig-"+uuid.New().String()+".yaml")
		if err := os.WriteFile(tmpPath, decoded, 0600); err != nil {
			respondError(w, http.StatusInternalServerError, "Failed to write kubeconfig")
			return
		}
		kubeconfigPath = tmpPath
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
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	summary, err := h.clusterService.GetClusterSummary(r.Context(), resolvedID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
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
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	namespace := r.URL.Query().Get("namespace")
	filters := models.TopologyFilters{Namespace: namespace}

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

	start := time.Now()
	topology, err := h.topologyService.GetTopology(ctx, resolvedID, filters, maxNodes)
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

	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	timeoutSec := 30
	if h.cfg != nil && h.cfg.TopologyTimeoutSec > 0 {
		timeoutSec = h.cfg.TopologyTimeoutSec
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	graph, err := h.topologyService.GetResourceTopology(ctx, resolvedID, kind, namespace, name)
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

// ExportTopology handles POST /clusters/{clusterId}/topology/export
func (h *Handler) ExportTopology(w http.ResponseWriter, r *http.Request) {
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

	var req struct {
		Format string `json:"format"` // png, pdf, svg
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	data, err := h.topologyService.ExportTopology(r.Context(), resolvedID, req.Format)
	if err != nil {
		if errors.Is(err, service.ErrExportNotImplemented) {
			respondError(w, http.StatusNotImplemented, "Topology export is not yet implemented. Planned formats: png, pdf, svg, json.")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
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
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
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

	topology, err := h.topologyService.GetTopology(r.Context(), resolvedID, models.TopologyFilters{}, 0)
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
