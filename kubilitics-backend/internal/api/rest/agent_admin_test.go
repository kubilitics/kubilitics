package rest

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
)

const testAdminJWTSecret = "test-secret-key-minimum-32-chars-x"

func TestMintBootstrapToken(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	// Use no-auth variant (backwards-compatible) — disabled mode, guard not engaged.
	h := NewAgentAdminHandler(repo, signer)

	body := []byte(`{"organization_id":"00000000-0000-0000-0000-000000000001","ttl_seconds":3600}`)
	req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
	req.Header.Set("X-User-ID", "admin-user")
	rr := httptest.NewRecorder()
	h.MintBootstrap(rr, req)
	if rr.Code != 200 {
		t.Fatalf("status %d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Token       string `json:"bootstrap_token"`
		HelmCommand string `json:"helm_command"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Token == "" || resp.HelmCommand == "" {
		t.Fatalf("got %+v", resp)
	}
}

func TestMintBootstrapToken_RequiresUserAuth_NoToken(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	h := NewAgentAdminHandlerWithAuth(repo, signer, "required", testAdminJWTSecret)

	body := []byte(`{"organization_id":"00000000-0000-0000-0000-000000000001","ttl_seconds":3600}`)
	req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
	// No Authorization header — must be rejected.
	rr := httptest.NewRecorder()
	h.MintBootstrap(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestMintBootstrapToken_RequiresUserAuth_ValidToken(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	h := NewAgentAdminHandlerWithAuth(repo, signer, "required", testAdminJWTSecret)

	// Issue a valid user access token.
	userTok, err := auth.IssueAccessToken(testAdminJWTSecret, "admin-id", "admin", "admin")
	if err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"organization_id":"00000000-0000-0000-0000-000000000001","ttl_seconds":3600}`)
	req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+userTok)
	rr := httptest.NewRecorder()
	h.MintBootstrap(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rr.Code, rr.Body.String())
	}
}
