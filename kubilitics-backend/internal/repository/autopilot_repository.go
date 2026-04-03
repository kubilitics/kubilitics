package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// AutoPilotRepository defines data access for Auto-Pilot configuration and actions.
type AutoPilotRepository interface {
	GetAutoPilotConfig(ctx context.Context, clusterID, ruleID string) (*models.AutoPilotConfig, error)
	ListAutoPilotConfigs(ctx context.Context, clusterID string) ([]models.AutoPilotConfig, error)
	UpsertAutoPilotConfig(ctx context.Context, config *models.AutoPilotConfig) error
	CreateAutoPilotAction(ctx context.Context, action *models.AutoPilotAction) error
	GetAutoPilotAction(ctx context.Context, id string) (*models.AutoPilotAction, error)
	ListAutoPilotActions(ctx context.Context, clusterID string, status string, limit, offset int) ([]models.AutoPilotAction, int, error)
	UpdateAutoPilotActionStatus(ctx context.Context, id, status, appliedBy string) error
}

// --- SQLiteRepository implements AutoPilotRepository ---

func (r *SQLiteRepository) GetAutoPilotConfig(ctx context.Context, clusterID, ruleID string) (*models.AutoPilotConfig, error) {
	var config models.AutoPilotConfig
	err := r.db.GetContext(ctx, &config, `SELECT * FROM autopilot_config WHERE cluster_id = ? AND rule_id = ?`, clusterID, ruleID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &config, nil
}

func (r *SQLiteRepository) ListAutoPilotConfigs(ctx context.Context, clusterID string) ([]models.AutoPilotConfig, error) {
	var configs []models.AutoPilotConfig
	err := r.db.SelectContext(ctx, &configs, `SELECT * FROM autopilot_config WHERE cluster_id = ? ORDER BY rule_id`, clusterID)
	return configs, err
}

func (r *SQLiteRepository) UpsertAutoPilotConfig(ctx context.Context, config *models.AutoPilotConfig) error {
	config.UpdatedAt = time.Now()
	query := `
		INSERT INTO autopilot_config (cluster_id, rule_id, mode, enabled, namespace_includes, namespace_excludes, cooldown_minutes, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(cluster_id, rule_id) DO UPDATE SET
			mode = excluded.mode,
			enabled = excluded.enabled,
			namespace_includes = excluded.namespace_includes,
			namespace_excludes = excluded.namespace_excludes,
			cooldown_minutes = excluded.cooldown_minutes,
			updated_at = excluded.updated_at
	`
	_, err := r.db.ExecContext(ctx, query,
		config.ClusterID,
		config.RuleID,
		config.Mode,
		config.Enabled,
		config.NamespaceIncludes,
		config.NamespaceExcludes,
		config.CooldownMinutes,
		config.UpdatedAt,
	)
	return err
}

func (r *SQLiteRepository) CreateAutoPilotAction(ctx context.Context, action *models.AutoPilotAction) error {
	query := `
		INSERT INTO autopilot_actions (id, cluster_id, rule_id, target_kind, target_namespace, target_name,
			action_type, status, severity, description, before_state, after_state,
			simulation_result, created_at, applied_at, applied_by, rollback_state)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := r.db.ExecContext(ctx, query,
		action.ID,
		action.ClusterID,
		action.RuleID,
		action.TargetKind,
		action.TargetNamespace,
		action.TargetName,
		action.ActionType,
		action.Status,
		action.Severity,
		action.Description,
		action.BeforeState,
		action.AfterState,
		action.SimulationResult,
		action.CreatedAt,
		action.AppliedAt,
		action.AppliedBy,
		action.RollbackState,
	)
	return err
}

func (r *SQLiteRepository) GetAutoPilotAction(ctx context.Context, id string) (*models.AutoPilotAction, error) {
	var action models.AutoPilotAction
	err := r.db.GetContext(ctx, &action, `SELECT * FROM autopilot_actions WHERE id = ?`, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("autopilot action not found: %s", id)
	}
	if err != nil {
		return nil, err
	}
	return &action, nil
}

func (r *SQLiteRepository) ListAutoPilotActions(ctx context.Context, clusterID string, status string, limit, offset int) ([]models.AutoPilotAction, int, error) {
	whereClause := "WHERE cluster_id = ?"
	args := []interface{}{clusterID}

	if status != "" {
		whereClause += " AND status = ?"
		args = append(args, status)
	}

	var total int
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	err := r.db.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM autopilot_actions %s`, whereClause), countArgs...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`SELECT * FROM autopilot_actions %s ORDER BY created_at DESC LIMIT ? OFFSET ?`, whereClause)
	args = append(args, limit, offset)

	var actions []models.AutoPilotAction
	err = r.db.SelectContext(ctx, &actions, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return actions, total, nil
}

func (r *SQLiteRepository) UpdateAutoPilotActionStatus(ctx context.Context, id, status, appliedBy string) error {
	var appliedAt *time.Time
	if status == "applied" || status == "approved" {
		now := time.Now()
		appliedAt = &now
	}
	query := `UPDATE autopilot_actions SET status = ?, applied_by = ?, applied_at = ? WHERE id = ?`
	result, err := r.db.ExecContext(ctx, query, status, appliedBy, appliedAt, id)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("autopilot action not found: %s", id)
	}
	return nil
}
