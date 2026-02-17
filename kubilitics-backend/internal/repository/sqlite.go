package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	_ "github.com/mattn/go-sqlite3"
)

// SQLiteRepository implements repositories using SQLite
type SQLiteRepository struct {
	db *sqlx.DB
}

// NewSQLiteRepository creates a new SQLite repository
func NewSQLiteRepository(dbPath string) (*SQLiteRepository, error) {
	db, err := sqlx.Connect("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to SQLite: %w", err)
	}

	// Enable foreign keys
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return nil, fmt.Errorf("failed to enable foreign keys: %w", err)
	}

	return &SQLiteRepository{db: db}, nil
}

// Close closes the database connection
func (r *SQLiteRepository) Close() error {
	return r.db.Close()
}

// RunMigrations runs database migrations
func (r *SQLiteRepository) RunMigrations(migrationSQL string) error {
	_, err := r.db.Exec(migrationSQL)
	return err
}

// ClusterRepository implementation (interface: Create, Get, List, Update, Delete)

func (r *SQLiteRepository) Create(ctx context.Context, cluster *models.Cluster) error {
	return r.createCluster(ctx, cluster)
}

func (r *SQLiteRepository) Get(ctx context.Context, id string) (*models.Cluster, error) {
	return r.getCluster(ctx, id)
}

func (r *SQLiteRepository) List(ctx context.Context) ([]*models.Cluster, error) {
	return r.listClusters(ctx)
}

func (r *SQLiteRepository) Update(ctx context.Context, cluster *models.Cluster) error {
	return r.updateCluster(ctx, cluster)
}

func (r *SQLiteRepository) Delete(ctx context.Context, id string) error {
	return r.deleteCluster(ctx, id)
}

func (r *SQLiteRepository) createCluster(ctx context.Context, cluster *models.Cluster) error {
	if cluster.ID == "" {
		cluster.ID = uuid.New().String()
	}
	if cluster.Provider == "" {
		cluster.Provider = "on-prem"
	}

	query := `
		INSERT INTO clusters (id, name, context, kubeconfig_path, server_url, version, status, provider, last_connected, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err := r.db.ExecContext(ctx, query,
		cluster.ID,
		cluster.Name,
		cluster.Context,
		cluster.KubeconfigPath,
		cluster.ServerURL,
		cluster.Version,
		cluster.Status,
		cluster.Provider,
		cluster.LastConnected,
		time.Now(),
		time.Now(),
	)

	return err
}

func (r *SQLiteRepository) getCluster(ctx context.Context, id string) (*models.Cluster, error) {
	var cluster models.Cluster
	query := `SELECT * FROM clusters WHERE id = ?`

	err := r.db.GetContext(ctx, &cluster, query, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("cluster not found: %s", id)
	}

	return &cluster, err
}

func (r *SQLiteRepository) listClusters(ctx context.Context) ([]*models.Cluster, error) {
	var clusters []*models.Cluster
	query := `SELECT * FROM clusters ORDER BY created_at DESC`

	err := r.db.SelectContext(ctx, &clusters, query)
	return clusters, err
}

func (r *SQLiteRepository) updateCluster(ctx context.Context, cluster *models.Cluster) error {
	query := `
		UPDATE clusters
		SET name = ?, context = ?, kubeconfig_path = ?, server_url = ?, version = ?,
		    status = ?, provider = ?, last_connected = ?, updated_at = ?
		WHERE id = ?
	`

	_, err := r.db.ExecContext(ctx, query,
		cluster.Name,
		cluster.Context,
		cluster.KubeconfigPath,
		cluster.ServerURL,
		cluster.Version,
		cluster.Status,
		cluster.Provider,
		cluster.LastConnected,
		time.Now(),
		cluster.ID,
	)

	return err
}

func (r *SQLiteRepository) deleteCluster(ctx context.Context, id string) error {
	query := `DELETE FROM clusters WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, id)
	return err
}

// TopologyRepository implementation

func (r *SQLiteRepository) SaveTopologySnapshot(ctx context.Context, snapshot *models.TopologySnapshot) error {
	if snapshot.ID == "" {
		snapshot.ID = uuid.New().String()
	}

	query := `
		INSERT INTO topology_snapshots (id, cluster_id, namespace, data, node_count, edge_count, layout_seed, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`

	// Parse data to get counts
	var topology models.TopologyGraph
	if err := json.Unmarshal([]byte(snapshot.Data), &topology); err != nil {
		return fmt.Errorf("failed to parse topology data: %w", err)
	}

	_, err := r.db.ExecContext(ctx, query,
		snapshot.ID,
		snapshot.ClusterID,
		snapshot.Namespace,
		snapshot.Data,
		topology.Metadata.NodeCount,
		topology.Metadata.EdgeCount,
		topology.Metadata.LayoutSeed,
		snapshot.Timestamp,
	)

	return err
}

func (r *SQLiteRepository) GetTopologySnapshot(ctx context.Context, id string) (*models.TopologySnapshot, error) {
	var snapshot models.TopologySnapshot
	query := `SELECT * FROM topology_snapshots WHERE id = ?`

	err := r.db.GetContext(ctx, &snapshot, query, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("snapshot not found: %s", id)
	}

	return &snapshot, err
}

func (r *SQLiteRepository) ListTopologySnapshots(ctx context.Context, clusterID string, limit int) ([]*models.TopologySnapshot, error) {
	var snapshots []*models.TopologySnapshot
	query := `
		SELECT * FROM topology_snapshots
		WHERE cluster_id = ?
		ORDER BY timestamp DESC
		LIMIT ?
	`

	err := r.db.SelectContext(ctx, &snapshots, query, clusterID, limit)
	return snapshots, err
}

func (r *SQLiteRepository) GetLatestTopologySnapshot(ctx context.Context, clusterID, namespace string) (*models.TopologySnapshot, error) {
	var snapshot models.TopologySnapshot
	var query string
	var args []interface{}

	if namespace != "" {
		query = `
			SELECT * FROM topology_snapshots
			WHERE cluster_id = ? AND namespace = ?
			ORDER BY timestamp DESC
			LIMIT 1
		`
		args = []interface{}{clusterID, namespace}
	} else {
		query = `
			SELECT * FROM topology_snapshots
			WHERE cluster_id = ? AND namespace IS NULL
			ORDER BY timestamp DESC
			LIMIT 1
		`
		args = []interface{}{clusterID}
	}

	err := r.db.GetContext(ctx, &snapshot, query, args...)
	if err == sql.ErrNoRows {
		return nil, nil // No snapshot found
	}

	return &snapshot, err
}

func (r *SQLiteRepository) DeleteOldTopologySnapshots(ctx context.Context, clusterID string, olderThan time.Time) error {
	query := `DELETE FROM topology_snapshots WHERE cluster_id = ? AND timestamp < ?`
	_, err := r.db.ExecContext(ctx, query, clusterID, olderThan)
	return err
}

// HistoryRepository implementation

func (r *SQLiteRepository) CreateResourceHistory(ctx context.Context, history *models.ResourceHistory) error {
	if history.ID == "" {
		history.ID = uuid.New().String()
	}

	query := `
		INSERT INTO resource_history (id, cluster_id, resource_type, namespace, name, action, yaml, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err := r.db.ExecContext(ctx, query,
		history.ID,
		"", // cluster_id - needs to be added to model
		history.ResourceType,
		history.Namespace,
		history.Name,
		history.Action,
		history.YAML,
		history.Timestamp,
	)

	return err
}

func (r *SQLiteRepository) ListResourceHistory(ctx context.Context, clusterID, resourceType, namespace, name string, limit int) ([]*models.ResourceHistory, error) {
	var history []*models.ResourceHistory
	query := `
		SELECT * FROM resource_history
		WHERE 1=1
	`
	args := []interface{}{}

	if clusterID != "" {
		query += " AND cluster_id = ?"
		args = append(args, clusterID)
	}

	if resourceType != "" {
		query += " AND resource_type = ?"
		args = append(args, resourceType)
	}

	if namespace != "" {
		query += " AND namespace = ?"
		args = append(args, namespace)
	}

	if name != "" {
		query += " AND name = ?"
		args = append(args, name)
	}

	query += " ORDER BY timestamp DESC LIMIT ?"
	args = append(args, limit)

	err := r.db.SelectContext(ctx, &history, query, args...)
	return history, err
}

// ProjectRepository implementation

func (r *SQLiteRepository) CreateProject(ctx context.Context, p *models.Project) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	query := `INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, p.ID, p.Name, p.Description, time.Now(), time.Now())
	return err
}

func (r *SQLiteRepository) GetProject(ctx context.Context, id string) (*models.Project, error) {
	var p models.Project
	err := r.db.GetContext(ctx, &p, `SELECT * FROM projects WHERE id = ?`, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("project not found: %s", id)
	}
	return &p, err
}

func (r *SQLiteRepository) ListProjects(ctx context.Context) ([]*models.ProjectListItem, error) {
	query := `SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
		(SELECT COUNT(*) FROM project_clusters WHERE project_id = p.id) AS cluster_count,
		(SELECT COUNT(*) FROM project_namespaces WHERE project_id = p.id) AS namespace_count
	FROM projects p ORDER BY p.name ASC`
	var list []*models.ProjectListItem
	err := r.db.SelectContext(ctx, &list, query)
	return list, err
}

func (r *SQLiteRepository) UpdateProject(ctx context.Context, p *models.Project) error {
	query := `UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?`
	_, err := r.db.ExecContext(ctx, query, p.Name, p.Description, time.Now(), p.ID)
	return err
}

func (r *SQLiteRepository) DeleteProject(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM projects WHERE id = ?`, id)
	return err
}

func (r *SQLiteRepository) AddClusterToProject(ctx context.Context, pc *models.ProjectCluster) error {
	query := `INSERT INTO project_clusters (project_id, cluster_id, created_at) VALUES (?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, pc.ProjectID, pc.ClusterID, time.Now())
	return err
}

func (r *SQLiteRepository) RemoveClusterFromProject(ctx context.Context, projectID, clusterID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM project_clusters WHERE project_id = ? AND cluster_id = ?`, projectID, clusterID)
	return err
}

func (r *SQLiteRepository) ListProjectClusters(ctx context.Context, projectID string) ([]*models.ProjectCluster, error) {
	var list []*models.ProjectCluster
	err := r.db.SelectContext(ctx, &list, `SELECT project_id, cluster_id FROM project_clusters WHERE project_id = ? ORDER BY cluster_id`, projectID)
	return list, err
}

func (r *SQLiteRepository) AddNamespaceToProject(ctx context.Context, pn *models.ProjectNamespace) error {
	query := `INSERT INTO project_namespaces (project_id, cluster_id, namespace_name, team, created_at) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.ExecContext(ctx, query, pn.ProjectID, pn.ClusterID, pn.NamespaceName, pn.Team, time.Now())
	return err
}

func (r *SQLiteRepository) RemoveNamespaceFromProject(ctx context.Context, projectID, clusterID, namespaceName string) error {
	query := `DELETE FROM project_namespaces WHERE project_id = ? AND cluster_id = ? AND namespace_name = ?`
	_, err := r.db.ExecContext(ctx, query, projectID, clusterID, namespaceName)
	return err
}

func (r *SQLiteRepository) ListProjectNamespaces(ctx context.Context, projectID string) ([]*models.ProjectNamespace, error) {
	var list []*models.ProjectNamespace
	err := r.db.SelectContext(ctx, &list, `SELECT project_id, cluster_id, namespace_name, team FROM project_namespaces WHERE project_id = ? ORDER BY cluster_id, team, namespace_name`, projectID)
	return list, err
}
