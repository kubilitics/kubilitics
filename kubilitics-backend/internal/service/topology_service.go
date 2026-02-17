package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/topologycache"
	"github.com/kubilitics/kubilitics-backend/internal/topology"
)

// ErrExportNotImplemented is returned when topology export is not yet implemented (API returns 501).
var ErrExportNotImplemented = errors.New("topology export not yet implemented")

// TopologyService generates topology graphs (with optional TTL cache; C1.3).
type TopologyService interface {
	GetTopology(ctx context.Context, clusterID string, filters models.TopologyFilters, maxNodes int) (*models.TopologyGraph, error)
	GetResourceTopology(ctx context.Context, clusterID string, kind, namespace, name string) (*models.TopologyGraph, error)
	ExportTopology(ctx context.Context, clusterID string, format string) ([]byte, error)
}

type topologyService struct {
	clusterService *clusterService
	cache          *topologycache.Cache
}

// NewTopologyService creates a topology service. If cache is nil or has TTL 0, caching is disabled.
func NewTopologyService(cs ClusterService, cache *topologycache.Cache) TopologyService {
	return &topologyService{
		clusterService: cs.(*clusterService),
		cache:          cache,
	}
}

func (s *topologyService) GetTopology(ctx context.Context, clusterID string, filters models.TopologyFilters, maxNodes int) (*models.TopologyGraph, error) {
	if s.cache != nil {
		if g, ok := s.cache.Get(clusterID, filters.Namespace); ok {
			return g, nil
		}
	}

	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	engine := topology.NewEngine(client)
	g, err := engine.BuildGraph(ctx, filters, clusterID, maxNodes)
	if err != nil {
		return nil, fmt.Errorf("failed to build topology: %w", err)
	}

	if s.cache != nil {
		s.cache.Set(clusterID, filters.Namespace, g)
	}
	return g, nil
}

func (s *topologyService) GetResourceTopology(ctx context.Context, clusterID string, kind, namespace, name string) (*models.TopologyGraph, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}
	engine := topology.NewEngine(client)
	g, err := engine.BuildResourceSubgraph(ctx, kind, namespace, name)
	if err != nil {
		return nil, fmt.Errorf("failed to build resource topology: %w", err)
	}
	topology := g.ToTopologyGraph(clusterID)
	return &topology, nil
}

func (s *topologyService) ExportTopology(ctx context.Context, clusterID string, format string) ([]byte, error) {
	// Stub: returns 501 until export is implemented (PNG/PDF/SVG/JSON per project-docs).
	return nil, ErrExportNotImplemented
}
