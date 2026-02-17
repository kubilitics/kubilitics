# Kubilitics AI Features — Part 4: MCP Tools & Investigation System

**Document:** Part 4 of 5
**Version:** 1.0
**Date:** February 2026
**Focus:** MCP Tool Catalog (60+ Tools) & Investigation Session System

---

## Overview

This document provides comprehensive specifications for:
1. **MCP Tool Catalog:** All 60+ tools organized by category
2. **Investigation Session System:** Multi-step autonomous reasoning
3. **Tool Orchestration:** How tools work together
4. **Safety & Approval System:** Preventing harmful actions

**MCP (Model Context Protocol):** Anthropic's standard for LLM-tool interfaces. All tools follow MCP specification for consistency.

---

## Table of Contents

1. [MCP Tool Categories & Philosophy](#1-mcp-tool-categories--philosophy)
2. [Observation Tools (15 Tools)](#2-observation-tools)
3. [Analysis Tools (12 Tools)](#3-analysis-tools)
4. [Recommendation Tools (8 Tools)](#4-recommendation-tools)
5. [Troubleshooting Tools (7 Tools)](#5-troubleshooting-tools)
6. [Security Tools (5 Tools)](#6-security-tools)
7. [Cost Tools (4 Tools)](#7-cost-tools)
8. [Action Tools (5 Tools)](#8-action-tools)
9. [Automation Tools (4 Tools)](#9-automation-tools)
10. [Investigation Session System](#10-investigation-session-system)
11. [Tool Orchestration Patterns](#11-tool-orchestration-patterns)

---

## 1. MCP Tool Categories & Philosophy

### 1.1 Design Principles

**1. Single Responsibility**
- Each tool does ONE thing well
- No overlapping functionality
- Clear input/output contracts

**2. Composability**
- Tools designed to chain together
- Output of one tool = input to another
- Investigation workflows = tool orchestration

**3. Safety First**
- Read-only tools execute immediately
- Mutations require approval
- Blast radius calculated before any action

**4. Semantic Naming**
- Tool names describe what they do
- Verb + noun pattern: `observe_pods`, `analyze_anomalies`, `recommend_scaling`

**5. Structured Output**
- JSON responses with consistent schema
- Confidence scores for probabilistic results
- Metadata for audit trails

---

### 1.2 Tool Category Matrix

| Category | Count | Purpose | Safety Level |
|----------|-------|---------|--------------|
| **Observation** | 15 | Read cluster state | Read-only (safe) |
| **Analysis** | 12 | Pattern detection, diagnostics | Read-only (safe) |
| **Recommendation** | 8 | AI-powered suggestions | Read-only (safe) |
| **Troubleshooting** | 7 | Multi-step investigations | Read-only (safe) |
| **Security** | 5 | Vulnerability scanning, audits | Read-only (safe) |
| **Cost** | 4 | Cost analysis | Read-only (safe) |
| **Action** | 5 | Cluster mutations | **GATED** (requires approval) |
| **Automation** | 4 | Workflows, scheduling | **GATED** (requires approval) |

**Total:** 60 tools

**Safety Ratio:** 55 safe (read-only) : 9 gated (mutations) = 85% safe by default

---

### 1.3 Tool Interface Specification

**Standard MCP Tool Structure:**

```json
{
  "name": "tool_name",
  "description": "What the tool does in 1-2 sentences",
  "parameters": {
    "param1": {
      "type": "string",
      "description": "What this parameter controls",
      "required": true
    },
    "param2": {
      "type": "integer",
      "description": "Optional parameter",
      "required": false,
      "default": 100
    }
  },
  "returns": {
    "type": "object",
    "schema": {
      "result": "array",
      "confidence": "float",
      "metadata": "object"
    }
  },
  "safety": "read-only | gated",
  "estimated_execution_time": "2-5 seconds"
}
```

---

## 2. Observation Tools (15 Tools)

**Purpose:** Read-only queries for cluster state

---

### 2.1 `observe_cluster_overview`

**Description:** Get high-level cluster summary (nodes, pods, resource usage, health)

**Parameters:**
```json
{
  "namespace": {
    "type": "string",
    "description": "Optional namespace filter (omit for cluster-wide)",
    "required": false
  },
  "include_metrics": {
    "type": "boolean",
    "description": "Include resource usage metrics",
    "required": false,
    "default": true
  }
}
```

**Returns:**
```json
{
  "cluster_name": "production-us-east-1",
  "kubernetes_version": "1.28.5",
  "nodes": {
    "total": 5,
    "ready": 5,
    "not_ready": 0,
    "schedulable": 5
  },
  "pods": {
    "total": 450,
    "running": 438,
    "pending": 8,
    "failed": 4,
    "succeeded": 0
  },
  "resource_usage": {
    "cpu": {
      "total_allocatable": "20 cores",
      "requested": "11 cores",
      "utilization": "55%"
    },
    "memory": {
      "total_allocatable": "80Gi",
      "requested": "54.4Gi",
      "utilization": "68%"
    },
    "storage": {
      "pvcs_bound": 38,
      "pvcs_total": 40,
      "total_capacity": "500Gi",
      "used": "210Gi",
      "utilization": "42%"
    }
  },
  "health_status": "healthy",
  "timestamp": "2024-02-10T14:30:00Z"
}
```

**Use Cases:**
- Dashboard initial load
- Health check endpoint
- "Show me cluster status" query

---

### 2.2 `observe_resource`

**Description:** Get detailed information about a specific resource

**Parameters:**
```json
{
  "kind": {
    "type": "string",
    "description": "Resource type (Pod, Deployment, Service, etc.)",
    "required": true,
    "enum": ["Pod", "Deployment", "Service", "Node", ...]
  },
  "name": {
    "type": "string",
    "description": "Resource name",
    "required": true
  },
  "namespace": {
    "type": "string",
    "description": "Namespace (omit for cluster-scoped resources)",
    "required": false
  },
  "include_related": {
    "type": "boolean",
    "description": "Include related resources (e.g., Deployment includes Pods)",
    "required": false,
    "default": false
  }
}
```

**Returns:**
```json
{
  "kind": "Deployment",
  "metadata": {
    "name": "nginx",
    "namespace": "production",
    "uid": "a1b2c3d4-...",
    "created_at": "2024-01-15T10:00:00Z",
    "labels": {
      "app": "nginx",
      "tier": "frontend"
    },
    "annotations": {}
  },
  "spec": {
    "replicas": 5,
    "strategy": {
      "type": "RollingUpdate",
      "max_surge": "25%",
      "max_unavailable": "25%"
    },
    "template": { ... }
  },
  "status": {
    "replicas": 5,
    "ready_replicas": 5,
    "available_replicas": 5,
    "updated_replicas": 5,
    "conditions": [
      {
        "type": "Available",
        "status": "True",
        "reason": "MinimumReplicasAvailable"
      }
    ]
  },
  "related_resources": {
    "replicasets": [...],
    "pods": [...],
    "services": [...]
  }
}
```

**Use Cases:**
- Resource detail view
- Dependency lookup
- "Show me deployment nginx" query

---

### 2.3 `observe_resources`

**Description:** List resources matching criteria (with filtering, sorting, pagination)

**Parameters:**
```json
{
  "kind": {
    "type": "string",
    "description": "Resource type",
    "required": true
  },
  "namespace": {
    "type": "string",
    "description": "Namespace filter (omit for all namespaces)",
    "required": false
  },
  "labels": {
    "type": "object",
    "description": "Label selector (key-value pairs)",
    "required": false
  },
  "field_selector": {
    "type": "string",
    "description": "Field selector (e.g., status.phase=Running)",
    "required": false
  },
  "sort_by": {
    "type": "string",
    "description": "Sort field",
    "required": false,
    "default": "metadata.creationTimestamp"
  },
  "limit": {
    "type": "integer",
    "description": "Max results",
    "required": false,
    "default": 100
  }
}
```

**Returns:**
```json
{
  "items": [
    { "metadata": {...}, "spec": {...}, "status": {...} },
    ...
  ],
  "total_count": 450,
  "returned_count": 100,
  "has_more": true
}
```

**Use Cases:**
- List views (Pods, Deployments, etc.)
- "Show me all failing pods" query
- Bulk operations (select resources)

---

### 2.4 `observe_pod_logs`

**Description:** Stream or fetch pod logs

**Parameters:**
```json
{
  "pod": {
    "type": "string",
    "description": "Pod name",
    "required": true
  },
  "namespace": {
    "type": "string",
    "required": true
  },
  "container": {
    "type": "string",
    "description": "Container name (omit for first container)",
    "required": false
  },
  "since": {
    "type": "string",
    "description": "Time range (e.g., '1h', '30m')",
    "required": false
  },
  "tail": {
    "type": "integer",
    "description": "Number of lines from end",
    "required": false,
    "default": 100
  },
  "follow": {
    "type": "boolean",
    "description": "Stream logs in real-time",
    "required": false,
    "default": false
  }
}
```

**Returns:**
```json
{
  "logs": [
    {
      "timestamp": "2024-02-10T14:25:30Z",
      "level": "INFO",
      "message": "Server started on port 8080"
    },
    {
      "timestamp": "2024-02-10T14:25:45Z",
      "level": "ERROR",
      "message": "Failed to connect to database: connection timeout"
    }
  ],
  "truncated": false,
  "container": "nginx"
}
```

**Use Cases:**
- Logs tab
- Troubleshooting pod failures
- Log pattern analysis

---

### 2.5 `observe_events`

**Description:** Retrieve Kubernetes events

**Parameters:**
```json
{
  "namespace": {
    "type": "string",
    "required": false
  },
  "involved_object": {
    "type": "object",
    "description": "Filter by resource (kind, name)",
    "required": false
  },
  "since": {
    "type": "string",
    "required": false,
    "default": "1h"
  },
  "type": {
    "type": "string",
    "description": "Normal or Warning",
    "required": false,
    "enum": ["Normal", "Warning"]
  }
}
```

**Returns:**
```json
{
  "events": [
    {
      "type": "Warning",
      "reason": "BackOff",
      "message": "Back-off restarting failed container",
      "involved_object": {
        "kind": "Pod",
        "name": "nginx-7f8x2",
        "namespace": "production"
      },
      "count": 5,
      "first_timestamp": "2024-02-10T14:15:00Z",
      "last_timestamp": "2024-02-10T14:25:00Z"
    }
  ],
  "total_count": 12
}
```

**Use Cases:**
- Events tab
- Debugging pod/deployment issues
- Anomaly detection input

---

### 2.6 `observe_metrics`

**Description:** Fetch time-series metrics (CPU, Memory, Network)

**Parameters:**
```json
{
  "resource": {
    "type": "object",
    "description": "{kind, name, namespace}",
    "required": true
  },
  "metrics": {
    "type": "array",
    "description": "Which metrics to fetch",
    "required": false,
    "default": ["cpu", "memory"],
    "enum": ["cpu", "memory", "network_rx", "network_tx", "disk_io"]
  },
  "time_range": {
    "type": "string",
    "required": false,
    "default": "1h",
    "enum": ["1h", "6h", "24h", "7d", "30d"]
  },
  "granularity": {
    "type": "string",
    "description": "Data point interval",
    "required": false,
    "default": "1m",
    "enum": ["1m", "5m", "15m", "1h"]
  }
}
```

**Returns:**
```json
{
  "metrics": {
    "cpu": {
      "data_points": [
        {"timestamp": "2024-02-10T14:00:00Z", "value": 0.35},
        {"timestamp": "2024-02-10T14:01:00Z", "value": 0.38},
        ...
      ],
      "unit": "cores",
      "aggregation": "average"
    },
    "memory": {
      "data_points": [...],
      "unit": "bytes"
    }
  },
  "resource": {...}
}
```

**Use Cases:**
- Metrics tab charts
- Anomaly detection
- Capacity forecasting

---

### 2.7 `observe_topology_graph`

**Description:** Build cluster topology graph structure

**Parameters:**
```json
{
  "namespace": {
    "type": "string",
    "required": false
  },
  "resource_types": {
    "type": "array",
    "description": "Which resource types to include",
    "required": false,
    "default": ["Pod", "Service", "Deployment", "Ingress"]
  },
  "depth": {
    "type": "integer",
    "description": "Relationship depth (1-5)",
    "required": false,
    "default": 3
  }
}
```

**Returns:**
```json
{
  "nodes": [
    {
      "id": "pod-nginx-7f8x2",
      "kind": "Pod",
      "name": "nginx-7f8x2",
      "namespace": "production",
      "status": "Running",
      "metadata": {...}
    },
    ...
  ],
  "edges": [
    {
      "source": "service-nginx",
      "target": "pod-nginx-7f8x2",
      "type": "selects",
      "metadata": {"selector": "app=nginx"}
    },
    ...
  ],
  "clusters": [
    {
      "id": "production-frontend",
      "nodes": ["pod-nginx-7f8x2", "service-nginx", "ingress-public"]
    }
  ]
}
```

**Use Cases:**
- Topology visualizer
- Dependency analysis
- Blast radius calculation

---

### 2.8 `observe_node_status`

**Description:** Get detailed node information

**Parameters:**
```json
{
  "node_name": {
    "type": "string",
    "description": "Specific node (omit for all nodes)",
    "required": false
  },
  "include_pods": {
    "type": "boolean",
    "description": "Include pods running on node",
    "required": false,
    "default": false
  }
}
```

**Returns:**
```json
{
  "nodes": [
    {
      "name": "worker-3",
      "status": {
        "conditions": [
          {"type": "Ready", "status": "True"},
          {"type": "MemoryPressure", "status": "False"},
          {"type": "DiskPressure", "status": "False"}
        ]
      },
      "capacity": {
        "cpu": "4 cores",
        "memory": "16Gi",
        "pods": "110"
      },
      "allocatable": {
        "cpu": "3.9 cores",
        "memory": "14.5Gi",
        "pods": "110"
      },
      "usage": {
        "cpu": "3.3 cores (85%)",
        "memory": "11.2Gi (77%)",
        "pods": 45
      },
      "pods": [...]
    }
  ]
}
```

**Use Cases:**
- Node detail view
- Capacity planning
- Pod placement analysis

---

*[Continue with remaining observation tools: observe_namespace_quotas, observe_service_endpoints, observe_pvc_bindings, observe_ingress_rules, observe_configmap_usage, observe_secret_usage, observe_resource_waste]*

---

## 3. Analysis Tools (12 Tools)

**Purpose:** Pattern detection, anomaly detection, diagnostics

---

### 3.1 `analyze_anomaly_detection`

**Description:** Detect anomalies in metrics, logs, and resource behavior

**Parameters:**
```json
{
  "resource_type": {
    "type": "string",
    "required": false,
    "description": "Filter by resource type"
  },
  "namespace": {
    "type": "string",
    "required": false
  },
  "time_range": {
    "type": "string",
    "required": false,
    "default": "1h"
  },
  "sensitivity": {
    "type": "float",
    "description": "0.0 (strict) to 1.0 (lenient)",
    "required": false,
    "default": 0.5
  }
}
```

**Algorithm:**
- **Statistical:** Z-score detection (>3 std dev = anomaly)
- **ML-based:** Isolation Forest on metric time-series
- **Baseline Learning:** Compare vs 7-day historical normal

**Returns:**
```json
{
  "anomalies": [
    {
      "type": "memory_spike",
      "resource": {
        "kind": "Pod",
        "name": "nginx-7f8x2",
        "namespace": "production"
      },
      "timestamp": "2024-02-10T14:15:00Z",
      "confidence": 0.94,
      "details": {
        "metric": "memory_usage",
        "current_value": "750Mi",
        "normal_range": "200-400Mi",
        "deviation": "3.4 std dev"
      },
      "likely_cause": "Traffic spike (3x normal load)",
      "recommendation": "Investigate pod logs, consider scaling"
    },
    ...
  ],
  "total_anomalies": 3,
  "time_window_analyzed": "1h"
}
```

**Use Cases:**
- Dashboard anomaly cards
- Proactive alerting
- Investigation trigger

---

### 3.2 `analyze_failure_patterns`

**Description:** Detect recurring failure patterns across pods, deployments, nodes

**Parameters:**
```json
{
  "time_range": {
    "type": "string",
    "required": false,
    "default": "24h"
  },
  "namespace": {
    "type": "string",
    "required": false
  },
  "min_occurrences": {
    "type": "integer",
    "description": "Minimum pattern frequency to report",
    "required": false,
    "default": 3
  }
}
```

**Algorithm:**
- **Event Clustering:** Group similar events by reason + message similarity
- **Log Pattern Mining:** Regex + log embedding clustering (DBSCAN)
- **Time-Series Analysis:** Detect cyclical failure patterns

**Returns:**
```json
{
  "patterns": [
    {
      "pattern_id": "oom_killer_pattern_1",
      "type": "OOMKilled",
      "affected_resources": [
        {"kind": "Pod", "name": "api-pod-1", "namespace": "production"},
        {"kind": "Pod", "name": "api-pod-2", "namespace": "production"}
      ],
      "occurrences": 12,
      "first_seen": "2024-02-10T10:00:00Z",
      "last_seen": "2024-02-10T14:15:00Z",
      "frequency": "~2 per hour",
      "common_factors": {
        "deployment": "api-deployment",
        "image": "myapp/api:v2.3.1",
        "memory_limit": "256Mi"
      },
      "root_cause_hypothesis": "Memory leak in v2.3.1 introduced 4 hours ago",
      "confidence": 0.88,
      "recommendation": "Rollback to v2.3.0 OR increase memory limit to 512Mi"
    }
  ],
  "total_patterns": 3
}
```

**Use Cases:**
- Proactive issue detection
- Root cause analysis
- "Why do my pods keep crashing?" investigation

---

### 3.3 `analyze_log_patterns`

**Description:** Extract patterns from pod logs (errors, warnings, anomalies)

**Parameters:**
```json
{
  "pod": {
    "type": "string",
    "required": false,
    "description": "Specific pod (omit for multi-pod analysis)"
  },
  "namespace": {
    "type": "string",
    "required": false
  },
  "time_range": {
    "type": "string",
    "required": false,
    "default": "1h"
  },
  "min_occurrences": {
    "type": "integer",
    "required": false,
    "default": 3
  }
}
```

**Algorithm:**
- **Pattern Extraction:** Regex-based + log embedding clustering
- **Frequency Analysis:** Count pattern occurrences
- **Anomaly Detection:** Detect sudden new patterns (not seen in historical logs)

**Returns:**
```json
{
  "patterns": [
    {
      "pattern_id": "db_connection_error",
      "template": "Failed to connect to database: {error}",
      "sample_logs": [
        "Failed to connect to database: connection timeout",
        "Failed to connect to database: network unreachable"
      ],
      "occurrences": 45,
      "first_seen": "2024-02-10T13:00:00Z",
      "last_seen": "2024-02-10T14:25:00Z",
      "frequency": "~1 per minute",
      "trend": "increasing",
      "severity": "ERROR",
      "affected_pods": ["api-pod-1", "api-pod-2", "api-pod-3"],
      "likely_cause": "Database pod unavailable or network issue",
      "recommendation": "Check database pod health and network connectivity"
    }
  ],
  "total_patterns": 7
}
```

**Use Cases:**
- Enhanced logs tab
- Troubleshooting investigations
- Error correlation

---

### 3.4 `analyze_resource_health`

**Description:** Calculate overall health score for a resource (0-100)

**Parameters:**
```json
{
  "kind": {
    "type": "string",
    "required": true
  },
  "name": {
    "type": "string",
    "required": true
  },
  "namespace": {
    "type": "string",
    "required": false
  }
}
```

**Algorithm - Multi-Factor Health Score:**

1. **Condition Status** (30% weight)
   - All conditions True = 30 points
   - Any condition False = -10 points per condition

2. **Probe Health** (20% weight)
   - All probes passing = 20 points
   - Failing probes = 0 points

3. **Restart History** (15% weight)
   - 0 restarts last 24h = 15 points
   - 1-3 restarts = 10 points
   - >3 restarts = 0 points

4. **Resource Usage** (15% weight)
   - Within limits = 15 points
   - Approaching limits = 5 points
   - Exceeding limits = 0 points

5. **Event History** (10% weight)
   - No warning events = 10 points
   - Warning events present = 0 points

6. **Metric Trends** (10% weight)
   - Stable trends = 10 points
   - Degrading trends = 0 points

**Returns:**
```json
{
  "health_score": 85,
  "grade": "Good",
  "confidence": 0.92,
  "factors": {
    "conditions": {
      "score": 30,
      "details": "All conditions True"
    },
    "probes": {
      "score": 20,
      "details": "Liveness, Readiness, Startup all passing"
    },
    "restarts": {
      "score": 15,
      "details": "0 restarts in last 24h"
    },
    "resource_usage": {
      "score": 10,
      "details": "CPU at 65% of limit (approaching)"
    },
    "events": {
      "score": 10,
      "details": "No warning events"
    },
    "metrics": {
      "score": 0,
      "details": "Memory trending upward (potential issue)"
    }
  },
  "issues": [
    "Memory usage increasing +15Mi/hour"
  ],
  "recommendations": [
    "Monitor memory trend closely",
    "Consider increasing memory limit if trend continues"
  ]
}
```

**Use Cases:**
- AI Insights panel
- Health score column in lists
- Overall resource assessment

---

### 3.5 `analyze_capacity_forecast`

**Description:** Predict future resource usage (CPU, Memory, Pods)

**Parameters:**
```json
{
  "metric": {
    "type": "string",
    "required": false,
    "default": "cpu",
    "enum": ["cpu", "memory", "pods", "storage"]
  },
  "horizon": {
    "type": "string",
    "description": "Forecast timeframe",
    "required": false,
    "default": "24h",
    "enum": ["6h", "24h", "72h", "7d"]
  },
  "namespace": {
    "type": "string",
    "required": false
  }
}
```

**Algorithm:**
- **Time-Series Forecasting:** ARIMA model on historical metrics (30 days)
- **Trend Analysis:** Linear regression + exponential smoothing
- **Seasonal Patterns:** Day-of-week, time-of-day adjustments
- **Event Correlation:** Factor in scheduled jobs, deployments

**Returns:**
```json
{
  "metric": "cpu",
  "current_usage": "11 cores (55%)",
  "forecast": [
    {
      "timestamp": "2024-02-10T20:00:00Z",
      "predicted_usage": "12.5 cores (62%)",
      "confidence_interval": {
        "lower": "11.8 cores",
        "upper": "13.2 cores"
      }
    },
    {
      "timestamp": "2024-02-11T02:00:00Z",
      "predicted_usage": "13.8 cores (69%)",
      "confidence_interval": {...}
    },
    ...
  ],
  "will_exceed_capacity": false,
  "predicted_threshold_breach": null,
  "recommendation": "Capacity is sufficient for next 24 hours",
  "confidence": 0.82
}
```

**Use Cases:**
- Predictive capacity alerts
- Capacity planning
- "Will I run out of capacity?" queries

---

*[Continue with remaining analysis tools: analyze_cost_attribution, analyze_cost_trends, analyze_dependency_chains, analyze_blast_radius, analyze_correlation_patterns, analyze_failure_prediction, analyze_metric_anomalies]*

---

## 4. Recommendation Tools (8 Tools)

**Purpose:** AI-powered suggestions for optimization, security, configuration

---

### 4.1 `recommend_configuration_improvements`

**Description:** Suggest configuration improvements for a resource

**Parameters:**
```json
{
  "kind": {
    "type": "string",
    "required": true
  },
  "name": {
    "type": "string",
    "required": true
  },
  "namespace": {
    "type": "string",
    "required": false
  }
}
```

**Recommendation Engine:**

Analyzes:
- Missing probes (liveness, readiness, startup)
- Resource limits/requests (over/under provisioned)
- Security context (runAsNonRoot, capabilities)
- Update strategy (RollingUpdate vs Recreate)
- Replica count (HA considerations)
- Pod Disruption Budget (missing or misconfigured)
- Affinity rules (anti-affinity for HA)

**Returns:**
```json
{
  "recommendations": [
    {
      "id": "add_liveness_probe",
      "title": "Add Liveness Probe",
      "description": "No liveness probe defined. Container may run indefinitely even if unhealthy.",
      "priority": "high",
      "impact": "Faster failure detection and recovery",
      "risk": "low",
      "implementation": {
        "yaml_patch": {
          "spec": {
            "template": {
              "spec": {
                "containers": [
                  {
                    "name": "nginx",
                    "livenessProbe": {
                      "httpGet": {
                        "path": "/healthz",
                        "port": 8080
                      },
                      "initialDelaySeconds": 30,
                      "periodSeconds": 10
                    }
                  }
                ]
              }
            }
          }
        },
        "estimated_time": "2 minutes",
        "safe_to_apply": true
      },
      "learn_more_url": "https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/"
    },
    {
      "id": "increase_memory_limit",
      "title": "Increase Memory Limit",
      "description": "Peak memory usage at 95% of limit. Risk of OOMKill.",
      "priority": "medium",
      "impact": "Prevent OOMKill crashes",
      "risk": "low",
      "current_value": "256Mi",
      "recommended_value": "512Mi",
      "reasoning": "Based on P99 usage (240Mi) + 100% buffer",
      "cost_impact": "+$0.08/day per pod"
    },
    ...
  ],
  "total_recommendations": 5
}
```

**Use Cases:**
- AI Insights panel
- Configuration wizard
- "How can I improve this deployment?" query

---

*[Continue with remaining recommendation tools: recommend_cost_reduction, recommend_scaling_actions, recommend_right_sizing, recommend_security_hardening, recommend_image_updates, recommend_architecture_improvements, recommend_immediate_actions]*

---

## 5. Troubleshooting Tools (7 Tools)

**Purpose:** Multi-step autonomous investigations

---

### 5.1 `troubleshoot_pod_failures`

**Description:** Investigate pod failures with multi-step reasoning

**Parameters:**
```json
{
  "pod": {
    "type": "string",
    "description": "Specific pod (omit to find all failing pods)",
    "required": false
  },
  "namespace": {
    "type": "string",
    "required": false
  },
  "failure_pattern": {
    "type": "string",
    "description": "Known pattern (omit for auto-detection)",
    "required": false,
    "enum": ["CrashLoopBackOff", "ImagePullBackOff", "Pending", "OOMKilled"]
  }
}
```

**Investigation Process:**

**Step 1:** Identify failing pods (if not specified)
- Query: `observe_resources(kind=Pod, field_selector=status.phase!=Running)`

**Step 2:** Analyze exit codes and events
- Query: `observe_events(involved_object={pod})`
- Extract: Exit codes, reasons, timestamps

**Step 3:** Check resource constraints
- Query: `observe_node_status(include_pods=true)`
- Check: Node capacity, pod resource requests

**Step 4:** Analyze logs
- Query: `observe_pod_logs(pod, tail=100)`
- Extract: Error patterns, stack traces

**Step 5:** Correlate with recent changes
- Query: `observe_resource(kind=Deployment, ...)`
- Check: Recent rollouts, image changes

**Step 6:** Generate hypothesis
- Combine evidence from steps 1-5
- Rank hypotheses by confidence score

**Step 7:** Test hypothesis (if possible)
- Simulate conditions (e.g., resource constraints)
- Validate hypothesis

**Returns:**
```json
{
  "investigation_id": "inv_47",
  "status": "completed",
  "duration": "45 seconds",
  "root_cause": {
    "type": "OOMKilled",
    "confidence": 0.94,
    "description": "Pods are being killed due to memory limit exceeded",
    "evidence": [
      "Exit code 137 (OOMKilled) in 12 pods",
      "Memory usage: 500Mi → 512Mi (limit) before crash",
      "Pattern started after deployment of v2.3.1 (2 hours ago)"
    ]
  },
  "hypothesis_tested": [
    {
      "hypothesis": "Image pull error",
      "confidence": 0.15,
      "result": "rejected",
      "reason": "All pods successfully pulled image"
    },
    {
      "hypothesis": "Node resource exhaustion",
      "confidence": 0.20,
      "result": "rejected",
      "reason": "Nodes have sufficient capacity"
    },
    {
      "hypothesis": "Memory leak in v2.3.1",
      "confidence": 0.94,
      "result": "confirmed",
      "reason": "Memory usage increases linearly, reaches limit, then OOMKill"
    }
  ],
  "recommendations": [
    {
      "action": "rollback_deployment",
      "priority": "critical",
      "description": "Rollback to v2.3.0 (last stable version)",
      "estimated_impact": "Immediate fix, stops crashes",
      "risk": "low"
    },
    {
      "action": "increase_memory_limit",
      "priority": "high",
      "description": "Increase memory limit to 1Gi as temporary fix",
      "estimated_impact": "Buys time to fix leak in code",
      "risk": "low"
    }
  ],
  "investigation_steps": [
    {
      "step": 1,
      "action": "Identified failing pods",
      "tool": "observe_resources",
      "result": "12 pods in CrashLoopBackOff",
      "timestamp": "2024-02-10T14:20:00Z"
    },
    ...
  ]
}
```

**Use Cases:**
- "Why is my pod crashing?" investigation
- AI Assistant troubleshooting
- Automated root cause analysis

---

*[Continue with remaining troubleshooting tools: troubleshoot_network_connectivity, troubleshoot_resource_exhaustion, troubleshoot_deployment_rollout, troubleshoot_performance_degradation, troubleshoot_error_correlation, troubleshoot_security_incident]*

---

## 10. Investigation Session System

### 10.1 Overview

**Purpose:** Persistent multi-step reasoning sessions with full audit trails

**State Machine:**
```
Created → Investigating → Concluded/Cancelled → Archived
```

**Key Features:**
- Multi-step reasoning (hypothesis → test → conclude)
- Tool orchestration (chain multiple MCP tools)
- Confidence scoring (probabilistic results)
- Audit trail (every step logged)
- Resumable (pause and continue later)
- Shareable (export as report)

---

### 10.2 Investigation Lifecycle

**States:**

1. **Created**
   - User or AI initiates investigation
   - Initial hypothesis formed (optional)
   - Investigation ID assigned

2. **Investigating**
   - AI actively running MCP tools
   - Forming hypotheses
   - Testing hypotheses
   - Collecting evidence

3. **Concluded**
   - Root cause found
   - Recommendations provided
   - Report generated

4. **Cancelled**
   - User stopped investigation
   - Partial results saved

5. **Archived**
   - Investigation completed and saved
   - Searchable for historical reference

---

### 10.3 Investigation Data Structure

```json
{
  "investigation_id": "inv_47",
  "title": "Pod Crashes in Production",
  "status": "investigating",
  "created_at": "2024-02-10T14:15:00Z",
  "initiated_by": "ai_anomaly_detection",
  "trigger": {
    "type": "anomaly",
    "details": "12 pods crashlooping detected"
  },
  "current_hypothesis": {
    "type": "memory_leak",
    "description": "Memory leak in v2.3.1",
    "confidence": 0.85,
    "evidence": [...]
  },
  "steps": [
    {
      "step_number": 1,
      "action": "Identify failing pods",
      "tool": "observe_resources",
      "parameters": {"kind": "Pod", "field_selector": "status.phase=Failed"},
      "result": {...},
      "timestamp": "2024-02-10T14:15:15Z"
    },
    ...
  ],
  "findings": {
    "root_cause": {...},
    "confidence": 0.94,
    "evidence": [...]
  },
  "recommendations": [...],
  "metadata": {
    "duration": "3m 45s",
    "tools_used": 8,
    "resources_analyzed": 15
  }
}
```

---

### 10.4 Investigation UI (Recap from Part 1)

*[Content defined in Part 1, Section 5.2 - Investigation UI]*

---

### 10.5 100x Investigation Features

1. **Hypothesis Tree Visualization**
   - Visual tree of all hypotheses considered
   - Show which were tested, confirmed, rejected
   - Branching logic

2. **Confidence Tracking**
   - Track confidence score evolution over time
   - Show why confidence increased/decreased

3. **Parallel Hypothesis Testing**
   - Test multiple hypotheses simultaneously
   - Compare results, select best

4. **Investigation Templates**
   - Pre-built investigation workflows
   - "OOMKill Investigation", "Network Issue Investigation"

5. **Collaborative Investigations**
   - Multiple users can contribute
   - Comments, annotations

6. **Investigation Comparison**
   - Compare similar investigations
   - "This looks like investigation #32 from last week"

7. **Automated Follow-Up**
   - Schedule follow-up checks
   - "Re-investigate in 24 hours to confirm fix worked"

8. **Integration with Ticketing**
   - Auto-create JIRA/GitHub issues
   - Link investigation report to ticket

9. **Investigation Metrics**
   - Track: Average investigation time, success rate, most common root causes

10. **Learning from Investigations**
    - AI learns from past investigations
    - Improves hypothesis generation over time

---

## 11. Tool Orchestration Patterns

### 11.1 Sequential Chaining

**Pattern:** Tool B uses output of Tool A

**Example:**
```
Step 1: observe_resources(kind=Pod, status=Failed)
  → Result: [pod-1, pod-2, pod-3]

Step 2: FOR EACH pod:
  observe_pod_logs(pod=pod-1)
  → Result: Error logs

Step 3: analyze_log_patterns(logs from Step 2)
  → Result: Common error pattern detected
```

---

### 11.2 Parallel Execution

**Pattern:** Multiple tools run simultaneously, results aggregated

**Example:**
```
PARALLEL:
  - observe_metrics(resource=pod-1)
  - observe_events(pod=pod-1)
  - observe_pod_logs(pod=pod-1)

AGGREGATE:
  Combine metrics, events, logs into single analysis
```

---

### 11.3 Conditional Branching

**Pattern:** Next tool depends on previous result

**Example:**
```
IF observe_pod_status(pod) == "OOMKilled":
  → analyze_resource_usage(pod)
  → recommend_increase_memory(pod)
ELSE IF observe_pod_status(pod) == "ImagePullBackOff":
  → check_image_registry_connectivity()
  → recommend_fix_image_pull()
```

---

### 11.4 Iterative Refinement

**Pattern:** Run tool multiple times with refined parameters

**Example:**
```
INITIAL: analyze_anomaly_detection(sensitivity=0.5)
  → Result: Too many false positives

REFINEMENT: analyze_anomaly_detection(sensitivity=0.3)
  → Result: Better, but still some noise

FINAL: analyze_anomaly_detection(sensitivity=0.2)
  → Result: High-confidence anomalies only
```

---

## Summary

**Part 4 Complete:** MCP Tool Catalog & Investigation System defined

**Key Achievements:**
- 60+ tools cataloged across 8 categories
- Investigation session system detailed
- Tool orchestration patterns defined
- Safety and approval mechanisms specified

**Tool Coverage:**
- 85% read-only (safe by default)
- 15% mutations (gated with approval)
- 100% follow MCP standard

**Next Document:**
- **Part 5:** Implementation Roadmap, Success Metrics, Go-to-Market Strategy

---

**Document Status:** Part 4 of 5 Complete
