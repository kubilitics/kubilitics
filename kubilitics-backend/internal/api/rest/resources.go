package rest

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/audit"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/redact"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// DestructiveConfirmHeader (D1.2): clients must send this for DELETE resource and POST /apply.
const DestructiveConfirmHeader = "X-Confirm-Destructive"

// ListResources handles GET /clusters/{clusterId}/resources/{kind}
func (h *Handler) ListResources(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	kind := vars["kind"]
	namespace := r.URL.Query().Get("namespace")

	if !validate.ClusterID(clusterID) || !validate.Kind(kind) || !validate.Namespace(namespace) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, kind, or namespace")
		return
	}

	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	client, err := h.clusterService.GetClient(resolvedID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	opts := metav1.ListOptions{}
	const defaultLimit = 5000
	opts.Limit = int64(defaultLimit)
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if n, err := strconv.ParseInt(limitStr, 10, 64); err == nil && n > 0 {
			opts.Limit = n
		}
	}
	if continueToken := r.URL.Query().Get("continue"); continueToken != "" {
		opts.Continue = continueToken
	}
	if labelSelector := r.URL.Query().Get("labelSelector"); labelSelector != "" {
		opts.LabelSelector = labelSelector
	}
	if fieldSelector := r.URL.Query().Get("fieldSelector"); fieldSelector != "" {
		opts.FieldSelector = fieldSelector
	}

	list, err := client.ListResources(r.Context(), kind, namespace, opts)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded. Try again or use a more specific query with namespace or label selectors.")
			return
		}
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Return list in API shape: items array + metadata (resourceVersion, continue, remainingItemCount when set)
	itemsRaw := listItemsToRaw(list.Items)
	if redact.IsSecretKind(kind) {
		for i := range itemsRaw {
			redact.SecretData(itemsRaw[i])
		}
	}
	meta := map[string]interface{}{
		"resourceVersion": list.GetResourceVersion(),
		"continue":        list.GetContinue(),
	}
	if list.GetRemainingItemCount() != nil {
		meta["remainingItemCount"] = *list.GetRemainingItemCount()
	}
	out := map[string]interface{}{
		"kind":       "List",
		"apiVersion": "v1",
		"metadata":   meta,
		"items":      itemsRaw,
	}
	respondJSON(w, http.StatusOK, out)
}

// listItemsToRaw converts unstructured items to a JSON-serializable slice (map[string]interface{}).
func listItemsToRaw(items []unstructured.Unstructured) []map[string]interface{} {
	out := make([]map[string]interface{}, len(items))
	for i := range items {
		out[i] = items[i].Object
	}
	return out
}

// GetResource handles GET /clusters/{clusterId}/resources/{kind}/{namespace}/{name}
// For cluster-scoped resources (IngressClass, Node, etc.) use namespace "-" or "_" in the path.
func (h *Handler) GetResource(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	kind := vars["kind"]
	namespace := vars["namespace"]
	name := vars["name"]
	if namespace == "-" || namespace == "_" {
		namespace = ""
	}

	if !validate.ClusterID(clusterID) || !validate.Kind(kind) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, kind, namespace, or name")
		return
	}

	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	client, err := h.clusterService.GetClient(resolvedID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	obj, err := client.GetResource(r.Context(), kind, namespace, name)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded.")
			return
		}
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	payload := obj.Object
	if redact.IsSecretKind(kind) {
		redact.SecretData(payload)
	}
	respondJSON(w, http.StatusOK, payload)
}

// PatchResource handles PATCH /clusters/{clusterId}/resources/{kind}/{namespace}/{name}
// Body: JSON merge-patch object (e.g. {"spec":{"replicas":3}} for scaling).
// For cluster-scoped resources use namespace "-" or "_" in the path.
func (h *Handler) PatchResource(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	kind := vars["kind"]
	namespace := vars["namespace"]
	name := vars["name"]
	if namespace == "-" || namespace == "_" {
		namespace = ""
	}

	if !validate.ClusterID(clusterID) || !validate.Kind(kind) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, kind, namespace, or name")
		return
	}

	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	client, err := h.clusterService.GetClient(resolvedID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	var patch map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON patch body")
		return
	}
	if len(patch) == 0 {
		respondError(w, http.StatusBadRequest, "Patch body is required")
		return
	}

	patchBytes, err := json.Marshal(patch)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to encode patch")
		return
	}

	obj, err := client.PatchResource(r.Context(), kind, namespace, name, patchBytes)
	requestID := logger.FromContext(r.Context())
	if err != nil {
		audit.LogMutation(requestID, clusterID, "patch", kind, namespace, name, "failure", err.Error())
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded.")
			return
		}
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	audit.LogMutation(requestID, clusterID, "patch", kind, namespace, name, "success", "")
	payload := obj.Object
	if redact.IsSecretKind(kind) {
		redact.SecretData(payload)
	}
	respondJSON(w, http.StatusOK, payload)
}

// DeleteResource handles DELETE /clusters/{clusterId}/resources/{kind}/{namespace}/{name}
// For cluster-scoped resources use namespace "-" or "_" in the path.
func (h *Handler) DeleteResource(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get(DestructiveConfirmHeader) != "true" {
		respondError(w, http.StatusBadRequest, "Destructive action requires X-Confirm-Destructive: true")
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	kind := vars["kind"]
	namespace := vars["namespace"]
	name := vars["name"]
	if namespace == "-" || namespace == "_" {
		namespace = ""
	}

	if !validate.ClusterID(clusterID) || !validate.Kind(kind) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, kind, namespace, or name")
		return
	}

	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	client, err := h.clusterService.GetClient(resolvedID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	opts := metav1.DeleteOptions{}
	if err := client.DeleteResource(r.Context(), kind, namespace, name, opts); err != nil {
		requestID := logger.FromContext(r.Context())
		audit.LogDelete(requestID, clusterID, kind, namespace, name, "failure", err.Error())
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded.")
			return
		}
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	requestID := logger.FromContext(r.Context())
	audit.LogDelete(requestID, clusterID, kind, namespace, name, "success", "")

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message": "Resource deleted",
		"cluster_id": clusterID,
		"kind":       kind,
		"namespace": namespace,
		"name":      name,
	})
}

// ApplyManifest handles POST /clusters/{clusterId}/apply
func (h *Handler) ApplyManifest(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get(DestructiveConfirmHeader) != "true" {
		respondError(w, http.StatusBadRequest, "Apply requires X-Confirm-Destructive: true (review YAML before applying)")
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]

	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	var req struct {
		YAML string `json:"yaml"`
	}

	// Limit body size (D1.2): use a limited reader if config set
	maxBytes := 512 * 1024 // 512KB default
	if h.cfg != nil && h.cfg.ApplyMaxYAMLBytes > 0 {
		maxBytes = h.cfg.ApplyMaxYAMLBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, int64(maxBytes))

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body or YAML too large")
		return
	}

	if req.YAML == "" {
		respondError(w, http.StatusBadRequest, "YAML content is required")
		return
	}

	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	client, err := h.clusterService.GetClient(resolvedID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	applied, err := client.ApplyYAML(r.Context(), req.YAML)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		audit.LogApply(requestID, clusterID, "failure", err.Error(), nil)
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded.")
			return
		}
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	requestID := logger.FromContext(r.Context())
	resources := make([]audit.AppliedResource, len(applied))
	for i := range applied {
		resources[i] = audit.AppliedResource{
			Kind: applied[i].Kind,
			Namespace: applied[i].Namespace,
			Name: applied[i].Name,
			Action: applied[i].Action,
		}
	}
	audit.LogApply(requestID, clusterID, "success", "", resources)

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message":    "Manifest applied successfully",
		"cluster_id": clusterID,
		"resources":  applied,
	})
}

// GetServiceEndpoints handles GET /clusters/{clusterId}/resources/services/{namespace}/{name}/endpoints.
// Returns the Endpoints resource with the same name as the service (Kubernetes creates it automatically).
func (h *Handler) GetServiceEndpoints(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	name := vars["name"]

	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or name")
		return
	}

	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	client, err := h.clusterService.GetClient(resolvedID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	obj, err := client.GetResource(r.Context(), "endpoints", namespace, name)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded.")
			return
		}
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, obj.Object)
}
