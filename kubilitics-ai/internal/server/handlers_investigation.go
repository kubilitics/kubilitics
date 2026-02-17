package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	reasoningengine "github.com/kubilitics/kubilitics-ai/internal/reasoning/engine"
)

// handleInvestigations handles GET (list) and POST (create) requests.
func (s *Server) handleInvestigations(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleListInvestigations(w, r)
	case http.MethodPost:
		s.handleCreateInvestigation(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleListInvestigations returns all investigations.
func (s *Server) handleListInvestigations(w http.ResponseWriter, r *http.Request) {
	if s.reasoningEngine == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"investigations": []interface{}{}})
		return
	}
	list, err := s.reasoningEngine.ListInvestigations(r.Context(), nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"investigations": list, "count": len(list)})
}

// handleCreateInvestigation starts a new investigation.
func (s *Server) handleCreateInvestigation(w http.ResponseWriter, r *http.Request) {
	if s.reasoningEngine == nil {
		http.Error(w, "reasoning engine not initialized", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Description string `json:"description"`
		Type        string `json:"type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Description == "" {
		http.Error(w, "description is required", http.StatusBadRequest)
		return
	}
	if req.Type == "" {
		req.Type = "general"
	}

	id, err := s.reasoningEngine.Investigate(r.Context(), req.Description, req.Type)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":          id,
		"type":        req.Type,
		"description": req.Description,
		"state":       "CREATED",
		"stream_url":  fmt.Sprintf("/ws/investigations/%s", id),
	})
}

// handleInvestigationByID handles GET /{id} and DELETE /{id}.
func (s *Server) handleInvestigationByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/v1/investigations/")
	id = strings.TrimSuffix(id, "/")
	if id == "" {
		http.Error(w, "investigation ID required", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.handleGetInvestigation(w, r, id)
	case http.MethodDelete:
		s.handleCancelInvestigation(w, r, id)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleGetInvestigation(w http.ResponseWriter, r *http.Request, id string) {
	if s.reasoningEngine == nil {
		http.Error(w, "reasoning engine not initialized", http.StatusServiceUnavailable)
		return
	}
	inv, err := s.reasoningEngine.GetInvestigation(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, inv)
}

func (s *Server) handleCancelInvestigation(w http.ResponseWriter, r *http.Request, id string) {
	if s.reasoningEngine == nil {
		http.Error(w, "reasoning engine not initialized", http.StatusServiceUnavailable)
		return
	}
	if err := s.reasoningEngine.CancelInvestigation(r.Context(), id); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"id": id, "state": "CANCELLED"})
}

// handleInvestigationStream streams investigation events over WebSocket.
// URL pattern: /ws/investigations/{id}
func (s *Server) handleInvestigationStream(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/ws/investigations/")
	id = strings.TrimSuffix(id, "/")
	if id == "" {
		http.Error(w, "investigation ID required", http.StatusBadRequest)
		return
	}

	if s.reasoningEngine == nil {
		http.Error(w, "reasoning engine not initialized", http.StatusServiceUnavailable)
		return
	}

	// Type assert to get Subscribe capability
	type subscribeableEngine interface {
		Subscribe(id string) *reasoningengine.Subscriber
	}
	se, ok := s.reasoningEngine.(subscribeableEngine)
	if !ok {
		http.Error(w, "streaming not supported by this engine implementation", http.StatusNotImplemented)
		return
	}

	// Check investigation exists
	_, err := s.reasoningEngine.GetInvestigation(r.Context(), id)
	if err != nil {
		http.Error(w, "investigation not found: "+err.Error(), http.StatusNotFound)
		return
	}

	upgrader := newUpgrader(s.config.AllowedOrigins)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	sub := se.Subscribe(id)

	conn.SetWriteDeadline(time.Now().Add(30 * time.Second))

	// Stream events until channel closes
	for ev := range sub.Ch {
		conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
		data, err := json.Marshal(ev)
		if err != nil {
			continue
		}
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			break
		}
		if ev.Type == "done" {
			break
		}
	}
}

// writeJSON writes a JSON response.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
