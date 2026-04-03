package simulation

// ScenarioType is the kind of what-if scenario to simulate.
type ScenarioType string

const (
	ScenarioDeleteResource  ScenarioType = "delete_resource"
	ScenarioDeleteNamespace ScenarioType = "delete_namespace"
	ScenarioNodeFailure     ScenarioType = "node_failure"
	ScenarioAZFailure       ScenarioType = "az_failure"
	ScenarioScaleChange     ScenarioType = "scale_change"
	ScenarioDeployNew       ScenarioType = "deploy_new"
)

// Scenario describes a single mutation to apply during simulation.
type Scenario struct {
	Type         ScenarioType `json:"type"`
	TargetKey    string       `json:"target_key,omitempty"`    // Kind/Namespace/Name for delete
	Namespace    string       `json:"namespace,omitempty"`     // for delete_namespace
	NodeName     string       `json:"node_name,omitempty"`     // for node_failure
	AZLabel      string       `json:"az_label,omitempty"`      // for az_failure (zone value)
	Replicas     int          `json:"replicas,omitempty"`      // for scale_change (new count)
	ManifestYAML string       `json:"manifest_yaml,omitempty"` // for deploy_new
}

// SimulationRequest is the input for a simulation run.
type SimulationRequest struct {
	Scenarios []Scenario `json:"scenarios"`
}

// SimulationResult contains the full before/after diff from running scenarios.
type SimulationResult struct {
	HealthBefore     float64    `json:"health_before"`
	HealthAfter      float64    `json:"health_after"`
	HealthDelta      float64    `json:"health_delta"`
	SPOFsBefore      int        `json:"spofs_before"`
	SPOFsAfter       int        `json:"spofs_after"`
	NewSPOFs         []NodeInfo `json:"new_spofs"`
	ResolvedSPOFs    []NodeInfo `json:"resolved_spofs"`
	RemovedNodes     []NodeInfo `json:"removed_nodes"`
	AddedNodes       []NodeInfo `json:"added_nodes"`
	ModifiedNodes    []NodeDiff `json:"modified_nodes"`
	LostEdges        []EdgeInfo `json:"lost_edges"`
	AddedEdges       []EdgeInfo `json:"added_edges"`
	AffectedServices []NodeInfo `json:"affected_services"`
	ComputeTimeMs    int64      `json:"compute_time_ms"`
}

// NodeInfo is a lightweight description of a graph node.
type NodeInfo struct {
	Key       string  `json:"key"`
	Kind      string  `json:"kind"`
	Namespace string  `json:"namespace"`
	Name      string  `json:"name"`
	Score     float64 `json:"score,omitempty"`
}

// NodeDiff captures how a node changed between the original and mutated snapshot.
type NodeDiff struct {
	NodeInfo
	ScoreBefore float64 `json:"score_before"`
	ScoreAfter  float64 `json:"score_after"`
	WasSPOF     bool    `json:"was_spof"`
	IsSPOF      bool    `json:"is_spof"`
}

// EdgeInfo describes a directed dependency edge in the graph.
type EdgeInfo struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

// ScenarioMeta describes an available scenario type for the /scenarios endpoint.
type ScenarioMeta struct {
	Type        ScenarioType `json:"type"`
	Label       string       `json:"label"`
	Description string       `json:"description"`
	Fields      []string     `json:"fields"`
}

// AvailableScenarios returns metadata about all supported scenario types.
func AvailableScenarios() []ScenarioMeta {
	return []ScenarioMeta{
		{
			Type:        ScenarioDeleteResource,
			Label:       "Delete Resource",
			Description: "Simulate deleting a specific resource by Kind/Namespace/Name",
			Fields:      []string{"target_key"},
		},
		{
			Type:        ScenarioDeleteNamespace,
			Label:       "Delete Namespace",
			Description: "Simulate deleting an entire namespace and all its resources",
			Fields:      []string{"namespace"},
		},
		{
			Type:        ScenarioNodeFailure,
			Label:       "Node Failure",
			Description: "Simulate a Kubernetes node going down — pods are removed but controllers survive",
			Fields:      []string{"node_name"},
		},
		{
			Type:        ScenarioAZFailure,
			Label:       "Availability Zone Failure",
			Description: "Simulate all nodes in an availability zone failing simultaneously",
			Fields:      []string{"az_label"},
		},
		{
			Type:        ScenarioScaleChange,
			Label:       "Scale Change",
			Description: "Simulate changing the replica count for a workload",
			Fields:      []string{"target_key", "replicas"},
		},
		{
			Type:        ScenarioDeployNew,
			Label:       "Deploy New Resource",
			Description: "Simulate deploying a new resource from a YAML manifest",
			Fields:      []string{"manifest_yaml"},
		},
	}
}
