package websocket

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	_ "github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
)

// Hub maintains active WebSocket connections and broadcasts messages
type Hub struct {
	// Registered clients
	clients map[*Client]bool

	// Inbound messages from clients
	broadcast chan []byte

	// Register requests from clients
	register chan *Client

	// Unregister requests from clients
	unregister chan *Client

	// Mutex for thread-safe operations
	mu sync.RWMutex

	// Context for cancellation
	ctx    context.Context
	cancel context.CancelFunc

	// Optional: invalidate topology cache when resource events are broadcast (C1.3)
	invalidateTopology func(clusterID, namespace string)
}

// NewHub creates a new WebSocket hub
func NewHub(ctx context.Context) *Hub {
	hubCtx, cancel := context.WithCancel(ctx)
	return &Hub{
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
		ctx:        hubCtx,
		cancel:     cancel,
	}
}

// Run starts the hub
func (h *Hub) Run() {
	for {
		select {
		case <-h.ctx.Done():
			return

		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			metrics.WebSocketConnectionsActive.Set(float64(len(h.clients)))
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			metrics.WebSocketConnectionsActive.Set(float64(len(h.clients)))
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.RLock()
			clientCount := len(h.clients)
			messageSize := float64(len(message))
			for client := range h.clients {
				select {
				case client.send <- message:
					metrics.WebSocketMessageSizeBytes.WithLabelValues("sent").Observe(messageSize)
				default:
					// Client buffer full, close connection
					close(client.send)
					delete(h.clients, client)
				}
			}
			// Track total messages sent (one per client that received it)
			if clientCount > 0 {
				metrics.WebSocketMessagesSentTotal.Add(float64(clientCount))
			}
			h.mu.RUnlock()
		}
	}
}

// Stop stops the hub
func (h *Hub) Stop() {
	h.cancel()
	h.mu.Lock()
	defer h.mu.Unlock()

	// Close all client connections
	for client := range h.clients {
		close(client.send)
		delete(h.clients, client)
	}
}

// SetTopologyInvalidator sets the callback invoked when a resource event is broadcast with a cluster scope (C1.3).
// When BroadcastResourceEvent is called with non-empty clusterID, this is called so topology cache can be invalidated.
func (h *Hub) SetTopologyInvalidator(fn func(clusterID, namespace string)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.invalidateTopology = fn
}

// BroadcastResourceEvent broadcasts a resource event to all clients. If clusterID is non-empty and a topology
// invalidator is set, the cache for that scope is invalidated (C1.3).
func (h *Hub) BroadcastResourceEvent(clusterID, namespace, eventType string, resourceType string, obj interface{}) error {
	h.mu.RLock()
	inv := h.invalidateTopology
	h.mu.RUnlock()
	if inv != nil && clusterID != "" {
		inv(clusterID, namespace)
	}

	msg := models.WebSocketMessage{
		Type:      "resource_update",
		Event:     eventType,
		Resource:  map[string]interface{}{"type": resourceType, "data": obj},
		Timestamp: time.Now(),
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	select {
	case h.broadcast <- data:
		return nil
	case <-h.ctx.Done():
		return h.ctx.Err()
	}
}

// BroadcastTopologyUpdate broadcasts a topology update
func (h *Hub) BroadcastTopologyUpdate(topology *models.TopologyGraph) error {
	msg := models.WebSocketMessage{
		Type:      "topology_update",
		Event:     "updated",
		Resource:  map[string]interface{}{"topology": topology},
		Timestamp: time.Now(),
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	select {
	case h.broadcast <- data:
		return nil
	case <-h.ctx.Done():
		return h.ctx.Err()
	}
}

// GetClientCount returns the number of connected clients
func (h *Hub) GetClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
