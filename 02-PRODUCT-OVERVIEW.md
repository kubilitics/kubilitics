# Kubilitics — Complete Product Overview

## What We Have Built

Kubilitics is a **three-component Kubernetes management platform** (backend, frontend, desktop) delivered as a unified system. Every component is production-ready, open-source, and designed for self-hosted deployment.

---

## Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        KUBILITICS PLATFORM                       │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │  Desktop App │  │   Web App    │                             │
│  │  (Tauri/Rust)│  │ (Helm/Docker)│                             │
│  └──────┬───────┘  └──────┬───────┘                             │
│         │                 │                                      │
│         └─────────────────┘                                      │
│                           │                                      │
│              ┌────────────▼──────────────┐                      │
│              │   kubilitics-backend (Go)  │                      │
│              │   REST + WebSocket         │                      │
│              │   Port 8190                │                      │
│              └────────────┬──────────────┘                      │
│                           │                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  kcli (Go CLI)  — kubectl wrapper with TUI                │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Kubernetes API    │
                    │  (any cluster)     │
                    └────────────────────┘
```

---

## 1. kubilitics-backend

**Language:** Go 1.24+
**Port:** 8190 (configurable)
**Storage:** SQLite (default) / PostgreSQL
**Protocol:** REST/JSON + WebSocket

The backend is the core engine of the platform. Every client — desktop app, web app, and CLI — talks exclusively to the backend. The backend talks exclusively to the Kubernetes API.

### What It Does

**Cluster Management**
- Register clusters from kubeconfig files (path-based or base64-encoded upload)
- Auto-detect contexts from `~/.kube/config`
- Persist cluster registry in SQLite with status tracking
- Connection pooling with circuit-breaker pattern
- Startup reconnection with per-cluster 8-second timeout (exec-based auth like EKS/GKE/AKS handled gracefully)
- Provider detection: EKS, GKE, AKS, k3s, Kind, Minikube, Rancher, Docker Desktop

**Resource Management**
- Full CRUD for all 50+ Kubernetes resource types
- YAML patch via `kubectl apply` semantics
- Rollout history and rollback for Deployments
- CronJob manual trigger and job history
- Job retry
- Service endpoint resolution
- ConfigMap, Secret, and PVC consumer discovery
- TLS certificate information for Secrets

**Topology Engine**
See dedicated section in `04-TOPOLOGY-ENGINE.md`. The topology engine is the most architecturally significant component.

**Real-time Streaming**
- WebSocket hub for live resource change events
- Server-sent event streams for log tailing
- Pod log streaming with multi-container support

**Metrics**
- Aggregated cluster metrics summary
- Per-node CPU/memory utilisation
- Per-workload metrics (Deployment, StatefulSet, DaemonSet, Job, CronJob, ReplicaSet)
- Integration with Kubernetes metrics-server

**Search**
- Full-text search across all resource types in a cluster
- Supports namespace, label, and name filtering

**Projects**
- Logical grouping of clusters and namespaces into projects
- Project-level dashboard aggregation
- Cluster and namespace membership management

**Authentication & Multi-tenancy** (optional, disabled by default)
- JWT-based authentication with refresh tokens
- API key authentication for service accounts and automation
- OIDC integration (Google, GitHub, Okta, etc.)
- SAML 2.0 integration
- MFA (TOTP)
- Role-Based Access Control: per-cluster and per-namespace permissions
- Admin user management: create, update, unlock, delete

**Observability**
- Structured JSON logging (configurable level)
- Prometheus metrics endpoint (`/metrics`)
- OpenTelemetry tracing (OTLP export)
- Request ID propagation
- Audit logging (every API call recorded immutably)

**Operations**
- Health endpoints: `/health`, `/healthz/live`, `/healthz/ready`
- Graceful shutdown (SIGTERM/SIGINT with configurable drain timeout)
- CORS, rate limiting, secure headers middleware stack
- TLS/HTTPS optional

---

## 2. kubilitics-frontend

**Language:** TypeScript + React 18
**Build tool:** Vite
**UI:** Tailwind CSS + Radix UI
**State:** Zustand + TanStack Query
**Port:** 5173 (dev) / any (production)

The frontend is a single-page application that communicates exclusively with the backend REST API and WebSocket endpoints. It is fully themeable (light/dark mode) and internationalised (i18next).

### Pages and Features

**Dashboard**
- Cluster health overview with live connection status
- Real-time resource counts by category
- Node status grid
- Recent events feed
- Quick-access links to any resource type

**Resource Browser (50+ resource types)**
Every Kubernetes resource type has two dedicated pages:

1. **List Page** — filterable, sortable table with status indicators, namespace selector, search, and bulk actions
2. **Detail Page** — full resource information, YAML viewer/editor, events, related resources, and AI analysis panel

Resource categories covered:
- Workloads: Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob, ReplicaSet, ReplicationController
- Configuration: ConfigMap, Secret, Namespace, ResourceQuota, LimitRange
- Storage: PVC, PV, StorageClass, VolumeSnapshot, VolumeSnapshotClass, VolumeSnapshotContent, VolumeAttachment
- Networking: Service, Endpoints, EndpointSlice, Ingress, IngressClass, NetworkPolicy
- RBAC: ServiceAccount, Role, RoleBinding, ClusterRole, ClusterRoleBinding
- Nodes: Node (with per-node metrics)
- Events: Kubernetes Event stream with severity filtering
- Autoscaling: HPA, VPA
- Policy: PodDisruptionBudget, PodSecurityPolicy, RuntimeClass, PriorityClass
- Extensions: CRD, CustomResource, MutatingWebhookConfiguration, ValidatingWebhookConfiguration
- MetalLB: BGPPeer, IPAddressPool
- Advanced: APIService, Lease, ControllerRevision, PodTemplate, ResourceSlice, DeviceClass
- Components: ComponentStatus

**Topology View**
Interactive dependency graph of all cluster resources. See `04-TOPOLOGY-ENGINE.md`.

**Analytics Dashboards**
- Cluster health and anomaly detection
- ML analytics (pattern recognition, trend analysis)
- Cost intelligence per namespace and cluster
- Security posture scoring

**Shell Access**
- Integrated terminal (xterm.js) for pod exec
- Shell panel with command history

**Settings**
- Backend URL configuration
- Theme and display preferences
- Authentication configuration

### Technical Highlights
- React Query for server-state management with optimistic updates
- CodeMirror 6 for YAML editing with Kubernetes schema validation
- Three.js for 3D topology rendering (alternative view)
- Cytoscape.js with ELK, Dagre, Cola, and FCose layout algorithms for 2D topology
- Recharts for metrics and cost charts
- Framer Motion for fluid animations
- Playwright E2E test coverage

---

## 3. Desktop Application

**Framework:** Tauri 2.0 (Rust)
**Frontend:** Shared React codebase
**Distribution:** macOS (.dmg, Universal), Windows (.msi), Linux (.deb)

### Architecture

The desktop app is a native application where:
- A **Rust shell** (Tauri) manages the native window, file system access, and dialogs
- A **Go backend** (the same kubilitics-backend binary) runs as a sidecar process, managed and supervised by the Rust shell
- The **React frontend** runs inside a WebView and talks to the local sidecar backend on `localhost:8190`

This means the desktop app is fully self-contained. No external server. No internet connection required. Works from first launch with just a kubeconfig on disk.

### Desktop-Specific Features
- Auto-discovers kubeconfig at `~/.kube/config` on startup
- Native file picker for kubeconfig selection
- Sidecar lifecycle management (start, stop, crash recovery)
- Native macOS/Windows/Linux window chrome and system tray integration
- Auto-updater via Tauri's built-in update mechanism
- Code-signed and notarised binaries (Apple Developer / Microsoft Authenticode)
- Universal binary for Apple Silicon and Intel Macs

---

## 4. kcli

**Language:** Go
**Distribution:** Single binary, cross-platform
**Dependencies:** None at runtime (kubectl not required)

A drop-in kubectl replacement with superior ergonomics, built-in observability, AI assistance, a full-screen TUI, and a plugin system.

See dedicated section in `06-KCLI.md`.

---

## Feature Matrix

| Feature | Desktop | Web |
|---------|---------|-----|
| Cluster management | ✅ | ✅ |
| 50+ resource types | ✅ | ✅ |
| Topology graph | ✅ | ✅ |
| Real-time updates | ✅ | ✅ |
| Pod logs | ✅ | ✅ |
| Pod shell (exec) | ✅ | ✅ |
| Metrics | ✅ | ✅ |
| Cost analysis | ✅ | ✅ |
| Offline mode | ✅ | — |
| YAML edit & apply | ✅ | ✅ |
| Multi-cluster | ✅ | ✅ |
| Auth (OIDC/SAML) | ✅ | ✅ |
| Audit logs | ✅ | ✅ |

---

## Current Release State

All three components are implemented and production-ready. The platform has passed:
- Full backend unit and integration test suites
- Frontend E2E test coverage via Playwright
- Manual QA across EKS, GKE, AKS, k3s, Kind, Minikube, Rancher Desktop, and Docker Desktop
- Security review: secure headers, rate limiting, input validation, audit logging
- Performance testing: topology builds sub-3-second for clusters with 1000+ resources

The platform is ready for public release.
