package websocket

import (
	"context"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for now
	},
}

// Handler handles WebSocket connections
type Handler struct {
	hub            *Hub
	informerMgr    *k8s.InformerManager
	ctx            context.Context
}

// NewHandler creates a new WebSocket handler
func NewHandler(ctx context.Context, hub *Hub, informerMgr *k8s.InformerManager) *Handler {
	return &Handler{
		hub:         hub,
		informerMgr: informerMgr,
		ctx:         ctx,
	}
}

// ServeWS handles websocket requests from clients
func (h *Handler) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	clientID := uuid.New().String()
	client := NewClient(h.ctx, h.hub, conn, clientID)

	// Register client
	h.hub.register <- client

	// Start client goroutines
	go client.WritePump()
	go client.ReadPump()

	log.Printf("New WebSocket client connected: %s", clientID)
}

// SetupInformerHandlers connects K8s informers to WebSocket broadcasts
func (h *Handler) SetupInformerHandlers() {
	// Register handlers for all resource types
	resourceTypes := []string{
		"Pod", "Service", "Deployment", "ReplicaSet", "StatefulSet", "DaemonSet",
		"ConfigMap", "Secret", "Node", "Namespace",
		"PersistentVolume", "PersistentVolumeClaim",
		"Job", "CronJob",
		"Ingress", "IngressClass", "NetworkPolicy",
		"Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding",
		"ServiceAccount", "Endpoints", "Event",
		"StorageClass", "HorizontalPodAutoscaler", "PodDisruptionBudget",
	}

	for _, resourceType := range resourceTypes {
		rt := resourceType // Capture for closure
		h.informerMgr.RegisterHandler(rt, func(eventType string, obj interface{}) {
			// clusterID/namespace can be passed when informers are per-cluster (invokes topology cache invalidation)
			if err := h.hub.BroadcastResourceEvent("", "", eventType, rt, obj); err != nil {
				log.Printf("Failed to broadcast %s event for %s: %v", eventType, rt, err)
			}
		})
	}
}
