package db

import (
	"context"
	"time"
)

// Store is the main persistence interface for the AI layer.
type Store interface {
	InvestigationStore
	AuditStore
	ConversationStore
	AnomalyStore
	CostSnapshotStore

	// Close releases database resources.
	Close() error

	// Ping verifies the connection is alive.
	Ping(ctx context.Context) error
}

// ─── Investigation store ──────────────────────────────────────────────────────

// InvestigationRecord is the DB representation of an investigation session.
type InvestigationRecord struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	State       string    `json:"state"`
	Description string    `json:"description"`
	Context     string    `json:"context"`
	Conclusion  string    `json:"conclusion"`
	Confidence  int       `json:"confidence"`
	Metadata    string    `json:"metadata"` // JSON blob
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// InvestigationStore persists investigation sessions.
type InvestigationStore interface {
	// SaveInvestigation creates or updates an investigation record.
	SaveInvestigation(ctx context.Context, rec *InvestigationRecord) error

	// GetInvestigation retrieves an investigation by ID.
	GetInvestigation(ctx context.Context, id string) (*InvestigationRecord, error)

	// ListInvestigations returns all investigations, newest first.
	ListInvestigations(ctx context.Context, limit, offset int) ([]*InvestigationRecord, error)

	// DeleteInvestigation removes an investigation and its steps.
	DeleteInvestigation(ctx context.Context, id string) error
}

// ─── Audit store ─────────────────────────────────────────────────────────────

// AuditRecord is the DB representation of an audit event.
type AuditRecord struct {
	ID            int64     `json:"id"`
	CorrelationID string    `json:"correlation_id"`
	EventType     string    `json:"event_type"`
	Description   string    `json:"description"`
	Resource      string    `json:"resource"`
	Action        string    `json:"action"`
	Result        string    `json:"result"`
	UserID        string    `json:"user_id"`
	Metadata      string    `json:"metadata"` // JSON blob
	Timestamp     time.Time `json:"timestamp"`
}

// AuditStore persists audit log entries.
type AuditStore interface {
	// AppendAuditEvent appends an immutable audit event.
	AppendAuditEvent(ctx context.Context, rec *AuditRecord) error

	// QueryAuditEvents retrieves audit events with optional filters.
	QueryAuditEvents(ctx context.Context, q AuditQuery) ([]*AuditRecord, error)
}

// AuditQuery filters audit event queries.
type AuditQuery struct {
	Resource  string
	Action    string
	UserID    string
	From      time.Time
	To        time.Time
	Limit     int
	Offset    int
}

// ─── Conversation store ───────────────────────────────────────────────────────

// ConversationRecord is a persisted conversation session.
type ConversationRecord struct {
	ID        string    `json:"id"`
	ClusterID string    `json:"cluster_id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// MessageRecord is a single message in a conversation.
type MessageRecord struct {
	ID             int64     `json:"id"`
	ConversationID string    `json:"conversation_id"`
	Role           string    `json:"role"` // user | assistant | tool
	Content        string    `json:"content"`
	TokenCount     int       `json:"token_count"`
	Metadata       string    `json:"metadata"` // JSON blob
	Timestamp      time.Time `json:"timestamp"`
}

// ConversationStore persists multi-turn conversation history.
type ConversationStore interface {
	// SaveConversation creates or updates a conversation.
	SaveConversation(ctx context.Context, rec *ConversationRecord) error

	// GetConversation retrieves a conversation by ID.
	GetConversation(ctx context.Context, id string) (*ConversationRecord, error)

	// ListConversations returns conversations for a cluster, newest first.
	ListConversations(ctx context.Context, clusterID string, limit, offset int) ([]*ConversationRecord, error)

	// AppendMessage adds a message to a conversation.
	AppendMessage(ctx context.Context, msg *MessageRecord) error

	// GetMessages returns messages for a conversation, oldest first.
	GetMessages(ctx context.Context, conversationID string, limit int) ([]*MessageRecord, error)

	// DeleteConversation removes a conversation and all its messages.
	DeleteConversation(ctx context.Context, id string) error
}

// ─── Anomaly store (A-CORE-013) ───────────────────────────────────────────────

// AnomalyRecord is a persisted anomaly detected by the analytics pipeline.
type AnomalyRecord struct {
	ID          int64     `json:"id"`
	ResourceID  string    `json:"resource_id"`
	Namespace   string    `json:"namespace"`
	Kind        string    `json:"kind"`
	AnomalyType string    `json:"anomaly_type"`
	Severity    string    `json:"severity"`
	Score       float64   `json:"score"`
	Description string    `json:"description"`
	Metadata    string    `json:"metadata"` // JSON blob
	DetectedAt  time.Time `json:"detected_at"`
}

// AnomalyQuery filters anomaly queries.
type AnomalyQuery struct {
	ResourceID  string
	Namespace   string
	Kind        string
	AnomalyType string
	Severity    string
	From        time.Time
	To          time.Time
	Limit       int
	Offset      int
}

// AnomalyStore persists analytics anomaly history.
type AnomalyStore interface {
	// AppendAnomaly stores a detected anomaly event.
	AppendAnomaly(ctx context.Context, rec *AnomalyRecord) error

	// QueryAnomalies retrieves anomalies with optional filters.
	QueryAnomalies(ctx context.Context, q AnomalyQuery) ([]*AnomalyRecord, error)

	// GetAnomaly retrieves a single anomaly by ID.
	GetAnomaly(ctx context.Context, id int64) (*AnomalyRecord, error)

	// AnomalySummary returns count grouped by severity for a time window.
	AnomalySummary(ctx context.Context, from, to time.Time) (map[string]int, error)
}

// ─── Cost snapshot store (A-CORE-013) ────────────────────────────────────────

// CostSnapshotRecord is a persisted cost pipeline snapshot for trending.
type CostSnapshotRecord struct {
	ID          int64     `json:"id"`
	ClusterID   string    `json:"cluster_id"`
	TotalCost   float64   `json:"total_cost"`
	WasteCost   float64   `json:"waste_cost"`
	Efficiency  float64   `json:"efficiency"` // 0–100
	Grade       string    `json:"grade"`
	Breakdown   string    `json:"breakdown"`  // JSON: map[kind]cost
	Namespaces  string    `json:"namespaces"` // JSON: []NamespaceCost summary
	RecordedAt  time.Time `json:"recorded_at"`
}

// CostTrendPoint is a single point in a cost trend query.
type CostTrendPoint struct {
	RecordedAt time.Time `json:"recorded_at"`
	TotalCost  float64   `json:"total_cost"`
	WasteCost  float64   `json:"waste_cost"`
	Efficiency float64   `json:"efficiency"`
	Grade      string    `json:"grade"`
}

// CostSnapshotStore persists cost pipeline snapshots for historical analysis.
type CostSnapshotStore interface {
	// AppendCostSnapshot stores a cost snapshot.
	AppendCostSnapshot(ctx context.Context, rec *CostSnapshotRecord) error

	// QueryCostSnapshots retrieves snapshots for a cluster ordered by time.
	QueryCostSnapshots(ctx context.Context, clusterID string, limit int) ([]*CostSnapshotRecord, error)

	// GetCostTrend returns lightweight trend points for charting.
	GetCostTrend(ctx context.Context, clusterID string, from, to time.Time) ([]*CostTrendPoint, error)

	// LatestCostSnapshot returns the most-recent snapshot for a cluster.
	LatestCostSnapshot(ctx context.Context, clusterID string) (*CostSnapshotRecord, error)
}
