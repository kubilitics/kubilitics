# Kubilitics — System Architecture

## Architecture Philosophy

Kubilitics is designed around a **thin-client / thick-backend** model. Every interface (desktop, web, CLI) is a rendering and interaction layer only. All Kubernetes interaction, topology computation, metrics aggregation, and AI reasoning happens in the backend services. This means:

- One place to update business logic
- One source of truth for cluster state
- All interfaces benefit from every backend improvement simultaneously
- No Kubernetes API calls from the browser or mobile app (eliminates CORS, credential exposure, and auth complexity)

---

## System Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                         KUBILITICS SYSTEM                            │
│                                                                      │
│  CLIENT LAYER                                                        │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐                   │
│  │  Desktop   │  │  Web App   │  │   kcli CLI   │                   │
│  │ Tauri/Rust │  │  Browser   │  │  Go binary   │                   │
│  └─────┬──────┘  └─────┬──────┘  └──────┬───────┘                   │
│        │               │                  │                           │
│        └───────────────┴──────────────────┘                           │
│                                │                                      │
│                    REST/JSON + WebSocket                              │
│                                │                                      │
│  BACKEND LAYER                 │                                      │
│  ┌─────────────────────────────▼──────────────────────────────────┐  │
│  │                   kubilitics-backend  :8190                     │  │
│  │                                                                  │  │
│  │  ┌──────────────────────────────────────────────────────────┐   │  │
│  │  │  Middleware Stack                                          │   │  │
│  │  │  OTel Tracing → Body Limit → CORS → Secure Headers →     │   │  │
│  │  │  Request ID → Rate Limit → Auth (JWT/APIKey) →           │   │  │
│  │  │  Logging → Audit → Panic Recovery                        │   │  │
│  │  └──────────────────────────────────────────────────────────┘   │  │
│  │                                                                  │  │
│  │  ┌───────────┐  ┌───────────┐  ┌──────────┐  ┌─────────────┐  │  │
│  │  │ Cluster   │  │ Topology  │  │ Metrics  │  │   Projects  │  │  │
│  │  │ Service   │  │ Service   │  │ Service  │  │   Service   │  │  │
│  │  └───────────┘  └───────────┘  └──────────┘  └─────────────┘  │  │
│  │  ┌───────────┐  ┌───────────┐  ┌──────────┐  ┌─────────────┐  │  │
│  │  │  Logs     │  │  Events   │  │   Cost   │  │    Auth     │  │  │
│  │  │  Service  │  │  Service  │  │  Service │  │   Service   │  │  │
│  │  └───────────┘  └───────────┘  └──────────┘  └─────────────┘  │  │
│  │                                                                  │  │
│  │  ┌──────────────────────────────────────────────────────────┐   │  │
│  │  │  Repository Layer (SQLite / PostgreSQL)                   │   │  │
│  │  └──────────────────────────────────────────────────────────┘   │  │
│  │                                                                  │  │
│  │  ┌──────────────────────────────────────────────────────────┐   │  │
│  │  │  K8s Client Pool  (client-go, per-cluster)               │   │  │
│  │  └────────────────────────────┬─────────────────────────────┘   │  │
│  └───────────────────────────────┼──────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────┼───────────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
   ┌──────────▼──────┐  ┌──────────▼──────┐  ┌──────────▼──────┐
   │  Cluster 1       │  │  Cluster 2       │  │  Cluster N       │
   │  (EKS)           │  │  (k3s)           │  │  (GKE)           │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## Backend Internal Architecture

### Service Layer

Each service encapsulates a distinct domain. Services do not call each other's HTTP APIs — they communicate through shared Go interfaces, enabling easy testing and composition.

```
kubilitics-backend/internal/service/
├── cluster_service.go        # Cluster registry, client pool, provider detection
├── topology_service.go       # Graph building, caching, export
├── logs_service.go           # Pod log streaming
├── events_service.go         # Kubernetes event aggregation
├── metrics_service.go        # metrics-server integration
├── unified_metrics_service.go # Advanced metric aggregation
├── cost_service.go           # Compute cost calculation
├── project_service.go        # Project/workspace management
├── export_service.go         # Topology export (PNG/SVG)
├── overview_cache.go         # Per-cluster informer cache manager
└── auth_service.go           # JWT, OIDC, SAML, MFA
```

### API Handler Layer

```
kubilitics-backend/internal/api/rest/
├── handler.go                # Handler struct and constructor
├── cluster_handler.go        # /clusters/* routes
├── resource_handler.go       # /resources/* routes (generic)
├── topology_handler.go       # /topology/* routes
├── metrics_handler.go        # /metrics/* routes
├── logs_handler.go           # /logs/* routes
├── events_handler.go         # /events/* routes
├── project_handler.go        # /projects/* routes
├── auth_handler.go           # /auth/* routes
├── user_handler.go           # /users/* routes
├── security_handler.go       # /security/* routes
├── websocket_handler.go      # /ws/* WebSocket upgrade
└── middleware.go             # Middleware chain assembly
```

### Repository Layer

The repository layer abstracts all database operations. The default storage is SQLite (zero-configuration, embedded). PostgreSQL is supported for multi-instance deployments.

```
kubilitics-backend/internal/repository/
├── cluster_repository.go     # Cluster CRUD + persistence
├── project_repository.go     # Project CRUD
├── user_repository.go        # User and permission CRUD
└── migrations/               # SQL schema migrations (versioned)
```

### K8s Client Layer

```
kubilitics-backend/internal/k8s/
├── client.go                 # K8s client wrapper (TestConnection, DetectProvider)
├── resource_client.go        # Generic resource CRUD via dynamic client
├── metrics_client.go         # metrics-server API calls
└── informer.go               # Informer/reflector setup for real-time events
```

---

## Data Flow: Adding a Cluster

```
1. User uploads kubeconfig (base64) via frontend
        │
        ▼
2. POST /api/v1/clusters
   { kubeconfig_base64: "...", context: "my-context" }
        │
        ▼
3. AddCluster handler (handler.go)
   → base64-decode bytes
   → call clusterService.AddClusterFromBytes()
        │
        ▼
4. clusterService.AddClusterFromBytes()
   → parse kubeconfig with clientcmd.Load()
   → validate context exists
   → write to ~/.kubilitics/kubeconfigs/<context>.yaml
   → call clusterService.AddCluster()
        │
        ▼
5. clusterService.AddCluster()
   → create k8s.Client from kubeconfig path + context
   → run TestConnection() (with timeout)
   → run DetectProvider() → "eks" | "gke" | "aks" | "k3s" | ...
   → persist to SQLite repository
   → register client in memory pool
   → start informer cache (if connected)
        │
        ▼
6. Return 201 Created with full cluster model
   { id, name, context, provider, status, server_url, ... }
```

---

## Data Flow: Building Topology

```
1. GET /api/v1/clusters/{id}/topology?namespace=default
        │
        ▼
2. TopologyHandler → TopologyService.GetTopology()
        │
        ▼
3. Check in-memory cache (TTL: 5 minutes)
   ├── Cache hit → return cached graph
   └── Cache miss → build graph
        │
        ▼
4. List all relevant resource types (concurrent):
   Pods, ReplicaSets, Deployments, StatefulSets, DaemonSets,
   Services, Ingresses, ConfigMaps, Secrets, PVCs,
   ServiceAccounts, Roles, RoleBindings, CRDs, ...
        │
        ▼
5. Build nodes (one per resource)
   → Assign kind, name, namespace, status, labels, annotations
   → Assign node group (workload, config, network, storage, rbac)
        │
        ▼
6. Infer edges (relationships):
   → OwnerReferences (Pod → ReplicaSet → Deployment)
   → Label selectors (Service.selector → Pod.labels)
   → Volume mounts (Pod.volumes → ConfigMap/Secret/PVC)
   → Ingress routing (Ingress → Service → Pod)
   → RBAC (ServiceAccount → RoleBinding → Role)
   → CronJob → Job → Pod scheduling chain
        │
        ▼
7. Validate graph (detect orphans, broken references)
8. Apply deterministic layout seed
9. Store in cache with TTL
        │
        ▼
10. Return TopologyGraph JSON
    { nodes: [...], edges: [...], metadata: {...} }
```

---

## Data Flow: Real-time Updates (WebSocket)

```
Frontend                   Backend                    Kubernetes API
   │                           │                            │
   │  WS /api/v1/ws/resources  │                            │
   │──────────────────────────>│                            │
   │                           │                            │
   │                           │  Informer (list+watch)     │
   │                           │<──────────────────────────>│
   │                           │                            │
   │                           │  ResourceEvent received    │
   │                           │<───────────────────────────│
   │                           │                            │
   │    {type, resource, obj}  │                            │
   │<──────────────────────────│                            │
   │                           │                            │
   │  (update UI)              │                            │
```

---

## Desktop App Architecture

```
macOS/Windows/Linux
┌─────────────────────────────────────────┐
│  Tauri Application Process              │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  WebView (WKWebView / WebView2)    │  │
│  │  React Frontend                    │  │
│  │  → talks to localhost:8190         │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Rust Shell (Tauri IPC)            │  │
│  │  → file system access              │  │
│  │  → native dialogs                  │  │
│  │  → sidecar process management      │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Go Backend Sidecar                │  │
│  │  (kubilitics-backend binary)       │  │
│  │  → same code as web backend        │  │
│  │  → port 8190 (local only)          │  │
│  │  → supervised by Rust shell        │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
         │
         ▼
  Kubernetes API
  (~/.kube/config)
```

---

## Port Reference

| Service | Default Port | Protocol | Notes |
|---------|-------------|----------|-------|
| kubilitics-backend | 8190 | HTTP/WS | Configurable via `KUBILITICS_PORT` |
| kubilitics-frontend (dev) | 5173 | HTTP | Vite dev server only |
| Desktop app backend | 8190 | HTTP | Local sidecar, not exposed externally |

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend language | Go | 1.24+ |
| Frontend language | TypeScript | 5.x |
| Frontend framework | React | 18.3 |
| Desktop shell | Rust + Tauri | 2.0 |
| CLI framework | Cobra | latest |
| TUI framework | Bubble Tea | latest |
| K8s client | client-go | k8s.io/client-go |
| Database | SQLite (default) | embedded |
| State management | Zustand | 5.x |
| UI components | Radix UI | latest |
| Styling | Tailwind CSS | 3.4 |
| Graph visualization | Cytoscape.js | 3.33 |
| 3D visualization | Three.js | 0.182 |
| Graph layout | ELK.js | 0.11 |
| Charts | Recharts | 2.15 |
| Terminal emulator | xterm.js | 6.0 |
| Build tool | Vite | 5.4 |
| E2E testing | Playwright | 1.49 |
| Tracing | OpenTelemetry | latest |
| Metrics | Prometheus client | latest |

---

## Security Model

### Authentication (optional, disabled by default for local use)
- JWT tokens with configurable expiry and refresh
- API keys for programmatic access
- OIDC integration with any compliant provider
- SAML 2.0 for enterprise SSO
- MFA (TOTP) for all auth modes

### Authorization
- Default: no auth required (for local/desktop use)
- With auth enabled: RBAC at cluster and namespace granularity
- Admin role: full access
- Viewer role: read-only
- Custom roles: configurable per-cluster, per-namespace permissions

### Transport
- HTTP by default for local deployments
- TLS/HTTPS with custom certificates for production deployments

### Data Protection
- No telemetry by default
- Zero data sent to Kubilitics servers
- Kubeconfig files stored with 0600 permissions in `~/.kubilitics/kubeconfigs/`
- SQLite database contains only resource metadata, never Secret values
- All mutations are audit-logged with user, timestamp, and diff

---

## Deployment Models

### Local (Desktop App)
Self-contained native app. No external dependencies.

### Self-hosted (Docker Compose)
```yaml
services:
  backend:
    image: kubilitics/backend:latest
    ports: ["8190:8190"]
    volumes:
      - ~/.kube:/root/.kube:ro
      - kubilitics-data:/var/lib/kubilitics

  frontend:
    image: kubilitics/frontend:latest
    ports: ["80:80"]
    environment:
      - VITE_API_URL=http://backend:8190
```

### Self-hosted (Helm)
```bash
helm install kubilitics kubilitics/kubilitics \
  --set backend.service.port=8190 \
  --set frontend.service.port=80 \
  --namespace kubilitics \
  --create-namespace
```

In-cluster deployment means the backend uses the pod's service account for Kubernetes API access — no kubeconfig required.
