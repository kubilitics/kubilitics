# Kubilitics Production Reliability Audit

**Date:** 2026-10-02
**Scope:** Read-only investigation of `kubilitics-backend`, `kubilitics-frontend`, and supporting services (brain, agent, CLI, trace-agent where relevant) against 11 customer-reported production problems.
**Method:** 6 independent read-only investigations (one per problem domain group), each required to trace actual execution paths with file:line evidence and label every claim CONFIRMED / HIGH / MEDIUM / LOW / UNVERIFIED. No code was modified to produce this audit. No live cluster was available during this pass — all evidence is static code analysis plus, where noted, isolated scratch reproductions (not committed to the repo).

---

## Executive Summary

Kubilitics' core intelligence engines (blast-radius scoring, topology relationship resolution, the Fleet overview endpoint) are **well-engineered where they've been hardened**: informer-cached, cycle-safe BFS, bounded concurrency via `errgroup`, atomic snapshot swaps. The problems are not "the architecture is wrong" — they are **inconsistent application of patterns that already exist correctly somewhere else in the same codebase**.

Five systemic root causes explain nearly all 24 findings below:

1. **Timeout/cancellation is opt-in per call-site, not structural** — on both sides of the HTTP boundary. One correct example (`getHealth()`'s `AbortSignal.timeout()`, the Fleet overview's `errgroup` fan-out) sits next to multiple call sites that forgot to apply the same pattern.
2. **Duplicate, divergent data-collection paths** — features re-implement live Kubernetes API collection instead of reusing informer caches that already exist for the same resource types.
3. **Scoping/filter parameters are plumbed on the frontend only** and silently never reach the backend query they're meant to narrow.
4. **"Health" and "freshness" are not first-class concepts** — one code path hardcodes a value that looks like a real check but isn't; another never records when it last checked anything.
5. **No canonical unit-conversion utility** for Kubernetes quantities — ~10 independent hand-rolled parsers on the frontend alone.

Two confirmed P0s directly explain customer-reported symptoms verbatim: **STARTUP-1** (sequential per-cluster connect loop blocking the HTTP listener bind — explains ">30s reopen") and **HEALTH-1** (presence layer hardcodes `Reachable: true` for every cluster, unconditionally — explains "stale HEALTHY" exactly). **COUNTS-1** explains the "36 nodes / 7,720 pods" class of symptom via a confirmed, reproduced control-flow bug. **TOPOLOGY-1** explains "topology loads forever" via a confirmed dead parameter (namespace selection never reaches the backend). **LOADING-1** is the single highest-leverage fix in the whole audit: the frontend's shared fetch wrapper has no timeout at all, so *any* backend hang on *any* page becomes an infinite spinner with no error, no retry, by construction.

---

## Repository Reality

Kubilitics is a multi-service monorepo:

- `kubilitics-frontend/` — React 18 + TypeScript, Zustand + React Query, deployed inside a Tauri desktop shell (desktop shell files are currently deleted/untracked in the working tree — out of scope for this audit).
- `kubilitics-backend/` — Go backend; owns Kubernetes connectivity (`internal/k8s/`), cluster registry/lifecycle (`internal/service/cluster_service.go`), informer-backed caches (`internal/service/overview_cache.go`, `internal/k8s/informer.go`), REST API (`internal/api/rest/`), WebSocket hub (`internal/api/websocket/`), topology engines — **two parallel implementations**: V1 (`internal/topology/`, actively used by the Topology page) and V2 (`internal/topology/v2/`, used only by the Blast Radius tab's canvas and partially by features that assume it's the only implementation), and the blast-radius scoring engine (`internal/graph/`).
- `brain/`, `kubilitics-agent/`, `kubilitics-cli/`, `kubilitics-trace-agent/` — separate services (AI layer, cluster-side agent, CLI, tracing); not implicated in any of the 11 reported problems and were correctly out of scope for all 6 investigations.
- Discovery/presence subsystem (`internal/cluster/discovery/`, `internal/cluster/presence/`) is **architecturally separate** from the connectivity/registry subsystem (`internal/service/cluster_service.go`) — this split is real, intentional, and mostly correct, but it is also the source of HEALTH-1 (two inconsistent health concepts).

Existing project docs (`docs/TOPOLOGY-API-CONTRACT.md`, blast-radius vision docs referenced in prior project memory) were checked against code; no direct contradictions were found except the V1/V2 topology divergence noted in TOPOLOGY-3, and a stale code comment referencing V2's pod-aggregation from a V1 code path.

---

## Production Failure Inventory

Severity is deliberately conservative per the audit's own classification rules (P0 = data corruption / misleading production state / app unusable; P1 = major functionality broken/unreliable; P2 = significant usability/performance problem; P3 = minor / informational).

### P0 Findings

#### STARTUP-1 — Sequential, 8s-per-cluster synchronous connect loop blocks HTTP server bind
- **Severity:** P0
- **Area:** startup / kubeconfig-discovery
- **Observed Behavior:** Closing/reopening the app can take >30 seconds.
- **Evidence:** `kubilitics-backend/cmd/server/main.go:413` calls `clusterService.LoadClustersFromRepo(ctx)` synchronously, ~750 lines before the `http.Server`/listener is constructed (`main.go:1168`) — the server cannot bind until this returns. `internal/service/cluster_service.go:706-753`, `LoadClustersFromRepo`, is a plain `for _, c := range clusters` loop (no goroutines), each iteration calling `client.TestConnection(testCtx)` bounded by `loadStartupTimeout = 8 * time.Second` (line 700). A secondary, smaller contributor: on first run with an empty DB, `main.go:434-440` auto-loads every kubeconfig context via `AddCluster`, also sequential, capped at 5s each (`cluster_service.go:424`).
- **Root Cause:** For N persisted clusters, worst-case boot-blocking time before the HTTP listener binds is `N × 8s`. A handful of stale/VPN-dependent contexts (plausible for the target "100+ cluster enterprise architect" persona) reaches the reported >30s directly.
- **Confidence:** CONFIRMED
- **Affected Components:** `cmd/server/main.go`, `internal/service/cluster_service.go` (`LoadClustersFromRepo`, `addClusterWithSource`)
- **User Impact:** Severe — the entire app is unusable, not just slow, for the full duration; this is a liveness-of-the-whole-app issue proportional to how many stale clusters exist in the user's kubeconfig.
- **Systemic Cause:** Root Cause A/B (below) — the correct fan-out pattern (`errgroup`) already exists in `internal/api/rest/fleet.go`'s `GetFleetOverview` and simply wasn't reused here.
- **Recommended Fix:** Parallelize `LoadClustersFromRepo` using the same bounded `errgroup` fan-out already proven in `fleet.go`; and/or bind the HTTP listener first, mark clusters "connecting" asynchronously, matching the "Headlamp/Lens" pattern already referenced in frontend code comments.
- **Regression Test:** Add a test with 5 clusters pointed at unroutable IPs asserting total `LoadClustersFromRepo` wall-clock time stays under ~10s (not ~40s). No such test exists today (`TestClusterConnectionFailure_Handling` only covers one cluster).
- **Dependencies:** Overlaps with KUBECONFIG-1 (same code path, different framing); fix pattern should be shared with FLEET-1's existing correct implementation.
- **Phase:** 4 (Startup & Fleet), secondary Phase 2 (Cluster Lifecycle)

#### LOADING-1 — Shared frontend fetch wrapper has no timeout or abort signal
- **Severity:** P0
- **Area:** frontend-query
- **Observed Behavior:** Multiple pages can remain in a loading state indefinitely.
- **Evidence:** `kubilitics-frontend/src/services/api/client.ts:196-201` (`backendRequest`) and `:314-317` (`backendRequestText`) call `fetch(url, {...init, headers})` with **no `signal`/`AbortSignal.timeout`**. The same file's `getHealth()` (`client.ts:379`) correctly uses `AbortSignal.timeout(5000)` — proof the pattern is known but not applied to the primary data path. A repo-wide grep for `AbortSignal|AbortController` found usage in ~20 files, never in `resources.ts`, `clusterHealth.ts`, `metrics.ts`, or `topology.ts` — all of which route through `backendRequest`.
- **Root Cause:** `fetch()` without an abort/timeout signal only resolves when the server sends bytes or the OS tears down the socket — neither is guaranteed if an upstream handler hangs (see LOADING-3, LOADING-4, TOPOLOGY-2).
- **Confidence:** CONFIRMED
- **Affected Components:** Effectively every REST-backed page in the app — `useKubernetes.ts` (1000+ call sites), `useClusterOverview.ts`, `useClusterHealth.ts`, `useClusterTopology.ts`, metrics, shell, reports, schedules.
- **User Impact:** A spinner that never resolves with no error UI — React Query's `isLoading` only flips once its promise settles, and this promise never does.
- **Systemic Cause:** Root Cause A — the one shared choke-point for ~90% of HTTP calls never enforces a deadline; the one place that does is the exception, not the rule.
- **Recommended Fix:** Add a hard client-side timeout (e.g. 15-20s) via `AbortSignal.timeout()` inside `backendRequest`/`backendRequestText` directly, so every caller inherits it for free; surface the resulting abort as a normal error so existing `AsyncSection`/error-boundary UI can render retry instead of an infinite skeleton.
- **Regression Test:** Add a simulated-hang test against `backendRequest` asserting it rejects within the configured timeout. None found today.
- **Dependencies:** None — purely additive.
- **Phase:** 1 (Reliability Foundation)

#### TOPOLOGY-1 — Namespace selection never reaches the backend; every view triggers a full cluster-wide build
- **Severity:** P0
- **Area:** discovery
- **Observed Behavior:** Topology can load forever, regardless of what namespace scope the user selects.
- **Evidence:** `kubilitics-frontend/src/topology/hooks/useTopologyData.ts:168` calls `useClusterTopology({ clusterId, depth, enabled })` — **never passing `namespace`**, even though `useClusterTopology` (`kubilitics-frontend/src/hooks/useClusterTopology.ts:30-41`) accepts it. The parameter resolves to `undefined`, so the backend's `GetTopology` handler (`kubilitics-backend/internal/api/rest/handler.go:1316-1317`) sets `filters.Namespace = ""`, which `discoverResources` (`internal/topology/engine.go:102-105`) treats as `metav1.NamespaceAll` — every one of 25 discovery calls lists cluster-wide, every time. A code comment at `TopologyPage.tsx:128` explicitly warns "Empty set = All Namespaces = 735 resources = system freeze" — that exact scenario is what happens on every single request.
- **Root Cause:** Namespace scoping was only ever implemented client-side (post-fetch filtering); the server-side parameter exists in the hook's signature but is dropped by its only caller.
- **Confidence:** CONFIRMED
- **Affected Components:** discovery, relationship-resolution (operates on the full graph), serialization (full graph transmitted), frontend-render (client re-filters after the fact).
- **User Impact:** Every topology load, no matter how scoped in the UI, pays worst-case backend cost.
- **Systemic Cause:** Root Cause C — a feature's two halves (depth scoping done server-side, namespace scoping done client-side only) were never wired together.
- **Recommended Fix:** Thread the selected namespace through `useTopologyData` → `useClusterTopology` → `getTopology` so the backend actually scopes its 25 `List()` calls; keep client-side filtering as a secondary defense layer only.
- **Regression Test:** Add an integration test asserting the network request query string reflects the UI's namespace selection. None found today.
- **Dependencies:** Compounds with TOPOLOGY-2 and TOPOLOGY-3.
- **Phase:** 5 (Topology)

#### COUNTS-1 — Live pod counter drifts upward permanently via unhandled `DeletedFinalStateUnknown`
- **Severity:** P0
- **Area:** counts / caching
- **Observed Behavior:** Pod counts on the live Dashboard (Overview/`ClusterCapacity`/`LiveSignalStrip`) can drift arbitrarily upward over the backend process's lifetime and never self-correct — the exact shape of a "36 nodes / 7,720 pods" symptom.
- **Evidence:** `kubilitics-backend/internal/service/overview_cache.go:292-366` (`updatePodStatus`) maintains the pod count via `ov.Counts.Pods++`/`--`, keyed by a `podPhases[clusterID][uid]` map, driven directly by informer ADD/MODIFIED/DELETED events. Every *other* counter in the same file (`updateNodeCount`, `updateNamespaceCount`, `updateDeploymentCount`, `updateDaemonSetCount`, `updateStatefulSetCount`) instead recomputes from `len(informer.GetStore(Kind).List())` on every event — self-healing regardless of a missed event. `updatePodStatus` requires `obj.(*corev1.Pod)` to succeed (line 301-304); on failure it silently returns **before** decrementing or cleaning up `phases[uid]`. Client-go's documented behavior is that `DeleteFunc` can receive a `cache.DeletedFinalStateUnknown` wrapper (not `*corev1.Pod`) on an inferred-from-relist delete. A repo-wide grep for `DeletedFinalStateUnknown` returns **zero matches** — this case is never unwrapped anywhere. A scratch (uncommitted) reproduction confirmed the control flow: a wrapped delete event leaves the counter stuck, never decrementing.
- **Root Cause:** Pods is the only resource type in `OverviewCache` tracked by incremental mutation instead of recompute-from-store; any missed/wrapped delete event leaks a permanent increment with no periodic reconciliation.
- **Confidence:** HIGH (code path + documented client-go semantics + reproduced control flow; not verified against a live 36-node cluster)
- **Affected Components:** `overview_cache.go`, `GetClusterOverview` REST handler, frontend `useClusterOverview`/`ClusterCapacity`/`LiveSignalStrip`/Dashboard. The separately-hardened `/summary` sidebar endpoint (`GetClusterSummary`, see COUNTS-2) is **not** affected.
- **User Impact:** Dashboard pod count grows without bound relative to node count, destroying trust in the product's core "operational intelligence" numbers.
- **Systemic Cause:** Root Cause E — inconsistent design (5 of 6 counters self-heal, one doesn't) combined with a well-known, undefended client-go edge case.
- **Recommended Fix:** Make pod counts recompute from the informer store's `List()` on every event like every other counter, or add periodic full reconciliation against the store; unwrap `cache.DeletedFinalStateUnknown` before the type assertion either way.
- **Regression Test:** Add a test for `updatePodStatus` handling `DeletedFinalStateUnknown`, and a test asserting `Counts.Pods` stays equal to `len(store.List())` after a sequence of ADD/missed-DELETE/relist events. Neither exists today.
- **Dependencies:** None blocking; isolated to `overview_cache.go`.
- **Phase:** 3 (Data Correctness)

#### HEALTH-1 — Presence layer hardcodes `Reachable: true` for every registered cluster, unconditionally
- **Severity:** P0
- **Area:** health-freshness
- **Observed Behavior:** Unavailable/removed clusters can still appear HEALTHY/reachable in the UI.
- **Evidence:** `kubilitics-backend/internal/cluster/discovery/manager.go:94-102`, `Manager.Snapshot()`, builds each `presence.RegisteredCluster` with `Reachable: true` **unconditionally** — no connectivity check is performed anywhere in this file or its callers. This snapshot is served at `GET /api/v1/presence`, consumed by `kubilitics-frontend/src/hooks/useClusterPresence.ts`, stored verbatim, and in `kubilitics-frontend/src/pages/ClusterPickerPage.tsx:107` mapped directly to a green "Reachable" dot and label. The field's own doc comment (`internal/cluster/presence/types.go:27-29`) describes it as derived "from preflight or any cached envelope" — but the only concrete producer in the repo never performs that check.
- **Root Cause:** Two parallel, inconsistent health concepts exist in the backend: `cluster_service.go`'s live-checked `Status` field (actually re-verified via `GetClusterInfo` on each list/get call) vs. the presence layer's `Reachable` flag, which is never checked at all. The frontend's cluster-picker UI reads from the unchecked one.
- **Confidence:** CONFIRMED
- **Affected Components:** `discovery/manager.go`, `presence/types.go`, `presence_handler.go`, `useClusterPresence.ts`, `clusterPresenceStore.ts`, `ClusterPickerPage.tsx`
- **User Impact:** A cluster that is offline, removed from kubeconfig, or never actually reachable still shows a green "Reachable" indicator in the cluster picker — this is the exact customer-reported "stale HEALTHY" problem, confirmed in code.
- **Systemic Cause:** Root Cause D — "health" is not a first-class, measured concept across the whole system; one of its two representations is a hardcoded placeholder that looks real.
- **Recommended Fix:** Wire `Manager.Snapshot()` to consult the already-live `ClusterService.Status` (or perform its own lightweight preflight) before setting `Reachable`; add a last-checked timestamp so the frontend can render staleness, not just a binary flag.
- **Regression Test:** Add a test asserting `Reachable` reflects actual connectivity (e.g. for a deliberately-unreachable cluster). None found today.
- **Dependencies:** Should be fixed together with HEALTH-2 (no staleness concept exists at all).
- **Phase:** 2 (Cluster Lifecycle)

### P1 Findings

#### LOADING-2 — React Query retry/backoff cannot rescue a hung `queryFn`; cancellation signal unused
- **Severity:** P1 | **Area:** frontend-query
- **Observed Behavior:** Global `QueryClient` retry/backoff config (`App.tsx:209-238`) only engages once a query's promise *rejects*; if it never settles (LOADING-1), retry never fires.
- **Evidence:** No `queryFn`-level `signal` usage found in `useKubernetes.ts` queryFns (`:246-269`) — React Query's auto-injected `AbortSignal` is never read, so not even React Query's own unmount-cancellation is wired up for these calls.
- **Root Cause:** A capability (React Query's per-query signal) exists but is unused; combined with LOADING-1, no layer bounds wait time.
- **Confidence:** CONFIRMED
- **Affected Components:** Same surface as LOADING-1.
- **User Impact:** No retry attempts visible, no error, just a stuck skeleton indefinitely.
- **Systemic Cause:** Root Cause A — convention gap, signal propagation never adopted project-wide.
- **Recommended Fix:** Thread the `queryFn`'s `signal` into `backendRequest`'s fetch call in addition to the LOADING-1 timeout fix — complementary, not a substitute.
- **Regression Test:** No test verifies a query exits loading state on timeout or unmount-cancel.
- **Dependencies:** LOADING-1.
- **Phase:** 1

#### LOADING-3 — Backend Overview handler's fallback path bypasses the configured K8s call timeout
- **Severity:** P1 | **Area:** backend-handler
- **Observed Behavior:** When a cluster's informer hot-cache isn't ready, `GetClusterOverview` falls back to direct `clientset` calls that skip the client's timeout wrapper, unlike every other resource handler.
- **Evidence:** `kubilitics-backend/internal/api/rest/overview.go:50-66` passes `r.Context()` directly into three raw `clientset.List()` calls, skipping `client.withTimeout()` — contrast with `ListResources`/`GetResource`/`PatchResource`/`DeleteResource` (`internal/k8s/resources.go:61-230`), all of which call `c.withTimeout(ctx)` first (applying the configured `K8sTimeoutSec`, default 30s).
- **Root Cause:** Inconsistent application of the timeout wrapper — three raw clientset calls were added directly in the REST handler instead of going through the wrapped client method.
- **Confidence:** CONFIRMED
- **Affected Components:** `GET /clusters/{clusterId}/overview` — the main Dashboard page, whenever a cluster's informer cache is cold.
- **User Impact:** If the underlying K8s API call hangs, this handler has no deadline of its own beyond `r.Context()` cancellation, which `net/http`'s `ReadTimeout`/`WriteTimeout` does not reliably bound for a handler goroutine blocked on unrelated I/O.
- **Systemic Cause:** Root Cause A — no handler-level timeout middleware wraps all routes uniformly; enforcement is opt-in per call-site.
- **Recommended Fix:** Route the Overview fallback through `client.ListResources`/`withTimeout`, or add server-wide middleware wrapping every handler in a `context.WithTimeout` so no call style can escape the bound.
- **Regression Test:** No test simulates a hung apiserver for this specific fallback path.
- **Dependencies:** None.
- **Phase:** 1

#### TOPOLOGY-2 — Frontend's 8s client timeout is shorter than the backend's 30s build budget, with no real cancellation
- **Severity:** P1 | **Area:** frontend-render / serialization boundary
- **Observed Behavior:** Topology view errors out quickly or cycles loading→error repeatedly on larger clusters, reading as "stuck."
- **Evidence:** `useClusterTopology.ts:63-70` races a hardcoded `FETCH_TIMEOUT_MS = 8_000` against the fetch (`Promise.race`), with React Query configured for `retry: 1, retryDelay: 2_000`. The backend's own deadline (`handler.go:1335-1340`) defaults to 30s (`topology_timeout_sec`). The underlying `fetch()` inside `backendRequest` has no `AbortController`, so the client-side "give up" does **not** actually cancel the in-flight request — backend work continues after the UI has already shown an error.
- **Root Cause:** Two independently-tuned timeouts for the same logical operation were never reconciled, and the client's give-up isn't a real cancellation.
- **Confidence:** CONFIRMED
- **Affected Components:** frontend-render (error/retry UI), discovery (wasted backend work continues after client gives up).
- **User Impact:** On any cluster where a full build realistically takes 8-30s (plausible at enterprise scale), the user can never see a successful load — every attempt times out client-side first.
- **Systemic Cause:** Root Cause A, compounded by Root Cause C (TOPOLOGY-1) — once namespace scoping is fixed, builds should usually complete well under 8s, but the ceiling mismatch remains latent.
- **Recommended Fix:** Make the client timeout longer than (or derived from) the server's declared budget, and use a real `AbortController` so giving up client-side actually cancels backend work.
- **Regression Test:** No test exercises an 8-30s-slow backend and asserts final UI state/timing.
- **Dependencies:** Related to TOPOLOGY-1.
- **Phase:** 5

#### BLASTRADIUS-1 — Blast Radius canvas's topology path duplicates live K8s calls instead of reusing the informer-backed graph engine
- **Severity:** P1 | **Area:** graph-build
- **Observed Behavior:** Blast Radius tab can load forever / feel stuck.
- **Evidence:** `kubilitics-backend/internal/topology/v2/collector_k8s.go:15-363` (`CollectFromClient`) issues ~28 parallel live `List()` calls against the real K8s API whenever its 30s cache (`topologyCacheTTL`) is cold — a wholly separate data path from `internal/graph.ClusterGraphEngine`, which already maintains an informer cache of the same resource types for blast-radius *scoring*. The topology build never reuses that cache. The 30s server timeout plus the frontend's `retry: 2, retryDelay: 1000` (`useResourceTopology.ts:104-105`) means a user can see up to ~90s of spinner before any error surfaces.
- **Root Cause:** Two independently-maintained collection paths for overlapping cluster state — one informer-cached (graph engine), one live-API-per-request with only a short TTL cache (topology v2) — and the live path is what feeds the Blast Radius tab's canvas.
- **Confidence:** CONFIRMED
- **Affected Components:** `topology/v2/collector_k8s.go`, `topology/v2/builder/build_topology.go`, `handler.go:GetResourceTopology`, frontend `useResourceTopology.ts`, `BlastRadiusTab.tsx`
- **User Impact:** On large/remote/slow clusters, opening the Blast Radius tab pays the full 28-call collection cost, with up to ~90s of visible spinner before failure.
- **Systemic Cause:** Root Cause B — no shared cache/informer layer between the blast-radius graph engine and the topology-v2 builder.
- **Recommended Fix:** Source `GetResourceTopology`'s resource bundle from the same `ClusterGraphEngine`/informer lister caches already running per cluster, eliminating the redundant live `List` fan-out.
- **Regression Test:** No test asserts an upper bound on topology build latency/call count for large clusters, or that the Blast Radius tab degrades gracefully instead of appearing stuck.
- **Dependencies:** None on BLASTRADIUS-2/3.
- **Phase:** 6

#### METRICS-2 (MEMORY-2) — ~10 independent, unguarded frontend memory parsers; NaN/percent decoupling
- **Severity:** P1 | **Area:** memory-units / aggregation
- **Observed Behavior:** Structural precondition for "huge/impossible memory total + 0% used" shown simultaneously (exact reported magnitude not reproduced).
- **Evidence:** At least 10 independent memory-string parsers across the frontend (`useClusterUtilization.ts`, `ClusterCapacity.tsx`, `Nodes.tsx` ×2, `NodeDetail.tsx`, `PodDetail.tsx`, `MetricsDashboard.tsx` ×3, `lib/utils.ts`), each reimplementing Ki/Mi/Gi/Ti byte-math independently. `lib/utils.ts:parseMemory` (used by two dashboard widgets) uses `parseInt(memory, 10)` with **no finite/NaN guard** — a malformed quantity string silently becomes `NaN`, which then poisons an aggregate total via `+=`, while separate `total > 0` guards evaluate `NaN > 0` as `false` and independently render `0%` — the numerator and percentage paths go wrong **independently**, structurally matching the reported symptom shape.
- **Root Cause:** No canonical "parse Kubernetes quantity string → base bytes" utility is shared across the frontend; each page/widget reinvented memory parsing with inconsistent NaN handling and no central validation gate before rendering.
- **Confidence:** MEDIUM (decoupling mechanism confirmed by code reading; exact reported magnitude not reproduced — explicitly UNVERIFIED)
- **Affected Components:** Dashboard capacity/efficiency widgets listed above.
- **User Impact:** A single malformed/missing memory field (common with CRD-managed virtual nodes, misconfigured kubelets, scientific-notation quantities) can silently zero out a percentage while an upstream byte-sum is corrupted, with no anomaly surfaced.
- **Systemic Cause:** Root Cause F — no canonical unit-conversion utility; violates the "store base bytes, format only at the boundary" principle the codebase otherwise claims to follow for design tokens.
- **Recommended Fix:** One shared, tested `parseK8sQuantityToBytes(string): number | null` utility (returns `null`, never `NaN`/`0`, on bad input) used by every widget; explicit finite + bounds guard immediately before any percentage/format call, rendering "unknown" instead of a silently-wrong number.
- **Regression Test:** No cross-cutting test asserts all memory-displaying widgets agree on one cluster's total; no test feeds malformed/scientific-notation quantities through any parser.
- **Dependencies:** None blocking; refactor-sized.
- **Phase:** 3

#### HEALTH-2 — No staleness/last-checked concept anywhere in cluster health data
- **Severity:** P1 | **Area:** health-freshness
- **Observed Behavior:** Concern that health is a cached boolean never invalidated on disconnect, with the frontend trusting whatever was last sent.
- **Evidence:** `presence.RegisteredCluster`/`ConnectedCluster` (`presence/types.go:21-47`) carry `RegisteredAt`/`ConnectedAt` but no "last health check," "last successful check," latency, or error field. `models.Cluster.Status` carries `LastConnected` and is recomputed per-request, but only when a page view triggers `ListClusters`/`GetCluster` — there is no periodic background health loop and no push of `Status` changes over the presence SSE stream (which only pushes discovery events).
- **Root Cause:** The architecture conflates "last time this was checked" with "current truth," and only one of its two health representations is even checked at all (see HEALTH-1).
- **Confidence:** HIGH
- **Affected Components:** `presence/types.go`, `cluster_service.go`
- **User Impact:** Users cannot distinguish "confirmed reachable 2 seconds ago" from "confirmed reachable 10 minutes ago" from "never actually checked."
- **Systemic Cause:** Root Cause D.
- **Recommended Fix:** Add explicit `LastCheckedAt`/`LastSuccessAt`/`Latency`/`LastError` fields to the presence wire type, populate from a real check, render relative staleness in the UI.
- **Regression Test:** None exists because the fields don't exist yet.
- **Dependencies:** HEALTH-1.
- **Phase:** 2

#### CONTAM-1 — WebSocket resource/topology broadcast pipeline is dead code and lacks real cluster scoping
- **Severity:** P1 (dormant today; would be P0 the moment it's wired up without fixing the gap) | **Area:** cross-cluster-contamination
- **Observed Behavior:** Concern that a WS message from cluster A could be attributed to cluster B after a switch.
- **Evidence:** `internal/api/websocket/handler.go:211-234` (`SetupInformerHandlers`) is the only call site of `Hub.BroadcastResourceEvent`, and it hardcodes `clusterID=""`. This function is **never invoked anywhere in the repo** (confirmed dead code via repo-wide grep). `ServeWS` never reads the `cluster_id` query parameter the frontend already sends. `Client.AcceptsCluster` defaults to "accept all clusters" unless an explicit subscribe message is sent — which the frontend never sends.
- **Root Cause:** Cluster-scoping primitives (`clusterID` filter, `AcceptsCluster`) were built but the two wiring steps that would make them effective were never completed, and the one call site that exists hardcodes an empty cluster ID.
- **Confidence:** CONFIRMED for the dead/unscoped wiring; UNVERIFIED as a *live* contamination bug today, since no resource events are currently broadcast through this path at all — real-time push updates over this path are simply non-functional right now, which is itself a separate, smaller gap worth flagging.
- **Affected Components:** `api/websocket/handler.go`, `hub.go`, `client.go`, frontend `useBackendWebSocket.ts`, `useResourceLiveUpdates.ts`, `useTopologyLiveUpdates.ts`
- **User Impact:** None today (feature inert). If re-enabled without fixing the plumbing, every open tab would receive every other cluster's resource events, causing spurious invalidations/animation noise (not wrong *data* shown, since REST refetches remain correctly cluster-scoped by query key per CONTAM-2).
- **Systemic Cause:** Root Cause G — partially-built feature left half-wired, with no integration test to catch the gap.
- **Recommended Fix:** Before re-enabling any informer→WS broadcast, make `ServeWS` read `cluster_id` (or require a post-connect subscribe message) and call the client's subscription method; ensure every `BroadcastResourceEvent` call passes the real originating cluster ID.
- **Regression Test:** No test exercises `SetupInformerHandlers` or the `cluster_id` query-param → subscription path.
- **Dependencies:** None blocking; should be fixed before this pipeline is resumed.
- **Phase:** 2

### P2 Findings

#### LOADING-4 — K8s REST client has no built-in HTTP timeout; relies entirely on per-call context
- **Severity:** P2 | **Area:** backend-handler
- **Evidence:** `internal/k8s/client.go:66-108` never sets `rest.Config.Timeout`; bounding is achieved only via the per-call `withTimeout()` wrapper, applied inconsistently (LOADING-3 already shows a miss).
- **Root Cause/Confidence:** HIGH — timeout enforcement is layered on `context.Context` per call-site rather than set once on the transport, so every new call site is a chance to forget it.
- **Recommended Fix:** Set `rest.Config.Timeout` at client construction time in addition to the existing per-call wrapper, as defense-in-depth.
- **Regression Test:** No test asserts `rest.Config.Timeout` is non-zero.
- **Dependencies:** LOADING-3. **Phase:** 1

#### LOADING-5 — Informer cache sync has no timeout and no retry/alerting on permanent failure
- **Severity:** P2 | **Area:** informer-cache
- **Evidence:** `internal/k8s/informer.go:102-114`'s `WaitForCacheSync` is gated only on an explicit-stop channel; if sync for any resource type never completes (e.g. an RBAC denial on `watch`), the hot cache never becomes ready, permanently, with no distinguishing signal between "still warming up" and "will never sync."
- **Confidence:** MEDIUM (no timeout confirmed by code; not verified to have caused a production incident — latent risk, not an observed hang). Runs as a background goroutine, so it does not itself block any HTTP request directly.
- **Recommended Fix:** Wrap the sync wait in a bounded context with retry/backoff; surface persistent failure as a visible per-cluster health flag instead of silent permanent fallback.
- **Dependencies:** None. **Phase:** 1

#### TOPOLOGY-3 — Code assumes backend pod aggregation that the active (V1) code path does not implement
- **Severity:** P2 | **Area:** discovery / graph-construction (doc-vs-code mismatch)
- **Evidence:** `useTopologyData.ts:34-37` claims "Backend pod aggregation (>3 pods collapse to 1 node) keeps real node counts well below [the 1000-node] limit." That aggregation only exists in `internal/topology/v2/builder/pod_aggregation.go` (the V2 engine, used only by Blast Radius). The Topology page exclusively uses V1 (`internal/topology/engine.go`), which has no aggregation logic at all.
- **Confidence:** CONFIRMED
- **User Impact:** On a namespace with many pods/replicas, the assumed size safety-net doesn't exist for the pipeline actually serving the Topology page — compounds TOPOLOGY-1.
- **Systemic Cause:** Root Cause B — two parallel topology implementations diverged; comments/assumptions written against one leaked into code using the other.
- **Recommended Fix:** Port pod aggregation into V1, or migrate the Topology page onto V2 — and correct the misleading comment either way.
- **Dependencies:** Compounds TOPOLOGY-1. **Phase:** 5

#### BLASTRADIUS-2 — Topology resource List calls silently truncate above 500 items for most resource types
- **Severity:** P2 | **Area:** graph-build
- **Evidence:** `collector_k8s.go` applies `ListOptions{Limit: 500}` to every resource type except Pods and Events, with no continuation-token loop for the other 26 types — items beyond the first page are silently dropped.
- **Confidence:** CONFIRMED
- **User Impact:** On clusters with >500 of any one resource type (common for multi-tenant/GitOps-heavy clusters), Blast Radius edges referencing resources past item 500 are silently missing, with no truncation warning.
- **Recommended Fix:** Extract the pods/events continuation-loop pattern into a shared paginated collector; apply uniformly, or explicitly surface a truncation warning.
- **Dependencies:** Compounds BLASTRADIUS-1 (same code path). **Phase:** 6

#### METRICS-1 (MEMORY-1) — Backend `parseMemoryToMi` is a hardcoded-format parser masquerading as a general one
- **Severity:** P2 | **Area:** memory-units
- **Evidence:** `internal/metrics/aggregate.go:44-61` (`parseMemoryToMi`) blindly strips any unit-letter suffix without applying its corresponding scale factor, then treats the remainder as if already in Mi — correct only because its current live callers always hand it a literal `"%.2fMi"`-formatted string. If any future caller passes a genuine `Ki`/`Gi`/`Ti`-suffixed quantity, the result is silently off by a factor of 1024 per unit level.
- **Confidence:** HIGH (code read); live-trigger risk UNVERIFIED (no current caller passes non-Mi input).
- **Recommended Fix:** Replace with `resource.ParseQuantity(...).Value()`, matching the correct pattern already used elsewhere in the same codebase (`grpc/service.go:709-723`).
- **Dependencies:** None. **Phase:** 3

#### LIFECYCLE-2 — Cluster removal has no client-side timeout and asymmetric error-path UI cleanup
- **Severity:** P2 | **Area:** removal
- **Observed Behavior:** Customer report of removal staying "PENDING" indefinitely.
- **Evidence:** `kubilitics-frontend/src/pages/Settings.tsx:75-95` — the delete mutation's `onSuccess` clears the confirmation dialog state (`setClusterToRemove(null)`), but `onError` only shows a toast and never clears it. `backendRequest` has no timeout (see LOADING-1), though the backend's `http.Server` does enforce a 15s `WriteTimeout` as an eventual ceiling.
- **Root Cause:** Asymmetric cleanup between success/error mutation paths; no explicit client timeout shorter than the server's 15s ceiling.
- **Confidence:** HIGH (asymmetry confirmed; "indefinite" framing is UNVERIFIED since the server does eventually time out the connection).
- **User Impact:** Confirmation dialog can remain visibly open after a failed delete, reading as "stuck," and inviting repeated re-clicks.
- **Recommended Fix:** Clear dialog state in `onError` too; add an explicit request timeout well under 15s.
- **Dependencies:** None. **Phase:** 2

### P3 / Informational Findings (ruled out — included for completeness, per anti-hallucination rules)

| ID | Finding | Confidence |
|---|---|---|
| KUBECONFIG-1 | Discovery/enumeration of kubeconfig contexts never dials the network and is already per-source isolated; the customer-visible symptom traces to STARTUP-1, not discovery. | HIGH |
| FLEET-1 | `GetFleetOverview` already does correct bounded `errgroup` fan-out with partial-result tolerance — the model this audit recommends elsewhere. One UNVERIFIED caveat: a registered-but-newly-slow cluster has no additional per-call deadline beyond the shared client timeout config. | CONFIRMED (core), UNVERIFIED (caveat) |
| TOPOLOGY-4 | ELK layout and relationship-resolution are already bounded/indexed (inverted label index, 300-node layout-strategy switch, 1000-node render cap) — checked and ruled out as the "forever" source. | HIGH |
| BLASTRADIUS-3 | A single global mutex serializes lazy graph-engine startup across clusters; existing singleflight/negative-cache mitigation likely bounds the practical impact, but this wasn't fully confirmed. | MEDIUM |
| COUNTS-2 | The hardened `/summary` sidebar endpoint (`GetClusterSummary`) is correctly cluster-scoped, unpaginated-but-correct, and not affected by COUNTS-1. | CONFIRMED |
| METRICS-3 | Backend `resource.Quantity` → bytes conversions (`metrics_service.go`, `metrics_server_provider.go`) consistently use `.Value()` with correct power-of-1024 division — audited and found clean. | CONFIRMED |
| LIFECYCLE-1 | Cluster removal is confirmed **not** gated on remote reachability — no network call to the target cluster exists anywhere in the removal path; this guarantee already holds. | CONFIRMED |
| CONTAM-2 | React Query keys for resources/topology consistently include `clusterId`; WS reconnect-on-cluster-switch correctly rebinds handlers. Not exhaustively checked across all 140+ pages — recommend a repo-wide grep before final sign-off. | HIGH (sampled) |

---

## Systemic Root Causes

### ROOT CAUSE A — Timeout/cancellation enforcement is opt-in per call-site, not structural
The codebase knows the right patterns (`AbortSignal.timeout()` in `getHealth()`, `withTimeout()` wrapper in `internal/k8s`, `errgroup` fan-out in `fleet.go`) but applies them inconsistently.
→ **Symptoms:** STARTUP-1, LOADING-1, LOADING-2, LOADING-3, LOADING-4, LOADING-5, TOPOLOGY-2, LIFECYCLE-2

### ROOT CAUSE B — Duplicate, divergent data-collection paths for the same cluster state
Features re-implement live Kubernetes collection instead of reusing informer caches that already exist for the same resource types; two full topology engines (V1/V2) coexist and diverged.
→ **Symptoms:** STARTUP-1 (reuse opportunity), BLASTRADIUS-1, BLASTRADIUS-2, TOPOLOGY-3

### ROOT CAUSE C — Scoping/filter parameters plumbed on only one side of the stack
A feature's narrowing logic (namespace, depth) is implemented server-side for one dimension and client-side-only for another, with no end-to-end wiring check.
→ **Symptoms:** TOPOLOGY-1, TOPOLOGY-2 (compounding)

### ROOT CAUSE D — "Health"/"freshness" are not first-class, measured concepts
One representation of cluster health is a hardcoded placeholder; the other has no staleness timestamp at all; the frontend has no way to distinguish "just checked" from "never checked."
→ **Symptoms:** HEALTH-1, HEALTH-2

### ROOT CAUSE E — Incremental counters instead of idempotent recompute-from-source-of-truth
One counter (pods) diverges from the self-healing pattern used by every sibling counter, and doesn't defend against a documented client-go edge case.
→ **Symptoms:** COUNTS-1

### ROOT CAUSE F — No canonical Kubernetes-quantity parsing utility
~10 independent hand-rolled byte-unit parsers on the frontend, one fragile hardcoded-format parser on the backend; no shared "parse to base bytes" function anywhere.
→ **Symptoms:** METRICS-1, METRICS-2

### ROOT CAUSE G — Partially-built features left half-wired
Cluster-scoping primitives for WebSocket broadcast exist but were never connected end-to-end, with no integration test to catch the gap — a dormant landmine for the next person who "finishes" the feature.
→ **Symptoms:** CONTAM-1

---

## Architecture Risk Map

```
Frontend (React+TS, Zustand, React Query)
   │
   │  backendRequest() — [ROOT CAUSE A: no timeout/abort anywhere here] (LOADING-1,2)
   ▼
Backend REST API (kubilitics-backend/internal/api/rest)
   │                                   │
   │ GetClusterOverview                │ GetFleetOverview
   │ [ROOT CAUSE A: skips             │ [CORRECT: errgroup fan-out,
   │  withTimeout — LOADING-3]        │  partial-result tolerant — FLEET-1]
   ▼                                   ▼
Cluster Manager (internal/service/cluster_service.go)
   │  LoadClustersFromRepo — sequential, 8s×N — [STARTUP-1]
   │  RemoveCluster — correctly local-only, no remote dial — [LIFECYCLE-1, good]
   ▼
K8s Clients (internal/k8s) ←──── rest.Config has no Timeout [LOADING-4]
   │
   ├──→ Informers/Caches (OverviewCache, InformerManager)
   │       │ 5 of 6 counters self-heal from store.List(); Pods does not [COUNTS-1]
   │       │ WaitForCacheSync has no timeout [LOADING-5]
   │
   ├──→ Metrics (internal/metrics, internal/service/metrics_service.go)
   │       │ Quantity→bytes conversion itself is clean [METRICS-3]
   │       │ parseMemoryToMi is a hardcoded-format parser [METRICS-1]
   │
   ├──→ Topology V1 (internal/topology) ←── used by Topology page
   │       │ namespace param never arrives from frontend [TOPOLOGY-1]
   │       │ client/server timeout mismatch, no cancellation [TOPOLOGY-2]
   │       │ no pod aggregation (comment assumes V2's) [TOPOLOGY-3]
   │
   ├──→ Topology V2 (internal/topology/v2) ←── used by Blast Radius canvas only
   │       │ duplicates live collection instead of reusing graph engine [BLASTRADIUS-1]
   │       │ silent >500-item truncation on 26 of 28 resource types [BLASTRADIUS-2]
   │
   ├──→ Blast Radius scoring engine (internal/graph) — informer-cached,
   │       cycle-safe BFS, atomic snapshots — [CORRECT, no bug found]
   │
   ├──→ Discovery/Presence (internal/cluster/discovery, presence)
   │       │ enumeration-only, never dials network — [CORRECT — KUBECONFIG-1]
   │       │ Reachable hardcoded true — [HEALTH-1]
   │       │ no staleness timestamp anywhere — [HEALTH-2]
   │
   └──→ WebSocket Hub (internal/api/websocket)
           │ scoping primitives built but never wired; dead code call site
           │ hardcodes clusterID="" — [CONTAM-1]

Persistence (SQLite/Postgres repository) — local only, correctly never
   involved in remote-reachability checks for removal [LIFECYCLE-1, good]

Desktop/Tauri — out of scope this pass (shell files currently deleted/
   untracked in working tree); not implicated in any of the 11 reports.
```

---

## Performance Baseline

**No live cluster was available during this audit — all numbers below are configured/coded values read directly from source, not runtime measurements.** Treat anything not explicitly marked "measured" as a configured ceiling, not an observed latency.

| Value | Source | Status |
|---|---|---|
| 8s per-cluster connect timeout during startup load | `cluster_service.go:700` (`loadStartupTimeout`) | Configured value, read from code |
| 5s per-cluster timeout for first-run auto-add | `cluster_service.go:424` | Configured value |
| Startup connect loop is sequential (not parallel) → N×8s worst case | `main.go:413`, `cluster_service.go:706-753` | Confirmed by code structure, not measured wall-clock |
| 30s topology build timeout (server) | `config.go:187` (`topology_timeout_sec` default) | Configured value |
| 8s topology fetch timeout (client) | `useClusterTopology.ts:65` | Configured value |
| 30s blast-radius topology cache TTL | `handler.go:63` (`topologyCacheTTL`) | Configured value |
| 500-item pagination limit, unused for 26/28 resource types | `collector_k8s.go:20` | Configured value, confirmed un-looped |
| 15s HTTP server `WriteTimeout`/`ReadTimeout` | `main.go:1130-1172` | Configured value |
| 1000-node client-side topology render cap | `useTopologyData.ts:38` | Configured value |

**No throughput, latency-under-load, or memory-overflow magnitude numbers were measured** — these require a live cluster and are explicitly out of scope for this read-only pass. Phase 0 of the hardening roadmap should produce the first real measurements.

---

## Test Coverage Gaps

- No test bounds `LoadClustersFromRepo` wall-clock time as a function of cluster count (STARTUP-1).
- No test asserts `backendRequest` rejects within a timeout, or that a query exits loading on timeout/unmount (LOADING-1, LOADING-2).
- No test simulates a hung apiserver for the Overview fallback path (LOADING-3), or asserts `rest.Config.Timeout` is set (LOADING-4).
- No test simulates a resource type that never completes informer sync (LOADING-5).
- No test asserts the topology network request reflects the UI's namespace selection (TOPOLOGY-1), or exercises an 8-30s-slow backend (TOPOLOGY-2).
- No test asserts node-count behavior for high-replica namespaces on the V1 topology endpoint (TOPOLOGY-3).
- No test bounds topology build latency/call count for large clusters, or asserts graceful Blast Radius degradation (BLASTRADIUS-1); no test seeds >500 of a resource type (BLASTRADIUS-2).
- No test covers `updatePodStatus` handling `DeletedFinalStateUnknown`, or asserts `Counts.Pods == len(store.List())` under churn (COUNTS-1).
- No cross-widget test asserts all memory displays agree on one cluster's total, or feeds malformed/scientific-notation quantities through any parser (METRICS-2); no test feeds `Ki`/`Gi`/`Ti` input to `parseMemoryToMi` (METRICS-1).
- No test asserts `Reachable` reflects real connectivity (HEALTH-1); no staleness fields exist to test yet (HEALTH-2).
- No test exercises `SetupInformerHandlers` or the `cluster_id` WS subscription path at all (CONTAM-1).
- No test asserts the removal confirmation dialog closes on a failed delete (LIFECYCLE-2).
- `TestClusterService_RemoveCluster_Found`/`_NotFound` exist but don't explicitly simulate "remote cluster unreachable during remove" (LIFECYCLE-1 — guarantee already holds, test would just lock it in).

---

## Recommended Remediation

Fix in systemic-root-cause order, not finding-by-finding — most individual findings are symptoms of one of the 7 root causes above, and fixing the root cause closes multiple findings at once:

1. **Root Cause A** (timeout/cancellation structural fix) closes STARTUP-1, LOADING-1/2/3/4/5, TOPOLOGY-2, LIFECYCLE-2 — highest leverage, do first.
2. **Root Cause D** (first-class health/freshness) closes HEALTH-1/2 — second-highest leverage, directly fixes a P0 misleading-state issue.
3. **Root Cause C** (namespace plumbing) closes TOPOLOGY-1, reduces exposure to TOPOLOGY-2/3.
4. **Root Cause E** (pod counter) is a small, isolated fix closing COUNTS-1 alone.
5. **Root Cause B** (duplicate collection paths) closes BLASTRADIUS-1/2, TOPOLOGY-3 — larger refactor, sequence after the above.
6. **Root Cause F** (canonical unit parser) closes METRICS-1/2 — refactor-sized, can run in parallel with (5).
7. **Root Cause G** (CONTAM-1) — fix before resuming real-time WS work, not urgent otherwise since the feature is currently inert.

See `docs/PRODUCTION-HARDENING-ROADMAP.md` for the phased execution plan. **No implementation should begin until this audit is reviewed and approved, per the governing investigation brief.**
