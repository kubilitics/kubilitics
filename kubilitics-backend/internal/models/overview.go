package models

// ClusterOverview is the response for GET /clusters/{clusterId}/overview
type ClusterOverview struct {
	Health       OverviewHealth       `json:"health"`
	Counts       OverviewCounts       `json:"counts"`
	PodStatus    OverviewPodStatus   `json:"pod_status"`
	Alerts       OverviewAlerts      `json:"alerts"`
	Utilization  *OverviewUtilization `json:"utilization,omitempty"`
}

type OverviewHealth struct {
	Score     int                     `json:"score"`
	Grade     string                  `json:"grade"`  // A, B, C, D, F
	Status    string                  `json:"status"` // healthy, good, degraded, unhealthy, critical
	Breakdown map[string]int          `json:"breakdown"`
	Findings  []OverviewHealthFinding `json:"findings,omitempty"`
	Insight   string                  `json:"insight"`
}

type OverviewHealthFinding struct {
	Category string `json:"category"`
	Severity int    `json:"severity"`
	Check    string `json:"check"`
	Message  string `json:"message"`
}

type OverviewCounts struct {
	Nodes       int `json:"nodes"`
	ReadyNodes  int `json:"ready_nodes"`
	Pods        int `json:"pods"`
	Namespaces  int `json:"namespaces"`
	Deployments int `json:"deployments"`

	DeploymentsAvailable   int `json:"deployments_available"`
	DeploymentsUnavailable int `json:"deployments_unavailable"`
	DaemonSetsTotal        int `json:"daemonsets_total"`
	DaemonSetsReady        int `json:"daemonsets_ready"`
	StatefulSetsTotal      int `json:"statefulsets_total"`
	StatefulSetsReady      int `json:"statefulsets_ready"`

	DiskPressureNodes   int `json:"disk_pressure_nodes"`
	MemoryPressureNodes int `json:"memory_pressure_nodes"`
	PIDPressureNodes    int `json:"pid_pressure_nodes"`
}

type OverviewPodStatus struct {
	Running          int `json:"running"`
	Pending          int `json:"pending"`
	Failed           int `json:"failed"`
	Succeeded        int `json:"succeeded"`
	TotalRestarts    int `json:"total_restarts"`
	CrashLoopBackOff int `json:"crashloop_backoff"`
	OOMKilled        int `json:"oom_killed"`
}

type OverviewAlerts struct {
	Warnings int              `json:"warnings"`
	Critical int              `json:"critical"`
	Top3     []OverviewAlert  `json:"top_3"`
}

type OverviewAlert struct {
	Reason    string `json:"reason"`
	Resource  string `json:"resource"`
	Namespace string `json:"namespace"`
}

type OverviewUtilization struct {
	CPUPercent    int     `json:"cpu_percent"`
	MemoryPercent int     `json:"memory_percent"`
	CPUCores      float64 `json:"cpu_cores"`
	MemoryGiB     float64 `json:"memory_gib"`
}
