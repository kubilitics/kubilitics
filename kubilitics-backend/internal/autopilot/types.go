package autopilot

import "time"

// Finding represents a single detection result from an autopilot rule.
type Finding struct {
	RuleID          string      `json:"rule_id"`
	Severity        string      `json:"severity"` // "critical", "high", "medium", "low"
	TargetKind      string      `json:"target_kind"`
	TargetNamespace string      `json:"target_namespace"`
	TargetName      string      `json:"target_name"`
	Description     string      `json:"description"`
	ActionType      string      `json:"action_type"` // "scale", "create_pdb", "set_limits", "create_netpol", "add_spread", "set_requests"
	ProposedPatch   interface{} `json:"proposed_patch"`
}

// RuleConfig controls per-rule behavior for a cluster.
type RuleConfig struct {
	RuleID            string   `json:"rule_id"`
	Mode              string   `json:"mode"` // "auto", "approval", "audit"
	Enabled           bool     `json:"enabled"`
	NamespaceIncludes []string `json:"namespace_includes,omitempty"`
	NamespaceExcludes []string `json:"namespace_excludes,omitempty"`
	CooldownMinutes   int      `json:"cooldown_minutes"`
}

// ActionRecord persists an autopilot action for audit and approval workflows.
type ActionRecord struct {
	ID              string      `json:"id"`
	ClusterID       string      `json:"cluster_id"`
	RuleID          string      `json:"rule_id"`
	Status          string      `json:"status"` // "pending", "applied", "dismissed", "audit"
	Severity        string      `json:"severity"`
	TargetKind      string      `json:"target_kind"`
	TargetNamespace string      `json:"target_namespace"`
	TargetName      string      `json:"target_name"`
	Description     string      `json:"description"`
	ActionType      string      `json:"action_type"`
	ProposedPatch   interface{} `json:"proposed_patch"`
	SafetyDelta     float64     `json:"safety_delta"`
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
}

// RuleMeta provides static metadata about a detection rule.
type RuleMeta struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Severity    string `json:"severity"`
	ActionType  string `json:"action_type"`
}

// AutoPilotRepository defines the data access interface the autopilot system requires.
// Implementations can back this with SQLite, Postgres, or an in-memory store.
type AutoPilotRepository interface {
	// ListActions returns actions for a cluster filtered by optional status, with pagination.
	ListActions(clusterID string, status string, limit, offset int) ([]ActionRecord, error)
	// GetAction retrieves a single action by ID.
	GetAction(actionID string) (*ActionRecord, error)
	// CreateAction persists a new action record.
	CreateAction(action *ActionRecord) error
	// UpdateActionStatus sets the status and updated_at timestamp on an existing action.
	UpdateActionStatus(actionID string, status string) error
	// GetLastActionTime returns the most recent action time for a given rule + target combination,
	// used for cooldown enforcement.
	GetLastActionTime(clusterID, ruleID, targetKind, targetNamespace, targetName string) (*time.Time, error)
	// ListRuleConfigs returns all rule configs for a cluster.
	ListRuleConfigs(clusterID string) ([]RuleConfig, error)
	// GetRuleConfig returns config for a specific rule in a cluster.
	GetRuleConfig(clusterID, ruleID string) (*RuleConfig, error)
	// UpsertRuleConfig creates or updates a rule config.
	UpsertRuleConfig(clusterID string, config RuleConfig) error
}
