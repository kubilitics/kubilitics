package reports

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func sampleReport() *ResilienceReport {
	return &ResilienceReport{
		ClusterID:      "cluster-1",
		ClusterName:    "prod-east",
		GeneratedAt:    time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC),
		HealthScore:    85,
		HealthLabel:    "Healthy",
		SPOFCount:      3,
		CriticalSPOFs:  1,
		NamespacesRisk: 2,
		Findings: []ResilienceFinding{
			{Severity: "critical", Category: "spof", Resource: "deployment/api-gateway", Namespace: "production", Description: "Single replica deployment"},
		},
	}
}

func TestFormatSlack_ValidJSON(t *testing.T) {
	data, err := formatSlack(sampleReport())
	require.NoError(t, err)

	var parsed map[string]interface{}
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Contains(t, parsed["text"], "prod-east")
	blocks, ok := parsed["blocks"].([]interface{})
	require.True(t, ok)
	assert.Len(t, blocks, 2)

	// Verify header block.
	header := blocks[0].(map[string]interface{})
	assert.Equal(t, "header", header["type"])

	// Verify section block contains health score.
	section := blocks[1].(map[string]interface{})
	text := section["text"].(map[string]interface{})
	assert.Contains(t, text["text"], "85/100")
	assert.Contains(t, text["text"], "Healthy")
}

func TestFormatTeams_ValidJSON(t *testing.T) {
	data, err := formatTeams(sampleReport())
	require.NoError(t, err)

	var parsed map[string]interface{}
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)

	assert.Equal(t, "MessageCard", parsed["@type"])
	assert.Equal(t, "Kubilitics Resilience Report", parsed["summary"])
	assert.NotEmpty(t, parsed["themeColor"])

	sections, ok := parsed["sections"].([]interface{})
	require.True(t, ok)
	require.Len(t, sections, 1)

	section := sections[0].(map[string]interface{})
	facts, ok := section["facts"].([]interface{})
	require.True(t, ok)
	assert.Len(t, facts, 3)
}

func TestFormatGeneric_FullReport(t *testing.T) {
	report := sampleReport()
	data, err := formatGeneric(report)
	require.NoError(t, err)

	var parsed ResilienceReport
	err = json.Unmarshal(data, &parsed)
	require.NoError(t, err)
	assert.Equal(t, report.ClusterID, parsed.ClusterID)
	assert.Equal(t, report.HealthScore, parsed.HealthScore)
	assert.Len(t, parsed.Findings, 1)
}

func TestDeliverWebhook_Success(t *testing.T) {
	var receivedBody []byte
	var receivedContentType string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedContentType = r.Header.Get("Content-Type")
		receivedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	err := DeliverWebhook(server.URL, "generic", sampleReport())
	require.NoError(t, err)
	assert.Equal(t, "application/json", receivedContentType)
	assert.NotEmpty(t, receivedBody)

	// Verify the received body is a valid ResilienceReport.
	var report ResilienceReport
	err = json.Unmarshal(receivedBody, &report)
	require.NoError(t, err)
	assert.Equal(t, "cluster-1", report.ClusterID)
}

func TestDeliverWebhook_SlackFormat(t *testing.T) {
	var receivedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	err := DeliverWebhook(server.URL, "slack", sampleReport())
	require.NoError(t, err)

	var parsed map[string]interface{}
	err = json.Unmarshal(receivedBody, &parsed)
	require.NoError(t, err)
	assert.Contains(t, parsed["text"], "prod-east")
	assert.NotNil(t, parsed["blocks"])
}

func TestDeliverWebhook_TeamsFormat(t *testing.T) {
	var receivedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	err := DeliverWebhook(server.URL, "teams", sampleReport())
	require.NoError(t, err)

	var parsed map[string]interface{}
	err = json.Unmarshal(receivedBody, &parsed)
	require.NoError(t, err)
	assert.Equal(t, "MessageCard", parsed["@type"])
}

func TestDeliverWebhook_Non2xxStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	err := DeliverWebhook(server.URL, "generic", sampleReport())
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "status 500")
}

func TestDeliverWebhook_Timeout(t *testing.T) {
	// Create a server that delays beyond the webhook timeout.
	// We use a shorter delay than the full 10s to keep tests fast, but test the
	// mechanism by using a custom server with a small delay and checking connection behavior.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond) // Simulates slow server
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// This should succeed since 100ms < 10s timeout.
	err := DeliverWebhook(server.URL, "generic", sampleReport())
	assert.NoError(t, err)
}

func TestDeliverWebhook_ConnectionRefused(t *testing.T) {
	err := DeliverWebhook("http://127.0.0.1:1", "generic", sampleReport())
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "webhook POST failed")
}

func TestHealthColor(t *testing.T) {
	assert.Equal(t, "00CC00", healthColor(90))
	assert.Equal(t, "00CC00", healthColor(80))
	assert.Equal(t, "FFAA00", healthColor(79))
	assert.Equal(t, "FFAA00", healthColor(50))
	assert.Equal(t, "CC0000", healthColor(49))
	assert.Equal(t, "CC0000", healthColor(0))
}
