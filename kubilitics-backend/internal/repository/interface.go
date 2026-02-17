package repository

import (
	"context"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// ClusterRepository defines cluster data access methods
type ClusterRepository interface {
	Create(ctx context.Context, cluster *models.Cluster) error
	Get(ctx context.Context, id string) (*models.Cluster, error)
	List(ctx context.Context) ([]*models.Cluster, error)
	Update(ctx context.Context, cluster *models.Cluster) error
	Delete(ctx context.Context, id string) error
}

// TopologyRepository defines topology data access methods
type TopologyRepository interface {
	SaveSnapshot(ctx context.Context, snapshot *models.TopologySnapshot) error
	GetSnapshot(ctx context.Context, id string) (*models.TopologySnapshot, error)
	ListSnapshots(ctx context.Context, clusterID string, limit int) ([]*models.TopologySnapshot, error)
	GetLatestSnapshot(ctx context.Context, clusterID, namespace string) (*models.TopologySnapshot, error)
	DeleteOldSnapshots(ctx context.Context, clusterID string, olderThan time.Time) error
}

// HistoryRepository defines resource history data access methods
type HistoryRepository interface {
	Create(ctx context.Context, history *models.ResourceHistory) error
	List(ctx context.Context, clusterID, resourceType, namespace, name string, limit int) ([]*models.ResourceHistory, error)
	GetDiff(ctx context.Context, id string) (string, error)
}

// ProjectRepository defines project data access methods for multi-cluster, multi-tenancy
type ProjectRepository interface {
	CreateProject(ctx context.Context, p *models.Project) error
	GetProject(ctx context.Context, id string) (*models.Project, error)
	ListProjects(ctx context.Context) ([]*models.ProjectListItem, error)
	UpdateProject(ctx context.Context, p *models.Project) error
	DeleteProject(ctx context.Context, id string) error
	AddClusterToProject(ctx context.Context, pc *models.ProjectCluster) error
	RemoveClusterFromProject(ctx context.Context, projectID, clusterID string) error
	ListProjectClusters(ctx context.Context, projectID string) ([]*models.ProjectCluster, error)
	AddNamespaceToProject(ctx context.Context, pn *models.ProjectNamespace) error
	RemoveNamespaceFromProject(ctx context.Context, projectID, clusterID, namespaceName string) error
	ListProjectNamespaces(ctx context.Context, projectID string) ([]*models.ProjectNamespace, error)
}

// Repository aggregates all repositories
type Repository struct {
	Cluster  ClusterRepository
	Topology TopologyRepository
	History  HistoryRepository
	Project  ProjectRepository
}
