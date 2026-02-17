package rest

import (
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetMetalLBFeature handles GET /clusters/{clusterId}/features/metallb
// Returns { installed: true|false } if MetalLB CRDs (ipaddresspools, bgppeers) exist in the cluster.
func (h *Handler) GetMetalLBFeature(w http.ResponseWriter, r *http.Request) {
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

	installed, err := h.clusterService.HasMetalLB(r.Context(), resolvedID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"installed": installed,
	})
}
