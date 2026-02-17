package rest

import (
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// ListCRDInstances handles GET /clusters/{clusterId}/crd-instances/{crdName}
// Lists instances of a CRD by its full name (e.g. certificates.cert-manager.io).
func (h *Handler) ListCRDInstances(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	crdName := vars["crdName"]
	namespace := r.URL.Query().Get("namespace")

	if !validate.ClusterID(clusterID) || crdName == "" || !validate.Namespace(namespace) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, crdName, or namespace")
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

	list, err := client.ListCRDInstances(r.Context(), crdName, namespace, opts)
	if err != nil {
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

	itemsRaw := listItemsToRaw(list.Items)
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
