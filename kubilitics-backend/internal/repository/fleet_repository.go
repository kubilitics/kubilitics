package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// FleetRepository defines data access for Fleet X-Ray health history and golden templates.
type FleetRepository interface {
	InsertFleetHealth(ctx context.Context, record *models.FleetHealthRecord) error
	GetFleetHealthHistory(ctx context.Context, clusterID string, from, to time.Time) ([]models.FleetHealthRecord, error)
	GetLatestFleetHealth(ctx context.Context, clusterID string) (*models.FleetHealthRecord, error)
	CreateGoldenTemplate(ctx context.Context, tpl *models.GoldenTemplate) error
	GetGoldenTemplate(ctx context.Context, id string) (*models.GoldenTemplate, error)
	ListGoldenTemplates(ctx context.Context) ([]models.GoldenTemplate, error)
	UpdateGoldenTemplate(ctx context.Context, tpl *models.GoldenTemplate) error
	DeleteGoldenTemplate(ctx context.Context, id string) error
}

// --- SQLiteRepository implements FleetRepository ---

func (r *SQLiteRepository) InsertFleetHealth(ctx context.Context, record *models.FleetHealthRecord) error {
	query := `
		INSERT INTO fleet_health_history (cluster_id, timestamp, health_score, spof_count, pdb_coverage,
			hpa_coverage, netpol_coverage, critical_count, total_workloads, metrics_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := r.db.ExecContext(ctx, query,
		record.ClusterID,
		record.Timestamp,
		record.HealthScore,
		record.SPOFCount,
		record.PDBCoverage,
		record.HPACoverage,
		record.NetPolCoverage,
		record.CriticalCount,
		record.TotalWorkloads,
		record.MetricsJSON,
	)
	return err
}

func (r *SQLiteRepository) GetFleetHealthHistory(ctx context.Context, clusterID string, from, to time.Time) ([]models.FleetHealthRecord, error) {
	var records []models.FleetHealthRecord
	query := `
		SELECT * FROM fleet_health_history
		WHERE cluster_id = ? AND timestamp >= ? AND timestamp <= ?
		ORDER BY timestamp ASC
	`
	err := r.db.SelectContext(ctx, &records, query, clusterID, from, to)
	return records, err
}

func (r *SQLiteRepository) GetLatestFleetHealth(ctx context.Context, clusterID string) (*models.FleetHealthRecord, error) {
	var record models.FleetHealthRecord
	query := `SELECT * FROM fleet_health_history WHERE cluster_id = ? ORDER BY timestamp DESC LIMIT 1`
	err := r.db.GetContext(ctx, &record, query, clusterID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *SQLiteRepository) CreateGoldenTemplate(ctx context.Context, tpl *models.GoldenTemplate) error {
	now := time.Now()
	tpl.CreatedAt = now
	tpl.UpdatedAt = now
	query := `
		INSERT INTO golden_templates (id, name, description, requirements, created_at, updated_at, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`
	_, err := r.db.ExecContext(ctx, query,
		tpl.ID,
		tpl.Name,
		tpl.Description,
		tpl.Requirements,
		tpl.CreatedAt,
		tpl.UpdatedAt,
		tpl.CreatedBy,
	)
	return err
}

func (r *SQLiteRepository) GetGoldenTemplate(ctx context.Context, id string) (*models.GoldenTemplate, error) {
	var tpl models.GoldenTemplate
	err := r.db.GetContext(ctx, &tpl, `SELECT * FROM golden_templates WHERE id = ?`, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("golden template not found: %s", id)
	}
	if err != nil {
		return nil, err
	}
	return &tpl, nil
}

func (r *SQLiteRepository) ListGoldenTemplates(ctx context.Context) ([]models.GoldenTemplate, error) {
	var templates []models.GoldenTemplate
	err := r.db.SelectContext(ctx, &templates, `SELECT * FROM golden_templates ORDER BY name ASC`)
	return templates, err
}

func (r *SQLiteRepository) UpdateGoldenTemplate(ctx context.Context, tpl *models.GoldenTemplate) error {
	tpl.UpdatedAt = time.Now()
	query := `UPDATE golden_templates SET name = ?, description = ?, requirements = ?, updated_at = ? WHERE id = ?`
	result, err := r.db.ExecContext(ctx, query, tpl.Name, tpl.Description, tpl.Requirements, tpl.UpdatedAt, tpl.ID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("golden template not found: %s", tpl.ID)
	}
	return nil
}

func (r *SQLiteRepository) DeleteGoldenTemplate(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM golden_templates WHERE id = ?`, id)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("golden template not found: %s", id)
	}
	return nil
}
