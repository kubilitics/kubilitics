package rest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// AgentAdminHandler provides admin-only operations for the agent trust model.
type AgentAdminHandler struct {
	repo         *repository.AgentRepo
	signer       *agenttoken.Signer
	authMode     string // "disabled" | "optional" | "required"
	userJWTSecret string // user-JWT secret for inline auth guard
}

// NewAgentAdminHandler constructs an AgentAdminHandler.
// authMode and userJWTSecret are used to enforce the inline auth guard on
// MintBootstrap; pass empty strings to disable the guard (test / disabled mode).
func NewAgentAdminHandler(repo *repository.AgentRepo, signer *agenttoken.Signer) *AgentAdminHandler {
	return &AgentAdminHandler{repo: repo, signer: signer}
}

// NewAgentAdminHandlerWithAuth constructs an AgentAdminHandler with an inline
// user-JWT auth guard. When authMode != "disabled", MintBootstrap requires a
// valid user access token in the Authorization header.
func NewAgentAdminHandlerWithAuth(repo *repository.AgentRepo, signer *agenttoken.Signer, authMode, userJWTSecret string) *AgentAdminHandler {
	return &AgentAdminHandler{
		repo:          repo,
		signer:        signer,
		authMode:      strings.ToLower(strings.TrimSpace(authMode)),
		userJWTSecret: userJWTSecret,
	}
}

type mintRequest struct {
	OrganizationID string `json:"organization_id"`
	TTLSeconds     int    `json:"ttl_seconds"`
}

// MintBootstrap issues a single-use bootstrap token for an organization and
// returns the signed JWT together with a ready-to-run helm install command.
//
// When auth_mode != "disabled", a valid user access token must be supplied in
// the Authorization: Bearer header. This is a minimal pre-RBAC guard; full
// RBAC (role checks, audit log) is a later spec item.
func (h *AgentAdminHandler) MintBootstrap(w http.ResponseWriter, r *http.Request) {
	// Minimal pre-RBAC guard: require a valid user JWT when auth is enabled.
	mode := h.authMode
	if mode == "" {
		mode = "disabled"
	}
	if mode != "disabled" && h.userJWTSecret != "" {
		authHeader := r.Header.Get("Authorization")
		const bearer = "Bearer "
		if len(authHeader) <= len(bearer) || !strings.EqualFold(authHeader[:len(bearer)], bearer) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeAgentErr(w, http.StatusUnauthorized, "unauthorized", "valid user token required")
			return
		}
		tokenStr := strings.TrimSpace(authHeader[len(bearer):])
		claims, err := auth.ValidateToken(h.userJWTSecret, tokenStr)
		if err != nil || claims == nil || claims.Refresh {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeAgentErr(w, http.StatusUnauthorized, "unauthorized", "invalid or expired user token")
			return
		}
	}

	var req mintRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAgentErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if req.OrganizationID == "" {
		req.OrganizationID = defaultOrgID
	}
	if req.TTLSeconds <= 0 {
		req.TTLSeconds = 24 * 3600
	}
	if req.TTLSeconds < 900 || req.TTLSeconds > 7*24*3600 {
		writeAgentErr(w, http.StatusBadRequest, "ttl_out_of_range", "ttl must be 900..604800 seconds")
		return
	}

	// X-User-ID is recorded for audit purposes only; no authorization is enforced here.
	createdBy := r.Header.Get("X-User-ID")
	if createdBy == "" {
		createdBy = "anonymous"
	}

	jti := uuid.NewString()
	ttl := time.Duration(req.TTLSeconds) * time.Second

	tok, err := h.signer.IssueBootstrap(agenttoken.BootstrapClaims{
		JTI:       jti,
		OrgID:     req.OrganizationID,
		CreatedBy: createdBy,
		TTL:       ttl,
	})
	if err != nil {
		writeAgentErr(w, http.StatusInternalServerError, "sign_error", err.Error())
		return
	}

	if err := h.repo.InsertBootstrapToken(r.Context(), &models.BootstrapToken{
		JTI:            jti,
		OrganizationID: req.OrganizationID,
		CreatedBy:      createdBy,
		ExpiresAt:      time.Now().Add(ttl),
	}); err != nil {
		writeAgentErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	hubURL := os.Getenv("KUBILITICS_PUBLIC_HUB_URL")
	if hubURL == "" {
		hubURL = "https://<your-hub>"
	}
	helmCmd := fmt.Sprintf(
		"helm install kubilitics-agent kubilitics/kubilitics-agent "+
			"-n kubilitics-system --create-namespace "+
			"--set hub.url=%s --set hub.token=%s",
		hubURL, tok,
	)

	writeAgentJSON(w, http.StatusOK, map[string]any{
		"bootstrap_token": tok,
		"jti":             jti,
		"expires_at":      time.Now().Add(ttl).UTC().Format(time.RFC3339),
		"helm_command":    helmCmd,
	})
}
