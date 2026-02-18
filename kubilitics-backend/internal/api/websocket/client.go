package websocket

import (
	"context"
	"log"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
)

const (
	// Time allowed to write a message to the peer
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer
	pongWait = 60 * time.Second

	// Send pings to peer with this period (must be less than pongWait)
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer
	maxMessageSize = 512 * 1024 // 512KB
)

// Client represents a WebSocket client
type Client struct {
	// The websocket connection
	conn *websocket.Conn

	// Buffered channel of outbound messages
	send chan []byte

	// Hub reference
	hub *Hub

	// Context for cancellation
	ctx    context.Context
	cancel context.CancelFunc

	// Client ID for tracking
	id string

	// Authentication claims (nil if unauthenticated)
	claims *auth.Claims

	// Subscription filters
	filters map[string]interface{}
}

// NewClient creates a new WebSocket client
func NewClient(ctx context.Context, hub *Hub, conn *websocket.Conn, id string, claims *auth.Claims) *Client {
	clientCtx, cancel := context.WithCancel(ctx)
	return &Client{
		conn:    conn,
		send:    make(chan []byte, 256),
		hub:     hub,
		ctx:     clientCtx,
		cancel:  cancel,
		id:      id,
		claims:  claims,
		filters: make(map[string]interface{}),
	}
}

// IsAuthenticated returns true if the client is authenticated
func (c *Client) IsAuthenticated() bool {
	return c.claims != nil
}

// UserID returns the authenticated user's ID, or empty string if not authenticated
func (c *Client) UserID() string {
	if c.claims == nil {
		return ""
	}
	return c.claims.UserID
}

// Username returns the authenticated user's username, or empty string if not authenticated
func (c *Client) Username() string {
	if c.claims == nil {
		return ""
	}
	return c.claims.Username
}

// Role returns the authenticated user's role, or empty string if not authenticated
func (c *Client) Role() string {
	if c.claims == nil {
		return ""
	}
	return c.claims.Role
}

// ReadPump pumps messages from the websocket connection to the hub
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		select {
		case <-c.ctx.Done():
			return
		default:
			_, message, err := c.conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WebSocket error: %v", err)
				}
				return
			}

			// Track received messages
			metrics.WebSocketMessagesReceivedTotal.Inc()
			metrics.WebSocketMessageSizeBytes.WithLabelValues("received").Observe(float64(len(message)))

			// Handle client messages (e.g., subscription updates)
			c.handleMessage(message)
		}
	}
}

// WritePump pumps messages from the hub to the websocket connection
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case <-c.ctx.Done():
			return

		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued messages to the current websocket message
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Close closes the client connection
func (c *Client) Close() {
	c.cancel()
}

// handleMessage handles incoming messages from the client
func (c *Client) handleMessage(message []byte) {
	// Parse message and update filters/subscriptions
	// Implementation depends on subscription model
	log.Printf("Received message from client %s: %s", c.id, string(message))
}
