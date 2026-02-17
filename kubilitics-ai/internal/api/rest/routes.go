package rest

// Package rest (continued in routes.go) manages route registration for all REST endpoints.
//
// Responsibilities:
//   - Register all GET, POST, PATCH, DELETE routes for AI operations
//   - Attach authentication middleware to protected routes
//   - Attach correlation ID middleware for request tracing
//   - Attach request validation middleware
//   - Define URL patterns and method associations
//   - Document all endpoints with their contract (request/response types)
//
// All Routes (as per backend design document):
//
// Investigations:
//   GET    /api/v1/ai/investigations              List all investigations with pagination/filtering
//   POST   /api/v1/ai/investigations              Create new investigation
//   GET    /api/v1/ai/investigations/{id}         Get investigation details + state
//   DELETE /api/v1/ai/investigations/{id}         Cancel investigation
//
// Insights:
//   GET    /api/v1/ai/insights                    List all insights
//   GET    /api/v1/ai/insights/{id}               Get specific insight
//   DELETE /api/v1/ai/insights/{id}               Delete insight
//
// Actions:
//   GET    /api/v1/ai/actions                     List all proposed actions
//   POST   /api/v1/ai/actions                     Create action (from recommendation)
//   GET    /api/v1/ai/actions/{id}                Get action details
//   PATCH  /api/v1/ai/actions/{id}/approve        Approve and execute action
//   PATCH  /api/v1/ai/actions/{id}/reject         Reject action
//
// Analytics:
//   GET    /api/v1/ai/metrics                     Get resource metrics and time-series
//   GET    /api/v1/ai/anomalies                   Get detected anomalies
//   GET    /api/v1/ai/forecasts                   Get resource usage forecasts
//   GET    /api/v1/ai/health-scores               Get resource health scores
//
// Chat:
//   POST   /api/v1/ai/chat/message                Send chat message, get response
//   WS     /api/v1/ai/chat/stream                 WebSocket for streaming responses
//
// Configuration:
//   GET    /api/v1/ai/config                      Get current configuration
//   PATCH  /api/v1/ai/config                      Update configuration (autonomy level, safety policies, LLM settings)
//
// Usage:
//   GET    /api/v1/ai/usage/summary               Get token/cost usage summary
//   GET    /api/v1/ai/usage/details               Get detailed usage breakdown
//
// Health:
//   GET    /health                                Health check (ready/alive)
//   GET    /healthz                               Kubernetes-style health probe

// RegisterRoutes registers all REST API routes with the given HTTP router.
func RegisterRoutes() {
	// Register all endpoints with their handlers and middleware chains
	// Attach auth middleware to /api/v1/ai/* routes
	// Attach correlation ID middleware to all routes
	// Return registered routes configuration
}
