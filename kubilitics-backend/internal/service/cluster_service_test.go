package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// mockClusterRepo implements repository.ClusterRepository for tests.
type mockClusterRepo struct {
	clusters map[string]*models.Cluster
}

func (m *mockClusterRepo) Create(ctx context.Context, cluster *models.Cluster) error {
	if m.clusters == nil {
		m.clusters = make(map[string]*models.Cluster)
	}
	c := *cluster
	m.clusters[cluster.ID] = &c
	return nil
}

func (m *mockClusterRepo) Get(ctx context.Context, id string) (*models.Cluster, error) {
	if c, ok := m.clusters[id]; ok {
		cp := *c
		return &cp, nil
	}
	return nil, errors.New("cluster not found")
}

func (m *mockClusterRepo) List(ctx context.Context) ([]*models.Cluster, error) {
	var out []*models.Cluster
	for _, c := range m.clusters {
		cp := *c
		out = append(out, &cp)
	}
	return out, nil
}

func (m *mockClusterRepo) Update(ctx context.Context, cluster *models.Cluster) error {
	if m.clusters == nil {
		m.clusters = make(map[string]*models.Cluster)
	}
	c := *cluster
	m.clusters[cluster.ID] = &c
	return nil
}

func (m *mockClusterRepo) Delete(ctx context.Context, id string) error {
	delete(m.clusters, id)
	return nil
}

func TestClusterService_ListClusters_EmptyRepo(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	svc := NewClusterService(repo, nil)

	list, err := svc.ListClusters(ctx)
	if err != nil {
		t.Fatalf("ListClusters: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("expected 0 clusters, got %d", len(list))
	}
}

func TestClusterService_RemoveCluster_NotFound(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	svc := NewClusterService(repo, nil)

	err := svc.RemoveCluster(ctx, "nonexistent-id")
	if err == nil {
		t.Fatal("expected error when removing non-existent cluster")
	}
}

func TestClusterService_ListClusters_FromRepo(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{
		"id-1": {
			ID: "id-1", Name: "cluster-1", Context: "ctx1",
			Status: "disconnected", CreatedAt: time.Now(), UpdatedAt: time.Now(),
		},
	}}
	svc := NewClusterService(repo, nil)

	list, err := svc.ListClusters(ctx)
	if err != nil {
		t.Fatalf("ListClusters: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 cluster, got %d", len(list))
	}
	if list[0].ID != "id-1" || list[0].Name != "cluster-1" {
		t.Errorf("unexpected cluster: %+v", list[0])
	}
}

func TestClusterService_GetCluster_FromRepo(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{
		"id-1": {
			ID: "id-1", Name: "cluster-1", Context: "ctx1",
			Status: "disconnected", CreatedAt: time.Now(), UpdatedAt: time.Now(),
		},
	}}
	svc := NewClusterService(repo, nil)

	c, err := svc.GetCluster(ctx, "id-1")
	if err != nil {
		t.Fatalf("GetCluster: %v", err)
	}
	if c.ID != "id-1" || c.Name != "cluster-1" {
		t.Errorf("unexpected cluster: %+v", c)
	}

	_, err = svc.GetCluster(ctx, "nonexistent")
	if err == nil {
		t.Fatal("expected error for non-existent cluster")
	}
}

func TestClusterService_AddCluster_RespectsMaxClusters(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: map[string]*models.Cluster{
		"id-1": {
			ID: "id-1", Name: "cluster-1", Context: "ctx1",
			Status: "disconnected", CreatedAt: time.Now(), UpdatedAt: time.Now(),
		},
	}}
	cfg := &config.Config{MaxClusters: 1}
	svc := NewClusterService(repo, cfg)

	_, err := svc.AddCluster(ctx, "/nonexistent/kubeconfig", "ctx")
	if err == nil {
		t.Fatal("expected error when at cluster limit")
	}
	if !strings.Contains(err.Error(), "cluster limit reached") && !strings.Contains(err.Error(), "max 1") {
		t.Errorf("expected cluster limit error, got: %v", err)
	}
}

// Ensure mockClusterRepo satisfies repository.ClusterRepository
var _ repository.ClusterRepository = (*mockClusterRepo)(nil)
