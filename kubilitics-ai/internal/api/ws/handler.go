package ws

import "context"

// Package ws provides WebSocket handler for real-time streaming communication with the frontend.
//
// Responsibilities:
//   - Accept WebSocket connections from the frontend at /api/v1/ai/chat/stream
//   - Maintain bidirectional communication for streaming investigation updates
//   - Send investigation progress events (hypothesis, tool calls, findings, conclusions)
//   - Receive chat messages and forward to Reasoning Engine
//   - Stream LLM reasoning chain-of-thought steps to frontend for transparency
//   - Handle connection lifecycle (connect, ping/pong, disconnect)
//   - Manage backpressure and message ordering
//   - Enforce authentication via token in headers or query params
//
// Message Types (bidirectional):
//   - InvestigationStarted: Sent when investigation begins
//   - HypothesisGenerated: Sent when LLM proposes hypothesis
//   - ToolCalled: Sent when LLM calls a tool (with input)
//   - ToolResult: Sent when tool execution completes (with output)
//   - FindingDiscovered: Sent when analysis uncovers a finding
//   - ConclusionReached: Sent when investigation concludes
//   - RecommendationProposed: Sent when action recommended
//   - ChatMessage (incoming): Received from frontend, triggers investigation
//   - Error: Sent on any error during streaming
//   - ConnectionClosed: Sent when connection closes
//
// Connection Management:
//   - WebSocket upgraded from HTTP with keep-alive ping/pong
//   - Automatic reconnection retry logic on client-side
//   - Per-connection investigation context maintained
//   - Multiple concurrent WebSockets allowed (one per user session)
//
// Integration Points:
//   - Reasoning Engine: Subscribes to investigation progress events
//   - Frontend: Consumes streaming updates for real-time display
//   - Audit Logger: Records all chat messages

// WSHandler defines the interface for WebSocket communication.
type WSHandler interface {
	// HandleConnection upgrades HTTP to WebSocket and manages the connection lifecycle.
	HandleConnection(ctx context.Context) error

	// SendMessage sends a message to the connected client.
	SendMessage(ctx context.Context, messageType string, data interface{}) error

	// ReceiveMessage receives and parses a message from the client.
	ReceiveMessage(ctx context.Context) (messageType string, data interface{}, err error)

	// Close gracefully closes the WebSocket connection.
	Close() error
}

// NewWSHandler creates a new WebSocket handler with dependencies injected.
func NewWSHandler() WSHandler {
	// Inject Reasoning Engine, Audit Logger
	return nil
}
