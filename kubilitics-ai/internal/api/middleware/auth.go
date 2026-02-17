package middleware

import "context"

// Package middleware provides HTTP middleware for all API requests.
//
// Responsibilities:
//   - Validate authentication tokens (JWT, API keys, OAuth)
//   - Extract user identity and scopes from tokens
//   - Inject authentication context into requests
//   - Add correlation IDs to all requests for distributed tracing
//   - Log request metadata for audit trail
//   - Enforce rate limiting per user/API key
//   - Validate request content-type and body size limits
//   - Add security headers (CORS, X-Frame-Options, CSP, etc.)
//
// Authentication Strategy:
//   - JWT tokens with configurable signing key
//   - Bearer token scheme: Authorization: Bearer <token>
//   - API key support: X-API-Key header
//   - Fallback to session cookies if enabled
//   - Token validation includes expiration, signature, and claims verification
//
// Context Propagation:
//   - User ID added to context for audit logging
//   - Correlation ID added for request tracing across services
//   - Request metadata stored for logging
//   - Autonomy level extracted from user config

// AuthMiddleware defines the interface for authentication and request processing.
type AuthMiddleware interface {
	// ValidateToken validates JWT or API key token.
	ValidateToken(ctx context.Context, token string) error

	// ExtractUserContext extracts user identity and configuration from token claims.
	ExtractUserContext(ctx context.Context, token string) error

	// GenerateCorrelationID generates or extracts correlation ID for request tracing.
	GenerateCorrelationID(ctx context.Context) string

	// EnforceRateLimit checks if user has exceeded rate limits.
	EnforceRateLimit(ctx context.Context, userID string) error
}

// NewAuthMiddleware creates a new authentication middleware.
func NewAuthMiddleware() AuthMiddleware {
	// Load signing keys from config
	// Initialize rate limiter
	return nil
}
