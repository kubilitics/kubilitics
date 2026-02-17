package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite driver (no CGO required)
)

// schema defines the tables for the AI persistence layer.
// Version is tracked in the schema_versions table.
var migrations = []struct {
	version int
	sql     string
}{
	{
		version: 1,
		sql: `
CREATE TABLE IF NOT EXISTS schema_versions (
    version     INTEGER PRIMARY KEY,
    applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investigations (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL DEFAULT 'general',
    state       TEXT NOT NULL DEFAULT 'CREATED',
    description TEXT NOT NULL,
    context     TEXT NOT NULL DEFAULT '',
    conclusion  TEXT NOT NULL DEFAULT '',
    confidence  INTEGER NOT NULL DEFAULT 0,
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_at  DATETIME NOT NULL,
    updated_at  DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_investigations_state ON investigations(state);
CREATE INDEX IF NOT EXISTS idx_investigations_created_at ON investigations(created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    correlation_id  TEXT NOT NULL DEFAULT '',
    event_type      TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    resource        TEXT NOT NULL DEFAULT '',
    action          TEXT NOT NULL DEFAULT '',
    result          TEXT NOT NULL DEFAULT '',
    user_id         TEXT NOT NULL DEFAULT '',
    metadata        TEXT NOT NULL DEFAULT '{}',
    timestamp       DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_events(resource);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);

CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    cluster_id  TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL DEFAULT '',
    created_at  DATETIME NOT NULL,
    updated_at  DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_cluster ON conversations(cluster_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role                TEXT NOT NULL,
    content             TEXT NOT NULL,
    token_count         INTEGER NOT NULL DEFAULT 0,
    metadata            TEXT NOT NULL DEFAULT '{}',
    timestamp           DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp ASC);
`,
	},
	// Migration 2: anomaly_events + cost_snapshots tables (A-CORE-013)
	{
		version: 2,
		sql: `
CREATE TABLE IF NOT EXISTS anomaly_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id  TEXT NOT NULL DEFAULT '',
    namespace    TEXT NOT NULL DEFAULT '',
    kind         TEXT NOT NULL DEFAULT '',
    anomaly_type TEXT NOT NULL DEFAULT '',
    severity     TEXT NOT NULL DEFAULT 'LOW',
    score        REAL NOT NULL DEFAULT 0.0,
    description  TEXT NOT NULL DEFAULT '',
    metadata     TEXT NOT NULL DEFAULT '{}',
    detected_at  DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_anomaly_detected_at  ON anomaly_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_namespace     ON anomaly_events(namespace);
CREATE INDEX IF NOT EXISTS idx_anomaly_severity      ON anomaly_events(severity);
CREATE INDEX IF NOT EXISTS idx_anomaly_resource_id   ON anomaly_events(resource_id);

CREATE TABLE IF NOT EXISTS cost_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id  TEXT NOT NULL DEFAULT 'default',
    total_cost  REAL NOT NULL DEFAULT 0.0,
    waste_cost  REAL NOT NULL DEFAULT 0.0,
    efficiency  REAL NOT NULL DEFAULT 0.0,
    grade       TEXT NOT NULL DEFAULT 'F',
    breakdown   TEXT NOT NULL DEFAULT '{}',
    namespaces  TEXT NOT NULL DEFAULT '[]',
    recorded_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_snapshots_cluster     ON cost_snapshots(cluster_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_snapshots_recorded_at ON cost_snapshots(recorded_at DESC);
`,
	},
}

// sqliteStore is the SQLite-backed implementation of Store.
type sqliteStore struct {
	db *sql.DB
}

// NewSQLiteStore opens (or creates) a SQLite database at the given path and
// runs all pending schema migrations. Pass ":memory:" for an in-memory store.
func NewSQLiteStore(path string) (Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite %q: %w", path, err)
	}

	// Enable WAL mode for better concurrency and performance.
	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable WAL: %w", err)
	}
	// Enable foreign-key constraints.
	if _, err := db.Exec(`PRAGMA foreign_keys=ON`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}

	s := &sqliteStore{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

// migrate applies any unapplied migrations in order.
func (s *sqliteStore) migrate() error {
	// Ensure schema_versions table exists before reading from it.
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_versions (
        version    INTEGER PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
	if err != nil {
		return fmt.Errorf("create schema_versions: %w", err)
	}

	for _, m := range migrations {
		var count int
		err := s.db.QueryRow(`SELECT COUNT(*) FROM schema_versions WHERE version = ?`, m.version).Scan(&count)
		if err != nil {
			return fmt.Errorf("check migration %d: %w", m.version, err)
		}
		if count > 0 {
			continue // already applied
		}

		if _, err := s.db.Exec(m.sql); err != nil {
			return fmt.Errorf("apply migration %d: %w", m.version, err)
		}

		if _, err := s.db.Exec(`INSERT INTO schema_versions(version) VALUES(?)`, m.version); err != nil {
			return fmt.Errorf("record migration %d: %w", m.version, err)
		}
	}
	return nil
}

func (s *sqliteStore) Close() error { return s.db.Close() }

func (s *sqliteStore) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

// ─── Investigations ───────────────────────────────────────────────────────────

func (s *sqliteStore) SaveInvestigation(ctx context.Context, rec *InvestigationRecord) error {
	_, err := s.db.ExecContext(ctx, `
        INSERT INTO investigations(id, type, state, description, context, conclusion, confidence, metadata, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            state       = excluded.state,
            context     = excluded.context,
            conclusion  = excluded.conclusion,
            confidence  = excluded.confidence,
            metadata    = excluded.metadata,
            updated_at  = excluded.updated_at
    `,
		rec.ID, rec.Type, rec.State, rec.Description, rec.Context,
		rec.Conclusion, rec.Confidence, rec.Metadata,
		rec.CreatedAt.UTC(), rec.UpdatedAt.UTC(),
	)
	return err
}

func (s *sqliteStore) GetInvestigation(ctx context.Context, id string) (*InvestigationRecord, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id,type,state,description,context,conclusion,confidence,metadata,created_at,updated_at FROM investigations WHERE id=?`, id)
	return scanInvestigation(row)
}

func (s *sqliteStore) ListInvestigations(ctx context.Context, limit, offset int) ([]*InvestigationRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,type,state,description,context,conclusion,confidence,metadata,created_at,updated_at FROM investigations ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*InvestigationRecord
	for rows.Next() {
		rec, err := scanInvestigation(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, rec)
	}
	return result, rows.Err()
}

func (s *sqliteStore) DeleteInvestigation(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM investigations WHERE id=?`, id)
	return err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanInvestigation(row rowScanner) (*InvestigationRecord, error) {
	rec := &InvestigationRecord{}
	var createdAt, updatedAt string
	err := row.Scan(&rec.ID, &rec.Type, &rec.State, &rec.Description, &rec.Context,
		&rec.Conclusion, &rec.Confidence, &rec.Metadata, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	rec.CreatedAt, _ = parseTime(createdAt)
	rec.UpdatedAt, _ = parseTime(updatedAt)
	return rec, nil
}

// ─── Audit events ─────────────────────────────────────────────────────────────

func (s *sqliteStore) AppendAuditEvent(ctx context.Context, rec *AuditRecord) error {
	_, err := s.db.ExecContext(ctx, `
        INSERT INTO audit_events(correlation_id, event_type, description, resource, action, result, user_id, metadata, timestamp)
        VALUES(?,?,?,?,?,?,?,?,?)
    `,
		rec.CorrelationID, rec.EventType, rec.Description, rec.Resource, rec.Action,
		rec.Result, rec.UserID, rec.Metadata, rec.Timestamp.UTC(),
	)
	return err
}

func (s *sqliteStore) QueryAuditEvents(ctx context.Context, q AuditQuery) ([]*AuditRecord, error) {
	query := `SELECT id,correlation_id,event_type,description,resource,action,result,user_id,metadata,timestamp FROM audit_events WHERE 1=1`
	args := []any{}

	if q.Resource != "" {
		query += ` AND resource = ?`
		args = append(args, q.Resource)
	}
	if q.Action != "" {
		query += ` AND action = ?`
		args = append(args, q.Action)
	}
	if q.UserID != "" {
		query += ` AND user_id = ?`
		args = append(args, q.UserID)
	}
	if !q.From.IsZero() {
		query += ` AND timestamp >= ?`
		args = append(args, q.From.UTC())
	}
	if !q.To.IsZero() {
		query += ` AND timestamp <= ?`
		args = append(args, q.To.UTC())
	}
	query += ` ORDER BY timestamp DESC`
	if q.Limit > 0 {
		query += fmt.Sprintf(` LIMIT %d OFFSET %d`, q.Limit, q.Offset)
	}

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*AuditRecord
	for rows.Next() {
		rec := &AuditRecord{}
		var ts string
		if err := rows.Scan(&rec.ID, &rec.CorrelationID, &rec.EventType, &rec.Description,
			&rec.Resource, &rec.Action, &rec.Result, &rec.UserID, &rec.Metadata, &ts); err != nil {
			return nil, err
		}
		rec.Timestamp, _ = parseTime(ts)
		result = append(result, rec)
	}
	return result, rows.Err()
}

// ─── Conversations ────────────────────────────────────────────────────────────

func (s *sqliteStore) SaveConversation(ctx context.Context, rec *ConversationRecord) error {
	_, err := s.db.ExecContext(ctx, `
        INSERT INTO conversations(id, cluster_id, title, created_at, updated_at)
        VALUES(?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            title      = excluded.title,
            updated_at = excluded.updated_at
    `,
		rec.ID, rec.ClusterID, rec.Title, rec.CreatedAt.UTC(), rec.UpdatedAt.UTC(),
	)
	return err
}

func (s *sqliteStore) GetConversation(ctx context.Context, id string) (*ConversationRecord, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id,cluster_id,title,created_at,updated_at FROM conversations WHERE id=?`, id)
	rec := &ConversationRecord{}
	var ca, ua string
	if err := row.Scan(&rec.ID, &rec.ClusterID, &rec.Title, &ca, &ua); err != nil {
		return nil, err
	}
	rec.CreatedAt, _ = parseTime(ca)
	rec.UpdatedAt, _ = parseTime(ua)
	return rec, nil
}

func (s *sqliteStore) ListConversations(ctx context.Context, clusterID string, limit, offset int) ([]*ConversationRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `SELECT id,cluster_id,title,created_at,updated_at FROM conversations`
	args := []any{}
	if clusterID != "" {
		query += ` WHERE cluster_id = ?`
		args = append(args, clusterID)
	}
	query += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`
	args = append(args, limit, offset)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*ConversationRecord
	for rows.Next() {
		rec := &ConversationRecord{}
		var ca, ua string
		if err := rows.Scan(&rec.ID, &rec.ClusterID, &rec.Title, &ca, &ua); err != nil {
			return nil, err
		}
		rec.CreatedAt, _ = parseTime(ca)
		rec.UpdatedAt, _ = parseTime(ua)
		result = append(result, rec)
	}
	return result, rows.Err()
}

func (s *sqliteStore) AppendMessage(ctx context.Context, msg *MessageRecord) error {
	_, err := s.db.ExecContext(ctx, `
        INSERT INTO messages(conversation_id, role, content, token_count, metadata, timestamp)
        VALUES(?,?,?,?,?,?)
    `,
		msg.ConversationID, msg.Role, msg.Content, msg.TokenCount, msg.Metadata, msg.Timestamp.UTC(),
	)
	return err
}

func (s *sqliteStore) GetMessages(ctx context.Context, conversationID string, limit int) ([]*MessageRecord, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id,conversation_id,role,content,token_count,metadata,timestamp FROM messages WHERE conversation_id=? ORDER BY timestamp ASC LIMIT ?`,
		conversationID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*MessageRecord
	for rows.Next() {
		msg := &MessageRecord{}
		var ts string
		if err := rows.Scan(&msg.ID, &msg.ConversationID, &msg.Role, &msg.Content, &msg.TokenCount, &msg.Metadata, &ts); err != nil {
			return nil, err
		}
		msg.Timestamp, _ = parseTime(ts)
		result = append(result, msg)
	}
	return result, rows.Err()
}

func (s *sqliteStore) DeleteConversation(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM conversations WHERE id=?`, id)
	return err
}

// ─── Anomaly events (A-CORE-013) ─────────────────────────────────────────────

func (s *sqliteStore) AppendAnomaly(ctx context.Context, rec *AnomalyRecord) error {
	result, err := s.db.ExecContext(ctx, `
        INSERT INTO anomaly_events(resource_id, namespace, kind, anomaly_type, severity, score, description, metadata, detected_at)
        VALUES(?,?,?,?,?,?,?,?,?)
    `,
		rec.ResourceID, rec.Namespace, rec.Kind, rec.AnomalyType,
		rec.Severity, rec.Score, rec.Description, rec.Metadata,
		rec.DetectedAt.UTC(),
	)
	if err != nil {
		return err
	}
	id, _ := result.LastInsertId()
	rec.ID = id
	return nil
}

func (s *sqliteStore) QueryAnomalies(ctx context.Context, q AnomalyQuery) ([]*AnomalyRecord, error) {
	query := `SELECT id,resource_id,namespace,kind,anomaly_type,severity,score,description,metadata,detected_at FROM anomaly_events WHERE 1=1`
	args := []any{}

	if q.ResourceID != "" {
		query += ` AND resource_id = ?`
		args = append(args, q.ResourceID)
	}
	if q.Namespace != "" {
		query += ` AND namespace = ?`
		args = append(args, q.Namespace)
	}
	if q.Kind != "" {
		query += ` AND kind = ?`
		args = append(args, q.Kind)
	}
	if q.AnomalyType != "" {
		query += ` AND anomaly_type = ?`
		args = append(args, q.AnomalyType)
	}
	if q.Severity != "" {
		query += ` AND severity = ?`
		args = append(args, q.Severity)
	}
	if !q.From.IsZero() {
		query += ` AND detected_at >= ?`
		args = append(args, q.From.UTC())
	}
	if !q.To.IsZero() {
		query += ` AND detected_at <= ?`
		args = append(args, q.To.UTC())
	}
	query += ` ORDER BY detected_at DESC`
	if q.Limit > 0 {
		query += fmt.Sprintf(` LIMIT %d OFFSET %d`, q.Limit, q.Offset)
	}

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*AnomalyRecord
	for rows.Next() {
		rec := &AnomalyRecord{}
		var ts string
		if err := rows.Scan(&rec.ID, &rec.ResourceID, &rec.Namespace, &rec.Kind,
			&rec.AnomalyType, &rec.Severity, &rec.Score, &rec.Description, &rec.Metadata, &ts); err != nil {
			return nil, err
		}
		rec.DetectedAt, _ = parseTime(ts)
		result = append(result, rec)
	}
	return result, rows.Err()
}

func (s *sqliteStore) GetAnomaly(ctx context.Context, id int64) (*AnomalyRecord, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id,resource_id,namespace,kind,anomaly_type,severity,score,description,metadata,detected_at FROM anomaly_events WHERE id=?`, id)
	rec := &AnomalyRecord{}
	var ts string
	if err := row.Scan(&rec.ID, &rec.ResourceID, &rec.Namespace, &rec.Kind,
		&rec.AnomalyType, &rec.Severity, &rec.Score, &rec.Description, &rec.Metadata, &ts); err != nil {
		return nil, err
	}
	rec.DetectedAt, _ = parseTime(ts)
	return rec, nil
}

func (s *sqliteStore) AnomalySummary(ctx context.Context, from, to time.Time) (map[string]int, error) {
	query := `SELECT severity, COUNT(*) FROM anomaly_events WHERE 1=1`
	args := []any{}
	if !from.IsZero() {
		query += ` AND detected_at >= ?`
		args = append(args, from.UTC())
	}
	if !to.IsZero() {
		query += ` AND detected_at <= ?`
		args = append(args, to.UTC())
	}
	query += ` GROUP BY severity`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	summary := map[string]int{}
	for rows.Next() {
		var sev string
		var count int
		if err := rows.Scan(&sev, &count); err != nil {
			return nil, err
		}
		summary[sev] = count
	}
	return summary, rows.Err()
}

// ─── Cost snapshots (A-CORE-013) ─────────────────────────────────────────────

func (s *sqliteStore) AppendCostSnapshot(ctx context.Context, rec *CostSnapshotRecord) error {
	result, err := s.db.ExecContext(ctx, `
        INSERT INTO cost_snapshots(cluster_id, total_cost, waste_cost, efficiency, grade, breakdown, namespaces, recorded_at)
        VALUES(?,?,?,?,?,?,?,?)
    `,
		rec.ClusterID, rec.TotalCost, rec.WasteCost, rec.Efficiency,
		rec.Grade, rec.Breakdown, rec.Namespaces, rec.RecordedAt.UTC(),
	)
	if err != nil {
		return err
	}
	id, _ := result.LastInsertId()
	rec.ID = id
	return nil
}

func (s *sqliteStore) QueryCostSnapshots(ctx context.Context, clusterID string, limit int) ([]*CostSnapshotRecord, error) {
	if limit <= 0 {
		limit = 90
	}
	query := `SELECT id,cluster_id,total_cost,waste_cost,efficiency,grade,breakdown,namespaces,recorded_at FROM cost_snapshots`
	args := []any{}
	if clusterID != "" {
		query += ` WHERE cluster_id = ?`
		args = append(args, clusterID)
	}
	query += fmt.Sprintf(` ORDER BY recorded_at DESC LIMIT %d`, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*CostSnapshotRecord
	for rows.Next() {
		rec := &CostSnapshotRecord{}
		var ts string
		if err := rows.Scan(&rec.ID, &rec.ClusterID, &rec.TotalCost, &rec.WasteCost,
			&rec.Efficiency, &rec.Grade, &rec.Breakdown, &rec.Namespaces, &ts); err != nil {
			return nil, err
		}
		rec.RecordedAt, _ = parseTime(ts)
		result = append(result, rec)
	}
	return result, rows.Err()
}

func (s *sqliteStore) GetCostTrend(ctx context.Context, clusterID string, from, to time.Time) ([]*CostTrendPoint, error) {
	query := `SELECT recorded_at,total_cost,waste_cost,efficiency,grade FROM cost_snapshots WHERE 1=1`
	args := []any{}
	if clusterID != "" {
		query += ` AND cluster_id = ?`
		args = append(args, clusterID)
	}
	if !from.IsZero() {
		query += ` AND recorded_at >= ?`
		args = append(args, from.UTC())
	}
	if !to.IsZero() {
		query += ` AND recorded_at <= ?`
		args = append(args, to.UTC())
	}
	query += ` ORDER BY recorded_at ASC`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*CostTrendPoint
	for rows.Next() {
		p := &CostTrendPoint{}
		var ts string
		if err := rows.Scan(&ts, &p.TotalCost, &p.WasteCost, &p.Efficiency, &p.Grade); err != nil {
			return nil, err
		}
		p.RecordedAt, _ = parseTime(ts)
		result = append(result, p)
	}
	return result, rows.Err()
}

func (s *sqliteStore) LatestCostSnapshot(ctx context.Context, clusterID string) (*CostSnapshotRecord, error) {
	query := `SELECT id,cluster_id,total_cost,waste_cost,efficiency,grade,breakdown,namespaces,recorded_at FROM cost_snapshots`
	args := []any{}
	if clusterID != "" {
		query += ` WHERE cluster_id = ?`
		args = append(args, clusterID)
	}
	query += ` ORDER BY recorded_at DESC LIMIT 1`

	row := s.db.QueryRowContext(ctx, query, args...)
	rec := &CostSnapshotRecord{}
	var ts string
	if err := row.Scan(&rec.ID, &rec.ClusterID, &rec.TotalCost, &rec.WasteCost,
		&rec.Efficiency, &rec.Grade, &rec.Breakdown, &rec.Namespaces, &ts); err != nil {
		return nil, err
	}
	rec.RecordedAt, _ = parseTime(ts)
	return rec, nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// parseTime handles multiple SQLite datetime formats.
func parseTime(s string) (time.Time, error) {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999999999Z07:00",
		"2006-01-02 15:04:05.999999999Z07:00",
		"2006-01-02 15:04:05Z07:00",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("cannot parse time %q", s)
}
