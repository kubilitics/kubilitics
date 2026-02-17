// Package logger provides enterprise-grade structured JSON logging with request correlation.
// No PII or secrets are logged; request_id and cluster_id enable traceability in production.
package logger

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"time"
)

type contextKey string

const RequestIDKey contextKey = "request_id"

// LogEntry is the structured log payload (JSON). Safe for aggregation; no secrets.
type LogEntry struct {
	Time       string  `json:"time"`
	Level      string  `json:"level"`
	RequestID  string  `json:"request_id,omitempty"`
	ClusterID  string  `json:"cluster_id,omitempty"`
	Method     string  `json:"method,omitempty"`
	Path       string  `json:"path,omitempty"`
	Status     int     `json:"status,omitempty"`
	DurationMs float64 `json:"duration_ms,omitempty"`
	Message    string  `json:"message,omitempty"`
	Error      string  `json:"error,omitempty"`
}

// RequestLog writes a single JSON line for an HTTP request (after response). Use from middleware.
func RequestLog(out *os.File, reqID, clusterID, method, path string, status int, duration time.Duration, errMsg string) {
	level := "info"
	if status >= 500 {
		level = "error"
	} else if status >= 400 {
		level = "warn"
	}
	entry := LogEntry{
		Time:       time.Now().UTC().Format(time.RFC3339Nano),
		Level:      level,
		RequestID:  reqID,
		ClusterID:  clusterID,
		Method:     method,
		Path:       path,
		Status:     status,
		DurationMs: float64(duration.Milliseconds()),
		Error:      errMsg,
	}
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(entry)
}

// FromContext returns the request ID from context, or empty string.
func FromContext(ctx context.Context) string {
	if id, ok := ctx.Value(RequestIDKey).(string); ok {
		return id
	}
	return ""
}

// StdLogger returns a slog.Logger for non-request logs (startup, shutdown). JSON when LOG_JSON=1.
func StdLogger() *slog.Logger {
	opts := &slog.HandlerOptions{Level: slog.LevelInfo}
	if os.Getenv("LOG_JSON") == "1" {
		return slog.New(slog.NewJSONHandler(os.Stderr, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stderr, opts))
}
