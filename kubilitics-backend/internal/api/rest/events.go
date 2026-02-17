package rest

import (
	"net/http"
	"sort"
	"strconv"

	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// sortEventsByLastTimestampDesc sorts events by LastTimestamp descending (most recent first).
func sortEventsByLastTimestampDesc(events []*models.Event) {
	sort.Slice(events, func(i, j int) bool {
		return events[i].LastTimestamp.After(events[j].LastTimestamp)
	})
}

// GetEvents handles GET /clusters/{clusterId}/events
// Lists Kubernetes events (namespace, limit). Optional: involvedObjectKind + involvedObjectName for pod-scoped events. B1.2.
func (h *Handler) GetEvents(w http.ResponseWriter, r *http.Request) {
	if h.eventsService == nil {
		respondError(w, http.StatusNotImplemented, "Kubernetes events are not configured")
		return
	}

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
	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	involvedObjectKind := r.URL.Query().Get("involvedObjectKind")
	involvedObjectName := r.URL.Query().Get("involvedObjectName")

	if involvedObjectKind != "" && involvedObjectName != "" {
		ns := namespace
		if ns == "" || ns == "*" || ns == "_all" {
			ns = "default"
		}
		// Pod-scoped (or any resource) events: last N events for the resource (most recent first)
		events, err := h.eventsService.GetResourceEvents(r.Context(), resolvedID, ns, involvedObjectKind, involvedObjectName)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		sortEventsByLastTimestampDesc(events)
		if len(events) > limit {
			events = events[:limit]
		}
		respondJSON(w, http.StatusOK, events)
		return
	}

	// All namespaces: namespace empty, "*", or "_all"
	if namespace == "" || namespace == "*" || namespace == "_all" {
		events, err := h.eventsService.ListEventsAllNamespaces(r.Context(), resolvedID, limit)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, events)
		return
	}

	// Single namespace
	events, err := h.eventsService.ListEvents(r.Context(), resolvedID, namespace, limit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, events)
}
