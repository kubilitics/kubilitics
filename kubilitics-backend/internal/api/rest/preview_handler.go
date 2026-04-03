package rest

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/intelligence/preview"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// PreviewBlastRadius handles POST /clusters/{clusterId}/blast-radius/preview.
// It accepts a manifest YAML in the request body, analyses its impact against
// the current cluster graph snapshot, and returns a pre-apply blast radius report.
func (h *Handler) PreviewBlastRadius(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	// Parse the request body.
	var req preview.PreviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest,
			"Invalid request body: "+err.Error(), logger.FromContext(r.Context()))
		return
	}

	if req.ManifestYAML == "" {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest,
			"manifest_yaml is required", logger.FromContext(r.Context()))
		return
	}

	// Get the graph engine for this cluster.
	engine := h.getOrStartGraphEngine(r, clusterID)
	if engine == nil {
		respondError(w, http.StatusServiceUnavailable,
			"Blast radius graph not available for this cluster")
		return
	}

	snap := engine.Snapshot()
	if !snap.Status().Ready {
		respondError(w, http.StatusServiceUnavailable,
			"Dependency graph is still building")
		return
	}

	// Run the preview analysis.
	previewEngine := preview.NewEngine()
	result, err := previewEngine.AnalyzeManifest(req.ManifestYAML, snap)
	if err != nil {
		respondErrorWithCode(w, http.StatusUnprocessableEntity, ErrCodeValidationFailed,
			err.Error(), logger.FromContext(r.Context()))
		return
	}

	respondJSON(w, http.StatusOK, result)
}
