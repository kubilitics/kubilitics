package server

// handlers_observation.go — full implementation of all 16 observation tool handlers.
//
// Each handler:
//   1. Extracts & validates args
//   2. Calls the kubilitics-backend REST API via backendHTTP
//   3. Returns a structured map the LLM can reason about
//
// All handlers are read-only (no cluster mutations).

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// jsonUnmarshal is a local alias to avoid conflict with potential package-level json var.
var jsonUnmarshal = json.Unmarshal

// httpClient returns a lazy-initialised backendHTTP for this server instance.
// The base URL is taken from the MCP server config.
func (s *mcpServerImpl) http() *backendHTTP {
	baseURL := s.config.Backend.HTTPBaseURL
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}
	return newBackendHTTP(baseURL)
}

// ─── observe_cluster_overview ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleClusterOverview(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	var overview map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview); err != nil {
		// Fallback to summary endpoint if overview not available.
		var summary map[string]interface{}
		if err2 := c.get(ctx, c.clusterPath(clusterID, "/summary"), &summary); err2 != nil {
			return nil, fmt.Errorf("cluster overview: %w", err)
		}
		return map[string]interface{}{
			"cluster_id": clusterID,
			"summary":    summary,
			"timestamp":  time.Now(),
		}, nil
	}

	return map[string]interface{}{
		"cluster_id": clusterID,
		"overview":   overview,
		"timestamp":  time.Now(),
	}, nil
}

// ─── observe_resource ─────────────────────────────────────────────────────────

func (s *mcpServerImpl) handleObserveResource(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	kind := strArg(args, "kind")
	if kind == "" {
		return nil, fmt.Errorf("observe_resource: 'kind' is required")
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_resource: 'name' is required")
	}
	namespace := strArg(args, "namespace")

	var resource map[string]interface{}
	path := c.clusterPath(clusterID, "/resources/"+url.PathEscape(strings.ToLower(kind+"s"))+"/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, path, &resource); err != nil {
		return nil, err
	}
	return resource, nil
}

// ─── observe_resources_by_query ───────────────────────────────────────────────

func (s *mcpServerImpl) handleResourcesByQuery(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	query := strArg(args, "query")
	namespace := strArg(args, "namespace")
	kind := strArg(args, "kind")
	limit := intArg(args, "limit", 25)

	q := url.Values{}
	q.Set("q", query)
	q.Set("limit", fmt.Sprint(limit))
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	if kind != "" {
		q.Set("kind", kind)
	}

	var results map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/search?"+q.Encode()), &results); err != nil {
		return nil, err
	}
	return results, nil
}

// ─── observe_pod_logs ─────────────────────────────────────────────────────────

func (s *mcpServerImpl) handlePodLogs(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	if namespace == "" {
		namespace = "default"
	}
	podName := strArg(args, "pod_name")
	if podName == "" {
		return nil, fmt.Errorf("observe_pod_logs: 'pod_name' is required")
	}
	container := strArg(args, "container_name")
	tailLines := intArg(args, "tail_lines", 100)

	q := url.Values{}
	q.Set("tail", fmt.Sprint(tailLines))
	if container != "" {
		q.Set("container", container)
	}

	path := c.clusterPath(clusterID, "/logs/"+url.PathEscape(namespace)+"/"+url.PathEscape(podName)+"?"+q.Encode())

	// Logs endpoint returns plain text, not JSON.
	req, err := newHTTPRequest(ctx, "GET", c.baseURL+path)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("pod logs: %w", err)
	}
	defer resp.Body.Close()

	// Read at most 32 KB of logs.
	buf := make([]byte, 32*1024)
	n, _ := resp.Body.Read(buf)
	logText := string(buf[:n])

	return map[string]interface{}{
		"pod":       podName,
		"namespace": namespace,
		"container": container,
		"tail":      tailLines,
		"logs":      logText,
	}, nil
}

// ─── observe_events ───────────────────────────────────────────────────────────

func (s *mcpServerImpl) handleEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	limit := intArg(args, "limit", 50)

	q := url.Values{}
	q.Set("limit", fmt.Sprint(limit))
	if namespace != "" {
		q.Set("namespace", namespace)
	}

	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err != nil {
		return nil, err
	}
	return events, nil
}

// ─── observe_resource_topology ────────────────────────────────────────────────

func (s *mcpServerImpl) handleResourceTopology(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	depth := intArg(args, "depth", 3)

	// Try named resource topology first, fall back to cluster-wide.
	kind := strArg(args, "kind")
	name := strArg(args, "name")

	var path string
	if kind != "" && name != "" && namespace != "" {
		path = c.clusterPath(clusterID, fmt.Sprintf("/topology/resource/%s/%s/%s",
			url.PathEscape(kind), url.PathEscape(namespace), url.PathEscape(name)))
	} else {
		q := url.Values{}
		q.Set("maxNodes", fmt.Sprint(depth*50))
		if namespace != "" {
			q.Set("namespace", namespace)
		}
		path = c.clusterPath(clusterID, "/topology?"+q.Encode())
	}

	var topology map[string]interface{}
	if err := c.get(ctx, path, &topology); err != nil {
		return nil, err
	}
	return topology, nil
}

// ─── observe_metrics ──────────────────────────────────────────────────────────

func (s *mcpServerImpl) handleMetrics(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	kind := strArg(args, "kind")
	name := strArg(args, "name")

	// Route to the most specific metrics endpoint available.
	var path string
	switch strings.ToLower(kind) {
	case "node":
		if name != "" {
			path = c.clusterPath(clusterID, "/metrics/nodes/"+url.PathEscape(name))
		} else {
			path = c.clusterPath(clusterID, "/metrics")
		}
	case "deployment":
		if name != "" && namespace != "" {
			path = c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/deployment/"+url.PathEscape(name))
		} else {
			path = c.clusterPath(clusterID, "/metrics/summary")
		}
	case "pod":
		if name != "" && namespace != "" {
			path = c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
		} else {
			path = c.clusterPath(clusterID, "/metrics/summary")
		}
	case "statefulset":
		if name != "" && namespace != "" {
			path = c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/statefulset/"+url.PathEscape(name))
		} else {
			path = c.clusterPath(clusterID, "/metrics/summary")
		}
	case "daemonset":
		if name != "" && namespace != "" {
			path = c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/daemonset/"+url.PathEscape(name))
		} else {
			path = c.clusterPath(clusterID, "/metrics/summary")
		}
	default:
		path = c.clusterPath(clusterID, "/metrics/summary")
	}

	var metrics map[string]interface{}
	if err := c.get(ctx, path, &metrics); err != nil {
		return nil, err
	}
	return metrics, nil
}

// ─── observe_node_status ──────────────────────────────────────────────────────

func (s *mcpServerImpl) handleNodeStatus(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	name := strArg(args, "name")
	if name != "" {
		var node map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes//"+url.PathEscape(name)), &node); err != nil {
			return nil, err
		}
		return node, nil
	}

	// List all nodes with metrics.
	var nodes map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes); err != nil {
		return nil, err
	}
	var metrics map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics"), &metrics)

	return map[string]interface{}{
		"nodes":   nodes,
		"metrics": metrics,
	}, nil
}

// ─── observe_namespace_overview ───────────────────────────────────────────────

func (s *mcpServerImpl) handleNamespaceOverview(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	// Namespace counts endpoint.
	var counts map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/namespaces/counts"), &counts)

	// List namespaces.
	var namespaces map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/namespaces"), &namespaces); err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"namespaces": namespaces,
		"counts":     counts,
	}, nil
}

// ─── observe_workload_health ──────────────────────────────────────────────────

func (s *mcpServerImpl) handleWorkloadHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")

	q := url.Values{}
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	qs := ""
	if len(q) > 0 {
		qs = "?" + q.Encode()
	}

	// Collect health data from multiple workload types.
	results := map[string]interface{}{}
	for _, kind := range []string{"deployments", "statefulsets", "daemonsets", "replicasets"} {
		var data map[string]interface{}
		path := c.clusterPath(clusterID, "/resources/"+kind+qs)
		if err := c.get(ctx, path, &data); err == nil {
			results[kind] = data
		}
	}

	// Also grab pod restarts from metrics summary.
	var summary map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &summary)
	if summary != nil {
		results["metrics_summary"] = summary
	}

	return results, nil
}

// ─── observe_network_policies ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleNetworkPolicies(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	q := url.Values{}
	if namespace != "" {
		q.Set("namespace", namespace)
	}

	var policies map[string]interface{}
	path := c.clusterPath(clusterID, "/resources/networkpolicies")
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	if err := c.get(ctx, path, &policies); err != nil {
		return nil, err
	}
	return policies, nil
}

// ─── observe_storage_status ───────────────────────────────────────────────────

func (s *mcpServerImpl) handleStorageStatus(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	q := url.Values{}
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	qs := ""
	if len(q) > 0 {
		qs = "?" + q.Encode()
	}

	results := map[string]interface{}{}

	var pvcs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumeclaims"+qs), &pvcs); err == nil {
		results["pvcs"] = pvcs
	}

	var pvs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvs); err == nil {
		results["pvs"] = pvs
	}

	var storageClasses map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/storageclasses"), &storageClasses); err == nil {
		results["storage_classes"] = storageClasses
	}

	var pvCounts map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/storageclasses/pv-counts"), &pvCounts); err == nil {
		results["pv_counts_by_storageclass"] = pvCounts
	}

	return results, nil
}

// ─── observe_api_resources ────────────────────────────────────────────────────

func (s *mcpServerImpl) handleAPIResources(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	// Capabilities endpoint doesn't need a cluster ID.
	var caps map[string]interface{}
	if err := c.get(ctx, "/capabilities", &caps); err != nil {
		return nil, err
	}
	return caps, nil
}

// ─── observe_custom_resources ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleCustomResources(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	crdName := strArg(args, "crd_name")
	if crdName != "" {
		var instances map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/crd-instances/"+url.PathEscape(crdName)), &instances); err != nil {
			return nil, err
		}
		return instances, nil
	}

	// List all CRDs.
	var crds map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/customresourcedefinitions"), &crds); err != nil {
		return nil, err
	}
	return crds, nil
}

// ─── observe_resource_history ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleResourceHistory(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	kind := strArg(args, "kind")
	name := strArg(args, "name")
	namespace := strArg(args, "namespace")

	if kind == "" || name == "" {
		return nil, fmt.Errorf("observe_resource_history: 'kind' and 'name' are required")
	}

	// Try the replicasets (rollout history) endpoint for workloads.
	var history map[string]interface{}
	path := c.clusterPath(clusterID, fmt.Sprintf("/resources/%s/%s/%s/history",
		url.PathEscape(strings.ToLower(kind+"s")),
		url.PathEscape(namespace),
		url.PathEscape(name)))
	if err := c.get(ctx, path, &history); err != nil {
		// Fallback: return the resource itself (history not available)
		return s.handleObserveResource(ctx, args)
	}
	return history, nil
}

// ─── export_topology_to_drawio ────────────────────────────────────────────────

func (s *mcpServerImpl) handleExportTopologyToDrawio(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	drawioURL := c.baseURL + "/api/v1/clusters/" + url.PathEscape(clusterID) + "/topology/export/drawio?format=mermaid"
	req, err := newHTTPRequest(ctx, "GET", drawioURL)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to get draw.io export: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("draw.io export failed (HTTP %d)", resp.StatusCode)
	}

	var result struct {
		URL     string `json:"url"`
		Mermaid string `json:"mermaid,omitempty"`
	}
	// Decode using json
	buf := make([]byte, 64*1024)
	n, _ := resp.Body.Read(buf)
	if err := jsonUnmarshal(buf[:n], &result); err != nil {
		return nil, fmt.Errorf("failed to decode draw.io response: %w", err)
	}
	return map[string]interface{}{
		"url":     result.URL,
		"message": "Open this URL in a browser to view and edit the architecture diagram in draw.io",
		"mermaid": result.Mermaid,
	}, nil
}

// ─── Updated createObservationHandler ─────────────────────────────────────────

// newObservationHandler replaces the stub createObservationHandler in server.go.
// It is called from registerAllTools via createObservationHandler.
func (s *mcpServerImpl) routeObservationTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	switch name {
	case "observe_cluster_overview":
		return s.handleClusterOverview(ctx, args)
	case "observe_resource":
		return s.handleObserveResource(ctx, args)
	case "observe_resources_by_query":
		return s.handleResourcesByQuery(ctx, args)
	case "observe_pod_logs":
		return s.handlePodLogs(ctx, args)
	case "observe_events":
		return s.handleEvents(ctx, args)
	case "observe_resource_topology":
		return s.handleResourceTopology(ctx, args)
	case "observe_resource_history":
		return s.handleResourceHistory(ctx, args)
	case "export_topology_to_drawio":
		return s.handleExportTopologyToDrawio(ctx, args)
	case "observe_metrics":
		return s.handleMetrics(ctx, args)
	case "observe_node_status":
		return s.handleNodeStatus(ctx, args)
	case "observe_namespace_overview":
		return s.handleNamespaceOverview(ctx, args)
	case "observe_workload_health":
		return s.handleWorkloadHealth(ctx, args)
	case "observe_network_policies":
		return s.handleNetworkPolicies(ctx, args)
	case "observe_storage_status":
		return s.handleStorageStatus(ctx, args)
	case "observe_api_resources":
		return s.handleAPIResources(ctx, args)
	case "observe_custom_resources":
		return s.handleCustomResources(ctx, args)
	default:
		return nil, fmt.Errorf("observation tool not implemented: %s", name)
	}
}
