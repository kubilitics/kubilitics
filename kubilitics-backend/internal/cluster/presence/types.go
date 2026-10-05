// Package presence defines the shared wire types for the presence layer.
// These types are consumed by both the REST handler (internal/api/rest) and
// the discovery Manager (internal/cluster/discovery); placing them in a
// neutral package breaks the cycle that would otherwise form between
// those two packages.
package presence

import (
	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

// DiscoveredCluster is the smallest identity record — known to exist,
// not yet touched. Source indicates which DiscoverySource produced it.
type DiscoveredCluster struct {
	Identity identity.LogicalIdentity `json:"identity"`
	Source   string                   `json:"source"` // kubeconfig | secret | manual
	// LastSeenAt records when this cluster was last observed by its source.
	LastSeenAt string `json:"last_seen_at,omitempty"`
}

// RegisteredCluster adds backend-side registration details — the backend
// has parsed/stored enough to connect on demand.
type RegisteredCluster struct {
	DiscoveredCluster
	// RegisteredAt is the ISO-8601 timestamp of first registration.
	RegisteredAt string `json:"registered_at"`
	// Reachable reflects the cluster's actual last-checked connectivity via
	// the live ClusterService client registry — HEALTH-1 (docs/PRODUCTION-
	// RELIABILITY-AUDIT.md): previously hardcoded true unconditionally.
	// Frontend treats this as a hint, not truth, and should prefer
	// LastCheckedAt to judge freshness.
	Reachable bool `json:"reachable"`
	// LastCheckedAt is the ISO-8601 timestamp of the most recent reachability
	// check (success or failure), or empty if never checked. HEALTH-2.
	LastCheckedAt string `json:"last_checked_at,omitempty"`
	// LastSuccessAt is the ISO-8601 timestamp of the most recent successful
	// check, or empty if never successful. HEALTH-2.
	LastSuccessAt string `json:"last_success_at,omitempty"`
	// LastError is the error message from the most recent failed check, or
	// empty if the last check succeeded (or none has run yet). HEALTH-2.
	LastError string `json:"last_error,omitempty"`
	// SessionID is the backend-issued UUID used by cluster-scoped APIs
	// (e.g. /api/v1/clusters/{uuid}/pods). Present for clusters the
	// backend has registered (ManualSource); empty for entries sourced
	// only from file/secret discovery — those become registered (and get
	// a SessionID) once the user "connects" them.
	SessionID string `json:"session_id,omitempty"`
	// Provider is the detected cloud/local provider (eks | gke | aks |
	// minikube | kind | docker-desktop | on-prem | openshift | rancher |
	// k3s). Empty when unknown. The frontend renders cloud chips from this.
	Provider string `json:"provider,omitempty"`
	// KubeconfigPath is the on-disk path (server-side) that this cluster was
	// registered from, when known. VALID-05 (docs/VALID-05-INVESTIGATION.md):
	// previously absent from this type entirely, which made the frontend's
	// click-to-connect flow (ClusterPickerPage.tsx's handlePick) fall back to
	// a hardcoded "~/.kube/config" guess whenever the real path differed —
	// breaking any cluster registered via a non-default/custom KUBECONFIG.
	// Empty for entries with no known path (e.g. in-cluster/ServiceAccount
	// source). Not a secret: this is a path, never kubeconfig contents.
	KubeconfigPath string `json:"kubeconfig_path,omitempty"`
	// ContextName is the kubeconfig context name this cluster was registered
	// under, when it differs from the identity name. VALID-05: threaded
	// through alongside KubeconfigPath for the same reconnect-flow fix.
	ContextName string `json:"context_name,omitempty"`
}

// ConnectedCluster is registered + has an active backend session.
type ConnectedCluster struct {
	RegisteredCluster
	// ConnectedAt is when the current session began.
	ConnectedAt string `json:"connected_at"`
}

// Snapshot is the whole-world view at one instant.
type Snapshot struct {
	Discovered []DiscoveredCluster `json:"discovered"`
	Registered []RegisteredCluster `json:"registered"`
	Connected  []ConnectedCluster  `json:"connected"`
	// LastUsed is the logical identity of the most-recently-active cluster.
	LastUsed *identity.LogicalIdentity `json:"last_used,omitempty"`
}
