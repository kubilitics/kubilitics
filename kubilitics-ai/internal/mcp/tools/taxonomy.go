package tools

// ToolCategory represents the category of MCP tools
type ToolCategory string

const (
	// Observation tools - Read-only cluster state queries
	CategoryObservation ToolCategory = "observation"

	// Analysis tools - Intelligent insights and diagnostics
	CategoryAnalysis ToolCategory = "analysis"

	// Recommendation tools - AI-powered suggestions
	CategoryRecommendation ToolCategory = "recommendation"

	// Action tools - Cluster modifications (requires approval)
	CategoryAction ToolCategory = "action"

	// Troubleshooting tools - Problem detection and resolution
	CategoryTroubleshooting ToolCategory = "troubleshooting"

	// Security tools - Security analysis and compliance
	CategorySecurity ToolCategory = "security"

	// Cost tools - Resource optimization and cost analysis
	CategoryCost ToolCategory = "cost"

	// Automation tools - Workflow and automation
	CategoryAutomation ToolCategory = "automation"

	// Execution tools - Safety-gated cluster mutations (A-CORE-004)
	// Every tool in this category passes through the Safety Engine before executing.
	CategoryExecution ToolCategory = "execution"
)

// ToolDefinition defines a complete MCP tool specification
type ToolDefinition struct {
	Name                  string       `json:"name"`
	Category              ToolCategory `json:"category"`
	Description           string       `json:"description"`
	InputSchema           interface{}  `json:"inputSchema"`
	Destructive           bool         `json:"destructive"`
	RequiresAI            bool         `json:"requiresAI"`
	RequiredAutonomyLevel int          `json:"requiredAutonomyLevel"` // 1=Observe, 2=Recommend, 3=Propose, 4=Act, 5=Autonomous
}

// Kubilitics AI MCP Tool Taxonomy - 100x More Powerful
//
// This taxonomy defines 50+ advanced tools organized into 8 categories,
// designed to be 100x more powerful than existing K8s MCP servers.
//
// Key Innovations:
// 1. AI-Powered Intelligence: Tools that reason, not just query
// 2. Autonomous Troubleshooting: Multi-step investigation workflows
// 3. Predictive Analysis: Future state predictions and anomaly detection
// 4. Security-First: Built-in security scanning and compliance checks
// 5. Cost Optimization: Real-time cost analysis and waste detection
// 6. Self-Healing: Automated remediation with human approval
// 7. Cross-Resource Analysis: Understanding relationships and dependencies
// 8. Natural Language: Conversational interface over CLI commands

var ToolTaxonomy = []ToolDefinition{
	// === OBSERVATION TOOLS (15 tools) ===
	// Read-only cluster state queries with intelligent filtering
	// Autonomy Level: 1 (Observe)

	{
		Name:                  "observe_cluster_overview",
		Category:              CategoryObservation,
		Description:           "Get comprehensive cluster overview with health, capacity, and resource distribution. Returns intelligent summary with anomaly detection.",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 1,
	},
	{
		Name:        "observe_resource",
		Category:    CategoryObservation,
		Description: "Get detailed information about a specific resource (Pod, Deployment, Service, etc.) with intelligent context about relationships and dependencies.",
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_resources_by_query",
		Category:    CategoryObservation,
		Description: "Query resources using natural language. Example: 'all pods in production with high CPU' or 'failing deployments in last hour'.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_pod_logs",
		Category:    CategoryObservation,
		Description: "Stream or retrieve pod logs with intelligent filtering, error detection, and contextual analysis.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_events",
		Category:    CategoryObservation,
		Description: "Get cluster events with intelligent grouping, correlation, and impact analysis.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_resource_topology",
		Category:    CategoryObservation,
		Description: "Visualize resource relationships and dependencies with intelligent graph analysis.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "export_topology_to_drawio",
		Category:    CategoryObservation,
		Description: "Export cluster topology as an editable diagram. Returns a draw.io URL that opens the architecture diagram in a new tab. Use when user asks for 'architecture diagram', 'show me the topology', or 'export to draw.io'.",
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_resource_history",
		Category:    CategoryObservation,
		Description: "Get temporal history of resource changes, revisions, and state transitions.",
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_metrics",
		Category:    CategoryObservation,
		Description: "Get time-series metrics for resources with trend analysis and anomaly detection.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_node_status",
		Category:    CategoryObservation,
		Description: "Get detailed node health, capacity, and workload distribution with recommendations.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_namespace_overview",
		Category:    CategoryObservation,
		Description: "Get comprehensive namespace overview with quotas, limits, and resource usage.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_workload_health",
		Category:    CategoryObservation,
		Description: "Get intelligent health assessment of workloads (Deployments, StatefulSets, DaemonSets).",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_network_policies",
		Category:    CategoryObservation,
		Description: "Analyze network policies with traffic flow visualization and gap detection.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_storage_status",
		Category:    CategoryObservation,
		Description: "Get storage utilization, PV/PVC status, and capacity planning insights.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "observe_api_resources",
		Category:    CategoryObservation,
		Description: "List all available API resources with intelligent categorization and usage examples.",
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "observe_custom_resources",
		Category:    CategoryObservation,
		Description: "Get CRDs and custom resources with validation schema analysis.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === DEEP ANALYSIS TOOLS (12 tools) ===
	// === DEEP ANALYSIS TOOLS (12 tools) ===
	// Tier-2 specialized analysis tools — compute real intelligence from K8s data
	// These tools use the gRPC backend proxy and run deterministic algorithms.
	// Autonomy Level: 2 (Recommend)

	{
		Name:                  "analyze_pod_health",
		Category:              CategoryAnalysis,
		Description:           "Analyze pod health across a namespace: detect OOMKills, restart loops, eviction patterns, and stuck-pending pods. Returns per-pod severity findings with actionable messages.",
		RequiredAutonomyLevel: 2,
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific pod name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_deployment_health",
		Category:    CategoryAnalysis,
		Description: "Analyze deployment health: rollout stall detection, replica unavailability, image pull failures, and readiness probe failures. Returns health status per deployment (Healthy/Degraded/Critical).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific deployment name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_node_pressure",
		Category:    CategoryAnalysis,
		Description: "Analyze node pressure conditions: MemoryPressure, DiskPressure, PIDPressure. Identifies nodes under stress with severity HIGH. Use to diagnose cluster-wide resource exhaustion.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name": map[string]interface{}{"type": "string", "description": "Optional specific node name to analyze"},
			},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "detect_resource_contention",
		Category:    CategoryAnalysis,
		Description: "Detect CPU throttling risk and memory overcommit by finding containers without resource limits/requests. Returns contention risk level (LOW/MEDIUM/HIGH) and list of violating containers.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to scan for resource contention (required)"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_network_connectivity",
		Category:    CategoryAnalysis,
		Description: "Analyze network connectivity: check service endpoint readiness, count active NetworkPolicies, and detect services with no ready endpoints. Use to diagnose connectivity failures.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific service name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_rbac_permissions",
		Category:    CategoryAnalysis,
		Description: "Analyze RBAC permissions for over-privileged service accounts. Checks RoleBindings and ClusterRoleBindings for dangerous roles (cluster-admin, admin, edit). Returns risk level and per-binding findings.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":            map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"service_account_name": map[string]interface{}{"type": "string", "description": "Optional specific service account name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_storage_health",
		Category:    CategoryAnalysis,
		Description: "Analyze storage health: detect unbound PVCs, failed provisioning, and storage class issues. Returns storage health status (Healthy/Degraded) with list of problematic PVCs.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "check_resource_limits",
		Category:    CategoryAnalysis,
		Description: "Check for containers missing CPU/memory limits and requests. Returns compliance rate and list of violations with per-container recommendations. Critical for cluster stability.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to check (required)"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_hpa_behavior",
		Category:    CategoryAnalysis,
		Description: "Analyze HorizontalPodAutoscaler behavior: detect flapping, scaling delays, inactive HPAs, and HPAs at max replicas. Returns per-HPA warnings with scaling context.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to analyze (required)"},
				"name":      map[string]interface{}{"type": "string", "description": "Optional specific HPA name to focus on"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "analyze_log_patterns",
		Category:    CategoryAnalysis,
		Description: "Extract and classify error/warning patterns from pod logs. Detects error keywords (panic, fatal, exception, OOM), counts patterns by type, and returns sample error lines with severity.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":      map[string]interface{}{"type": "string", "description": "Kubernetes namespace (required)"},
				"pod_name":       map[string]interface{}{"type": "string", "description": "Pod name to analyze logs from (required)"},
				"container_name": map[string]interface{}{"type": "string", "description": "Optional specific container name within the pod"},
				"tail_lines":     map[string]interface{}{"type": "integer", "description": "Number of log lines to analyze (default: 100)"},
			},
			"required": []string{"namespace", "pod_name"},
		},
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "assess_security_posture",
		Category:    CategoryAnalysis,
		Description: "Assess security posture with CIS Kubernetes Benchmark checks: hostNetwork, hostPID, privileged containers, runAsRoot, writable root filesystems. Returns security score (0-100) and per-finding CIS IDs.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace": map[string]interface{}{"type": "string", "description": "Kubernetes namespace to assess (required)"},
			},
			"required": []string{"namespace"},
		},
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "detect_configuration_drift",
		Category:    CategoryAnalysis,
		Description: "Detect configuration drift between a resource's live state and a provided desired state specification. Returns drift count, field-level differences, and drift summary for GitOps validation.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":     map[string]interface{}{"type": "string", "description": "Kubernetes namespace of the resource (required)"},
				"kind":          map[string]interface{}{"type": "string", "description": "Resource kind (e.g., Deployment, ConfigMap) (required)"},
				"name":          map[string]interface{}{"type": "string", "description": "Resource name (required)"},
				"desired_state": map[string]interface{}{"type": "object", "description": "Desired state specification to compare against live state"},
			},
			"required": []string{"namespace", "kind", "name"},
		},
		Destructive: false,
		RequiresAI:  false,
	},

	// === ANALYSIS TOOLS (12 tools) ===
	// Intelligent insights and diagnostics

	{
		Name:        "analyze_resource_efficiency",
		Category:    CategoryAnalysis,
		Description: "Analyze resource requests vs actual usage with rightsizing recommendations.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_failure_patterns",
		Category:    CategoryAnalysis,
		Description: "Detect recurring failure patterns across pods, deployments, and nodes.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_dependencies",
		Category:    CategoryAnalysis,
		Description: "Map service dependencies and identify potential single points of failure.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_configuration_drift",
		Category:    CategoryAnalysis,
		Description: "Detect configuration drift from desired state with remediation suggestions.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_capacity_trends",
		Category:    CategoryAnalysis,
		Description: "Predict future capacity needs based on historical trends and growth patterns.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_performance_bottlenecks",
		Category:    CategoryAnalysis,
		Description: "Identify performance bottlenecks across compute, network, and storage.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_error_correlation",
		Category:    CategoryAnalysis,
		Description: "Correlate errors across logs, events, and metrics to find root causes.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_blast_radius",
		Category:    CategoryAnalysis,
		Description: "Assess potential impact of resource changes or failures on dependent services.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_rollout_risk",
		Category:    CategoryAnalysis,
		Description: "Assess risk of deployments, updates, and configuration changes.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_pod_scheduling",
		Category:    CategoryAnalysis,
		Description: "Analyze pod scheduling decisions, affinity rules, and placement optimization.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_image_vulnerabilities",
		Category:    CategoryAnalysis,
		Description: "Scan container images for vulnerabilities with severity prioritization.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "analyze_workload_patterns",
		Category:    CategoryAnalysis,
		Description: "Identify traffic patterns, peak hours, and scaling opportunities.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === RECOMMENDATION TOOLS (8 tools) ===
	// AI-powered suggestions and optimizations
	// Autonomy Level: 2 (Recommend)

	{
		Name:                  "recommend_resource_optimization",
		Category:              CategoryRecommendation,
		Description:           "Generate actionable recommendations for resource optimization (CPU, memory, storage).",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 2,
	},
	{
		Name:        "recommend_cost_reduction",
		Category:    CategoryRecommendation,
		Description: "Identify cost-saving opportunities with projected savings estimates.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_security_hardening",
		Category:    CategoryRecommendation,
		Description: "Provide security hardening recommendations based on best practices and CVEs.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_scaling_strategy",
		Category:    CategoryRecommendation,
		Description: "Suggest HPA/VPA configurations and scaling strategies based on workload patterns.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_architecture_improvements",
		Category:    CategoryRecommendation,
		Description: "Suggest architectural improvements for resilience, performance, and cost.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_upgrade_path",
		Category:    CategoryRecommendation,
		Description: "Plan Kubernetes and application upgrade paths with risk assessment.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_monitoring_improvements",
		Category:    CategoryRecommendation,
		Description: "Suggest monitoring, alerting, and observability enhancements.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "recommend_disaster_recovery",
		Category:    CategoryRecommendation,
		Description: "Provide disaster recovery and backup strategy recommendations.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === TROUBLESHOOTING TOOLS (7 tools) ===
	// Problem detection and resolution
	// Autonomy Level: 2 (Recommend)

	{
		Name:                  "troubleshoot_pod_failures",
		Category:              CategoryTroubleshooting,
		Description:           "Autonomous investigation of pod failures with root cause analysis and fix suggestions.",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 2,
	},
	{
		Name:        "troubleshoot_network_issues",
		Category:    CategoryTroubleshooting,
		Description: "Diagnose network connectivity, DNS, and service discovery issues.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "troubleshoot_performance_degradation",
		Category:    CategoryTroubleshooting,
		Description: "Investigate performance issues with metric correlation and bottleneck identification.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "troubleshoot_deployment_failures",
		Category:    CategoryTroubleshooting,
		Description: "Analyze failed deployments, rollouts, and update issues with remediation steps.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "troubleshoot_resource_constraints",
		Category:    CategoryTroubleshooting,
		Description: "Identify resource exhaustion, OOM kills, and capacity issues.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "troubleshoot_rbac_issues",
		Category:    CategoryTroubleshooting,
		Description: "Debug RBAC permission issues and suggest proper role configurations.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "troubleshoot_storage_issues",
		Category:    CategoryTroubleshooting,
		Description: "Diagnose PV/PVC issues, mount failures, and storage provisioning problems.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === SECURITY TOOLS (5 tools) ===
	// Security analysis and compliance
	// Autonomy Level: 2 (Recommend)

	{
		Name:                  "security_scan_cluster",
		Category:              CategorySecurity,
		Description:           "Comprehensive cluster security scan with CIS benchmarks and compliance checks.",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 2,
	},
	{
		Name:        "security_audit_rbac",
		Category:    CategorySecurity,
		Description: "Audit RBAC configurations, identify overprivileged accounts and security risks.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "security_scan_secrets",
		Category:    CategorySecurity,
		Description: "Scan for exposed secrets, weak encryption, and secret management issues.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "security_check_pod_security",
		Category:    CategorySecurity,
		Description: "Validate pod security policies, admission controls, and runtime security.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "security_compliance_report",
		Category:    CategorySecurity,
		Description: "Generate compliance reports for SOC2, HIPAA, PCI-DSS, etc.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === COST TOOLS (4 tools) ===
	// Resource optimization and cost analysis
	// Autonomy Level: 2 (Recommend)

	{
		Name:                  "cost_analyze_spending",
		Category:              CategoryCost,
		Description:           "Analyze cluster costs with breakdown by namespace, workload, and and resource type.",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 2,
	},
	{
		Name:        "cost_identify_waste",
		Category:    CategoryCost,
		Description: "Identify wasted resources: over-provisioned pods, unused PVs, idle nodes.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "cost_forecast_spending",
		Category:    CategoryCost,
		Description: "Forecast future costs based on trends and planned changes.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "cost_optimization_plan",
		Category:    CategoryCost,
		Description: "Generate comprehensive cost optimization plan with ROI estimates.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === ACTION TOOLS (5 tools) ===
	// Cluster modifications (requires approval)
	// Autonomy Level: 4 (Act)

	{
		Name:                  "action_scale_workload",
		Category:              CategoryAction,
		Description:           "Scale deployments, statefulsets, or replicasets with safety checks.",
		Destructive:           false,
		RequiresAI:            false,
		RequiredAutonomyLevel: 4,
	},
	{
		Name:                  "action_restart_workload",
		Category:              CategoryAction,
		Description:           "Restart pods or workloads with rolling update strategy.",
		Destructive:           true,
		RequiresAI:            false,
		RequiredAutonomyLevel: 4,
	},
	{
		Name:                  "action_apply_manifest",
		Category:              CategoryAction,
		Description:           "Apply Kubernetes manifests with validation and dry-run support.",
		Destructive:           true,
		RequiresAI:            false,
		RequiredAutonomyLevel: 4,
	},
	{
		Name:                  "action_rollback_deployment",
		Category:              CategoryAction,
		Description:           "Rollback deployment to previous revision with impact analysis.",
		Destructive:           true,
		RequiresAI:            true,
		RequiredAutonomyLevel: 4,
	},
	{
		Name:                  "action_execute_command",
		Category:              CategoryAction,
		Description:           "Execute command in pod container with security validation.",
		Destructive:           true,
		RequiresAI:            false,
		RequiredAutonomyLevel: 4,
	},

	// === AUTOMATION TOOLS (3 tools) ===
	// Multi-step automation workflows
	// Autonomy Level: 4 (Act)

	{
		Name:                  "automation_run_playbook",
		Category:              CategoryAutomation,
		Description:           "Run a predefined remediation playbook (e.g., 'clear-logs', 'restart-deployment', 'cordon-node').",
		Destructive:           false,
		RequiresAI:            true,
		RequiredAutonomyLevel: 4,
	},
	{
		Name:        "automation_schedule_task",
		Category:    CategoryAutomation,
		Description: "Schedule recurring tasks like backups, cleanups, and health checks.",
		Destructive: false,
		RequiresAI:  false,
	},
	{
		Name:        "automation_create_alert_rule",
		Category:    CategoryAutomation,
		Description: "Create intelligent alert rules with auto-remediation triggers.",
		Destructive: false,
		RequiresAI:  true,
	},
	{
		Name:        "automation_generate_runbook",
		Category:    CategoryAutomation,
		Description: "Generate runbooks for common operational scenarios.",
		Destructive: false,
		RequiresAI:  true,
	},

	// === EXECUTION TOOLS (9 tools) — A-CORE-004 ===
	// === EXECUTION TOOLS (9 tools) — A-CORE-004 ===
	// Safety-gated cluster mutations. EVERY tool passes through the Safety Engine
	// (autonomy level check + blast radius + policy) before any cluster change.
	// All tools support dry_run=true for impact preview without execution.
	// Autonomy Level: 3 (Active execution)

	{
		Name:     "restart_pod",
		Category: CategoryExecution,
		Description: "Restart a pod by deleting it (its controller will recreate it). Safety Level 2 — semi-autonomous. " +
			"Passes through policy + blast-radius check. Supports dry_run for impact preview. Requires namespace and pod name.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":     map[string]interface{}{"type": "string", "description": "Pod namespace (required)"},
				"name":          map[string]interface{}{"type": "string", "description": "Pod name to restart (required)"},
				"justification": map[string]interface{}{"type": "string", "description": "Reason for restart (recommended for audit log)"},
				"dry_run":       map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "scale_deployment",
		Category: CategoryExecution,
		Description: "Scale a Deployment to a target replica count. Safety Level 3 — requires explicit user confirmation unless autonomy level allows. " +
			"Blast radius analysis is performed. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":     map[string]interface{}{"type": "string", "description": "Deployment namespace (required)"},
				"name":          map[string]interface{}{"type": "string", "description": "Deployment name (required)"},
				"replicas":      map[string]interface{}{"type": "integer", "description": "Target replica count (required)", "minimum": 0},
				"justification": map[string]interface{}{"type": "string", "description": "Reason for scaling"},
				"dry_run":       map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"namespace", "name", "replicas"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "cordon_node",
		Category: CategoryExecution,
		Description: "Mark a node as unschedulable (cordon) to prevent new pods from being scheduled. Safety Level 3. " +
			"Existing pods are NOT evicted. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name":          map[string]interface{}{"type": "string", "description": "Node name to cordon (required)"},
				"justification": map[string]interface{}{"type": "string", "description": "Reason for cordoning"},
				"dry_run":       map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "drain_node",
		Category: CategoryExecution,
		Description: "Evict all pods from a node (drain) to prepare for maintenance. Safety Level 4 — highest restriction, always reviewed by policy engine. " +
			"Supports grace period, ignore-daemonsets, and delete-emptydir options. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"name":                 map[string]interface{}{"type": "string", "description": "Node name to drain (required)"},
				"grace_period_seconds": map[string]interface{}{"type": "integer", "description": "Grace period for pod eviction in seconds (default: 30)"},
				"ignore_daemon_sets":   map[string]interface{}{"type": "boolean", "description": "Ignore DaemonSet-managed pods (default: true)"},
				"delete_emptydir_data": map[string]interface{}{"type": "boolean", "description": "Allow deleting pods with emptyDir volumes"},
				"justification":        map[string]interface{}{"type": "string", "description": "Reason for draining"},
				"dry_run":              map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "apply_resource_patch",
		Category: CategoryExecution,
		Description: "Apply a JSON merge or strategic merge patch to any Kubernetes resource. Safety Level 4. " +
			"Use for targeted field updates (e.g., updating container image, annotations). Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":     map[string]interface{}{"type": "string", "description": "Resource namespace"},
				"kind":          map[string]interface{}{"type": "string", "description": "Resource kind (e.g., Deployment) (required)"},
				"name":          map[string]interface{}{"type": "string", "description": "Resource name (required)"},
				"patch":         map[string]interface{}{"type": "object", "description": "JSON patch object (required)"},
				"patch_type":    map[string]interface{}{"type": "string", "enum": []string{"merge", "strategic"}, "description": "Patch type: merge or strategic"},
				"justification": map[string]interface{}{"type": "string", "description": "Reason for patch"},
				"dry_run":       map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"kind", "name", "patch"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "delete_resource",
		Category: CategoryExecution,
		Description: "Delete a Kubernetes resource. Safety Level 5 — most restrictive, always requires human approval regardless of autonomy level. " +
			"Supports optional grace period. Supports dry_run (strongly recommended first).",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":            map[string]interface{}{"type": "string", "description": "Resource namespace"},
				"kind":                 map[string]interface{}{"type": "string", "description": "Resource kind (required)"},
				"name":                 map[string]interface{}{"type": "string", "description": "Resource name (required)"},
				"grace_period_seconds": map[string]interface{}{"type": "integer", "description": "Grace period before deletion"},
				"justification":        map[string]interface{}{"type": "string", "description": "Reason for deletion (required for audit)"},
				"dry_run":              map[string]interface{}{"type": "boolean", "description": "Preview without deleting (strongly recommended)"},
			},
			"required": []string{"kind", "name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "rollback_deployment",
		Category: CategoryExecution,
		Description: "Roll back a Deployment to a previous revision. Safety Level 3. " +
			"Specify revision number (0 = previous revision). Returns rollback plan before execution. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":     map[string]interface{}{"type": "string", "description": "Deployment namespace (required)"},
				"name":          map[string]interface{}{"type": "string", "description": "Deployment name (required)"},
				"revision":      map[string]interface{}{"type": "integer", "description": "Revision to roll back to (0 = previous revision)"},
				"justification": map[string]interface{}{"type": "string", "description": "Reason for rollback"},
				"dry_run":       map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"namespace", "name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "update_resource_limits",
		Category: CategoryExecution,
		Description: "Update CPU/memory requests and limits for a specific container in a workload. Safety Level 3. " +
			"Builds a strategic merge patch and applies it. Requires container_name. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":      map[string]interface{}{"type": "string", "description": "Workload namespace (required)"},
				"kind":           map[string]interface{}{"type": "string", "description": "Resource kind: Deployment, StatefulSet, DaemonSet (required)"},
				"name":           map[string]interface{}{"type": "string", "description": "Workload name (required)"},
				"container_name": map[string]interface{}{"type": "string", "description": "Container name to update (required)"},
				"cpu_request":    map[string]interface{}{"type": "string", "description": "CPU request (e.g., '250m')"},
				"cpu_limit":      map[string]interface{}{"type": "string", "description": "CPU limit (e.g., '500m')"},
				"memory_request": map[string]interface{}{"type": "string", "description": "Memory request (e.g., '256Mi')"},
				"memory_limit":   map[string]interface{}{"type": "string", "description": "Memory limit (e.g., '512Mi')"},
				"justification":  map[string]interface{}{"type": "string", "description": "Reason for limit change"},
				"dry_run":        map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"namespace", "kind", "name", "container_name"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
	{
		Name:     "trigger_hpa_scale",
		Category: CategoryExecution,
		Description: "Manually override an HPA's current desired replica count by patching its status. Safety Level 4. " +
			"Use when immediate scaling is needed before the HPA's metric-based decisions take effect. Supports dry_run.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"namespace":       map[string]interface{}{"type": "string", "description": "HPA namespace (required)"},
				"name":            map[string]interface{}{"type": "string", "description": "HPA name (required)"},
				"target_replicas": map[string]interface{}{"type": "integer", "description": "Target replica count (required)", "minimum": 0},
				"justification":   map[string]interface{}{"type": "string", "description": "Reason for manual scale trigger"},
				"dry_run":         map[string]interface{}{"type": "boolean", "description": "Preview changes without executing"},
			},
			"required": []string{"namespace", "name", "target_replicas"},
		},
		Destructive: true,
		RequiresAI:  false,
	},
}

// GetToolsByCategory returns all tools in a specific category
func GetToolsByCategory(category ToolCategory) []ToolDefinition {
	var tools []ToolDefinition
	for _, tool := range ToolTaxonomy {
		if tool.Category == category {
			tools = append(tools, tool)
		}
	}
	return tools
}

// GetToolByName returns a tool definition by name
func GetToolByName(name string) *ToolDefinition {
	for _, tool := range ToolTaxonomy {
		if tool.Name == name {
			return &tool
		}
	}
	return nil
}

// GetNonDestructiveTools returns all non-destructive tools
func GetNonDestructiveTools() []ToolDefinition {
	var tools []ToolDefinition
	for _, tool := range ToolTaxonomy {
		if !tool.Destructive {
			tools = append(tools, tool)
		}
	}
	return tools
}

// GetAIPoweredTools returns all tools that require AI capabilities
func GetAIPoweredTools() []ToolDefinition {
	var tools []ToolDefinition
	for _, tool := range ToolTaxonomy {
		if tool.RequiresAI {
			tools = append(tools, tool)
		}
	}
	return tools
}
