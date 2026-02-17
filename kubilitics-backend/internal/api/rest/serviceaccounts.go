package rest

import (
	"net/http"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetServiceAccountTokenCounts handles GET /clusters/{clusterId}/resources/serviceaccounts/token-counts
// Returns a map of "namespace/name" to count of token secrets (type=kubernetes.io/service-account-token, annotation kubernetes.io/service-account.name=name).
func (h *Handler) GetServiceAccountTokenCounts(w http.ResponseWriter, r *http.Request) {
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

	list, err := client.ListResources(r.Context(), "secrets", "", metav1.ListOptions{Limit: 10000})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	counts := make(map[string]int)
	for i := range list.Items {
		obj := &list.Items[i]
		typ, _, _ := unstructured.NestedString(obj.Object, "type")
		if typ != "kubernetes.io/service-account-token" {
			continue
		}
		ann, _, _ := unstructured.NestedStringMap(obj.Object, "metadata", "annotations")
		saName := ann["kubernetes.io/service-account.name"]
		if saName == "" {
			continue
		}
		ns, _, _ := unstructured.NestedString(obj.Object, "metadata", "namespace")
		if ns == "" {
			continue
		}
		key := ns + "/" + saName
		counts[key]++
	}
	respondJSON(w, http.StatusOK, counts)
}
