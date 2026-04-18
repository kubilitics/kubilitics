package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestRateLimit_HeartbeatBurst(t *testing.T) {
	repo := newTestAgentRepo(t)
	signer := agenttoken.NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	cluster := &models.AgentCluster{
		ID: uuid.NewString(), OrganizationID: defaultOrgID, ClusterUID: "uid-rl",
		Name: "c", Status: "active", CredentialEpoch: 1,
	}
	if err := repo.UpsertCluster(context.Background(), cluster); err != nil {
		t.Fatal(err)
	}
	access, _ := signer.IssueAccess(agenttoken.AccessClaims{
		ClusterID: cluster.ID, OrgID: defaultOrgID, Epoch: 1, TTL: time.Hour,
	})

	hb := NewAgentHeartbeatHandler(repo, signer)
	limited := NewClusterRateLimitMiddleware(signer, 10, 50)(hb)

	body, _ := json.Marshal(map[string]string{"cluster_id": cluster.ID, "cluster_uid": "uid-rl", "status": "healthy"})

	successes, throttled := 0, 0
	for i := 0; i < 80; i++ {
		req := httptest.NewRequest("POST", "/x", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+access)
		rr := httptest.NewRecorder()
		limited.ServeHTTP(rr, req)
		switch rr.Code {
		case 200:
			successes++
		case 429:
			throttled++
		}
	}
	if throttled < 10 {
		t.Fatalf("expected at least 10 rate-limited, got %d (successes=%d)", throttled, successes)
	}
}
