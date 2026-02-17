# Kubilitics — Enterprise-Grade Task Plan (TASKS_ENTERPRISE_GRADE.md)

**Version:** 1.0  
**Date:** 2026-02-04  
**Status:** Additive and corrective to TASKS.md and Claude-TASKS.md  
**Bar:** “Would this survive real production usage in a Fortune 500 company?”

This document pressure-tests Kubilitics against real companies, real clusters, real incidents, and scale to millions of users. It is **additive and corrective**: it does not replace TASKS.md but elevates it to enterprise-grade by filling gaps, removing blind spots, and defining what must be perfect on Day 1 vs what can evolve.

---

## Quick Comparison: TASKS.md vs Claude-TASKS.md

| Aspect | TASKS.md | Claude-TASKS.md |
|--------|----------|------------------|
| **Tone** | Planning-only; honest about placeholders and mocks | Claims “production ready,” “complete”; many tasks marked done |
| **Ground truth** | Aligned with repo: cluster in-memory, resource handlers placeholders, topology mock, logs/metrics/events 501 | Asserts backend/desktop “complete” and “21 tests passing”; contradicts repo (ClusterService no repo, handlers return placeholders) |
| **Structure** | 9 milestones (M1–M9); per-task: why, verification, tests, DoD | Phases 1–9; checklist style [x]/[ ]; more granular tasks |
| **Integration** | Explicit: frontend→backend as gateway; remove mocks; one data path | “Frontend 100% complete (external repo)”; desktop frontend integration “NOT STARTED” |
| **Testing** | Unit, integration, E2E, fixtures, test_reports; one-command test | Unit tests “done”; integration “blocked on K8s”; E2E/infra “to be created” |
| **Enterprise** | Not addressed | Phase 9 “Enterprise (Future)”; SSO, multi-cluster, SOC2 deferred |
| **Use** | Single execution reference; fixes known gaps | Useful task breakdowns for backend/desktop/mobile; completion status should be re-verified against codebase |

**Conclusion:** Use **TASKS.md** as the execution source of truth (it matches repo reality). Use **Claude-TASKS.md** for task granularity and phase ideas, but re-verify every “complete” item against actual code. **TASKS_ENTERPRISE_GRADE.md** (this document) adds what both lack for enterprise: scale, failure, security, observability, and a clear MVP vs Enterprise split.

---

## 1. Gap Analysis

### 1.1 What Existing TASKS.md Does Well

- **Honest about current state:** Calls out frontend→K8s API vs backend gateway, cluster in-memory, placeholder resource handlers, topology mock, logs/events/metrics 501. No false “production ready” claims.
- **Single data path:** Decides and documents backend as gateway when present; tasks to remove or gate mocks (M1, M3).
- **Contract-first:** Defines canonical API and topology response shape; aligns backend and frontend (M1.2, M2.5).
- **Persistence:** Task to wire ClusterService to repository so clusters survive restart (M2.1).
- **Verification per task:** Each task has folders/files, add/change, why, verification, tests, definition of done.
- **Testing and local E2E:** Unit, integration, E2E, fixtures, test_reports, one-command dev and test (M6, M7).
- **Known gaps section:** Explicit list of hacky or missing items with corresponding tasks.
- **Quality bar:** Stripe-level backend, Linear-level UX, Kubernetes-native, open-source friendly.

### 1.2 What Is Missing

- **Multi-cluster at scale:** No tasks for many clusters (10s–100s), cluster health aggregation, or connection pooling/per-cluster limits. “Current cluster” is assumed; no explicit multi-cluster UX or backend strategy.
- **Large-cluster behavior:** No tasks for 1000s of nodes, pagination/cursor for topology, incremental graph updates, or backend timeouts/memory limits. Project-docs mention “10K nodes in &lt;2s” but no task for validating under load or degrading gracefully.
- **Real RBAC:** No task for propagating K8s RBAC to API responses (403, filtered lists). Backend may return data the user is not allowed to see if it uses a single service account.
- **Failure and recovery:** No tasks for: backend crash recovery, WebSocket reconnection with backoff, cluster unreachable handling (timeouts, retries, circuit breaker), or partial failure (some clusters up, some down).
- **Observability of Kubilitics itself:** No tasks for metrics (request latency, error rate, topology build time), tracing, or structured logging for the backend. You cannot run this in production without knowing how it behaves.
- **Caching and performance:** No tasks for response caching (e.g. topology per cluster/namespace), cache invalidation on watch events, or rate limiting to protect the K8s API.
- **Frontend at scale:** No tasks for virtualized lists (1000s of resources), lazy loading of topology, or real-time updates via WebSocket (instead of polling). No SRE-focused UX (incident mode, quick filters, error transparency).
- **Desktop/mobile enterprise:** No tasks for kubeconfig security (no plaintext on disk in docs), offline/degraded mode behavior, or OS-specific security (keychain, attestation).
- **Audit and compliance:** No tasks for audit logging (who did what to which resource), retention, or read-only export for compliance.

### 1.3 What Is Dangerously Underestimated

- **Logs, events, metrics:** TASKS.md allows “501 and document.” For enterprise, “we don’t have logs/metrics/events” is a deal-breaker. SREs need real pod logs, real events, and real metrics (from Metrics Server or Prometheus). Treating these as optional underestimates their importance.
- **Real-time updates:** Relying on polling or “later we’ll add WebSocket” underestimates the need for instant feedback during incidents. WebSocket (or equivalent) should be part of the core integration contract, not a follow-up.
- **Security of credentials:** Assuming “kubeconfig on disk” or “token in env” is enough underestimates enterprise requirements: keychain, short-lived tokens, and no long-lived secrets in config files.
- **Topology at scale:** “10K nodes” in docs with no explicit task for streaming, chunking, or “topology of namespace X only” will lead to OOM or timeouts on large clusters. This must be designed in, not patched later.

### 1.4 What Would Break in Real Production

- **Single process, no HA:** Backend is one process. No task for horizontal scaling, leader election, or stateless design with externalized state. One crash = full outage.
- **In-memory cluster map:** Until M2.1 is done, clusters are in-memory; restart loses all connections. Even after M2.1, reconnecting 50 clusters on startup could overwhelm the K8s API or hang the process.
- **No rate limiting:** Unbounded requests to the K8s API from multiple users or tabs can trigger throttling (429) or get the service account blocked.
- **No request timeouts:** Long-running topology build or list could hold connections indefinitely; no task for context timeout and propagation.
- **WebSocket without backpressure:** Many clients receiving full topology pushes could overwhelm the server or clients; no task for incremental deltas or subscription scoping.
- **Frontend:** Large lists without virtualization will freeze the UI; topology with 10K nodes in the DOM without canvas virtualization will crash the tab.
- **Desktop:** Sidecar crash loop or port conflict with no user-visible recovery path; kubeconfig path assumptions that break on locked-down corporate machines.

### 1.5 What Would Block Enterprise Adoption

- **No RBAC model:** Enterprise expects “users see only what they’re allowed to.” If Kubilitics uses one identity to talk to K8s, it cannot enforce per-user visibility. Tasks for “backend as proxy with user identity” or “per-user kubeconfig” are missing.
- **No audit trail:** “Who deleted this pod?” must be answerable. No task for audit logging of mutating operations and retention.
- **No SSO / identity:** Enterprise expects SAML/OIDC and group-based access. Both TASKS documents defer this to “future”; for paid enterprise, it is a Day-1 expectation in many orgs.
- **No multi-tenancy or isolation:** Multiple teams using one Kubilitics instance with no namespace or cluster isolation is a non-starter for regulated industries.
- **Secrets handling:** Displaying secrets in UI, or storing kubeconfig/tokens without encryption at rest, will fail security review.
- **No SLA or observability:** No defined SLOs (e.g. p99 latency for topology), no metrics export (Prometheus), no runbooks. Operations cannot adopt a black box.

---

## 2. Enterprise Capability Additions

### 2.1 Backend

| Task ID | Description | Why | Definition of done |
|--------|-------------|-----|---------------------|
| E-BE-1 | **Real Kubernetes API interactions** | All resource and topology calls must use client-go with context timeout, retry with backoff for 5xx/429, and propagate RBAC (403) and NotFound (404) to API response. No silent fallbacks to empty data. | Contract: timeout and retry policy documented; 403/404 mapped to JSON error codes; integration test with mock that returns 403/429. |
| E-BE-2 | **Multi-cluster handling** | Support N clusters (e.g. N &lt; 100 initially). Per-cluster connection lifecycle, health check, and optional connection limit. List clusters with status (connected / disconnected / error). | Backend can register many clusters; GET /clusters returns status; unhealthy clusters do not bring down the process. |
| E-BE-3 | **Scaling strategies** | Document and implement: stateless backend (no in-process cluster state that cannot be recreated from DB); optional read-through cache for topology/list with TTL and invalidation on watch; pagination/cursor for list and topology (e.g. namespace-scoped or chunked). | Design doc; at least one of: topology cache, list pagination, or namespace-scoped topology; no single request that loads full cluster into memory. |
| E-BE-4 | **Caching & performance** | Cache topology per (clusterId, namespace, filters) with TTL (e.g. 30s); invalidate on WebSocket resource update for that cluster/namespace. Rate limit outbound calls to K8s API per cluster (e.g. token bucket). | Cache hit/miss observable; invalidation on event; rate limiter in place; no thundering herd on topology. |
| E-BE-5 | **Observability of Kubilitics itself** | Structured logging (JSON) with request ID, cluster ID, duration; Prometheus metrics: request count by path/status, latency histogram, topology_build_duration_seconds, websocket_connections_active; optional tracing (OpenTelemetry). | Logs and metrics consumable by standard tools; dashboard or runbook that uses them. |
| E-BE-6 | **Failure handling** | Graceful shutdown (drain WebSocket, finish in-flight requests); circuit breaker or backoff per cluster on repeated connection failure; timeout on topology build (e.g. 30s) return 503 with partial result or error; WebSocket reconnect with exponential backoff and max retries. | Documented behavior; no unbounded wait; reconnection tested. |
| E-BE-7 | **Data modeling for large clusters** | Support “topology for namespace X” or “topology for resource Y and N-hop neighborhood” to bound size; stream or paginate node/edge list for very large graphs; document max recommended nodes/edges per response. | API supports scoped topology; docs state limits; 10K-node scenario tested or documented as out-of-scope for single request. |

### 2.2 Frontend

| Task ID | Description | Why | Definition of done |
|--------|-------------|-----|---------------------|
| E-FE-1 | **Handling large datasets** | Virtualized lists for resource tables (e.g. react-window or similar); lazy load or paginate; topology canvas must not mount 10K DOM nodes—use canvas or WebGL and limit visible nodes or use clustering. | List of 1000+ items scrolls without freeze; topology with 1K+ nodes renders without tab crash. |
| E-FE-2 | **Real-time updates (not polling)** | Consume WebSocket for resource/topology updates; apply deltas to local state; no polling as primary mechanism for list or topology. | UI updates within seconds of K8s change when WebSocket connected; documented fallback (e.g. polling) only when WebSocket unavailable. |
| E-FE-3 | **UX for SREs under stress** | Clear error states (backend down, cluster unreachable, 403, timeout); retry and “back to cluster list” actions; optional “incident mode” (e.g. hide non-critical UI, emphasize errors and events). | No blank screens; every error path has message and action; optional compact/incident layout. |
| E-FE-4 | **Accessibility & performance** | WCAG 2.1 AA for critical paths (cluster list, resource list, topology); keyboard navigation; focus management. Performance: LCP &lt; 2.5s, no long tasks &gt; 50ms on interaction. | Audit or test; documented a11y and perf targets. |
| E-FE-5 | **State management at scale** | Normalized cache for resources (by cluster/kind/namespace/name); invalidation on WebSocket event; avoid duplicate fetches; optional optimistic updates for mutations with rollback on error. | Single source of truth per resource; no duplicate requests for same resource; rollback on failure. |
| E-FE-6 | **Error transparency** | Surface API error code and message (e.g. 403 Forbidden, 504 Gateway Timeout); log request ID for support; optional “copy error for support” action. | User sees why something failed; support can correlate with backend logs. |

### 2.3 Desktop App

| Task ID | Description | Why | Definition of done |
|--------|-------------|-----|---------------------|
| E-DT-1 | **Secure local cluster access** | Do not log or display kubeconfig paths or tokens in plaintext in logs or UI; use OS keychain for stored credentials where possible; document secure kubeconfig handling. | Security review checklist; no secrets in logs; keychain use documented or deferred with task. |
| E-DT-2 | **Kubeconfig management** | Support multiple kubeconfigs; validate and show connection errors per context; avoid overwriting or modifying user kubeconfig without explicit action. | Multiple configs; clear errors; read-only by default. |
| E-DT-3 | **Offline / degraded modes** | When backend or cluster is unreachable: show clear status, cached data (if any) with “stale” indicator, and retry option. Do not pretend data is live. | UX spec; stale indicator; retry and back to list. |
| E-DT-4 | **OS-specific considerations** | macOS: notarization, keychain; Windows: code signing, credential manager; Linux: portal/secret service. Document and implement per platform. | Per-OS doc; at least one secure credential path per platform or explicit “not yet” task. |
| E-DT-5 | **Update strategy** | Secure update channel (HTTPS, signature verification); optional auto-update with user control; no silent execution of unsigned code. | Update flow documented; signature verification; user can disable auto-update. |

### 2.4 Mobile App

| Task ID | Description | Why | Definition of done |
|--------|-------------|-----|---------------------|
| E-MO-1 | **Real use cases** | Define primary mobile scenarios: e.g. alerts (push), read-only cluster/resource view, incident acknowledgment. No “full desktop on mobile”; scope to 3–5 concrete flows. | Documented mobile scope; tasks only for those flows. |
| E-MO-2 | **Push notifications** | Alerts for critical cluster/resource events (e.g. pod crash, node NotReady); link to resource or cluster in app; respect Do Not Disturb. | Push payload and deep link spec; implementation or stub with task. |
| E-MO-3 | **Security constraints** | No kubeconfig on device; connect via backend or authenticated API only; optional biometric to open app; no sensitive data in screenshots (e.g. blur secrets). | Security doc; no raw kubeconfig on mobile; biometric or PIN optional. |
| E-MO-4 | **Minimal but powerful UX** | Read-only list and detail for key resources; topology as simplified view or link to web; fast load and offline cache for last view. | Defined mobile screens; performance target; offline cache for one cluster/view. |

---

## 3. Security, Trust & Compliance

| Task ID | Description | Why | Definition of done |
|--------|-------------|-----|---------------------|
| E-SEC-1 | **RBAC** | Backend: when acting on behalf of a user, use user’s credentials or token and pass through to K8s; when using service account, document that all users see same visibility. Prefer per-request identity and map 403 from K8s to API. | Design: identity model (per-user vs service account); 403 propagation; doc. |
| E-SEC-2 | **Secrets handling** | Never log or expose secret values in API response (mask or omit); optional redaction in YAML view; kubeconfig/tokens encrypted at rest if stored (e.g. keychain, encrypted DB). | Audit: no secrets in logs/API; storage doc. |
| E-SEC-3 | **Audit logs** | Log all mutating operations (create/update/delete) with who (identity), what (resource), when, outcome. Retention policy (e.g. 90 days); export for compliance. | Schema and retention doc; implementation for at least delete/apply. |
| E-SEC-4 | **Data isolation** | Multi-tenant: namespace or cluster as boundary; no cross-tenant data in same response. Single-tenant: document that one instance = one org. | Isolation model documented and enforced in API. |
| E-SEC-5 | **Zero-trust assumptions** | Validate all inputs; no trust of client for authorization (authorize per request); HTTPS only; secure headers (CSP, HSTS where applicable). | Checklist; no authz based solely on client claim. |
| E-SEC-6 | **Secure defaults** | Default to read-only where possible; destructive actions require explicit confirmation; no auto-apply of arbitrary YAML without review option. | Defaults documented; confirmations for delete/apply. |

---

## 4. Data & Observability (NO MOCKS)

| Task ID | Description | Why | Definition of done |
|--------|-------------|-----|---------------------|
| E-OBS-1 | **Real metrics ingestion** | Backend integrates with cluster Metrics Server or Prometheus (if present) for pod/node metrics; API exposes metrics for list/detail (CPU, memory, etc.); no fake or static metrics. | Real metrics in API response when available; 501 or empty when metrics not available, documented. |
| E-OBS-2 | **Real logs** | Pod log streaming from K8s API (stdout/stderr); support container selection, tail, and follow; no mock log content. | Same as project-docs logs service; integration test with real pod. |
| E-OBS-3 | **Real events** | Kubernetes events from API; filter by namespace, resource, type; stream via WebSocket; no static event list. | Events endpoint and WebSocket event type implemented and tested. |
| E-OBS-4 | **Correlation across resources** | Events and topology reference same resource IDs; link from event to resource detail and to topology node; optional “show events for this node” in topology. | Consistent IDs; at least one correlation path (e.g. event → resource). |
| E-OBS-5 | **Historical data** | Optional: store time-series of topology or metrics for “history” or “trend”; retention (e.g. 7 days) and storage format. | Design doc; optional implementation with retention. |
| E-OBS-6 | **Retention strategies** | Document retention for: audit logs, topology snapshots, resource history, and any stored metrics; deletion or archival process. | Retention matrix; implementation or explicit “not stored” for each data type. |

---

## 5. Market & Product Reality Check

### 5.1 Conceptual Comparison (Raise the Bar Only)

- **Lens / OpenLens:** Strong desktop UX, multi-cluster, extensions. Kubilitics differentiator: topology-first, relationship accuracy, and WYSIWYG export. Must match or exceed Lens on cluster switching and resource list performance.
- **Kubernetes Dashboard:** Reference for RBAC and read-only views. Kubilitics must not be worse on permission model and clarity of “you don’t have access.”
- **Datadog / Grafana:** Observability and metrics are their core. Kubilitics does not need to replace them but must integrate (e.g. link to Grafana, or ingest Prometheus metrics) and not ship fake metrics.
- **Rancher / Argo:** Multi-cluster and GitOps. For enterprise, “manage many clusters” and “approval workflows” will be expected; Kubilitics can differentiate on topology and UX first, then add multi-cluster and GitOps.

### 5.2 Differentiation Opportunities

- **Topology as the source of truth:** One graph, all relationships, deterministic layout, WYSIWYG export. Competitors often treat topology as secondary.
- **Desktop-first, offline-capable:** Native app with local backend fits air-gapped and locked-down environments.
- **Single coherent platform:** Web, desktop, mobile from one codebase and one API contract.

### 5.3 Must-Have vs Nice-to-Have (Enterprise Lens)

| Must-have for enterprise | Nice-to-have (can evolve) |
|--------------------------|----------------------------|
| Real K8s data (no mocks) | AI/ML recommendations |
| RBAC and audit trail | SSO (can follow after RBAC) |
| Multi-cluster with status | 100+ clusters in one view |
| Real logs, events, metrics | Long-term history and trends |
| Secure credential handling | Biometric on mobile |
| Observability of Kubilitics itself | Custom dashboards |
| Graceful failure and recovery | Native menus and tray |
| Scalable topology (scoped/paginated) | 10K nodes in one view |

---

## 6. Updated Execution Strategy

### 6.1 Phased Rollout Plan

- **Phase A — Foundation (current TASKS.md M1–M3):** Integration model, contract, persistence, real resource and topology APIs, frontend using backend, no mocks in critical path. **Must complete before any “production” claim.**
- **Phase B — Reliability and observability:** E-BE-5 (observability), E-BE-6 (failure handling), E-OBS-1 to E-OBS-3 (real metrics, logs, events), E-FE-2 (real-time updates). **Required for production use by a single team.**
- **Phase C — Scale and security:** E-BE-2, E-BE-3, E-BE-4 (multi-cluster, scaling, caching), E-BE-7 (large-cluster topology), E-SEC-1, E-SEC-2, E-SEC-3 (RBAC, secrets, audit). **Required for multi-team or enterprise pilot.**
- **Phase D — Enterprise readiness:** E-SEC-4, E-SEC-5, E-SEC-6 (isolation, zero-trust, secure defaults), SSO/identity, compliance (retention, export). **Required for broad enterprise adoption.**

### 6.2 MVP vs Enterprise Split

- **MVP (ship to early users):** Phase A + Phase B. One cluster or few clusters; real data; real-time; observable; no mocks in core paths; secure credential handling and audit for mutating operations.
- **Enterprise:** Phase C + Phase D. Multi-cluster at scale, RBAC and audit, SSO, compliance, and documented SLOs and runbooks.

### 6.3 What Must Be Perfect on Day 1

- **No mock data in production code paths:** Topology, list, detail, logs, events, metrics must come from K8s or be explicitly “unavailable” (501 or empty with reason). No static JSON or fake data in default flow.
- **Secure handling of credentials:** No plaintext kubeconfig/tokens in logs or UI; use keychain or encrypted storage where available.
- **Error paths and recovery:** Every critical path has defined behavior on timeout, 403, 404, and cluster down; frontend shows message and retry or exit.
- **Observability:** Logs and metrics for the backend so operators can run it in production.

### 6.4 What Can Evolve Safely

- **Scale limits:** Start with “single cluster or few clusters” and “namespace-scoped topology”; add multi-cluster and very large topology in Phase C.
- **SSO and advanced RBAC:** After per-request identity and audit are in place, add SAML/OIDC and group-based access.
- **Mobile and website:** After desktop and web are stable and observable, expand to mobile and marketing site.
- **AI/ML features:** After core topology and observability are solid, add recommendations and insights.

---

## 7. Document History

| Version | Date       | Changes |
|---------|------------|---------|
| 1.0     | 2026-02-04 | Initial TASKS_ENTERPRISE_GRADE.md: gap analysis, enterprise capabilities, security, observability, market check, execution strategy. |

---

*Additive and corrective. No code. No mock logic in production paths. Every critical system must have error paths, recovery paths, and observability.*
