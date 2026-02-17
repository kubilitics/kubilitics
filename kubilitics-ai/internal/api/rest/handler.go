package rest

import "context"

// Package rest provides HTTP REST API handlers for frontend communication.
//
// Responsibilities:
//   - Handle all /api/v1/ai/* endpoints for investigation, insights, actions, analytics, and configuration
//   - Translate HTTP requests into internal operations (Reasoning Engine calls, Backend proxy calls)
//   - Format responses according to the REST contract defined in pkg/types/api.go
//   - Apply authentication middleware to all routes
//   - Log all API calls for audit trail
//   - Return appropriate HTTP status codes and error messages
//
// Integration Points:
//   - Reasoning Engine: Trigger investigations, retrieve investigation state
//   - Backend Proxy: Fetch cluster resources, validate changes
//   - Analytics Engine: Compute metrics, scores, trends, forecasts
//   - Safety Engine: Evaluate proposed actions before returning to frontend
//   - Audit Logger: Record all investigations and actions
//
// API Endpoint Groups:
//   1. Investigations: GET/POST /investigations, GET /investigations/{id}, DELETE /investigations/{id}
//   2. Insights: GET /insights, GET /insights/{id}, DELETE /insights/{id}
//   3. Actions: GET /actions, POST /actions, GET /actions/{id}, PATCH /actions/{id}/approve
//   4. Analytics: GET /metrics, GET /anomalies, GET /forecasts, GET /health-scores
//   5. Chat: POST /chat/message, WS /chat/stream
//   6. Configuration: GET /config, PATCH /config
//   7. Usage: GET /usage/summary, GET /usage/details
//
// All handlers are stateless and thread-safe.

// AIHandler defines the interface for all AI-related REST endpoints.
type AIHandler interface {
	// Investigation endpoints
	GetInvestigations(ctx context.Context) error
	CreateInvestigation(ctx context.Context) error
	GetInvestigation(ctx context.Context, id string) error
	CancelInvestigation(ctx context.Context, id string) error

	// Insight endpoints
	GetInsights(ctx context.Context) error
	GetInsight(ctx context.Context, id string) error
	DeleteInsight(ctx context.Context, id string) error

	// Action endpoints
	GetActions(ctx context.Context) error
	CreateAction(ctx context.Context) error
	GetAction(ctx context.Context, id string) error
	ApproveAction(ctx context.Context, id string) error
	RejectAction(ctx context.Context, id string) error

	// Analytics endpoints
	GetMetrics(ctx context.Context) error
	GetAnomalies(ctx context.Context) error
	GetForecasts(ctx context.Context) error
	GetHealthScores(ctx context.Context) error

	// Chat endpoints
	PostChatMessage(ctx context.Context) error

	// Configuration endpoints
	GetConfig(ctx context.Context) error
	UpdateConfig(ctx context.Context) error

	// Usage endpoints
	GetUsageSummary(ctx context.Context) error
	GetUsageDetails(ctx context.Context) error
}

// NewAIHandler creates a new AIHandler with all dependencies injected.
func NewAIHandler() AIHandler {
	// Inject Reasoning Engine, Backend Proxy, Analytics Engine, Safety Engine, Audit Logger
	return nil
}
