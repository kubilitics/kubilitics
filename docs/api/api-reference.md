# Kubilitics Complete API Reference

**Version:** 0.1.0
**Last Updated:** March 2026
**Status:** Production
**Backend Port:** 8190

## Table of Contents

1. [Authentication & Headers](#1-authentication--headers)
2. [Health & System Endpoints](#2-health--system-endpoints)
3. [Resource Management Endpoints](#3-resource-management-endpoints)
4. [Namespace & Context Endpoints](#4-namespace--context-endpoints)
5. [Pod Operations](#5-pod-operations)
6. [Events & Metrics Endpoints](#6-events--metrics-endpoints)
7. [Topology Endpoints](#7-topology-endpoints)
8. [WebSocket Endpoints](#8-websocket-endpoints)
9. [Error Codes](#9-error-codes)
10. [Rate Limiting Policy](#10-rate-limiting-policy)
11. [API Versioning Strategy](#11-api-versioning-strategy)

---

## 1. Authentication & Headers

All Kubilitics API endpoints require authentication via Bearer tokens or kubeconfig context selection. This section documents the authentication mechanisms, required headers, and context management.

### Bearer Token Authentication

Kubilitics supports JWT-based Bearer token authentication for programmatic access. Tokens are issued by the Kubilitics authentication service and must be included in the Authorization header of all requests.

**Header Format:**
```
Authorization: Bearer <jwt-token>
```

**Token Structure:**
JWT tokens contain the following claims:
- `sub` (subject): User ID or service account identifier
- `exp` (expiration): Token expiration time (Unix timestamp)
- `iat` (issued at): Token issuance time
- `scope`: Comma-separated list of granted permissions (read, write, admin)
- `cluster_id`: Associated Kubernetes cluster identifier
- `namespace`: Default namespace for the token bearer

**Token Lifetime:**
- Standard user tokens: 24 hours
- Service account tokens: 7 days
- Admin tokens: 90 days with automatic rotation requirement

**Token Revocation:**
Tokens can be revoked immediately by removing them from the token blacklist cache. Revocation is propagated across all Kubilitics instances within 30 seconds.

### Kubeconfig Context Selection

Kubilitics integrates with Kubernetes kubeconfig files for context-based authentication. Users can select a kubeconfig context via the `X-Kubeconfig-Context` header or through the API.

**Header Format:**
```
X-Kubeconfig-Context: <context-name>
```

**Context Validation:**
- Kubilitics validates the selected context against the kubeconfig file
- RBAC permissions from the kubeconfig's associated user/role apply
- Context can be overridden per-request or set as default in user preferences
- Invalid contexts return 401 Unauthorized with context validation error

### Required Headers

All API requests must include the following headers:

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | Bearer token in format `Bearer <token>` |
| `X-Kubeconfig-Context` | No | Kubernetes context name; uses default if omitted |
| `X-Request-ID` | No | Unique request identifier for tracing (auto-generated if omitted) |
| `Content-Type` | Conditional | `application/json` for POST/PUT requests |
| `Accept` | No | `application/json` (default) or `text/event-stream` for SSE |
| `User-Agent` | No | Client identifier (recommended for debugging) |

**Example Request with Headers:**
```
GET /api/v1/namespaces HTTP/1.1
Host: kubilitics.local:8190
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Kubeconfig-Context: prod-cluster
X-Request-ID: req-20260210-a1b2c3d4
Accept: application/json
User-Agent: Kubilitics-CLI/1.0.0
```

---

## 2. Health & System Endpoints

### GET /health

**Description:**
Returns the health status of the Kubilitics backend service and its dependencies. Used by load balancers, health checks, and monitoring systems.

**Request Parameters:**
None

**Response Schema (Success - 200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-10T14:23:45Z",
  "version": "1.0.0",
  "build": "ubuntu-x64",
  "uptime_seconds": 3600,
  "dependencies": {
    "kubernetes_api": "healthy",
    "database": "healthy",
    "ai_service": "healthy",
    "redis_cache": "healthy"
  },
  "region": "us-west-2",
  "cluster_info": {
    "name": "prod-us-west-2",
    "nodes": 47,
    "version": "1.28.3"
  }
}
```

**Response Schema (Degraded - 503 Service Unavailable):**
```json
{
  "status": "degraded",
  "timestamp": "2026-02-10T14:23:45Z",
  "version": "1.0.0",
  "dependencies": {
    "kubernetes_api": "unhealthy",
    "database": "healthy",
    "ai_service": "healthy",
    "redis_cache": "unhealthy"
  },
  "error": "Critical dependencies unavailable",
  "retry_after_seconds": 30
}
```

**Authentication:** None (publicly accessible)

**Rate Limiting:** No rate limit (health checks are not throttled)

**Use Cases:**
- Kubernetes liveness probe for container orchestration
- Load balancer health verification
- Monitoring system status checks
- Application startup verification

---

### GET /api/v1/version

**Description:**
Returns detailed version information about the Kubilitics backend and all integrated components.

**Request Parameters:**
None

**Response Schema (Success - 200 OK):**
```json
{
  "backend": {
    "version": "1.0.0",
    "build_commit": "abc123def456",
    "build_date": "2026-02-08T10:00:00Z",
    "golang_version": "1.24",
    "architecture": "amd64"
  },
  "frontend": {
    "version": "1.0.0",
    "react_version": "18.2.0",
    "build_hash": "xyz789"
  },
  "ai_service": {
    "version": "1.0.0",
    "build_commit": "ghi789jkl012",
    "go_version": "1.24"
  },
  "kubernetes": {
    "api_version": "1.28.3",
    "cluster_name": "prod-us-west-2"
  },
  "database": {
    "type": "postgresql",
    "migration_version": 45
  },
  "helm_chart": {
    "name": "kubilitics",
    "version": "1.0.0",
    "repository": "https://charts.kubilitics.com"
  }
}
```

**Response Schema (Error - 500 Internal Server Error):**
```json
{
  "error": "version_query_failed",
  "message": "Failed to retrieve AI service version",
  "details": {
    "component": "ai_service",
    "reason": "connection_timeout"
  }
}
```

**Authentication:** Required (Bearer token)

**Rate Limiting:** 100 requests/minute per user

**Use Cases:**
- Version compatibility verification before API calls
- Debug information gathering
- Automated deployment verification
- Monitoring component versions

---

## 3. Resource Management Endpoints

### GET /api/v1/resources/{kind}

**Description:**
Retrieves all Kubernetes resources of a specified kind across all namespaces. Returns paginated results with filtering and sorting options.

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `kind` | string (path) | Yes | Kubernetes resource kind (Pod, Deployment, Service, etc.) |
| `namespace` | string (query) | No | Filter to specific namespace; omit for all |
| `label_selector` | string (query) | No | Label selector (e.g., `app=myapp,tier=frontend`) |
| `field_selector` | string (query) | No | Field selector (e.g., `status.phase=Running`) |
| `limit` | integer (query) | No | Max results per page (default: 50, max: 500) |
| `offset` | integer (query) | No | Pagination offset (default: 0) |
| `sort_by` | string (query) | No | Sort field (name, created, age) |
| `sort_order` | string (query) | No | asc or desc (default: asc) |

**Response Schema (Success - 200 OK):**
```json
{
  "kind": "Pod",
  "api_version": "v1",
  "total_count": 847,
  "page": {
    "limit": 50,
    "offset": 0,
    "returned": 50,
    "has_more": true
  },
  "items": [
    {
      "metadata": {
        "name": "nginx-deployment-5d59d67564-abcde",
        "namespace": "default",
        "uid": "550e8400-e29b-41d4-a716-446655440000",
        "creation_timestamp": "2026-02-08T10:00:00Z",
        "labels": {
          "app": "nginx",
          "version": "1.0"
        },
        "annotations": {
          "description": "Production nginx instance"
        }
      },
      "spec": {
        "containers": [
          {
            "name": "nginx",
            "image": "nginx:1.24",
            "ports": [{"container_port": 80}]
          }
        ]
      },
      "status": {
        "phase": "Running",
        "conditions": [
          {
            "type": "Ready",
            "status": "True",
            "last_probe_time": "2026-02-10T14:23:00Z",
            "last_transition_time": "2026-02-08T10:15:00Z"
          }
        ]
      }
    }
  ]
}
```

**Response Schema (Error - 400 Bad Request):**
```json
{
  "error": "invalid_kind",
  "message": "Unknown Kubernetes kind: InvalidKind",
  "valid_kinds": ["Pod", "Deployment", "Service", "ConfigMap", "Secret", "...]
}
```

**Authentication:** Required (Bearer token with read scope)

**Rate Limiting:** 200 requests/minute per user; 500 requests/minute for read-only service accounts

**Use Cases:**
- List all pods in a namespace for monitoring dashboards
- Search resources by labels for troubleshooting
- Export resource inventory for compliance auditing
- Bulk resource operations

---

### POST /api/v1/resources/{kind}

**Description:**
Creates a new Kubernetes resource of the specified kind. Validates resource specification against Kubernetes OpenAPI schema.

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `kind` | string (path) | Yes | Kubernetes resource kind |
| `validate_only` | boolean (query) | No | Validate without creating (default: false) |

**Request Body Schema:**
```json
{
  "apiVersion": "v1",
  "kind": "Pod",
  "metadata": {
    "name": "my-pod",
    "namespace": "default",
    "labels": {
      "app": "myapp"
    }
  },
  "spec": {
    "containers": [
      {
        "name": "main",
        "image": "myapp:1.0",
        "ports": [
          {
            "containerPort": 8080,
            "name": "http"
          }
        ]
      }
    ]
  }
}
```

**Response Schema (Success - 201 Created):**
```json
{
  "kind": "Pod",
  "apiVersion": "v1",
  "metadata": {
    "name": "my-pod",
    "namespace": "default",
    "uid": "550e8400-e29b-41d4-a716-446655440001",
    "creation_timestamp": "2026-02-10T14:23:45Z"
  },
  "status": {
    "phase": "Pending",
    "conditions": []
  }
}
```

**Response Schema (Error - 400 Bad Request):**
```json
{
  "error": "validation_failed",
  "message": "Resource validation failed",
  "violations": [
    {
      "field": "spec.containers[0].resources.limits.memory",
      "reason": "must be >= requests.memory",
      "message": "Memory limit cannot be less than memory request"
    },
    {
      "field": "metadata.name",
      "reason": "invalid_dns1123",
      "message": "Name must be a valid DNS-1123 subdomain"
    }
  ]
}
```

**Authentication:** Required (Bearer token with write scope)

**Rate Limiting:** 50 requests/minute per user

**Use Cases:**
- Create deployments via API
- Provision workloads from CI/CD pipelines
- Generate resources from templates
- Implement infrastructure-as-code automation

---

### PUT /api/v1/resources/{kind}/{namespace}/{name}

**Description:**
Updates an existing Kubernetes resource. Supports both full replacement and strategic merge patch operations.

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `kind` | string (path) | Yes | Kubernetes resource kind |
| `namespace` | string (path) | Yes | Resource namespace |
| `name` | string (path) | Yes | Resource name |
| `patch_strategy` | string (query) | No | replace (default) or merge_patch or strategic_merge_patch |

**Request Body Schema (replace):**
```json
{
  "apiVersion": "v1",
  "kind": "ConfigMap",
  "metadata": {
    "name": "app-config",
    "namespace": "default"
  },
  "data": {
    "key1": "value1",
    "key2": "value2"
  }
}
```

**Response Schema (Success - 200 OK):**
```json
{
  "kind": "ConfigMap",
  "apiVersion": "v1",
  "metadata": {
    "name": "app-config",
    "namespace": "default",
    "generation": 2,
    "generation_observed_by_controller": 2
  },
  "data": {
    "key1": "value1",
    "key2": "value2"
  }
}
```

**Authentication:** Required (Bearer token with write scope)

**Rate Limiting:** 50 requests/minute per user

**Use Cases:**
- Update deployment replicas
- Modify configuration maps
- Patch secrets
- Scale workloads

---

### DELETE /api/v1/resources/{kind}/{namespace}/{name}

**Description:**
Deletes a Kubernetes resource. Supports graceful termination with optional immediate deletion.

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `kind` | string (path) | Yes | Kubernetes resource kind |
| `namespace` | string (path) | Yes | Resource namespace |
| `name` | string (path) | Yes | Resource name |
| `grace_period_seconds` | integer (query) | No | Grace period for termination (default: 30) |
| `force` | boolean (query) | No | Force immediate deletion (default: false) |

**Response Schema (Success - 200 OK):**
```json
{
  "kind": "Pod",
  "apiVersion": "v1",
  "metadata": {
    "name": "my-pod",
    "namespace": "default",
    "deletion_timestamp": "2026-02-10T14:23:45Z",
    "deletion_grace_period_seconds": 30
  },
  "status": {
    "phase": "Terminating"
  }
}
```

**Response Schema (Error - 404 Not Found):**
```json
{
  "error": "not_found",
  "message": "Pod default/my-pod not found",
  "resource_kind": "Pod"
}
```

**Authentication:** Required (Bearer token with delete scope)

**Rate Limiting:** 50 requests/minute per user

**Use Cases:**
- Clean up failed resources
- Terminate workloads
- Resource lifecycle management
- Automated cleanup scripts

---

## 4. Namespace & Context Endpoints

### GET /api/v1/namespaces

**Description:**
Lists all Kubernetes namespaces accessible to the current user/context. Returns namespace metadata and status.

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer (query) | No | Max results (default: 100) |
| `offset` | integer (query) | No | Pagination offset (default: 0) |
| `include_system` | boolean (query) | No | Include system namespaces (default: false) |

**Response Schema (Success - 200 OK):**
```json
{
  "total_count": 12,
  "items": [
    {
      "name": "default",
      "status": "Active",
      "creation_timestamp": "2026-01-01T00:00:00Z",
      "pod_count": 23,
      "resource_quota_status": {
        "hard": {
          "pods": "100",
          "memory": "1000Gi"
        },
        "used": {
          "pods": "23",
          "memory": "245Gi"
        }
      }
    },
    {
      "name": "kube-system",
      "status": "Active",
      "creation_timestamp": "2026-01-01T00:00:00Z",
      "pod_count": 15
    }
  ]
}
```

**Authentication:** Required (Bearer token with read scope)

**Rate Limiting:** 200 requests/minute per user

**Use Cases:**
- Initialize dashboard namespace filters
- List available deployment targets
- Check namespace quota usage
- Implement namespace-aware RBAC

---

### GET /api/v1/contexts

**Description:**
Lists all available kubeconfig contexts that the user can switch between. Returns context metadata and cluster information.

**Request Parameters:**
None

**Response Schema (Success - 200 OK):**
```json
{
  "current_context": "prod-us-west-2",
  "contexts": [
    {
      "name": "prod-us-west-2",
      "cluster": {
        "name": "prod-us-west-2",
        "server": "https://api.prod-us-west-2.k8s.example.com:6443",
        "certificate_authority": "/path/to/ca.crt",
        "is_insecure": false
      },
      "user": {
        "name": "prod-admin",
        "client_certificate": "/path/to/client.crt"
      },
      "namespace": "default",
      "is_reachable": true,
      "kubernetes_version": "1.28.3"
    },
    {
      "name": "staging-eu-west-1",
      "cluster": {
        "name": "staging-eu-west-1",
        "server": "https://api.staging-eu-west-1.k8s.example.com:6443"
      },
      "user": {
        "name": "staging-admin"
      },
      "namespace": "default",
      "is_reachable": false,
      "error": "connection_timeout"
    }
  ]
}
```

**Authentication:** Required (Bearer token)

**Rate Limiting:** 100 requests/minute per user

**Use Cases:**
- Context switcher UI in dashboard
- Multi-cluster management
- Cluster health verification

---

## 5. Pod Operations

### GET /api/v1/pods/{namespace}/{name}/logs

**Description:**
Retrieves logs from a pod container. Supports log streaming, filtering, and search.

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string (path) | Yes | Pod namespace |
| `name` | string (path) | Yes | Pod name |
| `container` | string (query) | No | Container name (required for multi-container pods) |
| `follow` | boolean (query) | No | Stream logs in real-time (WebSocket preferred) |
| `tail_lines` | integer (query) | No | Last N lines (default: 100, max: 10000) |
| `timestamps` | boolean (query) | No | Include log timestamps (default: true) |
| `since_time` | string (query) | No | RFC3339 timestamp; logs after this time |
| `until_time` | string (query) | No | RFC3339 timestamp; logs until this time |
| `search` | string (query) | No | Search logs for substring (case-insensitive) |

**Response Schema (Success - 200 OK):**
```
2026-02-10T14:23:45.123Z [INFO] Starting application
2026-02-10T14:23:46.456Z [INFO] Database connection established
2026-02-10T14:23:47.789Z [WARN] Cache miss for key: user:123
2026-02-10T14:23:48.012Z [ERROR] Failed to fetch external service
2026-02-10T14:23:49.345Z [INFO] Retrying in 5 seconds
```

**Response Schema (Error - 404 Not Found):**
```json
{
  "error": "pod_not_found",
  "message": "Pod default/my-pod not found",
  "namespace": "default",
  "pod_name": "my-pod"
}
```

**Authentication:** Required (Bearer token with read scope)

**Rate Limiting:** 100 requests/minute per user (log follows bypass normal limits)

**Use Cases:**
- Real-time log viewing in dashboard
- Log search and analysis
- Troubleshooting application errors
- CI/CD pipeline log collection

---

### POST /api/v1/pods/{namespace}/{name}/exec

**Description:**
Executes a command inside a running pod container. Returns command output and exit code. For interactive sessions, use WebSocket endpoint instead.

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string (path) | Yes | Pod namespace |
| `name` | string (path) | Yes | Pod name |
| `container` | string (query) | No | Container name (required for multi-container pods) |
| `timeout_seconds` | integer (query) | No | Command timeout (default: 30, max: 300) |

**Request Body Schema:**
```json
{
  "command": ["sh", "-c", "curl http://localhost:8190/health"],
  "working_dir": "/app",
  "environment": {
    "DEBUG": "true"
  }
}
```

**Response Schema (Success - 200 OK):**
```json
{
  "exit_code": 0,
  "stdout": "HTTP/1.1 200 OK\nContent-Type: application/json\n{\"status\":\"healthy\"}",
  "stderr": "",
  "execution_time_ms": 245,
  "pod": "my-pod",
  "container": "app"
}
```

**Response Schema (Error - 500 Internal Server Error):**
```json
{
  "error": "exec_failed",
  "message": "Command execution failed",
  "exit_code": 127,
  "stdout": "",
  "stderr": "sh: curl: not found",
  "pod": "my-pod",
  "container": "app"
}
```

**Authentication:** Required (Bearer token with exec scope)

**Rate Limiting:** 50 requests/minute per user; commands are serialized per pod

**Use Cases:**
- Health checks and diagnostics
- Configuration verification
- Debugging without SSH
- Automated remediation scripts

---

## 6. Events & Metrics Endpoints

### GET /api/v1/events

**Description:**
Retrieves Kubernetes cluster events. Returns events from all namespaces filtered by time range and resource type.

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string (query) | No | Filter to specific namespace |
| `resource_kind` | string (query) | No | Filter by resource kind (Pod, Deployment, etc.) |
| `resource_name` | string (query) | No | Filter by resource name |
| `event_type` | string (query) | No | Normal, Warning, Error |
| `since_time` | string (query) | No | RFC3339 timestamp (default: 1 hour ago) |
| `until_time` | string (query) | No | RFC3339 timestamp (default: now) |
| `limit` | integer (query) | No | Max results (default: 100, max: 1000) |
| `sort_order` | string (query) | No | asc or desc (default: desc) |

**Response Schema (Success - 200 OK):**
```json
{
  "total_count": 47,
  "items": [
    {
      "type": "Warning",
      "reason": "BackOff",
      "message": "Back-off restarting failed container",
      "involved_object": {
        "kind": "Pod",
        "namespace": "default",
        "name": "crash-loop-pod-abc123",
        "uid": "550e8400-e29b-41d4-a716-446655440002"
      },
      "first_timestamp": "2026-02-10T13:00:00Z",
      "last_timestamp": "2026-02-10T14:23:45Z",
      "count": 12,
      "source": {
        "component": "kubelet",
        "host": "node-1"
      }
    },
    {
      "type": "Normal",
      "reason": "Scheduled",
      "message": "Successfully assigned pod to node-2",
      "involved_object": {
        "kind": "Pod",
        "namespace": "default",
        "name": "healthy-pod-xyz789"
      },
      "timestamp": "2026-02-10T14:20:00Z",
      "source": {
        "component": "default-scheduler"
      }
    }
  ]
}
```

**Authentication:** Required (Bearer token with read scope)

**Rate Limiting:** 200 requests/minute per user

**Use Cases:**
- Event timeline dashboard
- Alert triggering based on Kubernetes events
- Troubleshooting resource failures
- Audit trail for cluster changes

---

### GET /api/v1/metrics/nodes

**Description:**
Retrieves current resource metrics for all cluster nodes. Requires Kubernetes metrics-server to be installed.

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `node_name` | string (query) | No | Filter to specific node |
| `sort_by` | string (query) | No | cpu_usage, memory_usage, network (default: name) |

**Response Schema (Success - 200 OK):**
```json
{
  "timestamp": "2026-02-10T14:23:45Z",
  "nodes": [
    {
      "name": "node-1",
      "cpu": {
        "usage_cores": "2.345",
        "allocatable_cores": "8",
        "percent": 29.3,
        "throttling_detected": false
      },
      "memory": {
        "usage_bytes": "5368709120",
        "allocatable_bytes": "15728640000",
        "percent": 34.1
      },
      "network": {
        "rx_bytes": "1099511627776",
        "tx_bytes": "274877906944",
        "rx_errors": 0,
        "tx_errors": 0
      },
      "disk": {
        "usage_bytes": "52428800000",
        "allocatable_bytes": "107374182400",
        "percent": 48.8
      },
      "status": "Ready",
      "pod_count": 23
    }
  ]
}
```

**Authentication:** Required (Bearer token with read scope)

**Rate Limiting:** 100 requests/minute per user

**Use Cases:**
- Node resource dashboard
- Capacity planning analysis
- Cluster utilization reporting
- Performance baseline establishment

---

### GET /api/v1/metrics/pods

**Description:**
Retrieves current resource metrics for pods. Requires metrics-server.

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string (query) | No | Filter to specific namespace |
| `pod_name` | string (query) | No | Filter to specific pod |
| `sort_by` | string (query) | No | cpu_usage, memory_usage (default: name) |
| `limit` | integer (query) | No | Max results (default: 100, max: 1000) |

**Response Schema (Success - 200 OK):**
```json
{
  "timestamp": "2026-02-10T14:23:45Z",
  "pods": [
    {
      "namespace": "default",
      "name": "nginx-deployment-5d59d67564-abcde",
      "containers": [
        {
          "name": "nginx",
          "cpu": {
            "usage_cores": "0.125",
            "requests": "0.1",
            "limits": "0.5",
            "percent_of_request": 125,
            "percent_of_limit": 25
          },
          "memory": {
            "usage_bytes": "33554432",
            "requests": "32000000",
            "limits": "64000000",
            "percent_of_request": 104,
            "percent_of_limit": 52
          }
        }
      ]
    }
  ]
}
```

**Authentication:** Required (Bearer token with read scope)

**Rate Limiting:** 100 requests/minute per user

**Use Cases:**
- Pod performance monitoring
- Right-sizing recommendations
- Cost allocation
- Performance troubleshooting

---

## 7. Topology Endpoints

### GET /api/v1/topology

**Description:**
Returns the complete cluster topology including nodes, namespaces, workloads, and relationships. This is a comprehensive endpoint for visualization and analysis.

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `depth` | integer (query) | No | Traversal depth (1-5, default: 3) |
| `include_metrics` | boolean (query) | No | Include resource metrics (default: true) |
| `include_events` | boolean (query) | No | Include recent events (default: false) |
| `namespace` | string (query) | No | Limit to specific namespace |

**Response Schema (Success - 200 OK):**
```json
{
  "cluster": {
    "name": "prod-us-west-2",
    "version": "1.28.3",
    "total_nodes": 47,
    "total_pods": 847,
    "total_services": 234
  },
  "nodes": [
    {
      "name": "node-1",
      "role": "worker",
      "status": "Ready",
      "cpu_available_cores": "8",
      "memory_available_bytes": "15728640000",
      "pod_count": 23,
      "pods": [
        {
          "namespace": "default",
          "name": "nginx-deployment-5d59d67564-abcde",
          "status": "Running"
        }
      ],
      "taints": [
        {
          "key": "workload",
          "value": "gpu",
          "effect": "NoSchedule"
        }
      ]
    }
  ],
  "namespaces": [
    {
      "name": "default",
      "pod_count": 100,
      "resource_quota_enforced": true,
      "workloads": {
        "deployments": 15,
        "statefulsets": 3,
        "daemonsets": 2,
        "jobs": 5,
        "cronjobs": 2
      }
    }
  ],
  "network_policies": {
    "total": 12,
    "by_namespace": {
      "default": 5,
      "kube-system": 2
    }
  }
}
```

**Authentication:** Required (Bearer token with read scope)

**Rate Limiting:** 50 requests/minute per user (computationally expensive)

**Use Cases:**
- Cluster visualization dashboards
- Capacity planning and trend analysis
- Multi-cluster comparison
- Topology-based troubleshooting

---

## 8. WebSocket Endpoints

### WebSocket /api/v1/ws

**Description:**
Establishes a WebSocket connection for real-time updates on Kubernetes resources. Clients can subscribe to specific resources or namespaces and receive updates as they occur.

**Connection Protocol:**
1. Upgrade HTTP connection to WebSocket via standard upgrade headers
2. Authenticate with Bearer token in query parameter: `ws://host:8190/api/v1/ws?token=<jwt>`
3. Send subscription message to specify resources of interest
4. Receive update messages as resources change

**Subscribe Message Format:**
```json
{
  "action": "subscribe",
  "resource_kind": "Pod",
  "namespace": "default",
  "label_selector": "app=myapp",
  "subscription_id": "sub-123"
}
```

**Unsubscribe Message Format:**
```json
{
  "action": "unsubscribe",
  "subscription_id": "sub-123"
}
```

**Update Message Format:**
```json
{
  "type": "ADDED",
  "subscription_id": "sub-123",
  "resource": {
    "kind": "Pod",
    "apiVersion": "v1",
    "metadata": {
      "name": "new-pod-abc123",
      "namespace": "default",
      "uid": "550e8400-e29b-41d4-a716-446655440003"
    },
    "status": {
      "phase": "Pending"
    }
  },
  "timestamp": "2026-02-10T14:23:45.123Z"
}
```

**Event Types:**
- `ADDED`: New resource created
- `MODIFIED`: Existing resource updated
- `DELETED`: Resource deleted
- `ERROR`: Subscription error

**Authentication:** Required (Bearer token in query parameter or Authorization header)

**Keep-Alive:** Server sends ping every 30 seconds; client must respond with pong

**Use Cases:**
- Real-time dashboard updates
- Live log streaming
- Event-driven automation
- Monitoring and alerting systems

---

### WebSocket /api/v1/shell

**Description:**
Establishes an interactive terminal session inside a pod container. Supports stdin/stdout/stderr multiplexing for interactive command execution.

**Connection Protocol:**
1. Upgrade to WebSocket with authentication
2. Send shell initialization message with pod/container info
3. Send input messages (stdin)
4. Receive output messages (stdout/stderr)
5. Connection maintains until explicitly closed or pod terminates

**Shell Init Message:**
```json
{
  "action": "init",
  "namespace": "default",
  "pod_name": "debug-pod",
  "container": "app",
  "shell": "/bin/bash",
  "rows": 24,
  "cols": 80
}
```

**Input Message Format (stdin):**
```json
{
  "type": "input",
  "data": "ls -la\n"
}
```

**Output Message Format (stdout/stderr):**
```json
{
  "type": "output",
  "channel": "stdout",
  "data": "total 12\ndrwxr-xr-x  2 root root 4096 Feb 10 14:20 .\ndrwxr-xr-x  3 root root 4096 Feb 10 14:20 ..\n-rw-r--r--  1 root root  123 Feb 10 14:20 config.yaml"
}
```

**Resize Message (terminal dimensions):**
```json
{
  "type": "resize",
  "rows": 30,
  "cols": 120
}
```

**Exit Message:**
```json
{
  "type": "exit",
  "exit_code": 0
}
```

**Authentication:** Required (Bearer token)

**Rate Limiting:** No rate limit on open connections; max 10 concurrent shells per user

**Use Cases:**
- Interactive debugging and troubleshooting
- Administrative tasks inside containers
- Log inspection and file manipulation
- Emergency remediation

---

## 9. Error Codes

Kubilitics uses standardized error codes across all API endpoints. Errors include a machine-readable code, human-readable message, and additional context.

### Error Response Format

```json
{
  "error": "error_code",
  "message": "Human-readable error description",
  "details": {
    "field": "specific_context"
  },
  "timestamp": "2026-02-10T14:23:45Z",
  "trace_id": "trace-abc123"
}
```

### Authentication & Authorization Errors

| Code | HTTP | Description |
|------|------|-------------|
| `unauthorized` | 401 | Missing or invalid Bearer token |
| `token_expired` | 401 | JWT token has expired |
| `invalid_context` | 401 | Kubeconfig context not found or invalid |
| `forbidden` | 403 | User lacks required permissions |
| `token_revoked` | 401 | Token has been revoked |
| `insufficient_scope` | 403 | Token does not include required scope |

### Resource Errors

| Code | HTTP | Description |
|------|------|-------------|
| `not_found` | 404 | Resource does not exist |
| `already_exists` | 409 | Resource already exists |
| `resource_conflict` | 409 | Resource state conflict (optimistic locking) |
| `invalid_resource_kind` | 400 | Unknown Kubernetes resource kind |
| `resource_in_use` | 409 | Cannot delete resource in use by other resources |
| `resource_terminating` | 409 | Resource is currently terminating |

### Validation Errors

| Code | HTTP | Description |
|------|------|-------------|
| `validation_failed` | 400 | Request validation failed (schema, format) |
| `invalid_parameter` | 400 | Invalid query or path parameter |
| `missing_required_field` | 400 | Required field missing from request body |
| `invalid_label_selector` | 400 | Malformed label selector syntax |
| `invalid_field_selector` | 400 | Malformed field selector syntax |

### Rate Limit Errors

| Code | HTTP | Description |
|------|------|-------------|
| `rate_limit_exceeded` | 429 | Request rate limit exceeded |
| `quota_exceeded` | 429 | User quota exceeded |
| `too_many_requests` | 429 | Server temporarily overloaded |

### Server Errors

| Code | HTTP | Description |
|------|------|-------------|
| `internal_server_error` | 500 | Unexpected server error |
| `service_unavailable` | 503 | Service temporarily unavailable |
| `database_error` | 500 | Database connection or query error |
| `kubernetes_api_error` | 502 | Kubernetes API server error |
| `ai_service_unavailable` | 503 | AI service not responding |

### AI Service Errors

| Code | HTTP | Description |
|------|------|-------------|
| `investigation_failed` | 500 | Investigation execution failed |
| `llm_api_error` | 502 | LLM provider API error |
| `token_budget_exhausted` | 429 | Monthly token budget exhausted |
| `vector_store_error` | 500 | Vector database error |
| `action_expired` | 410 | Proposed action approval window expired |

---

## 10. Rate Limiting Policy

Kubilitics implements tiered rate limiting to ensure fair resource distribution and prevent abuse.

### Standard Limits

**Per-User Limits (authenticated endpoints):**
- Read operations: 200 requests/minute
- Write operations: 50 requests/minute
- Log streaming: 100 concurrent connections
- Investigation operations: 20 investigations/minute, 5 concurrent max
- Chat sessions: 50 messages/minute, 10 concurrent sessions

**Per-Token Limits (service accounts):**
- Service tokens have 5x higher limits than user tokens
- Admin tokens have 10x higher limits

### Rate Limit Headers

```
X-RateLimit-Limit: 200
X-RateLimit-Remaining: 187
X-RateLimit-Reset: 1644514625
X-RateLimit-Reset-After: 45
```

### Retry Strategy

When rate limited (429 response):
1. Client should wait at least `X-RateLimit-Reset-After` seconds
2. Implement exponential backoff with jitter: `wait_time = min(300, 2^retry_count) + random(0, 1)`
3. Maximum 3 automatic retries recommended
4. Respect `Retry-After` header if present

### Burst Allowance

Each user receives a burst allowance of 20 additional requests per minute for immediate use, refreshed every 60 seconds. This allows for legitimate traffic spikes without rate limiting.

---

## 11. API Versioning Strategy

Kubilitics follows semantic versioning for API stability and evolution.

### Current API Version

**Version:** 1.0.0 (v1)
**Endpoint Prefix:** `/api/v1/`
**Status:** Stable (backward compatible)

### Version Support Policy

- Current version (v1): Full support, all features, bug fixes and security patches
- Previous version (v0): Limited support, critical security fixes only (6-month window)
- Deprecated versions: No support, EOL after deprecation period

### Backward Compatibility Guarantees

Within a major version (v1.x.x):
- Existing endpoints are never removed
- Request/response fields are never removed
- New endpoints may be added
- New response fields are always optional
- New request parameters are always optional with sensible defaults

### Breaking Changes

Breaking changes introduce a new major version (v2, v3, etc.). Migration period is minimum 12 months with both versions supported concurrently.

### Version Negotiation

Clients can explicitly request API version via:
1. Endpoint path (preferred): `/api/v1/resources`
2. Header: `X-API-Version: 1.0.0`

If not specified, latest stable version is used.

### Deprecation Timeline

1. **Announcement**: Documented in release notes
2. **Deprecation Period**: 6 months of concurrent support
3. **Sunset**: Old version returned errors with migration guide
4. **EOL**: Version completely removed

---

## Appendix: Example Workflows

### Workflow 1: Troubleshooting a Pod Crash

1. `GET /api/v1/pods/{namespace}/{name}/logs` - View pod logs
2. `GET /api/v1/events` - Check cluster events
3. `POST /api/v1/ai/investigate` - Initiate AI investigation
4. `GET /api/v1/ai/investigations` - Check investigation results
5. `GET /api/v1/ai/actions/pending` - Review recommended actions
6. `POST /api/v1/ai/actions/{id}/approve` - Approve remediation

### Workflow 2: Scaling a Deployment

1. `GET /api/v1/metrics/pods?namespace=default` - Check current load
2. `PUT /api/v1/resources/Deployment/default/nginx` - Update replica count
3. `WebSocket /api/v1/ws` - Subscribe to pod updates and monitor scaling
4. `GET /api/v1/metrics/pods` - Verify metrics after scaling

### Workflow 3: Real-time Cluster Monitoring

1. `WebSocket /api/v1/ws` - Subscribe to Pod, Deployment, Event resources
2. `GET /api/v1/topology` - Get cluster snapshot
3. `GET /api/v1/metrics/nodes` - Monitor node health
4. `GET /api/v1/ai/insights` - Get proactive recommendations

