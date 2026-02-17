package server

// backend_http.go — lightweight HTTP client for the kubilitics-backend REST API.
//
// The backend proxy uses gRPC for most operations, but some endpoints (topology,
// logs, metrics, search) are only available via REST.  This helper consolidates
// all direct HTTP calls in one place so every handler shares the same error
// handling, base URL resolution, and cluster ID lookup.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// backendHTTP is a thin client for the kubilitics-backend REST API.
type backendHTTP struct {
	baseURL    string
	httpClient *http.Client
}

// newBackendHTTP creates a client pointing at baseURL (e.g. "http://localhost:8080").
// If baseURL is empty it defaults to http://localhost:8080.
func newBackendHTTP(baseURL string) *backendHTTP {
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}
	return &backendHTTP{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// get performs a GET request and unmarshals the JSON response.
func (c *backendHTTP) get(ctx context.Context, path string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("GET %s: %w", path, err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: HTTP %d: %s", path, resp.StatusCode, truncate(string(body), 200))
	}

	if out != nil {
		if err := json.Unmarshal(body, out); err != nil {
			return fmt.Errorf("GET %s: decode: %w", path, err)
		}
	}
	return nil
}

// firstClusterID returns the ID of the first cluster registered in the backend.
// Results are not cached — callers should pass a cluster_id arg where possible.
func (c *backendHTTP) firstClusterID(ctx context.Context) (string, error) {
	var clusters []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := c.get(ctx, "/api/v1/clusters", &clusters); err != nil {
		return "", fmt.Errorf("list clusters: %w", err)
	}
	if len(clusters) == 0 {
		return "", fmt.Errorf("no clusters registered; add a cluster first")
	}
	return clusters[0].ID, nil
}

// resolveCluster returns the clusterID from args["cluster_id"], falling back to
// the first registered cluster if the arg is absent.
func (c *backendHTTP) resolveCluster(ctx context.Context, args map[string]interface{}) (string, error) {
	if id, ok := args["cluster_id"].(string); ok && id != "" {
		return url.PathEscape(id), nil
	}
	return c.firstClusterID(ctx)
}

// clusterPath returns "/api/v1/clusters/{clusterID}{suffix}".
func (c *backendHTTP) clusterPath(clusterID, suffix string) string {
	return "/api/v1/clusters/" + clusterID + suffix
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// newHTTPRequest is a helper to build an http.Request with context.
func newHTTPRequest(ctx context.Context, method, rawURL string) (*http.Request, error) {
	return http.NewRequestWithContext(ctx, method, rawURL, nil)
}

func strArg(args map[string]interface{}, key string) string {
	v, _ := args[key].(string)
	return v
}

func intArg(args map[string]interface{}, key string, def int) int {
	switch v := args[key].(type) {
	case int:
		return v
	case float64:
		return int(v)
	case int64:
		return int(v)
	}
	return def
}
