package server

// handlers_analysis.go — implementation of all analysis, troubleshooting,
// recommendation, security, cost, action, and automation tool handlers.
//
// Analysis tools aggregate data from multiple backend endpoints and return
// structured maps that the LLM can reason about. They are all read-only unless
// noted (action tools may mutate cluster state and require explicit approval).

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// ════════════════════════════════════════════════════════════════════════════
// ANALYSIS TOOLS
// ════════════════════════════════════════════════════════════════════════════

// routeAnalysisTool routes all analysis tool names to their handlers.
func (s *mcpServerImpl) routeAnalysisTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	switch name {
	case "analyze_resource_efficiency":
		return s.handleAnalyzeResourceEfficiency(ctx, args)
	case "analyze_failure_patterns":
		return s.handleAnalyzeFailurePatterns(ctx, args)
	case "analyze_dependencies":
		return s.handleAnalyzeDependencies(ctx, args)
	case "analyze_configuration_drift":
		return s.handleAnalyzeConfigurationDrift(ctx, args)
	case "analyze_capacity_trends":
		return s.handleAnalyzeCapacityTrends(ctx, args)
	case "analyze_performance_bottlenecks":
		return s.handleAnalyzePerformanceBottlenecks(ctx, args)
	case "analyze_error_correlation":
		return s.handleAnalyzeErrorCorrelation(ctx, args)
	case "analyze_blast_radius":
		return s.handleAnalyzeBlastRadius(ctx, args)
	case "analyze_rollout_risk":
		return s.handleAnalyzeRolloutRisk(ctx, args)
	case "analyze_pod_scheduling":
		return s.handleAnalyzePodScheduling(ctx, args)
	case "analyze_image_vulnerabilities":
		return s.handleAnalyzeImageVulnerabilities(ctx, args)
	case "analyze_workload_patterns":
		return s.handleAnalyzeWorkloadPatterns(ctx, args)
	default:
		return nil, fmt.Errorf("analysis tool not implemented: %s", name)
	}
}

// analyze_resource_efficiency — requests vs. actual usage across workloads
func (s *mcpServerImpl) handleAnalyzeResourceEfficiency(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}

	// Workload resource requests
	for _, kind := range []string{"deployments", "statefulsets", "daemonsets"} {
		var data map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/"+kind+qs), &data); err == nil {
			result[kind] = data
		}
	}
	// Actual usage summary
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics); err == nil {
		result["metrics_summary"] = metrics
	}
	// Cluster-wide metrics
	var clusterMetrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics"), &clusterMetrics); err == nil {
		result["cluster_metrics"] = clusterMetrics
	}
	result["namespace"] = namespace
	result["analysis_hint"] = "Compare requests/limits in workload specs with actual CPU/memory from metrics_summary to identify over-provisioned or under-provisioned resources."
	return result, nil
}

// analyze_failure_patterns — detect recurring failures via events + pod restarts
func (s *mcpServerImpl) handleAnalyzeFailurePatterns(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")

	q := url.Values{}
	q.Set("limit", "200")
	if namespace != "" {
		q.Set("namespace", namespace)
	}

	result := map[string]interface{}{}

	// Recent events — Warning events indicate failures
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	// Pod restarts visible in metrics
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics); err == nil {
		result["metrics_summary"] = metrics
	}
	// Pod list to check restartCount
	qs := nsQuery(namespace)
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err == nil {
		result["pods"] = pods
	}
	result["analysis_hint"] = "Look for Warning events with high count, pods with restartCount > 5, and OOMKilled or CrashLoopBackOff statuses."
	return result, nil
}

// analyze_dependencies — service dependency map via topology
func (s *mcpServerImpl) handleAnalyzeDependencies(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")

	q := url.Values{}
	q.Set("maxNodes", "500")
	if namespace != "" {
		q.Set("namespace", namespace)
	}

	var topology map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/topology?"+q.Encode()), &topology); err != nil {
		return nil, err
	}
	// Also pull services and endpoints to enrich the map
	qs := nsQuery(namespace)
	result := map[string]interface{}{"topology": topology}
	var svcs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services"+qs), &svcs); err == nil {
		result["services"] = svcs
	}
	result["analysis_hint"] = "Use the topology graph to identify services without redundancy (single node) and circular dependencies."
	return result, nil
}

// analyze_configuration_drift — compare desired vs. running state
func (s *mcpServerImpl) handleAnalyzeConfigurationDrift(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	// Collect desired state from deployments
	var deploys map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys); err == nil {
		result["deployments"] = deploys
	}
	// ReplicaSets reflect rollout state
	var rs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/replicasets"+qs), &rs); err == nil {
		result["replicasets"] = rs
	}
	// Pods show actual running state
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err == nil {
		result["pods"] = pods
	}
	result["analysis_hint"] = "Compare spec.replicas vs. status.availableReplicas in deployments; differences indicate drift. Look for pods with images that differ from deployment spec."
	return result, nil
}

// analyze_capacity_trends — node capacity and workload growth
func (s *mcpServerImpl) handleAnalyzeCapacityTrends(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	result := map[string]interface{}{}
	// Node capacity
	var nodes map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes); err == nil {
		result["nodes"] = nodes
	}
	// Current utilisation
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics"), &metrics); err == nil {
		result["cluster_metrics"] = metrics
	}
	var summary map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &summary); err == nil {
		result["metrics_summary"] = summary
	}
	// HPAs give scaling signals
	var hpa map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/horizontalpodautoscalers"), &hpa); err == nil {
		result["hpas"] = hpa
	}
	result["analysis_hint"] = "Extrapolate current growth rate from pod counts and CPU/memory utilisation. If nodes are above 80% capacity, scaling or node addition is imminent."
	return result, nil
}

// analyze_performance_bottlenecks — CPU/memory/network hotspots
func (s *mcpServerImpl) handleAnalyzePerformanceBottlenecks(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")

	result := map[string]interface{}{}
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics"), &metrics); err == nil {
		result["cluster_metrics"] = metrics
	}
	var summary map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &summary); err == nil {
		result["metrics_summary"] = summary
	}
	// Per-node metrics reveal hotspot nodes
	var nodes map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes); err == nil {
		result["nodes"] = nodes
	}
	// Warning events often indicate throttling/OOM
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "Nodes with >90% CPU or >85% memory are bottlenecks. OOMKilled events indicate memory pressure. Throttled containers show in cpu.throttling metrics."
	return result, nil
}

// analyze_error_correlation — correlate logs/events across services
func (s *mcpServerImpl) handleAnalyzeErrorCorrelation(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	q := url.Values{}
	q.Set("limit", "300")
	if namespace != "" {
		q.Set("namespace", namespace)
	}

	result := map[string]interface{}{}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	// List failing pods
	qs := nsQuery(namespace)
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err == nil {
		result["pods"] = pods
	}
	result["analysis_hint"] = "Group Warning events by timestamp windows. Simultaneous failures across different namespaces point to node-level or control-plane issues."
	return result, nil
}

// analyze_blast_radius — impact of a resource failing
func (s *mcpServerImpl) handleAnalyzeBlastRadius(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	kind := strArg(args, "kind")
	name := strArg(args, "name")
	namespace := strArg(args, "namespace")

	if kind == "" || name == "" {
		return nil, fmt.Errorf("analyze_blast_radius: 'kind' and 'name' are required")
	}

	result := map[string]interface{}{
		"subject_kind":      kind,
		"subject_name":      name,
		"subject_namespace": namespace,
	}

	// Resource topology shows who depends on this resource
	var path string
	if namespace != "" {
		path = c.clusterPath(clusterID, fmt.Sprintf("/topology/resource/%s/%s/%s",
			url.PathEscape(strings.ToLower(kind)),
			url.PathEscape(namespace),
			url.PathEscape(name)))
	} else {
		path = c.clusterPath(clusterID, "/topology?maxNodes=300")
	}
	var topology map[string]interface{}
	if err := c.get(ctx, path, &topology); err == nil {
		result["topology"] = topology
	}
	// Services that select pods from this workload
	if namespace != "" {
		qs := "?namespace=" + url.QueryEscape(namespace)
		var svcs map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services"+qs), &svcs); err == nil {
			result["services_in_namespace"] = svcs
		}
	}
	result["analysis_hint"] = "Trace outgoing edges in the topology graph to find all dependent services. Services with no alternative upstream are in the blast radius."
	return result, nil
}

// analyze_rollout_risk — assess risk before a deployment rollout
func (s *mcpServerImpl) handleAnalyzeRolloutRisk(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")

	result := map[string]interface{}{}

	if name != "" && namespace != "" {
		// Get deployment details
		var deploy map[string]interface{}
		path := c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
		if err := c.get(ctx, path, &deploy); err == nil {
			result["deployment"] = deploy
		}
		// Rollout history
		histPath := c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/rollout-history")
		var history map[string]interface{}
		if err := c.get(ctx, histPath, &history); err == nil {
			result["rollout_history"] = history
		}
		// Metrics for this deployment
		var metrics map[string]interface{}
		mPath := c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/deployment/"+url.PathEscape(name))
		if err := c.get(ctx, mPath, &metrics); err == nil {
			result["metrics"] = metrics
		}
	} else {
		// Cluster-wide: list all deployments for health check
		qs := nsQuery(namespace)
		var deploys map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys); err == nil {
			result["deployments"] = deploys
		}
	}
	// Current cluster resource availability
	var clMetrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &clMetrics); err == nil {
		result["cluster_metrics_summary"] = clMetrics
	}
	result["analysis_hint"] = "Check rollout strategy (RollingUpdate vs Recreate), minReadySeconds, and cluster headroom. High restart count in history = risky rollout."
	return result, nil
}

// analyze_pod_scheduling — scheduling decisions and node affinity
func (s *mcpServerImpl) handleAnalyzePodScheduling(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err == nil {
		result["pods"] = pods
	}
	var nodes map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes); err == nil {
		result["nodes"] = nodes
	}
	// Pending pods appear in events
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "Pods in Pending state with FailedScheduling events indicate node pressure or affinity mismatches. Compare taints/tolerations and resource requests."
	return result, nil
}

// analyze_image_vulnerabilities — scan images in running workloads
func (s *mcpServerImpl) handleAnalyzeImageVulnerabilities(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	// Gather all images from pods
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err != nil {
		return nil, fmt.Errorf("could not list pods: %w", err)
	}
	return map[string]interface{}{
		"pods":          pods,
		"analysis_hint": "Extract spec.containers[].image from each pod. Cross-reference with CVE databases or run trivy/grype against each image tag. Prioritise images with known Critical CVEs.",
	}, nil
}

// analyze_workload_patterns — traffic and scaling patterns
func (s *mcpServerImpl) handleAnalyzeWorkloadPatterns(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics); err == nil {
		result["metrics_summary"] = metrics
	}
	var hpa map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/horizontalpodautoscalers"+qs), &hpa); err == nil {
		result["hpas"] = hpa
	}
	var deploys map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys); err == nil {
		result["deployments"] = deploys
	}
	result["analysis_hint"] = "HPA currentReplicas vs minReplicas shows scaling activity. Steady high CPU indicates sustained load; spikes suggest bursty workloads needing KEDA or KUPE."
	return result, nil
}

// ════════════════════════════════════════════════════════════════════════════
// TROUBLESHOOTING TOOLS
// ════════════════════════════════════════════════════════════════════════════

// routeTroubleshootingTool routes all troubleshooting tool names to their handlers.
func (s *mcpServerImpl) routeTroubleshootingTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	switch name {
	case "troubleshoot_pod_failures":
		return s.handleTroubleshootPodFailures(ctx, args)
	case "troubleshoot_network_issues":
		return s.handleTroubleshootNetworkIssues(ctx, args)
	case "troubleshoot_performance_degradation":
		return s.handleTroubleshootPerformanceDegradation(ctx, args)
	case "troubleshoot_deployment_failures":
		return s.handleTroubleshootDeploymentFailures(ctx, args)
	case "troubleshoot_resource_constraints":
		return s.handleTroubleshootResourceConstraints(ctx, args)
	case "troubleshoot_rbac_issues":
		return s.handleTroubleshootRBACIssues(ctx, args)
	case "troubleshoot_storage_issues":
		return s.handleTroubleshootStorageIssues(ctx, args)
	default:
		return nil, fmt.Errorf("troubleshooting tool not implemented: %s", name)
	}
}

func (s *mcpServerImpl) handleTroubleshootPodFailures(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	podName := strArg(args, "pod_name")

	result := map[string]interface{}{}

	if podName != "" && namespace != "" {
		// Detailed single pod investigation
		var pod map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods/"+url.PathEscape(namespace)+"/"+url.PathEscape(podName)), &pod); err == nil {
			result["pod"] = pod
		}
		// Logs
		req, _ := newHTTPRequest(ctx, "GET", c.baseURL+c.clusterPath(clusterID, "/logs/"+url.PathEscape(namespace)+"/"+url.PathEscape(podName)+"?tail=200"))
		if req != nil {
			if resp, err := c.httpClient.Do(req); err == nil {
				defer resp.Body.Close()
				buf := make([]byte, 32*1024)
				n, _ := resp.Body.Read(buf)
				result["recent_logs"] = string(buf[:n])
			}
		}
	}

	// Events scoped to namespace or pod
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	// All pods to see restartCounts
	qs := nsQuery(namespace)
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err == nil {
		result["pods"] = pods
	}
	result["analysis_hint"] = "Check pod.status.containerStatuses[].state for Waiting/Terminated reasons. CrashLoopBackOff = app crash; ImagePullBackOff = registry issue; OOMKilled = memory limit too low."
	return result, nil
}

func (s *mcpServerImpl) handleTroubleshootNetworkIssues(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var svcs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services"+qs), &svcs); err == nil {
		result["services"] = svcs
	}
	var policies map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/networkpolicies"+qs), &policies); err == nil {
		result["network_policies"] = policies
	}
	var ingresses map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/ingresses"+qs), &ingresses); err == nil {
		result["ingresses"] = ingresses
	}
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "Check for NetworkPolicies blocking traffic, Services with no matching endpoints, and Ingress misconfigurations. DNS issues: look for coredns pod restarts."
	return result, nil
}

func (s *mcpServerImpl) handleTroubleshootPerformanceDegradation(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	return s.handleAnalyzePerformanceBottlenecks(ctx, args)
}

func (s *mcpServerImpl) handleTroubleshootDeploymentFailures(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	if name != "" && namespace != "" {
		var deploy map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &deploy); err == nil {
			result["deployment"] = deploy
		}
		var history map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/rollout-history"), &history); err == nil {
			result["rollout_history"] = history
		}
	} else {
		var deploys map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys); err == nil {
			result["deployments"] = deploys
		}
	}
	var replicasets map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/replicasets"+qs), &replicasets); err == nil {
		result["replicasets"] = replicasets
	}
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "Look for ReplicaSet with 0 available replicas; check deployment conditions for Progressing=False. Common causes: image pull failure, resource limits, or PodDisruptionBudget blocks."
	return result, nil
}

func (s *mcpServerImpl) handleTroubleshootResourceConstraints(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var nodes map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes); err == nil {
		result["nodes"] = nodes
	}
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics"), &metrics); err == nil {
		result["cluster_metrics"] = metrics
	}
	var quotas map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/resourcequotas"+qs), &quotas); err == nil {
		result["resource_quotas"] = quotas
	}
	var limits map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/limitranges"+qs), &limits); err == nil {
		result["limit_ranges"] = limits
	}
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "ResourceQuota exceeded blocks pod creation. LimitRange default limits may cause OOM. Node pressure taints prevent scheduling. Check events for 'Insufficient CPU/memory'."
	return result, nil
}

func (s *mcpServerImpl) handleTroubleshootRBACIssues(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var roles map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/roles"+qs), &roles); err == nil {
		result["roles"] = roles
	}
	var rb map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings"+qs), &rb); err == nil {
		result["role_bindings"] = rb
	}
	var croles map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/clusterroles"), &croles); err == nil {
		result["cluster_roles"] = croles
	}
	var crb map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings"), &crb); err == nil {
		result["cluster_role_bindings"] = crb
	}
	var sa map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/serviceaccounts"+qs), &sa); err == nil {
		result["service_accounts"] = sa
	}
	result["analysis_hint"] = "Match the serviceAccountName in the failing pod with RoleBindings/ClusterRoleBindings. Check if the bound Role has the required verbs for the needed resources."
	return result, nil
}

func (s *mcpServerImpl) handleTroubleshootStorageIssues(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var pvcs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumeclaims"+qs), &pvcs); err == nil {
		result["pvcs"] = pvcs
	}
	var pvs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvs); err == nil {
		result["pvs"] = pvs
	}
	var sc map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/storageclasses"), &sc); err == nil {
		result["storage_classes"] = sc
	}
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "PVC Pending = no matching PV or StorageClass provisioner unavailable. PVC Terminating stuck = finalizer or data-protection webhook blocking. Check events for FailedMount errors."
	return result, nil
}

// ════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION TOOLS (stub implementations — AI synthesises from obs data)
// ════════════════════════════════════════════════════════════════════════════

func (s *mcpServerImpl) routeRecommendationTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	// Recommendation tools are AI-synthesis tools; they gather raw data then let
	// the LLM generate the recommendations.
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	base := map[string]interface{}{"tool": name, "cluster_id": clusterID}

	switch name {
	case "recommend_resource_optimization":
		var metrics map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
		var deploys map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		base["metrics_summary"] = metrics
		base["deployments"] = deploys
		base["recommendation_hint"] = "Identify containers with requests >> actual usage and suggest rightsizing. Recommend VPA for variable workloads."

	case "recommend_cost_reduction":
		var nodes map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes)
		var pvs map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvs)
		var metrics map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics"), &metrics)
		base["nodes"] = nodes
		base["persistent_volumes"] = pvs
		base["cluster_metrics"] = metrics
		base["recommendation_hint"] = "Look for idle nodes (low CPU/memory), Released PVs, and over-replicated workloads. Spot/preemptible nodes for stateless workloads."

	case "recommend_security_hardening":
		var pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		var netpol map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/networkpolicies"+qs), &netpol)
		var rb map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings"+qs), &rb)
		base["pods"] = pods
		base["network_policies"] = netpol
		base["role_bindings"] = rb
		base["recommendation_hint"] = "Flag containers running as root, privileged containers, hostNetwork/hostPID, missing NetworkPolicies, and overly broad ClusterRoleBindings."

	case "recommend_scaling_strategy":
		var hpa map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/horizontalpodautoscalers"+qs), &hpa)
		var deploys map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		var metrics map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
		base["hpas"] = hpa
		base["deployments"] = deploys
		base["metrics_summary"] = metrics
		base["recommendation_hint"] = "Deployments without HPA and variable load → suggest HPA with CPU/memory targets. Predictable load → KEDA event-driven autoscaling."

	default:
		// For remaining recommendation tools, return cluster overview
		var overview map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview)
		base["overview"] = overview
		base["recommendation_hint"] = fmt.Sprintf("Generate %s recommendations based on the cluster state above.", name)
	}
	return base, nil
}

// ════════════════════════════════════════════════════════════════════════════
// SECURITY TOOLS
// ════════════════════════════════════════════════════════════════════════════

func (s *mcpServerImpl) routeSecurityTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{"tool": name, "cluster_id": clusterID}

	switch name {
	case "security_scan_cluster", "security_check_pod_security":
		var pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		var psp map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/podsecuritypolicies"), &psp)
		result["pods"] = pods
		result["pod_security_policies"] = psp
		result["security_hint"] = "Check for privileged:true, runAsRoot, hostNetwork, hostPID, missing securityContext, and wildcard RBAC verbs."

	case "security_audit_rbac":
		var croles map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterroles"), &croles)
		var crb map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings"), &crb)
		var roles map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/roles"+qs), &roles)
		var rb map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings"+qs), &rb)
		result["cluster_roles"] = croles
		result["cluster_role_bindings"] = crb
		result["roles"] = roles
		result["role_bindings"] = rb
		result["security_hint"] = "Flag cluster-admin bindings to non-system accounts, wildcard resource/verb rules, and service accounts with unnecessary permissions."

	case "security_scan_secrets":
		var secrets map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/secrets"+qs), &secrets)
		result["secrets"] = secrets
		result["security_hint"] = "Identify secrets of type Opaque that may contain plaintext credentials, secrets mounted in too many pods, and secrets older than 90 days."

	case "security_compliance_report":
		var overview map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview)
		var pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		result["overview"] = overview
		result["pods"] = pods
		result["security_hint"] = "Map findings to CIS Benchmark controls: network segmentation (5.3), least-privilege RBAC (5.1), pod security (5.2), and audit logging (3.2)."
	}
	return result, nil
}

// ════════════════════════════════════════════════════════════════════════════
// COST TOOLS
// ════════════════════════════════════════════════════════════════════════════

func (s *mcpServerImpl) routeCostTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{"tool": name, "cluster_id": clusterID}
	// All cost tools need nodes + workload counts + metrics
	var nodes map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes)
	var metrics map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
	var deploys map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
	var pvs map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvs)

	result["nodes"] = nodes
	result["metrics_summary"] = metrics
	result["deployments"] = deploys
	result["persistent_volumes"] = pvs

	switch name {
	case "cost_identify_waste":
		result["cost_hint"] = "Nodes <20% CPU utilisation are idle candidates. PVs in Released state are unused. Deployments with replica count > needed waste compute."
	case "cost_forecast_spending":
		result["cost_hint"] = "Use current node count × cloud instance price as baseline. Factor replica growth rate from HPA metrics to project 30/60/90 day spend."
	case "cost_optimization_plan":
		result["cost_hint"] = "Prioritise: (1) rightsize over-provisioned pods, (2) consolidate idle nodes, (3) delete Released PVs, (4) move dev workloads to spot/preemptible."
	default:
		result["cost_hint"] = "Analyse the workload resource requests vs actual usage to estimate monthly compute cost."
	}
	return result, nil
}

// ════════════════════════════════════════════════════════════════════════════
// ACTION TOOLS (mutating — require explicit approval in calling UI)
// ════════════════════════════════════════════════════════════════════════════

func (s *mcpServerImpl) routeActionTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	// NOTE: Action tools mutate cluster state. The AI server enforces that action
	// tools are only executed when the autonomy level grants permission. The LLM
	// must present the proposed action to the user and receive approval before
	// calling these tools.
	return nil, fmt.Errorf("action tool '%s' requires explicit user approval — not auto-executed", name)
}

// ════════════════════════════════════════════════════════════════════════════
// AUTOMATION TOOLS
// ════════════════════════════════════════════════════════════════════════════

func (s *mcpServerImpl) routeAutomationTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	// Automation tools generate runbooks / workflow definitions — they are
	// read-only planning tools that produce YAML/Markdown outputs.
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	var overview map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview)

	return map[string]interface{}{
		"tool":               name,
		"cluster_id":         clusterID,
		"cluster_overview":   overview,
		"automation_hint":    fmt.Sprintf("Generate a %s based on the cluster state above. Output as structured YAML or Markdown runbook.", name),
	}, nil
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

// nsQuery returns a query string scoping to a namespace if provided.
func nsQuery(namespace string) string {
	if namespace == "" {
		return ""
	}
	return "?namespace=" + url.QueryEscape(namespace)
}
