# Kubilitics — Single Execution Roadmap (Merged)

**Version:** 2.0  
**Date:** 2026-02-04  
**Status:** Planning and execution reference  
**Source of truth:** `project-docs/` for product scope, architecture, UX, non-goals.

This document is the **single execution roadmap** for the Kubilitics monorepo. It merges:
- **TASKS.md** (v1): repo-aligned foundation, contract, integration, testing.
- **Claude-TASKS.md**: granular task breakdown for backend, desktop, mobile, website, CI/CD.
- **TASKS_ENTERPRISE_GRADE.md**: enterprise capabilities, security, observability, scale, MVP vs Enterprise.

**How to use:** Execute phases in order (A → B → C → D). Mark tasks with `[ ]` / `[x]` only after **verifying against the codebase** (repo state overrides any “complete” claims from prior docs).

---

## Roadmap Overview

| Phase | Name | Goal | MVP? | Enterprise? |
|-------|------|------|------|-------------|
| **A** | Foundation | Contract, persistence, real APIs, frontend↔backend, no mocks | ✅ Required | ✅ Required |
| **B** | Reliability & observability | Real logs/events/metrics, WebSocket UI, backend observability, failure handling | ✅ Required | ✅ Required |
| **C** | Scale & security | Multi-cluster, caching, large topology, RBAC, secrets, audit | Optional for MVP | ✅ Required |
| **D** | Enterprise readiness | Isolation, zero-trust, SSO, compliance, retention | No | ✅ Required |
| **R** | Distribution & delivery | Desktop/mobile packaging, Helm, website deploy, CI/CD | ✅ For ship | ✅ For ship |
| **O** | Open-source readiness | License, CONTRIBUTING, SECURITY, release process | ✅ For ship | ✅ For ship |
| **MO** | Mobile | Scoped mobile flows, push, security, build | After desktop | After desktop |
| **W** | Website | Landing, docs, install links | ✅ For ship | ✅ For ship |

**Critical path for MVP:** Phase A → Phase B → Phase R (desktop + one-command run) → Phase O → Phase W.

---

## Phase A — Foundation

**Goal:** Single data path (frontend → backend → K8s), persisted clusters, real resource and topology APIs, no mocks in critical path.

**Dependencies:** None.  
**Acceptance:** New dev runs one command; backend + frontend show real data from one cluster.

### A1 — Product foundation & alignment

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] A1.1 | Document integration model (backend as gateway vs direct K8s) | `project-docs/`, `docs/` | Add `INTEGRATION-MODEL.md` or section: when backend present, frontend uses backend only; when absent, document optional direct K8s URL. | Two data paths exist; need one canonical model. | Review; link from README. | N/A | Doc merged; README updated. |
| [x] A1.2 | Define canonical topology API response shape | `project-docs/`, `kubilitics-backend/api/swagger.yaml` | OpenAPI: nodes (`kind`, `id`, `metadata`, `computed`), edges (`relationshipType`, `source`, `target`), `metadata.layoutSeed`, `metadata.isComplete`. | Frontend uses `kind`/`relationshipType`; backend uses `Type`. | OpenAPI + sample JSON match frontend types. | N/A | Contract documented; swagger updated. |
| [x] A1.3 | Align path parameter naming | `kubilitics-backend/internal/api/rest/` | Use `clusterId` in route docs and handler vars (or keep `id` and document). | project-docs use `clusterId`; backend uses `id`. | Grep + doc. | N/A | Consistent or documented. |

*Verified A1.1:* `docs/INTEGRATION-MODEL.md` created; README updated (Documentation section + repo structure) with link to INTEGRATION-MODEL.md.

*Verified A1.2:* `docs/TOPOLOGY-API-CONTRACT.md` created; `kubilitics-backend/api/swagger.yaml` already had TopologyGraph/TopologyNode/TopologyEdge with `kind`, `relationshipType`, `metadata.layoutSeed`, `metadata.isComplete`; added sample JSON example to GET `/clusters/{clusterId}/topology` 200 response; README updated with link to TOPOLOGY-API-CONTRACT.md.

*Verified A1.3:* Routes and handler vars use `clusterId`: `handler.go`, `resources.go`, `logs.go`, `events.go`, `metrics.go` use pattern `/clusters/{clusterId}/...` and `vars["clusterId"]`; swagger paths and parameter name updated to `clusterId`; duplicate stub routes in `cmd/server/main.go` removed; `docs/INTEGRATION-MODEL.md` updated to state path parameter name is clusterId.

### A2 — Backend hardening & APIs

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] A2.1 | Wire ClusterService to repository | `kubilitics-backend/internal/service/cluster_service.go`, `cmd/server/main.go` | Inject repository; CRUD clusters via repo; on startup load clusters from DB and register K8s clients. | Clusters currently in-memory; repo unused for clusters. | Add cluster, restart server, GET clusters returns it. | Unit test ClusterService with mock repo; integration test SQLite. | Clusters persisted and restored. |
| [x] A2.2 | ListResources with real K8s data | `kubilitics-backend/internal/api/rest/resources.go`, `internal/service/` | Get client by clusterId; map kind→GVR; list from K8s; paginate/sort per project-docs. | ListResources returns empty list today. | GET `.../resources/pods` returns real pods when connected. | Integration test with mock K8s client. | Real list; 404/403 when cluster missing or RBAC. |
| [x] A2.3 | GetResource with real K8s data | Same as A2.2 | Get client; get single resource by kind/namespace/name. | GetResource returns fake object. | GET resource returns real spec/status. | Integration test. | Real get; correct 404. |
| [x] A2.4 | DeleteResource and ApplyManifest | Same as A2.2 | Delete: K8s delete. Apply: parse YAML, apply via dynamic client. | Placeholders today. | DELETE removes; POST apply creates/updates. | Integration tests. | Safe errors; 404/403. |
| [x] A2.5 | Align topology API response with contract | `kubilitics-backend/internal/models/topology.go`, `internal/topology/graph.go` | JSON fields: `kind`, `relationshipType`, `metadata`, `computed` (match frontend). | Backend uses `Type`/`Meta`. | GET topology consumable by frontend without mapping. | Unit test serialization; integration test topology. | Contract test passes. |
| [x] A2.6 | ExportTopology: implement or stub | `kubilitics-backend/internal/service/export_service.go` | PNG or JSON export per project-docs; or 501 + document. | ExportTopology returns error today. | POST export returns file or 501. | Optional unit test. | No panic; documented. |
| [x] A2.7 | Logs/Events/Metrics: implement or 501 | `kubilitics-backend/internal/api/rest/logs.go`, `events.go`, `metrics.go` | Implement streaming/listing or return 501 and document in API doc. | Handlers return NotImplemented. | Clear behavior and doc. | N/A | Implemented or 501 + doc. |

*Verified A2.1:* ClusterService wired to repository: `NewClusterService(repo)`; CRUD uses repo (Create/Get/List/Update/Delete); in-memory `clients` map for live K8s clients; `LoadClustersFromRepo(ctx)` on startup in main.go; SQLiteRepository implements ClusterRepository (Create, Get, List, Update, Delete); unit tests in `cluster_service_test.go` with mock repo. Clusters persisted and restored on restart.

*Verified A2.2:* ListResources uses real K8s: k8s.Client gains Dynamic client; `internal/k8s/resources.go` adds ListResources(kind, namespace, opts) and NormalizeKindToResource; handler gets client via clusterService.GetClient(clusterID), calls client.ListResources, returns items + metadata; 404 when cluster not found, 403 on K8s Forbidden, 500 on other errors. GET `/api/v1/clusters/{clusterId}/resources/pods` returns real pod list when connected.

*Verified A2.3:* GetResource uses real K8s: k8s.Client.GetResource(kind, namespace, name) in `internal/k8s/resources.go`; handler gets client, calls GetResource, returns obj.Object; 404 when cluster or resource not found, 403 on K8s Forbidden.

*Verified A2.4:* DeleteResource: k8s.Client.DeleteResource(ctx, kind, namespace, name, opts) in `internal/k8s/resources.go`; handler gets client, calls DeleteResource; 404/403 mapped. ApplyManifest: `internal/k8s/apply.go` ApplyYAML(ctx, yamlContent) splits multi-doc YAML, decodes to unstructured, gets GVR from apiVersion/kind, Get then Create or Update; handler gets client, calls ApplyYAML, returns applied resources; 404/403 on errors.

*Verified A2.5:* Topology contract aligned: models use `Kind`, `RelationshipType`, `Metadata`, `Computed`; graph.ToTopologyGraph(clusterID) returns SchemaVersion and Metadata (NodeCount, EdgeCount, LayoutSeed); engine stores serviceAccountName in node extra; inferRBACRelationships adds Pod→ServiceAccount "uses" edges; graph_test and benchmark_test updated; postgres and export_service use Metadata/Kind; backend builds and topology tests pass.

*Verified A2.6:* ExportTopology returns service.ErrExportNotImplemented; handler returns 501 with message; swagger and API_DOCUMENTATION.md document 501 until implemented.

*Verified A2.7:* GetPodLogs, GetEvents, GetClusterMetrics, GetPodMetrics return 501 with clear messages; API_DOCUMENTATION.md and swagger updated for logs, events, metrics (501 until Phase B1.1/B1.2/B1.3).

*Verified A3.1:* Backend API client in `kubilitics-frontend/src/services/backendApiClient.ts` (getClusters, getTopology, getHealth, createBackendApiClient, BackendApiError); backend config store in `src/stores/backendConfigStore.ts` (backendBaseUrl, currentClusterId, setBackendBaseUrl, setCurrentClusterId, clearBackend, isBackendConfigured); base URL from VITE_API_URL (vite-env.d.ts); useBackendClient hook in `src/hooks/useBackendClient.ts`. Unit tests in `backendApiClient.test.ts` with mock fetch (vitest); `npm run test` passes. Client ready for use by topology and cluster list (A3.2, A3.4).

*Verified A3.2:* When backend URL is set, ClusterSelection uses useClustersFromBackend (GET /api/v1/clusters); shows loading/error/empty states; list is backend clusters (no fake list); on Connect sets backendConfigStore.currentClusterId and clusterStore (setClusters, setActiveCluster) from backend data; useClustersFromBackend in `src/hooks/useClustersFromBackend.ts`; backendClusterToDisplay/backendClusterToCluster mapping in ClusterSelection.

*Verified A3.4:* Topology page uses useTopologyFromBackend(clusterId) when backend configured and cluster selected; GET /api/v1/clusters/{clusterId}/topology; graph from backend or mock (mock when backend not configured or useDemoGraph); loading/error UI and Retry; handleRefresh refetches topology when backend; useTopologyFromBackend in `src/hooks/useTopologyFromBackend.ts`.

*Verified A3.3:* Backend API client has listResources(baseUrl, clusterId, kind, params?) and getResource(baseUrl, clusterId, kind, namespace, name) in `backendApiClient.ts`. useK8sResourceList and useK8sResource in `useKubernetes.ts` use backend when isBackendConfigured() and clusterId set (single code path: queryKey/queryFn switch on backend mode); clusterId from activeCluster?.id ?? currentClusterId. List/detail pages unchanged; they use same hooks and get backend data in backend mode.

*Verified A3.5:* Backend unreachable: BackendStatusBanner in AppLayout (useBackendHealth); message "Backend unreachable: …"; actions Retry and Settings. No clusters: ClusterSelection shows empty state message. Clusters fetch error: error + Retry. Cluster not found (404): Topology error block shows "Back to cluster list" link and Retry. Settings: Backend API card with backend base URL input and save to backendConfigStore. Messages and recovery actions documented in `docs/ERROR-STATES.md`.

### A3 — Frontend–backend integration & UX

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] A3.1 | Backend API client and base URL config | `kubilitics-frontend/src/services/` or `lib/`, `stores/` | Client for Kubilitics backend (base URL, `/api/v1/clusters/{clusterId}/...`); store for backend URL and current cluster ID. | Frontend only has K8s API URL. | Can call GET clusters and GET topology. | Unit test with MSW or mock fetch. | Client used by topology and cluster list. |
| [x] A3.2 | Cluster list from backend when backend mode | `kubilitics-frontend/src/pages/ClusterSelection.tsx`, stores | When backend URL set: GET `/api/v1/clusters`; show list; set current cluster. | Clusters must come from backend in backend mode. | Selecting backend shows clusters from backend. | E2E or integration. | No fake cluster list. |
| [x] A3.3 | Resource list/detail via backend when backend mode | `kubilitics-frontend/src/hooks/useKubernetes.ts` or new hook | Backend mode: path `/api/v1/clusters/{clusterId}/resources/{kind}?namespace=...`; use backend client. | Unify data path. | List/detail show same data from backend. | E2E for one resource type. | Single code path for backend mode. |
| [x] A3.4 | Topology page: fetch from backend, remove mock when connected | `kubilitics-frontend/src/pages/Topology.tsx`, topology store | GET `/api/v1/clusters/{clusterId}/topology`; map to Cytoscape; mock only when backend not configured or demo toggle. | Topology uses only mock today. | Topology view shows backend graph when cluster selected. | E2E: open topology, see nodes. | Real topology in normal flow. |
| [x] A3.5 | Error states and messaging | `kubilitics-frontend/src/` (pages, components) | Handle backend unreachable, no clusters, cluster not found with clear UI and recovery actions. | Avoid blank screens. | Manual and E2E. | E2E for disconnect/error. | Messages and actions documented. |

---

## Phase B — Reliability & Observability

**Goal:** Real logs, events, metrics (no mocks); WebSocket-driven UI updates; backend observable; failure handling and recovery.

**Dependencies:** Phase A.  
**Acceptance:** Logs/events/metrics from K8s or 501 documented; WebSocket updates UI; backend exposes metrics and structured logs.

*Verified B1.1:* LogsService.GetPodLogs streams from K8s API; rest/logs.go wires handler with container, tail, follow query params; real stream when pod exists.

*Verified B1.2:* EventsService.ListEvents queries K8s events; rest/events.go returns list with namespace, limit; real events (no static list).

*Verified B1.3:* MetricsService.GetPodMetrics/GetNamespaceMetrics use Metrics Server; rest/metrics.go returns pod/namespace metrics; 503 when Metrics Server unavailable (documented).

*Verified B2.1:* internal/pkg/logger (JSON RequestLog, request_id, cluster_id, duration); internal/api/middleware RequestID (X-Request-ID) and StructuredLog; no PII/secrets.

*Verified B2.2:* internal/pkg/metrics (kubilitics_http_requests_total, http_request_duration_seconds, topology_build_duration_seconds, websocket_connections_active); /metrics with promhttp; path normalized via route template; docs/OBSERVABILITY.md.

*Verified B2.3:* Config TopologyTimeoutSec, RequestTimeoutSec, ShutdownTimeoutSec; GetTopology context.WithTimeout and 503 on timeout; main.go graceful shutdown (hub.Stop, srv.Shutdown).

*Verified B2.4:* useBackendWebSocket in kubilitics-frontend (exponential backoff 1s→30s, max retries); WebSocket primary; polling fallback documented in OBSERVABILITY.md.

*Verified B3.1:* Makefile dev target; scripts/dev.sh (backend then frontend); README can reference make dev.

*Verified B3.2:* .env.example at repo root (KUBILITICS_*, VITE_API_URL); documented.

*Verified B3.3:* make test runs backend-test and frontend-test; test_reports/backend, test_reports/frontend, test_reports/playwright.

### B1 — Real data: logs, events, metrics

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] B1.1 | Real pod log streaming | `kubilitics-backend/internal/api/rest/logs.go`, `internal/service/logs_service.go` | Stream pod logs from K8s API; container selection, tail, follow. No mock content. | M2.7 or 501; for MVP need real logs. | GET logs returns real stream when pod exists. | Integration test with real/mock pod. | Same as project-docs logs service. |
| [x] B1.2 | Real Kubernetes events | `kubilitics-backend/internal/api/rest/events.go`, `internal/service/events_service.go` | Query K8s events; filter by namespace/resource/type; stream via WebSocket. No static list. | Events are critical for SRE. | Events endpoint and WebSocket event type work. | Integration test. | Real events; WebSocket optional. |
| [x] B1.3 | Real metrics (Metrics Server / Prometheus) | `kubilitics-backend/internal/api/rest/metrics.go`, `internal/service/metrics_service.go` | Integrate with cluster Metrics Server or Prometheus; expose pod/node metrics in API. 501 or empty when unavailable, documented. | No fake metrics. | Real metrics in response when available. | Integration test when metrics server present. | Documented behavior. |

### B2 — Backend observability & failure handling

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] B2.1 | Structured logging and request ID | `kubilitics-backend/internal/api/`, middleware | JSON logging with request ID, cluster ID, duration. | Operators need to debug production. | Logs consumable by standard tools. | N/A | Request ID in logs and optional response header. |
| [x] B2.2 | Prometheus metrics for Kubilitics | `kubilitics-backend/internal/api/`, `pkg/metrics/` or similar | Metrics: request count by path/status, latency histogram, topology_build_duration_seconds, websocket_connections_active. | Run in production without black box. | /metrics scrapeable; dashboard or runbook. | N/A | Metrics documented. |
| [x] B2.3 | Graceful shutdown and timeouts | `kubilitics-backend/cmd/server/main.go`, handlers | Drain WebSocket; finish in-flight requests; context timeout on topology build (e.g. 30s) and list; return 503 on timeout. | No unbounded waits. | Shutdown and timeout behavior documented and tested. | Integration test. | No unbounded wait. |
| [x] B2.4 | WebSocket reconnection (frontend) | `kubilitics-frontend/src/` (stores, services) | Exponential backoff and max retries on disconnect; apply deltas to local state; no polling as primary for list/topology. | Real-time is required for incidents. | UI updates within seconds of K8s change when WS connected. | E2E or integration. | WebSocket primary; polling fallback documented. |

### B3 — Local E2E and one-command run

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] B3.1 | One-command dev (backend + frontend) | Repo root: `Makefile` or `scripts/dev.sh`, `README.md` | Start backend then frontend; optional open browser; optional “with cluster” (kind/k3s + fixtures). | No single-command today. | New clone + one command → app running. | N/A | README updated; command works. |
| [x] B3.2 | Environment and .env.example | Root or per-app: `.env.example`, `docs/` or README | List KUBILITICS_PORT, DATABASE_PATH, VITE_API_URL, etc.; provide .env.example. | Deterministic setup. | Copy .env.example and run works. | N/A | Documented. |
| [x] B3.3 | One-command test and test_reports | Root: `Makefile` or `scripts/test.sh`, `.github/workflows/` | `make test` runs backend tests, frontend tests, E2E; output to test_reports/. | Quality gate. | Reports in test_reports/ or CI artifacts. | N/A | CI runs and publishes reports. |

### B4 — Testing (unit, integration, E2E)

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] B4.1 | Backend unit tests (topology, services) | `kubilitics-backend/internal/topology/*_test.go`, `internal/service/*_test.go` | Graph build, layout seed determinism, ClusterService (mock repo), TopologyService. | Coverage and regression. | `go test ./...` passes. | N/A | Coverage ≥ 70% for topology. |
| [x] B4.2 | Backend API integration tests | `kubilitics-backend/tests/` or `internal/api/rest/` | HTTP handlers with mock cluster service and fake K8s; assert status and JSON shape for clusters, resources, topology. | Contract and handler behavior. | Integration test in CI. | N/A | Clusters, resources, topology tested. |
| [x] B4.3 | Frontend unit tests (critical paths) | `kubilitics-frontend/src/` | Vitest: topology store, API client, one list/detail hook. | Regression. | `npm run test` passes. | N/A | At least 3 critical modules. |
| [x] B4.4 | E2E: one full flow (Playwright) | `tests/e2e/` or `kubilitics-frontend/e2e/`, `playwright.config.ts` | Start backend (or mock), open frontend, select cluster or load topology, assert nodes visible. | project-docs require E2E. | `npx playwright test` passes in CI. | N/A | Green in CI. |
| [x] B4.5 | Test fixtures | `tests/fixtures/` | JSON/YAML for topology response, cluster list, resource list; optional test-cluster.yaml for kind. | Reproducible tests. | Fixtures used by integration or E2E. | N/A | Documented in README or e2e blueprint. |

---

## Phase C — Scale & Security

**Goal:** Multi-cluster handling, caching, large-cluster topology (scoped/paginated), RBAC propagation, secrets handling, audit logging.

**Dependencies:** Phase B.  
**Acceptance:** Many clusters with status; topology cache or scope; 403/404 from K8s propagated; no secrets in logs/API; audit for mutations.

### C1 — Backend scale and resilience

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] C1.1 | Multi-cluster handling | `kubilitics-backend/internal/service/cluster_service.go`, API | Support N clusters (e.g. &lt;100); per-cluster health; list clusters with status (connected/disconnected/error). Unhealthy cluster does not kill process. | Single-cluster assumption breaks at scale. | GET /clusters returns status for many clusters. | Integration test. | Documented limit; status per cluster. |
| [x] C1.2 | K8s API: timeouts and retries | `kubilitics-backend/internal/k8s/`, handlers | Context timeout on all K8s calls; retry with backoff for 5xx/429; propagate 403/404 to API response. | No silent failures or unbounded waits. | Contract doc; integration test with mock 403/429. | N/A | Timeout and retry policy documented. |
| [x] C1.3 | Topology cache and invalidation | `kubilitics-backend/internal/service/topology_service.go`, cache layer | Cache topology per (clusterId, namespace, filters) with TTL; invalidate on WebSocket resource update for that scope. | Avoid thundering herd. | Cache hit/miss observable; invalidation on event. | Unit or integration. | No single request that always rebuilds full cluster. |
| [x] C1.4 | Topology scope for large clusters | `kubilitics-backend/internal/topology/`, API | Support “topology for namespace X” or “resource Y + N-hop”; document max nodes/edges per response. | 10K nodes in one response can OOM or timeout. | API supports namespace or resource-scoped topology; docs state limits. | Benchmark or doc. | Scoped topology available; 10K scenario doc’d or tested. |
| [x] C1.5 | Rate limit outbound K8s API calls | `kubilitics-backend/internal/k8s/` or middleware | Token bucket or similar per cluster to avoid 429. | Multiple users/tabs can throttle K8s. | Rate limiter in place; doc. | N/A | Documented. |

### C2 — Frontend at scale and SRE UX

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] C2.1 | Virtualized resource lists | `kubilitics-frontend/src/` (list components) | react-window or similar for tables with 1000+ items; paginate or lazy load. | Large lists freeze UI. | List of 1000+ items scrolls without freeze. | Perf test or manual. | No full DOM for huge lists. |
| [x] C2.2 | Topology canvas performance | `kubilitics-frontend/src/features/topology/` | Canvas/WebGL or limit visible nodes; no 10K DOM nodes for topology. | 10K nodes in DOM can crash tab. | Topology with 1K+ nodes renders without crash. | Perf test or manual. | Documented limit or clustering. |
| [x] C2.3 | Error transparency and SRE UX | `kubilitics-frontend/src/` (pages, components) | Surface API error code and message (403, 504); request ID for support; retry and “back to cluster list”; optional “incident mode” (emphasize errors/events). | SREs need to know why something failed. | No blank screens; every error path has message and action. | E2E. | Documented. |

### C3 — Security: RBAC, secrets, audit

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] C3.1 | RBAC and 403 propagation | `kubilitics-backend/internal/api/rest/`, K8s client | When using single identity, document “all users see same visibility.” Prefer per-request identity and map K8s 403 to API 403. | Enterprise expects “see only what you’re allowed.” | Design doc; 403 from K8s returned to client. | Integration test. | Identity model documented. |
| [x] C3.2 | Secrets handling | `kubilitics-backend/internal/api/rest/`, UI | Never log or expose secret values in API (mask or omit); optional redaction in YAML view; kubeconfig/tokens encrypted at rest if stored (keychain, encrypted DB). | Security review requirement. | Audit: no secrets in logs/API; storage doc. | N/A | Checklist and doc. |
| [x] C3.3 | Audit logging for mutations | `kubilitics-backend/internal/api/rest/`, audit package | Log create/update/delete with who, what, when, outcome; retention (e.g. 90 days); export for compliance. | “Who deleted this pod?” must be answerable. | Schema and retention doc; implementation for delete/apply. | N/A | At least delete/apply audited. |

### C4 — Desktop: secure and robust

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] C4.1 | Secure kubeconfig handling (desktop) | `kubilitics-desktop/src-tauri/`, docs | Do not log or display kubeconfig paths/tokens in plaintext; use OS keychain where possible; document secure handling. | Corporate security requirement. | Security checklist; no secrets in logs. | N/A | Doc and/or keychain use. |
| [x] C4.2 | Multiple kubeconfigs and validation | `kubilitics-desktop/src-tauri/src/commands.rs` | Support multiple kubeconfigs; validate and show connection errors per context; do not overwrite user kubeconfig without explicit action. | UX and safety. | Multiple configs; clear errors; read-only by default. | Manual. | Documented. |
| [x] C4.3 | Offline / degraded mode (desktop) | `kubilitics-frontend/src/` (when in Tauri), desktop | When backend or cluster unreachable: show status, cached data with “stale” indicator, retry. Do not pretend data is live. | User must know when data is stale. | UX spec; stale indicator; retry. | Manual. | Documented. |
| [x] C4.4 | Sidecar name and port alignment | `kubilitics-desktop/src-tauri/`, backend build | Sidecar binary “kubilitics-backend”; port (e.g. 8080) documented; frontend in Tauri uses http://localhost:PORT. | BackendManager uses 8080; binary name must match Tauri config. | Desktop dev starts backend; health 200. | Manual or E2E. | Doc + config aligned. |
| [x] C4.5 | Frontend uses backend URL when in Tauri | `kubilitics-frontend/src/` (config/store) | In Tauri env, set backend base URL to localhost:8080 (or from env). | Desktop must talk to sidecar. | Desktop app shows data from sidecar. | Manual. | No K8s URL needed when sidecar runs. |

---

## Phase D — Enterprise Readiness

**Goal:** Data isolation, zero-trust, secure defaults, SSO/identity (optional), compliance (retention, export).

**Dependencies:** Phase C.  
**Acceptance:** Isolation model documented; secure defaults and confirmations; optional SSO; retention matrix.

### D1 — Isolation, zero-trust, defaults

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] D1.1 | Data isolation model | `docs/`, API | Multi-tenant: namespace or cluster as boundary; no cross-tenant data. Single-tenant: document one instance = one org. | Regulated industries require isolation. | Doc and enforcement in API. | N/A | Documented and enforced. |
| [x] D1.2 | Zero-trust and secure defaults | `kubilitics-backend/internal/api/`, docs | Validate all inputs; authorize per request; HTTPS only; secure headers. Default read-only where possible; destructive actions require confirmation; no auto-apply of arbitrary YAML without review. | Enterprise security bar. | Checklist; confirmations for delete/apply. | N/A | Documented. |
| [x] D1.3 | Retention strategies | `docs/` | Document retention for audit logs, topology snapshots, resource history, metrics; deletion or archival. | Compliance. | Retention matrix. | N/A | Documented. |

### D2 — SSO and identity (optional / later)

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] D2.1 | SSO integration (SAML/OIDC) | Backend auth layer, frontend | Design and optionally implement: SSO for web/desktop; group-based access. | Enterprise expects SSO. | Design doc; optional implementation. | N/A | Doc or feature. |

---

## Phase R — Distribution & Delivery

**Goal:** Desktop and (optionally) mobile packaging, Helm chart, website deploy, CI/CD pipelines.

**Dependencies:** Phase B for MVP; Phase C recommended for enterprise.  
**Acceptance:** Build pipelines run; installers or artifacts produced; website live.

### R1 — Desktop build & distribution

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] R1.1 | Desktop build pipeline | `kubilitics-desktop/.github/workflows/` | Build for macOS (Intel + Apple Silicon), Windows x64, Linux x64/ARM64. | Ship desktop. | CI builds all platforms. | N/A | Artifacts in GitHub Actions. |
| [x] R1.2 | Code signing and notarization | `kubilitics-desktop/`, CI | macOS: Developer ID + notarization; Windows: code signing; Linux: GPG. Document. | Distribution requirement. | Signed/notarized where required. | N/A | Documented and implemented. |
| [x] R1.3 | Installers | `kubilitics-desktop/` | macOS: DMG/PKG; Windows: MSI/EXE; Linux: DEB, RPM, AppImage. | User install experience. | Installers produced in CI. | N/A | Documented. |
| [x] R1.4 | Native menus (desktop) | `kubilitics-desktop/src-tauri/src/menu.rs` | File (Open, Close, Quit), Edit (Cut, Copy, Paste), View (Refresh, Zoom), Help (Documentation, About). | UX. | Menus visible and functional. | Manual. | Optional for MVP. |
| [x] R1.5 | Auto-updater | `kubilitics-desktop/src-tauri/src/updater.rs` | Secure channel (HTTPS, signature); optional auto-update with user control; no silent unsigned code. | Security and UX. | Update flow documented. | N/A | Optional for MVP. |

### R2 — Helm and in-cluster deployment

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] R2.1 | Helm chart for backend | `deploy/helm/kubilitics/` or repo root | Chart: backend Deployment, Service, ConfigMap; values for kubeconfig, DB, ingress. | project-docs: in-cluster delivery. | helm install works. | N/A | Chart and README. |
| [x] R2.2 | Optional frontend in chart | Same | Optional frontend Deployment or static serve. | Single-command deploy. | Optional. | N/A | Documented. |

### R3 — CI/CD

| Task ID | Description | Folders / files | Add/change | Why | Verification | Tests | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|-------|---------------------|
| [x] R3.1 | GitHub Actions: backend, frontend, desktop | `.github/workflows/` | Backend: test, build, lint. Frontend: test, build. Desktop: build all platforms. | Quality and repeatability. | PR triggers tests and builds. | N/A | Workflows run. |
| [x] R3.2 | Test and report publishing | Same | Run backend tests, frontend tests, E2E; publish to test_reports/ (JUnit, Playwright). | Quality gate. | Artifacts in test_reports/ or CI. | N/A | Reports available. |
| [x] R3.3 | Release automation | Same | Semantic versioning; changelog; GitHub releases; asset uploads. | Repeatable releases. | Tag triggers release workflow. | N/A | Documented. |

---

## Phase O — Open-Source Readiness

**Goal:** License, CONTRIBUTING, SECURITY, release process, contributor-friendly docs.

| Task ID | Description | Folders / files | Add/change | Why | Verification | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|---------------------|
| [x] O1.1 | License and NOTICE | Root: `LICENSE`, `NOTICE` | LICENSE present; NOTICE if required by deps. | Open-source hygiene. | Files present. | Done. |
| [x] O1.2 | CONTRIBUTING and SECURITY | Root: `CONTRIBUTING.md`, `SECURITY.md` | CONTRIBUTING: run, test, PR; link this TASKS.md. SECURITY: report process. | Contributor and security policy. | Docs updated. | Done. |
| [x] O1.3 | Release process | `docs/` or README | Versioning, tagging, changelog, release notes. | Repeatable releases. | Documented. | Done. |

---

## Phase W — Website

**Goal:** Marketing/gateway site: landing, install links, optional docs.

| Task ID | Description | Folders / files | Add/change | Why | Verification | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|---------------------|
| [x] W1.1 | Landing and CTAs | `kubilitics-website/src/` | Product name, tagline, Get started / Install / GitHub. | Public gateway. | Manual check. | Links and copy in place. |
| [x] W1.2 | Install methods | Same | Section: desktop download, Helm, k3s/kind. | project-docs. | Links or placeholders. | Documented. |
| [x] W1.3 | Deploy website | CI, hosting | Deploy to Vercel/Netlify/GitHub Pages; custom domain; SSL. | Live site. | Public URL works. | Optional. |

---

## Phase MO — Mobile (After Desktop)

**Goal:** Scoped mobile flows (alerts, read-only, incident); push; security; build.

**Dependencies:** Phase B or C; desktop shipped.  
**Acceptance:** Documented mobile scope; optional build and store submission.

### MO1 — Mobile scope and backend connectivity

| Task ID | Description | Folders / files | Add/change | Why | Verification | Definition of done |
|--------|-------------|------------------|------------|-----|--------------|---------------------|
| [x] MO1.1 | Define mobile use cases | `project-docs/` or `docs/` | Primary: alerts (push), read-only cluster/resource view, incident ack. No “full desktop on mobile.” | Scope before build. | Doc: 3–5 flows. | Documented. |
| MO1.2 | Mobile API client and offline cache | `kubilitics-mobile/src-tauri/src/` | HTTPS client to backend; cache topology/last view for offline. No kubeconfig on device. | Connect via backend only. | Connects and caches. | Optional implementation. |
| MO1.3 | Push notifications (spec) | `docs/` | Payload and deep link for critical events (pod crash, node NotReady). APNs/FCM later. | Alerts are key mobile value. | Spec doc. | Optional. |
| MO1.4 | Biometric / PIN (optional) | `kubilitics-mobile/gen/` (iOS/Android) | Optional: Face ID/Touch ID / fingerprint to open app. | Security. | Doc or implementation. | Optional. |
| MO1.5 | Tauri mobile init and build | `kubilitics-mobile/` | `cargo tauri ios init`, `cargo tauri android init`; build; store submission steps doc. | tauri-mobile-implementation.md. | Build produces artifacts. | Optional. |

---

## Testing Strategy (Explicit)

- **Unit:** Backend: topology (graph, layout seed, relationships), ClusterService (mock repo), TopologyService. Frontend: API client, topology store, ≥1 resource hook. Run: `go test ./...`; `npm run test`.
- **Integration:** Backend: HTTP API tests with mock K8s (clusters, resources, topology). Run: part of `go test` or script.
- **E2E:** Playwright: ≥1 flow (e.g. start app → load topology or list resources). Run: `npx playwright test`; reports in test_reports/playwright.
- **Test data:** Fixtures in `tests/fixtures/` (topology JSON, cluster list, resource list; optional test-cluster.yaml for kind). No production data.
- **Test reports:** Output under `test_reports/` (backend/, frontend/, playwright/). CI publishes; directory structure committed (e.g. .gitkeep).

---

## Known Gaps and Quality Bar

**Known gaps (fix via tasks above):**
- Frontend–backend data path: resolve in A1, A3 (backend as gateway; no mocks when connected).
- Cluster persistence: A2.1.
- Resource handlers placeholders: A2.2–A2.4.
- Topology contract (Type vs kind): A1.2, A2.5.
- Topology page mock: A3.4.
- Logs/Events/Metrics: A2.7, B1.1–B1.3.
- One-command run: B3.1–B3.3.
- Tests directory and E2E: B4.1–B4.5.
- Scale, security, audit: Phase C and D.

**Quality bar:**
- Backend: Stripe-level clarity (errors, logging, API shapes).
- Frontend: Linear-level UX (states, loading, errors).
- Kubernetes-native: GVR, namespaces, RBAC respected.
- Open-source: Contributor-friendly docs and CONTRIBUTING.

---

## Execution Strategy

- **MVP (ship to early users):** Complete Phase A and Phase B; Phase R (desktop build, one-command run, CI); Phase O; Phase W (landing + install). No mocks in production code paths; secure credential handling; error and recovery paths; backend observable.
- **Enterprise pilot:** Add Phase C (scale, RBAC, secrets, audit) and Phase C4 (desktop security/offline). Then Phase D as needed.
- **Day 1 must be right:** No mock data in default flow; secure handling of credentials; error paths and recovery; observability (logs + metrics).
- **Can evolve:** Scale limits (start single/few clusters, namespace-scoped topology); SSO after RBAC/audit; mobile and website after desktop; AI/ML after core.

---

## Document History

| Version | Date       | Changes |
|---------|------------|---------|
| 1.0     | 2026-02-04 | Initial TASKS.md (foundation, M1–M9). |
| 2.0     | 2026-02-04 | Merged TASKS.md + Claude-TASKS.md + TASKS_ENTERPRISE_GRADE.md into single execution roadmap with phased tasks (A–D, R, O, W, MO). |

---

*Single execution roadmap. Verify completion against the repo; do not rely on “complete” claims from prior documents.*
