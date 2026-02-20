package rest

import (
	"log"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

var streamUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// GetClusterOverviewStream upgrades to WebSocket and streams real-time overview updates.
// GET /api/v1/clusters/{clusterId}/overview/stream
func (h *Handler) GetClusterOverviewStream(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	conn, err := streamUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("overview stream: upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	ctx := r.Context()
	log.Printf("overview stream: connected cluster=%s", clusterID)

	updateChan, unsubscribe := h.clusterService.Subscribe(clusterID)
	defer unsubscribe()

	// Keep-alive ticker
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case overview, ok := <-updateChan:
			if !ok {
				return
			}
			if err := conn.WriteJSON(overview); err != nil {
				log.Printf("overview stream: write failed: %v", err)
				return
			}
		}
	}
}
