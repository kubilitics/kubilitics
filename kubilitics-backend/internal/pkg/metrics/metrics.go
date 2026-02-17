// Package metrics provides Prometheus metrics for Kubilitics backend (RED + topology + WebSocket).
// Enterprise-grade: scrapeable /metrics; runbooks and dashboards can rely on these names.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

const namespace = "kubilitics"

var (
	// HTTPRequestTotal counts requests by method, path, status (RED: rate).
	HTTPRequestTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "http_requests_total",
			Help:      "Total number of HTTP requests by method, path, and status.",
		},
		[]string{"method", "path", "status"},
	)

	// HTTPRequestDurationSeconds is request latency histogram (RED: duration).
	HTTPRequestDurationSeconds = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Name:      "http_request_duration_seconds",
			Help:      "HTTP request duration in seconds.",
			Buckets:   prometheus.ExponentialBuckets(0.001, 2.5, 10), // 1ms to ~9.3s
		},
		[]string{"method", "path"},
	)

	// TopologyBuildDurationSeconds is topology build latency (SLO target).
	TopologyBuildDurationSeconds = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Name:      "topology_build_duration_seconds",
			Help:      "Topology graph build duration in seconds.",
			Buckets:   prometheus.ExponentialBuckets(0.5, 2, 8), // 0.5s to 64s
		},
	)

	// WebSocketConnectionsActive is current number of WebSocket clients (capacity planning).
	WebSocketConnectionsActive = promauto.NewGauge(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Name:      "websocket_connections_active",
			Help:      "Number of active WebSocket connections.",
		},
	)

	// TopologyCacheHitsTotal counts cache hits (observability for C1.3).
	TopologyCacheHitsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "topology_cache_hits_total",
			Help:      "Total number of topology cache hits.",
		},
	)

	// TopologyCacheMissesTotal counts cache misses (observability for C1.3).
	TopologyCacheMissesTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "topology_cache_misses_total",
			Help:      "Total number of topology cache misses.",
		},
	)
)
