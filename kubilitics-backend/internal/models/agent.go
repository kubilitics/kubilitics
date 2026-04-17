package models

import "time"

// Organization represents an organization in the multi-tenant agent trust model.
type Organization struct {
	ID        string    `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// AgentCluster represents a Kubernetes cluster registered via the agent trust model.
// Named AgentCluster to avoid collision with the existing kubeconfig-based Cluster type.
type AgentCluster struct {
	ID              string     `json:"id" db:"id"`
	OrganizationID  string     `json:"organization_id" db:"organization_id"`
	ClusterUID      string     `json:"cluster_uid" db:"cluster_uid"`
	Name            string     `json:"name" db:"name"`
	K8sVersion      string     `json:"k8s_version" db:"k8s_version"`
	AgentVersion    string     `json:"agent_version" db:"agent_version"`
	NodeCount       int        `json:"node_count" db:"node_count"`
	Status          string     `json:"status" db:"status"` // registering|active|degraded|offline|superseded
	CredentialEpoch int        `json:"credential_epoch" db:"credential_epoch"`
	RegisteredAt    time.Time  `json:"registered_at" db:"registered_at"`
	LastHeartbeatAt *time.Time `json:"last_heartbeat_at,omitempty" db:"last_heartbeat_at"`
}

type BootstrapToken struct {
	JTI            string     `json:"jti" db:"jti"`
	OrganizationID string     `json:"organization_id" db:"organization_id"`
	CreatedBy      string     `json:"created_by" db:"created_by"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
	ExpiresAt      time.Time  `json:"expires_at" db:"expires_at"`
	UsedAt         *time.Time `json:"used_at,omitempty" db:"used_at"`
	UsedByCluster  *string    `json:"used_by_cluster,omitempty" db:"used_by_cluster"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty" db:"revoked_at"`
}

type AgentCredential struct {
	ID               string     `json:"id" db:"id"`
	ClusterID        string     `json:"cluster_id" db:"cluster_id"`
	RefreshTokenHash string     `json:"refresh_token_hash" db:"refresh_token_hash"`
	IssuedAt         time.Time  `json:"issued_at" db:"issued_at"`
	ExpiresAt        time.Time  `json:"expires_at" db:"expires_at"`
	LastUsedAt       *time.Time `json:"last_used_at,omitempty" db:"last_used_at"`
	RevokedAt        *time.Time `json:"revoked_at,omitempty" db:"revoked_at"`
	CredentialEpoch  int        `json:"credential_epoch" db:"credential_epoch"`
}
