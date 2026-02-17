package rest

import (
	"net/http"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetStorageClassPVCounts handles GET /clusters/{clusterId}/resources/storageclasses/pv-counts
// Returns a map of storage class name to PV count for efficient list-page display.
func (h *Handler) GetStorageClassPVCounts(w http.ResponseWriter, r *http.Request) {
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
	client, err := h.clusterService.GetClient(resolvedID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	list, err := client.ListResources(r.Context(), "persistentvolumes", "", metav1.ListOptions{Limit: 5000})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	counts := make(map[string]int)
	for i := range list.Items {
		sc := storageClassNameFromPV(&list.Items[i])
		if sc != "" {
			counts[sc]++
		}
	}
	respondJSON(w, http.StatusOK, counts)
}

// storageClassNameFromPV reads spec.storageClassName from an unstructured PV.
func storageClassNameFromPV(obj *unstructured.Unstructured) string {
	sc, found, _ := unstructured.NestedString(obj.Object, "spec", "storageClassName")
	if !found || sc == "" {
		return ""
	}
	return sc
}
