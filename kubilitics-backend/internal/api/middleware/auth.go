package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// Auth returns middleware that enforces auth mode (disabled | optional | required) and sets claims in context.
// BE-AUTH-003: Also accepts API keys via X-API-Key header.
func Auth(cfg *config.Config, repo *repository.SQLiteRepository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if path == "/health" || path == "/metrics" ||
				path == "/api/v1/auth/login" || path == "/api/v1/auth/refresh" || path == "/api/v1/auth/logout" {
				next.ServeHTTP(w, r)
				return
			}
			mode := strings.ToLower(strings.TrimSpace(cfg.AuthMode))
			if mode == "" {
				mode = "disabled"
			}
			if mode == "disabled" {
				next.ServeHTTP(w, r)
				return
			}
			// BE-AUTH-003: Try API key first, then Bearer token
			apiKey := r.Header.Get("X-API-Key")
			if apiKey != "" && repo != nil {
			claims, err := validateAPIKey(r.Context(), repo, apiKey)
			if err == nil && claims != nil {
				metrics.AuthAPIKeyValidationsTotal.WithLabelValues("success").Inc()
				ctx := auth.WithClaims(r.Context(), claims)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			// Record failed API key validation
			if mode == "required" {
				metrics.AuthAPIKeyValidationsTotal.WithLabelValues("failure").Inc()
			}
				// If API key validation fails and mode is required, return error
				if mode == "required" {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusUnauthorized)
					_, _ = w.Write([]byte(`{"error":"Invalid or expired API key"}`))
					return
				}
			}
			// Try Bearer token
			token := extractBearer(r)
			if token == "" {
				if mode == "required" {
					w.Header().Set("WWW-Authenticate", "Bearer")
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusUnauthorized)
					_, _ = w.Write([]byte(`{"error":"Authentication required"}`))
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			claims, err := auth.ValidateTokenWithRepo(r.Context(), cfg.AuthJWTSecret, token, repo)
			if err != nil {
				if mode == "required" {
					w.Header().Set("WWW-Authenticate", "Bearer")
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusUnauthorized)
					errorMsg := "Invalid or expired token"
					if err == auth.ErrTokenRevoked {
						errorMsg = "Token has been revoked"
					}
					_, _ = w.Write([]byte(`{"error":"` + errorMsg + `"}`))
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			if claims.Refresh {
				if mode == "required" {
					w.Header().Set("WWW-Authenticate", "Bearer")
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusUnauthorized)
					_, _ = w.Write([]byte(`{"error":"Use access token for this request"}`))
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			ctx := auth.WithClaims(r.Context(), claims)
			
			// Phase 4: Update session activity
			if repo != nil && claims.ID != "" {
				session, err := repo.GetSessionByTokenID(ctx, claims.ID)
				if err == nil && session != nil && !session.IsExpired() {
					_ = repo.UpdateSessionActivity(ctx, session.ID)
				}
			}
			
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// validateAPIKey validates an API key and returns claims (BE-AUTH-003).
func validateAPIKey(ctx context.Context, repo *repository.SQLiteRepository, plaintextKey string) (*auth.Claims, error) {
	return findAPIKeyByPlaintext(ctx, repo, plaintextKey)
}

// findAPIKeyByPlaintext finds an API key by checking all stored hashes against the plaintext (BE-AUTH-003).
func findAPIKeyByPlaintext(ctx context.Context, repo *repository.SQLiteRepository, plaintextKey string) (*auth.Claims, error) {
	apiKey, err := repo.FindAPIKeyByPlaintext(ctx, plaintextKey)
	if err != nil || apiKey == nil {
		return nil, err
	}
	
	// Check if expired
	if apiKey.IsExpired() {
		return nil, auth.ErrExpiredToken
	}
	
	// Get user to build claims
	user, err := repo.GetUserByID(ctx, apiKey.UserID)
	if err != nil || user == nil {
		return nil, err
	}
	
	// Update last used
	_ = repo.UpdateAPIKeyLastUsed(ctx, apiKey.ID)
	
	// Build claims
	claims := &auth.Claims{
		UserID:   user.ID,
		Username: user.Username,
		Role:     user.Role,
		Refresh:  false,
	}
	return claims, nil
}

func extractBearer(r *http.Request) string {
	s := r.Header.Get("Authorization")
	if s == "" {
		return r.URL.Query().Get("token")
	}
	const prefix = "Bearer "
	if len(s) > len(prefix) && strings.EqualFold(s[:len(prefix)], prefix) {
		return strings.TrimSpace(s[len(prefix):])
	}
	return ""
}
