// Package service: MetricsCollector continuously collects metrics for all pods
// across all connected clusters and persists them to SQLite for historical charts.
// One API call per cluster fetches all pod metrics — no per-pod overhead.
package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

const (
	collectInterval = 30 * time.Second
	purgeInterval   = 1 * time.Hour
	maxHistoryAge   = 7 * 24 * time.Hour // keep 7 days
)

// MetricsCollector runs a background goroutine that fetches all pod metrics
// from every connected cluster and stores them in SQLite.
type MetricsCollector struct {
	clusterService ClusterService
	provider       *metrics.MetricsServerProvider
	repo           *repository.SQLiteRepository
}

// NewMetricsCollector creates a new collector.
func NewMetricsCollector(
	clusterService ClusterService,
	provider *metrics.MetricsServerProvider,
	repo *repository.SQLiteRepository,
) *MetricsCollector {
	return &MetricsCollector{
		clusterService: clusterService,
		provider:       provider,
		repo:           repo,
	}
}

// Start begins the collection loop. Call this at server startup.
func (mc *MetricsCollector) Start(ctx context.Context) {
	go func() {
		// Initial collection after a short delay (let clusters connect first)
		time.Sleep(5 * time.Second)
		mc.collectAll(ctx)

		ticker := time.NewTicker(collectInterval)
		defer ticker.Stop()
		purgeTicker := time.NewTicker(purgeInterval)
		defer purgeTicker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				mc.collectAll(ctx)
			case <-purgeTicker.C:
				mc.purgeOld(ctx)
			}
		}
	}()
	slog.Info("metrics collector started", "interval", collectInterval.String(), "retention", maxHistoryAge.String())
}

func (mc *MetricsCollector) collectAll(ctx context.Context) {
	clusters, err := mc.clusterService.ListClusters(ctx)
	if err != nil {
		slog.Warn("metrics collector: failed to list clusters", "error", err)
		return
	}

	now := time.Now().Unix()
	totalPods := 0

	for _, cluster := range clusters {
		if cluster.Status != "connected" {
			continue
		}
		client, err := mc.clusterService.GetClient(cluster.ID)
		if err != nil {
			continue // skip clusters without active client
		}

		fetchCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		podMetrics, err := mc.provider.GetAllPodMetrics(fetchCtx, client)
		cancel()

		if err != nil {
			slog.Debug("metrics collector: skip cluster", "cluster", cluster.Name, "error", err)
			continue
		}

		if len(podMetrics) == 0 {
			continue
		}

		rows := make([]repository.MetricsHistoryRow, 0, len(podMetrics))
		for _, pm := range podMetrics {
			rows = append(rows, repository.MetricsHistoryRow{
				ClusterID: cluster.ID,
				Namespace: pm.Namespace,
				PodName:   pm.Name,
				Timestamp: now,
				CPUMilli:  pm.CPUMilli,
				MemoryMiB: pm.MemoryMiB,
			})
		}

		if err := mc.repo.InsertMetricsHistory(ctx, rows); err != nil {
			slog.Warn("metrics collector: failed to insert", "cluster", cluster.Name, "error", err)
			continue
		}
		totalPods += len(rows)
	}

	if totalPods > 0 {
		slog.Debug("metrics collected", "pods", totalPods)
	}
}

func (mc *MetricsCollector) purgeOld(ctx context.Context) {
	deleted, err := mc.repo.PurgeOldMetrics(ctx, maxHistoryAge)
	if err != nil {
		slog.Warn("metrics purge failed", "error", err)
		return
	}
	if deleted > 0 {
		slog.Info("metrics purged", "deleted_rows", deleted)
	}
}
