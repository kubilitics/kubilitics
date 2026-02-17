package rest

import (
	"io"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetPodLogs handles GET /clusters/{clusterId}/logs/{namespace}/{pod}
// Streams pod logs from K8s API (container, tail, follow). B1.1.
func (h *Handler) GetPodLogs(w http.ResponseWriter, r *http.Request) {
	if h.logsService == nil {
		respondError(w, http.StatusNotImplemented, "Pod log streaming is not configured")
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	pod := vars["pod"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(pod) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or pod")
		return
	}

	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	container := r.URL.Query().Get("container")
	follow := r.URL.Query().Get("follow") == "true" || r.URL.Query().Get("follow") == "1"
	var tailLines int64
	if t := r.URL.Query().Get("tail"); t != "" {
		if n, err := strconv.ParseInt(t, 10, 64); err == nil && n > 0 {
			tailLines = n
		}
	}
	if tailLines == 0 {
		tailLines = 100
	}

	stream, err := h.logsService.GetPodLogs(r.Context(), resolvedID, namespace, pod, container, follow, tailLines)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer stream.Close()

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	_, _ = io.Copy(w, stream)
}
