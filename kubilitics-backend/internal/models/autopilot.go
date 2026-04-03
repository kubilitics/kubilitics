package models

import "time"

// AutoPilotConfig stores per-cluster, per-rule Auto-Pilot configuration.
type AutoPilotConfig struct {
	ID                int       `json:"id" db:"id"`
	ClusterID         string    `json:"cluster_id" db:"cluster_id"`
	RuleID            string    `json:"rule_id" db:"rule_id"`
	Mode              string    `json:"mode" db:"mode"`
	Enabled           bool      `json:"enabled" db:"enabled"`
	NamespaceIncludes string    `json:"namespace_includes" db:"namespace_includes"`
	NamespaceExcludes string    `json:"namespace_excludes" db:"namespace_excludes"`
	CooldownMinutes   int       `json:"cooldown_minutes" db:"cooldown_minutes"`
	UpdatedAt         time.Time `json:"updated_at" db:"updated_at"`
}

// AutoPilotAction represents a single Auto-Pilot remediation action and its audit trail.
type AutoPilotAction struct {
	ID               string     `json:"id" db:"id"`
	ClusterID        string     `json:"cluster_id" db:"cluster_id"`
	RuleID           string     `json:"rule_id" db:"rule_id"`
	TargetKind       string     `json:"target_kind" db:"target_kind"`
	TargetNamespace  string     `json:"target_namespace" db:"target_namespace"`
	TargetName       string     `json:"target_name" db:"target_name"`
	ActionType       string     `json:"action_type" db:"action_type"`
	Status           string     `json:"status" db:"status"`
	Severity         string     `json:"severity" db:"severity"`
	Description      string     `json:"description" db:"description"`
	BeforeState      string     `json:"before_state" db:"before_state"`
	AfterState       string     `json:"after_state" db:"after_state"`
	SimulationResult string     `json:"simulation_result" db:"simulation_result"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
	AppliedAt        *time.Time `json:"applied_at,omitempty" db:"applied_at"`
	AppliedBy        string     `json:"applied_by" db:"applied_by"`
	RollbackState    string     `json:"rollback_state" db:"rollback_state"`
}
