package reports

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

// ScheduleStore abstracts persistence for report schedules.
// Implementations must be safe for concurrent use.
type ScheduleStore interface {
	Save(schedule *Schedule) error
	Get(id string) (*Schedule, error)
	List(clusterID string) ([]*Schedule, error)
	Update(id string, schedule *Schedule) error
	Delete(id string) error
	ListDue(now time.Time) ([]*Schedule, error) // returns schedules where next_run <= now AND enabled = 1
}

// createTableSQL is the DDL executed on first connection.
const createTableSQL = `
CREATE TABLE IF NOT EXISTS report_schedules (
    id           TEXT PRIMARY KEY,
    cluster_id   TEXT NOT NULL,
    frequency    TEXT NOT NULL,
    format       TEXT NOT NULL DEFAULT 'json',
    webhook_url  TEXT NOT NULL,
    webhook_type TEXT NOT NULL DEFAULT 'generic',
    next_run     TIMESTAMP NOT NULL,
    last_run     TIMESTAMP,
    last_status  TEXT DEFAULT '',
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enabled      INTEGER NOT NULL DEFAULT 1
);
`

// SQLiteScheduleStore implements ScheduleStore using SQLite via sqlx.
type SQLiteScheduleStore struct {
	db *sqlx.DB
}

// NewSQLiteScheduleStore opens (or creates) the schedule table and returns a
// ready-to-use store. Pass a *sqlx.DB that is already connected to a SQLite
// database (e.g. the shared app DB or a dedicated file).
func NewSQLiteScheduleStore(db *sqlx.DB) (*SQLiteScheduleStore, error) {
	if _, err := db.Exec(createTableSQL); err != nil {
		return nil, fmt.Errorf("create report_schedules table: %w", err)
	}
	return &SQLiteScheduleStore{db: db}, nil
}

// Save inserts a new schedule row.
func (s *SQLiteScheduleStore) Save(schedule *Schedule) error {
	const q = `
		INSERT INTO report_schedules
			(id, cluster_id, frequency, format, webhook_url, webhook_type, next_run, last_run, last_status, created_at, enabled)
		VALUES
			(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := s.db.Exec(q,
		schedule.ID,
		schedule.ClusterID,
		schedule.Frequency,
		schedule.Format,
		schedule.WebhookURL,
		schedule.WebhookType,
		schedule.NextRun.UTC(),
		nullTime(schedule.LastRun),
		schedule.LastStatus,
		schedule.CreatedAt.UTC(),
		boolToInt(schedule.Enabled),
	)
	if err != nil {
		return fmt.Errorf("save schedule %s: %w", schedule.ID, err)
	}
	return nil
}

// Get retrieves a single schedule by ID. Returns an error if not found.
func (s *SQLiteScheduleStore) Get(id string) (*Schedule, error) {
	const q = `SELECT id, cluster_id, frequency, format, webhook_url, webhook_type,
	                  next_run, last_run, last_status, created_at, enabled
	           FROM report_schedules WHERE id = ?`

	var row scheduleRow
	if err := s.db.QueryRowx(q, id).StructScan(&row); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("schedule not found")
		}
		return nil, fmt.Errorf("get schedule %s: %w", id, err)
	}
	return row.toSchedule(), nil
}

// List returns all schedules for the given cluster. If clusterID is empty,
// all schedules are returned.
func (s *SQLiteScheduleStore) List(clusterID string) ([]*Schedule, error) {
	var (
		rows *sqlx.Rows
		err  error
	)

	if clusterID == "" {
		rows, err = s.db.Queryx(`SELECT id, cluster_id, frequency, format, webhook_url, webhook_type,
		                                next_run, last_run, last_status, created_at, enabled
		                         FROM report_schedules ORDER BY created_at`)
	} else {
		rows, err = s.db.Queryx(`SELECT id, cluster_id, frequency, format, webhook_url, webhook_type,
		                                next_run, last_run, last_status, created_at, enabled
		                         FROM report_schedules WHERE cluster_id = ? ORDER BY created_at`, clusterID)
	}
	if err != nil {
		return nil, fmt.Errorf("list schedules: %w", err)
	}
	defer func() { _ = rows.Close() }()

	return scanSchedules(rows)
}

// Update overwrites an existing schedule row. Returns an error if the row
// does not exist.
func (s *SQLiteScheduleStore) Update(id string, schedule *Schedule) error {
	const q = `
		UPDATE report_schedules
		SET cluster_id   = ?,
		    frequency    = ?,
		    format       = ?,
		    webhook_url  = ?,
		    webhook_type = ?,
		    next_run     = ?,
		    last_run     = ?,
		    last_status  = ?,
		    enabled      = ?
		WHERE id = ?`

	res, err := s.db.Exec(q,
		schedule.ClusterID,
		schedule.Frequency,
		schedule.Format,
		schedule.WebhookURL,
		schedule.WebhookType,
		schedule.NextRun.UTC(),
		nullTime(schedule.LastRun),
		schedule.LastStatus,
		boolToInt(schedule.Enabled),
		id,
	)
	if err != nil {
		return fmt.Errorf("update schedule %s: %w", id, err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("schedule not found")
	}
	return nil
}

// Delete removes a schedule by ID. Returns an error if the row does not exist.
func (s *SQLiteScheduleStore) Delete(id string) error {
	res, err := s.db.Exec(`DELETE FROM report_schedules WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete schedule %s: %w", id, err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("schedule not found")
	}
	return nil
}

// ListDue returns all enabled schedules whose next_run is at or before the
// given time. This is the query the background ticker uses each cycle.
func (s *SQLiteScheduleStore) ListDue(now time.Time) ([]*Schedule, error) {
	rows, err := s.db.Queryx(`
		SELECT id, cluster_id, frequency, format, webhook_url, webhook_type,
		       next_run, last_run, last_status, created_at, enabled
		FROM report_schedules
		WHERE next_run <= ? AND enabled = 1`, now.UTC())
	if err != nil {
		return nil, fmt.Errorf("list due schedules: %w", err)
	}
	defer func() { _ = rows.Close() }()

	return scanSchedules(rows)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// scheduleRow is the DB-scan target. SQLite stores booleans as INTEGER and
// nullable times as sql.NullTime, so we map those explicitly.
type scheduleRow struct {
	ID          string       `db:"id"`
	ClusterID   string       `db:"cluster_id"`
	Frequency   string       `db:"frequency"`
	Format      string       `db:"format"`
	WebhookURL  string       `db:"webhook_url"`
	WebhookType string       `db:"webhook_type"`
	NextRun     time.Time    `db:"next_run"`
	LastRun     sql.NullTime `db:"last_run"`
	LastStatus  string       `db:"last_status"`
	CreatedAt   time.Time    `db:"created_at"`
	Enabled     int          `db:"enabled"`
}

func (r *scheduleRow) toSchedule() *Schedule {
	s := &Schedule{
		ID:          r.ID,
		ClusterID:   r.ClusterID,
		Frequency:   r.Frequency,
		Format:      r.Format,
		WebhookURL:  r.WebhookURL,
		WebhookType: r.WebhookType,
		NextRun:     r.NextRun,
		LastStatus:  r.LastStatus,
		CreatedAt:   r.CreatedAt,
		Enabled:     r.Enabled == 1,
	}
	if r.LastRun.Valid {
		s.LastRun = r.LastRun.Time
	}
	return s
}

func scanSchedules(rows *sqlx.Rows) ([]*Schedule, error) {
	var result []*Schedule
	for rows.Next() {
		var row scheduleRow
		if err := rows.StructScan(&row); err != nil {
			return nil, fmt.Errorf("scan schedule row: %w", err)
		}
		result = append(result, row.toSchedule())
	}
	if result == nil {
		result = []*Schedule{}
	}
	return result, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// nullTime converts a zero time.Time to sql.NullTime{Valid: false}.
func nullTime(t time.Time) sql.NullTime {
	if t.IsZero() {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: t.UTC(), Valid: true}
}
