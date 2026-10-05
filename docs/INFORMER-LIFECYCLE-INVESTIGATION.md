# Enterprise Informer Lifecycle Investigation

**Status: IMPLEMENTED. Approved and built — see `docs/INFORMER-LIFECYCLE-IMPLEMENTATION.md` for the full implementation record, including real live measurements (197 goroutines registered-only vs. ~297+ active, matching this investigation's predictions), both mandatory race-surface proofs under `-race`, and two real regressions found and fixed during implementation. This document's own analysis and recommendation (Option E, hybrid) are preserved below unchanged as the historical record of what was approved.**

---

## Executive Summary

Every registered cluster — not every *viewed* cluster, every *registered* one — eagerly starts a full set of **27 Kubernetes informers** the moment a live client exists for it (on manual registration, on backend startup for every persisted cluster, and on every successful reconnect). This is called from 7 distinct code paths, all converging on `OverviewCache.StartClusterCache`. Real measurement (this and the prior phase) shows this costs **~297 goroutines and ~20-25MB RSS per registered cluster, linearly** — confirmed at N=1 (297), N=10 (2,950), N=26 (~7,750). The cost is identical whether the cluster is actively being viewed in Dashboard/Topology/Fleet or has sat untouched since the user added it weeks ago; there is currently **no idle/TTL/teardown mechanism at all** for a registered-but-unviewed cluster.

27 informers serve two real consumers: `OverviewCache` registers live-update handlers on 7 of them (Pod, Node, Namespace, Deployment, DaemonSet, StatefulSet, Event) for the Dashboard's real-time counters; separately, `resources.go`/`workloads.go` read directly from the informer-backed in-memory store (`GetStore`) for all 27 types to serve resource-list/detail pages in <1ms instead of a live ~200-2000ms K8s API call. **This is not pure waste** — a lazy redesign must preserve this fast-read benefit for whichever types a user actually visits, not discard it.

A real (if methodologically-limited — see the measurement methodology note in §7) comparison against Headlamp's actual backend source shows a materially different design: Headlamp's `k8cache` package creates per-context clientsets **on demand** (not eagerly on every registered context) and caches individual HTTP *responses* with explicit invalidation, with context-removal-triggered cleanup — not a standing, always-watching informer set per registered cluster. This is real, grounded evidence (not assumption) that a lazier model is a legitimate, precedented architectural direction — not proof that it is automatically correct for Kubilitics, whose real-time Dashboard/Topology features depend on live informer events in a way Headlamp's more request-driven UI may not.

**Recommendation (not implemented, awaiting approval):** move toward Option E (Hybrid: lightweight metadata on registration, informers started on first activation, idle-TTL teardown) — detailed in §15 — but only after closing the specific UNVERIFIED items in §20, several of which are correctness-critical (thundering-herd on simultaneous activation, TTL-shutdown races, informer failure handling) and must be answered with evidence, not assumed, before implementation.

---

## Current Architecture

```
Register/Reconnect/Startup-load a cluster
        │
        ▼
applyAndStoreClient / AddCluster / LoadClustersFromRepo
   (TestConnection succeeds)
        │
        ▼
s.clients[id] = client          (in-memory client map, clusterService)
        │
        ▼
OverviewCache.StartClusterCache(ctx, id, client)
        │
        ▼
k8s.NewInformerManager(client)
        │
        ▼
im.Start(ctx)  →  27 × factory.<Group>().<Version>().<Kind>().Informer()
        │                    (one SharedInformer per resource kind)
        ▼
im.factory.Start(im.stopCh)   (client-go starts all 27 reflectors + processors)
        │
        ▼
RUNS CONTINUOUSLY — no TTL, no idle shutdown, no "cluster not viewed" signal
        │
        ▼
Stops ONLY on: explicit RemoveCluster, or VALID-04's stop-before-restart on reconnect
```

There is no "first view" step in this picture — informers start at registration/startup time, before any UI has requested anything about the cluster.

---

## Complete Lifecycle Trace

Traced end-to-end from code (`internal/service/cluster_service.go`, `internal/service/overview_cache.go`, `internal/k8s/informer.go`, `internal/api/rest/resources.go`, `internal/api/rest/workloads.go`, `internal/api/rest/events.go`):

1. **Registration** — `AddCluster`/`AddClusterFromBytes` → `addClusterWithSource`. On success, `s.clients[id]` set and `StartClusterCache` called immediately (two branches: idempotent-match-update and brand-new-cluster).
2. **Persistence** — `s.repo.Create`/`s.repo.Update` (SQLite), independent of informer lifecycle — a cluster can be persisted with no live client/cache (e.g. offline at registration time).
3. **Backend startup** — `LoadClustersFromRepo` iterates every persisted cluster, builds a client, tests connection (bounded by `loadStartupTimeout`), and on success calls `StartClusterCache` — **every reachable persisted cluster gets its full informer set at process start**, before any frontend has connected.
4. **Background reconnect** — `ListClusters`'s per-cluster enrichment goroutine calls `kickBackgroundReconnect` for any cluster lacking a live client (fire-and-forget, `context.Background()`-scoped); that path's own success branch also calls `StartClusterCache`.
5. **Explicit reconnect** — `ReconnectCluster` and `tryReconnectCluster`'s shared `applyAndStoreClient` helper: both correctly call `StopClusterCache` *before* `StartClusterCache` (the VALID-04 fix) — no duplicate-cache leak on repeated reconnect.
6. **Informer startup** — `InformerManager.Start` calls 27 `setup<Kind>Informer` methods, each doing `factory.<Group>().<Version>().<Kind>().Informer()` + `AddEventHandler` (populates the type's `Store`, the <1ms-read cache resources.go/workloads.go consume) + optionally wiring into `im.handlers[kind]` if `OverviewCache.RegisterHandler` was called for that kind (7 of 27 are). `factory.Start(stopCh)` then starts every reflector/processor at once.
7. **Event handling** — client-go's reflectors deliver Add/Update/Delete events to each informer's registered handlers; `OverviewCache`'s 7 handlers update in-memory dashboard counters and call `notifyStream` (WebSocket push to subscribed overview listeners).
8. **Cache reads** — `resources.go`/`workloads.go` call `clusterService.GetInformerManager(clusterID)` then `im.GetStore(kind).List()` for instant resource-list reads; `OverviewCache.GetOverview(clusterID)` returns the live-maintained dashboard summary.
9. **Reconnect** — see #5; also resets the per-client circuit breaker (`ResetCircuitBreaker`) before testing the new connection.
10. **Cluster removal** — `RemoveCluster`: `repo.Delete` → `delete(s.clients, id)` → `StopClusterCache(id)`. Correct order (DB row gone, then in-memory client gone, then informers torn down).
11. **Cache shutdown** — `StopClusterCache` (`overview_cache.go:217`): under lock, calls `im.Stop()` (closes `im.stopCh`, the standard client-go shared-informer-factory shutdown signal — causes every reflector/processor goroutine for that cluster to exit), then deletes the cluster's entries from `informers`/`overviews`/`podPhases`/`stopChs` maps.
12. **Process shutdown** — not separately traced this pass; backend process exit naturally terminates all goroutines via OS process teardown — no evidence of an explicit graceful-drain-all-clusters path, and none is strictly needed since process exit reclaims everything regardless.

---

## StartClusterCache Call-Site Inventory

| Call site | Trigger | Current behavior | Required cache? | Lifetime | Stop path | Risk |
|---|---|---|---|---|---|---|
| `cluster_service.go:317` (`ListClusters` enrichment goroutine) | Every `GET /clusters`/Fleet poll, for any cluster currently lacking a live client | Builds client, tests connection, on success starts cache | Idempotent — `StartClusterCache` no-ops if already running (`overview_cache.go:58-61`) | Until explicit stop | None at this site (relies on later `RemoveCluster`/reconnect-driven stop) | Low — idempotency guard prevents duplicate starts; but this means a *persistently unreachable* cluster retries a full client-build+informer-start attempt on every single `ListClusters` call, bounded only by `kickBackgroundReconnect`'s own negative-failure cache for the *fire-and-forget* path, not this synchronous one — see Remaining Unknowns #1 |
| `cluster_service.go:400` (`kickBackgroundReconnect`) | Fire-and-forget background reconnect, kicked from #1 above | Same pattern, `context.Background()`-scoped (survives the triggering request) | Same idempotency guard | Until explicit stop | None at this site | Low-medium — runs un-cancellable by request lifecycle; bounded by `reconnectNegativeCacheTTL` (10s) for *this specific path* only |
| `cluster_service.go:575` (`addClusterWithSource`, idempotent-match branch) | Re-adding an already-known cluster (same path/server match) | Starts cache if status is "connected" | New cache if none exists | Until explicit stop | `RemoveCluster` | Low |
| `cluster_service.go:605` (`addClusterWithSource`, new-cluster branch) | First-time manual registration (`POST /clusters`) | Same | New cache | Until explicit stop | `RemoveCluster` | Low — this is the "register → eager informers" core behavior under investigation |
| `cluster_service.go:916` (`LoadClustersFromRepo`) | Backend process startup, once per persisted, reachable cluster | Starts cache for every reachable persisted cluster | New cache per cluster | Until explicit stop | `RemoveCluster` | **Highest-impact site** — this is what makes the cost scale with *total registered clusters*, not *clusters used this session*; a user with 50 previously-registered clusters pays the full ~297×50 goroutine cost on every backend restart, regardless of intent to use them this session |
| `cluster_service.go:992-993` (`applyAndStoreClient`, shared by `tryReconnectCluster`) | Reconnect via kubeconfig-fallback or in-cluster source | **Stops** existing cache, then starts fresh (VALID-04 fix) | Replacement cache | Until next stop/explicit removal | `StopClusterCache` called first in the same function | Low — correctly lifecycle-safe per VALID-04 |
| `cluster_service.go:1104-1108` (`ReconnectCluster`, direct kubeconfig-path branch) | Explicit user-triggered reconnect | Same stop-then-start pattern | Replacement cache | Until next stop/explicit removal | Same function | Low — correctly lifecycle-safe |

**Stop-only sites:** `cluster_service.go:692` (`RemoveCluster`), `cluster_service.go:1005` (`finishReconnect`, rolls back if the cluster row was deleted mid-reconnect — VALID-01-related race handling).

**Net finding:** every start-path is individually correct (idempotent, lifecycle-safe per VALID-04/VALID-01's established fixes) — the issue is architectural, not a bug: there is no path anywhere in this inventory that says "don't start yet, wait for a view."

---

## Informer Resource Inventory

27 informers started unconditionally by every `InformerManager.Start` call: Pod, Service, ConfigMap, Secret, Node, Namespace, PersistentVolume, PersistentVolumeClaim, ServiceAccount, Endpoints, Event, Deployment, ReplicaSet, StatefulSet, DaemonSet, Job, CronJob, Ingress, IngressClass, NetworkPolicy, Role, RoleBinding, ClusterRole, ClusterRoleBinding, StorageClass, HorizontalPodAutoscaler, PodDisruptionBudget.

| Informer/resource | Consumer | Always required? | On-demand candidate? | Cost | Correctness dependency |
|---|---|---:|---:|---:|---|
| Pod, Node, Namespace, Deployment, DaemonSet, StatefulSet | `OverviewCache` (Dashboard real-time counters) + resource pages | Yes, if Dashboard is used for this cluster | Partially — only needed once Dashboard (or a resource page for that kind) is opened | 1 informer each | Dashboard health/count correctness depends on these specifically |
| Event | `OverviewCache` (alerts) | Only if Dashboard alerts/Events page used | Yes | 1 informer | Alert-feed correctness |
| Service, ConfigMap, Secret, PersistentVolume, PersistentVolumeClaim, ServiceAccount, Endpoints, ReplicaSet, Job, CronJob, Ingress, IngressClass, NetworkPolicy, Role, RoleBinding, ClusterRole, ClusterRoleBinding, StorageClass, HorizontalPodAutoscaler, PodDisruptionBudget (20 types) | `resources.go`/`workloads.go` fast-read cache only — **no `OverviewCache` handler registered** | No — only needed when that specific resource-list/detail page is actually opened | Strong candidate | 1 informer each | Resource-list page latency (instant-from-cache vs. falling back to a live List call) — not a dashboard-correctness dependency |

**20 of 27 informers (74%) have no Dashboard/real-time consumer at all** — their sole purpose is making an eventual visit to that resource type's list page fast. This is the single clearest piece of evidence that per-feature, on-demand informer startup (Candidate C/E) could eliminate the large majority of the standing cost for a cluster a user is only viewing via Dashboard, without losing any Dashboard functionality.

---

## Goroutine Ownership

**Measured** (this and the prior phase, real `/metrics` reads against the isolated lab, not mocked): ~297 goroutines per registered cluster, N=1/10/26 all consistent with 297×N.

**Reasoned decomposition — explicitly NOT independently profiled per-informer this pass, flagged UNVERIFIED at this level of detail:**

```
Per registered cluster (~297 goroutines, measured aggregate)
 ├── InformerManager (27 SharedInformers)
 │    ├── 27 × reflector goroutine (ListAndWatch loop)
 │    ├── 27 × informer controller run-loop goroutine
 │    ├── 27 × shared-processor goroutine (fans out to listeners)
 │    └── 7 × extra listener goroutine (OverviewCache's registered handlers, on top of the base processor)
 │         (27×3 + 7 ≈ 88 — accounts for roughly a third of the measured total)
 ├── HTTP/2 transport goroutines (one or more per active watch connection; 27 concurrent long-lived
 │    watches per cluster plausibly contribute a meaningful share — not independently counted)
 ├── client-go workqueue / rate-limiter bookkeeping goroutines (per-informer, not separately counted)
 └── Unaccounted — the arithmetic above (~88-120 depending on assumptions) does not fully explain
      the measured ~297; the remainder is UNVERIFIED without an actual labeled pprof goroutine dump
      (`go tool pprof` with goroutine labels, or `runtime/pprof.Lookup("goroutine")` filtered by
      cluster ID) — not performed this pass. The brief's own instruction ("numbers must come from
      actual instrumentation or profiling, not guesses") is only partially satisfied: the aggregate
      297/cluster figure IS measured; the per-component breakdown above is reasoned from client-go's
      known architecture, not independently profiled, and is flagged as such rather than presented
      as more precise than it is.
```

**Action item for before implementation, not done this pass:** a real goroutine-label-based profile (e.g. temporarily wiring `pprof.Do` with a cluster-ID label around `InformerManager.Start`, or `runtime.Stack` analysis) to get the true per-component breakdown, which would materially sharpen the lazy-architecture cost/benefit estimate in §9.

---

## Current Resource Measurements

Reused from Phase I-B's real (not mocked) multi-cluster measurement — not re-collected this pass, since the investigation's own instruction set did not require re-measurement of data already real and recent:

| Tier | Goroutines | RSS |
|---|---:|---:|
| N=1 | 297 | 89 MB |
| N=10 | 2,950 | 248 MB |
| N=26 | ~7,686-7,814 | 610-673 MB |

**Methodology, restated precisely per this phase's explicit instruction not to misrepresent it:** N=26 used one real lab cluster's kubeconfig cloned 25× under distinct context names, all sharing **one real API server**. This measures the backend's genuine per-registration resource cost (informers, connections, goroutine bookkeeping) under real client-go mechanics — it does **not** measure what 26 independent API servers (different hosts/network latency/etcd load) would produce. The 100/500-cluster figures anywhere in this or prior documents are linear extrapolations from 3 real data points, explicitly labeled as hypotheses, not measured results.

**Not separately measured this pass (new asks from this phase's brief, not previously covered):** open file descriptors, active watch count via a direct metric (inferred from informer count × cluster count, not independently read from `/proc` or an FD-count metric), CPU%, startup/registration/removal/reconnect *latency* specifically (only steady-state goroutine/RSS were sampled).

---

## Registration vs Active-Cluster Cost

| Cost category | Status |
|---|---|
| A. Registration cost | **Measured, indirectly** — the N=1→N=10→N=26 deltas ARE the registration cost today, since registration and "active" are currently the same event (no distinction exists in the code). Cannot be separated into "registration-only" vs "active-view" costs under the *current* architecture, because the architecture doesn't distinguish them — this is precisely the gap a lazy redesign would create and need to measure separately. |
| B. First-view cost | **UNVERIFIED** — no code path currently exists where "first view" is a distinct event from "registration" (informers are already running by the time any view happens). Would need to be measured against a *prototype* lazy implementation, which does not exist. |
| C. Steady-state idle cost | **Measured** = the same ~297/cluster figure, since there is currently no distinction between idle-registered and actively-viewed — confirmed flat across 20 repeated Fleet calls (no additional growth from *requests*, but the baseline itself already includes the full informer cost for every registered cluster regardless of view activity). |
| D. Active-view cost | **UNVERIFIED** — indistinguishable from C under the current architecture for the same reason as B. |
| E. Reconnect cost | **Partially characterized** (VALID-04's own investigation measured reconnect goroutine behavior and found it flat/bounded after the fix — see `docs/VALID-04-INVESTIGATION.md`), but not re-measured with this phase's `/metrics`-based methodology specifically. |
| F. Removal cost | **UNVERIFIED** by direct measurement this pass — `StopClusterCache`'s code path is confirmed correct by reading (closes `stopCh`, deletes map entries, standard client-go shutdown), but the actual goroutine-count delta after a real removal was not sampled via `/metrics` this pass (a reasonable inference from the Start-side linearity and the code-correctness of Stop is that removal gives back ~297/cluster, but this is inference, not measurement). |

---

## Candidate Architectures

| | A. Current (eager) | B. Fully lazy | C. Feature-scoped | D. Lazy + idle TTL | E. Hybrid (recommended direction, NOT approved) |
|---|---|---|---|---|---|
| Memory (idle registered cluster) | Full (~20-25MB) | ~0 | ~0 until a feature opened | ~0 after TTL | Minimal (metadata only) |
| Goroutines (idle registered cluster) | ~297 | 0 | 0 until a feature opened | 0 after TTL | ~0 |
| First-view latency | N/A (already warm) | Cold-start cost shifted to first view (informer sync time — not measured, but `buildClusterSummary`'s existing cold-request numbers from the Enterprise Scale report suggest low-seconds for a modest cluster) | Cold-start cost shifted, but only for the specific feature's informers (smaller sync set, likely faster) | Same as B on first view; same again after every TTL-driven restart | Same as C, but "lightweight metadata" (name/status/counts via a cheap direct API call, not an informer) can be shown immediately even before the full informer set syncs |
| Warm-view latency | Already fast (current baseline) | Same as current once synced | Same as current for activated features | Same as current while within TTL window | Same |
| API-server load (N clusters, idle) | N × 27 standing watches | 0 | 0 | 0 after TTL | 0 (metadata via periodic lightweight poll, not a watch) |
| Cluster switching (A→B→A) | No cost (both already warm) | Re-sync cost on each switch back if B was torn down between switches | Same, scoped to activated features | Same, bounded by TTL window (no cost if switch-back happens within TTL) | Same as D |
| Correctness/race surface | Established, well-tested (VALID-01/02/04 already hardened this exact lifecycle) | New: activation-race, concurrent-first-view races (§ below) | Same races as B, plus per-feature activation bookkeeping | Same as B/C plus TTL-expiry race (§ below) | Same as D plus the added "lightweight metadata" path's own correctness (must never show stale/wrong counts while informers are cold) |
| Implementation complexity | None (shipped) | Medium — needs an activation gate + first-request-blocks-on-sync handling | Medium-high — needs per-feature informer-set definitions and partial-start/stop | High — adds TTL timer management, idle-detection, safe teardown-while-possibly-in-use | Highest — combines C's feature-scoping with D's TTL, plus a new lightweight-metadata path |
| Stale-data risk | None beyond existing (already-solved) staleness semantics | New risk window: between activation request and informer sync-complete, any read must either block or return a clear "still loading" state, not stale/wrong data | Same, narrower scope | Same, plus a cluster that goes idle→TTL-stopped→re-activated must not show the pre-TTL stale snapshot as current | Same as D; metadata path must be clearly distinguished from full-fidelity data in the API contract |

**No winner is selected here, per instruction.** Candidate E is named as "recommended direction" only because it's the natural evolution of C+D together and best matches the brief's own proposed lifecycle diagram — not because this investigation proves it superior with implementation-grade evidence. It remains unapproved.

---

## Correctness and Concurrency Analysis

Answered with code evidence where available; several are genuinely **UNVERIFIED** because they describe states the *current* architecture cannot enter (no activation/TTL mechanism exists yet) — these are correctly unanswerable from current code and must be designed, not retrofitted, if Candidate B/C/D/E is approved.

1. **Two simultaneous requests activate a cluster** — N/A under current architecture (no activation step exists; `StartClusterCache`'s own `c.mu.Lock()` + existence check at `overview_cache.go:58-61` is already safe against concurrent duplicate starts today). If a future lazy design adds an explicit "activate" trigger, it should reuse this exact same lock-and-check pattern — **UNVERIFIED for a design that doesn't exist yet**, but the existing idempotency primitive is directly reusable.
2. **Can two InformerManagers accidentally start?** — No, today: `StartClusterCache` checks `c.informers[clusterID]` existence under `c.mu.Lock()` before creating a new one (`overview_cache.go:58-64`) — CODE-PROVEN safe against today's call patterns.
3. **Activation races cluster removal** — Today's closest analogue, reconnect-races-removal, is explicitly handled by `finishReconnect` (`cluster_service.go:1003-1012`, rolls back client+cache if the row is gone) — VALID-01-documented pattern. A future activation path would need the same "re-check existence after the slow part, roll back if gone" shape — **UNVERIFIED for the not-yet-built activation path specifically**.
4. **Activation races reconnect** — Not applicable today (no activation step); VALID-04 already hardened reconnect-races-reconnect (stop-before-start, `applyAndStoreClient`). **UNVERIFIED** for activation specifically.
5. **TTL shutdown races a request** — **UNVERIFIED, no TTL mechanism exists.** This is the single most important new correctness question for Option D/E and must be designed explicitly (e.g., a reference-count or last-access-timestamp check inside the same lock `StopClusterCache` already takes, so a request that arrives just as TTL fires either (a) wins and cancels the stop, or (b) loses cleanly and triggers a fresh activation — not a half-torn-down state).
6. **Kubernetes API becomes unreachable** — Handled today for the *registration/reconnect* path (`clusterStatusFromError`, circuit breaker, negative-failure cache) — CODE-PROVEN for existing paths. Informer-level watch failures specifically (as opposed to connection-test failures) are handled by client-go's own reflector retry/backoff internally — not independently verified by Kubilitics' own code this pass.
7. **An informer fails** — client-go's reflector has its own internal retry/backoff; Kubilitics does not appear to have its own additional informer-health-monitoring/alerting layer (not found in `informer.go` — **UNVERIFIED** whether a permanently-failing informer for one resource type (e.g. an RBAC-restricted kind) is surfaced to the user in any way, or just silently never populates that one `Store`).
8. **Client replaced while informer running** — This is exactly VALID-04's finding and fix: previously, a replaced client left the OLD informer manager (bound to the abandoned client) running. Now fixed via the stop-before-start pattern at `applyAndStoreClient`/`ReconnectCluster` — CODE-PROVEN, already tested (`docs/VALID-04-INVESTIGATION.md`).
9. **Old informer using abandoned client** — Same as #8; fixed by VALID-04, CODE-PROVEN not to recur via the two reconnect call sites, which both now call `StopClusterCache` before `StartClusterCache`.
10. **Stale cache presented as fresh** — Outside informer lifecycle specifically, HEALTH-2's `Stale`/`StaleAsOf` fields (FLEET-N1 phase) already establish a pattern for honest staleness signaling at the `/summary` layer. The informer-backed `GetStore` reads themselves have no explicit staleness signal today (a `Store` read always returns "whatever client-go's reflector last saw," with `HasSynced()` as the only sync-state signal `resources.go`/`workloads.go` check) — **CODE-PROVEN that `HasSynced()` gating exists**, not independently verified that every consumer checks it correctly in all paths this pass.
11. **Cache generation A overwrite generation B** — `StopClusterCache` deletes all of a cluster's map entries before any subsequent `StartClusterCache` can populate them (both under the same `c.mu` lock, sequential by construction in the reconnect call sites) — CODE-PROVEN not to race for the *existing* stop-then-start call sites. **UNVERIFIED** for a not-yet-built concurrent-activation path.
12. **Removed cluster resurrects** — VALID-01 directly investigated and fixed this exact class of bug (`finishReconnect`'s existence re-check) — CODE-PROVEN, already tested.
13. **Background goroutines survive removal** — `StopClusterCache`'s `im.Stop()` closes `stopCh`, the standard, correct client-go shutdown signal for every goroutine that `factory.Start` spawned — CODE-PROVEN correct for the *existing* lifecycle. Not independently re-verified via a goroutine-count-before/after-removal measurement this pass (§ Registration vs Active-Cluster Cost, item F) — reasonable inference from code correctness, not direct measurement.
14. **Shutdown leaks goroutines** — Same answer as #13; CODE-PROVEN correct shutdown signal, not independently measured this pass.
15. **Interaction with VALID-01/VALID-02** — VALID-01 (reconnect-races-removal) and VALID-02 (bounded reconnect, unreachable clusters don't block healthy ones) both operate at the `clusterService` level, one layer above `OverviewCache`. A lazy-informer redesign would need to preserve both exactly — **UNVERIFIED for a design that doesn't exist**, but both fixes' own mechanisms (existence re-checks, per-cluster negative-failure caching) are directly reusable patterns for an activation/TTL layer.
16. **Namespace isolation (VALID-06)** — Orthogonal; VALID-06 is a frontend namespace-*discovery* fix, unrelated to backend informer lifecycle. No interaction found.
17. **Fleet behavior (FLEET-N1)** — Fleet's own aggregation (`GetFleetOverview`) calls `clusterService.GetClusterSummary`, which does NOT use the informer-backed cache at all (confirmed in Phase I-B's investigation — it makes its own direct, bounded List calls). A lazy-informer redesign would not change Fleet's own request pattern — **CODE-PROVEN no direct interaction**, though Fleet polling every 30s does exercise `ListClusters`, which is Call Site #1 in this document's inventory (the one that currently retries client-build+cache-start for any cluster lacking a live client on every poll) — worth considering together if Fleet's poll cadence interacts with a future TTL's shutdown cadence (e.g., could Fleet's own 30s poll inadvertently keep re-activating a cluster that TTL just shut down? — **UNVERIFIED, a real design question for Option D/E**).
18. **Topology correctness** — Topology (per the Enterprise Scale report) uses its own separate backend query path (`useClusterTopology`/`getTopology`), not confirmed to route through `OverviewCache`'s informers at all — **UNVERIFIED whether Topology has any dependency on this lifecycle**, worth confirming before implementation since an incorrect assumption here could break Topology under a lazy redesign without warning.
19. **Real-time updates** — Directly dependent: `OverviewCache`'s 7 registered handlers ARE the real-time update mechanism (Dashboard live counters, WebSocket push via `notifyStream`). Any lazy/TTL design must guarantee these 7 specific informers are running whenever a user has a Dashboard WebSocket connection open — a stronger requirement than "informers for the currently-viewed resource page," since Dashboard's real-time-ness depends on continuous event delivery, not point-in-time reads.
20. **New thundering-herd risk** — **UNVERIFIED, and genuinely plausible**: if a user with many registered clusters opens a multi-cluster view (e.g., Fleet, or rapidly tabs through several clusters) under a lazy architecture, that could trigger N simultaneous informer-startup sequences at once — each itself bounded (27 informers, same as today), but N-at-once is a new failure mode the current eager-at-startup model doesn't have (today, the "herd" already happened once, at backend startup, which is arguably worse in aggregate but happens exactly once rather than being user-triggerable repeatedly). This needs explicit bounding (e.g., reuse Phase I-B's `errgroup.SetLimit` pattern) if Option B/C/D/E is implemented.

---

## Failure Scenarios

Per explicit instruction, **designed but not executed** (would require either production code changes to inject the described failures, or an isolated environment this phase was not scoped to build for chaos-testing purposes specifically):

- Unreachable cluster during activation — would need: activation request → `TestConnection` fails → no informers started, clear error state, no resource leak, no cache entry left half-populated.
- Expired credentials — same shape as above; exec-based auth plugin failures already have a bounded timeout at `LoadClustersFromRepo` (`loadStartupTimeout`) — a lazy activation path would need the same bound.
- API server restart mid-watch — client-go's reflector auto-retries; needs confirmation this doesn't produce a goroutine-growth pattern over many restart cycles (not tested this pass).
- Reconnect storms — already partially bounded by `reconnectNegativeCacheTTL` (10s) and singleflight coalescing in `GetOrReconnectClient`; a lazy design's activation path should reuse these, not reinvent them.
- Rapid cluster switching — directly relevant to Option D/E's TTL design; needs a "don't tear down what was just re-activated" guard (§ Correctness Q5).
- Cluster removal during informer startup — closest existing analogue is `finishReconnect`'s existence re-check (VALID-01 pattern); a lazy activation path needs the same shape.
- Simultaneous activation of many clusters — § Correctness Q20 (thundering herd), needs explicit bounding.
- Backend restart — today, this is exactly `LoadClustersFromRepo`'s eager-start-everything behavior; a lazy redesign changes this to "persist metadata only, no informers," which is itself the core proposed change — the backend-restart scenario IS the primary case this investigation is about.
- Frontend refresh during reconnect — orthogonal to backend informer lifecycle; not a new risk from this specific change.

---

## Enterprise Resource Budgets

**Candidate** (not validated against measurement beyond the 3 real data points already gathered; explicitly proposed, not proven, per instruction not to claim a target is achievable until measured):

| Scenario | Candidate budget | Basis |
|---|---|---|
| Idle registered cluster (Option E, not yet built) | ~0 goroutines, <1MB (metadata only) | Design target, UNVERIFIED — no prototype exists |
| Active cluster (any option) | ~297 goroutines, ~20-25MB | Measured, current architecture — likely similar under a lazy design once activated, since the same 27-informer `InformerManager` would still run while active |
| First cluster activation latency | UNVERIFIED | No prototype; informer sync time scales with cluster resource count, not independently measured per-type this pass |
| Cluster switching (within TTL window) | Same as "already warm" today (near-zero added latency) | Design target for Option D/E |
| 10 registered, 1 active | ~297 goroutines total (vs. ~2,950 today) | Direct extrapolation from the per-cluster measured cost, assuming Option E's "metadata only when idle" holds |
| 50 registered, ~3 active | ~900 goroutines total (vs. ~14,850 extrapolated today) | Same extrapolation logic |
| 100 registered, ~5 active | ~1,500 goroutines total (vs. ~29,700 extrapolated today) | Same |

**Registered ≠ Active is the core proposed principle** — not yet implemented, these numbers are the projected benefit *if* Option E is built correctly, not a current capability.

---

## Performance Regression Strategy

Designed, not implemented this pass:

- **Cluster-count matrix:** 1/5/10/25/50/100 registered, with a controllable active/idle ratio (e.g., "10 registered, 2 active" as a first-class test case, not just raw N).
- **Pod/deployment-count matrix:** reuse the existing Enterprise Scale report's tiers (100/500/1K/2K/5K/10K pods; 10/50/100/300/500 deployments) crossed with the cluster-count matrix where feasible.
- **Topology variants:** cluster view, namespace view, dense namespace — reuse Phase E's `dense-ns` methodology.
- **Metrics:** p50/p95/p99 latency (with large-enough sample counts to be real percentiles, unlike this phase's small-sample ranges), cold/warm start, CPU, RSS, heap, goroutines, API request count, active-watch count, topology node/edge count, frontend render time where Playwright tooling is available (established in the Enterprise Scale report's earlier phases).
- **Gate shape:** each metric gets a measured-baseline-derived threshold (not invented), checked on every PR touching `internal/service/overview_cache.go`, `internal/k8s/informer.go`, or `internal/service/cluster_service.go`'s `StartClusterCache`/`StopClusterCache` call sites specifically — narrow enough to not become a maintenance burden on unrelated changes.
- **Not implemented this pass** — this is a design for a future CI capability, consistent with "produce a regression strategy," not "build the regression suite."

---

## Headlamp Architectural Comparison

Grounded in real Headlamp backend source (`kubernetes-sigs/headlamp`, `backend/pkg/`), read directly this pass — not assumed:

| Area | Kubilitics today | Headlamp mechanism | Evidence | Applicable lesson |
|---|---|---|---|---|
| Cluster/context lifecycle | Eager: every registered cluster gets a full informer set on registration/startup | `backend/pkg/kubeconfig/contextStore.go` + `backend/pkg/k8cache/context_cleanup.go`: contexts are tracked in a store; `clientsetCache` (per-context clientsets) is built lazily and explicitly purged via `PurgeCacheForContext` when a context is removed | Read directly: `context_cleanup.go` shows `collectCachedContextKeys` scanning `clientsetCache` for live entries, and `PurgeCacheForContext` deleting all cache entries for a removed context by key-prefix match | Real precedent for "clientset/cache created on demand, torn down explicitly on removal" — not identical to full lazy-TTL (no idle-timeout teardown evidence found), but confirms on-demand creation is a legitimate, shipped pattern, not a hypothetical |
| Response caching strategy | Informer-backed in-memory `Store` per resource kind, continuously updated by watches, read synchronously | `backend/pkg/k8cache`: HTTP-response-level cache keyed by `group+resource+namespace+context`, with explicit invalidation (`cacheInvalidation.go`) on non-GET requests (POST/PUT/DELETE) rather than continuous watch-driven updates for every cached type | Package doc comment: "provides caching utilities for Kubernetes API responses... invalidating entries when resources change" | Different tradeoff: request-driven response caching avoids a standing watch per resource kind per cluster, at the cost of needing explicit invalidation logic rather than getting it "for free" from continuous watch events. Not a strict improvement — it trades standing cost for invalidation complexity — but demonstrates the eager-informer approach is a choice, not the only option |
| Watches specifically | 27 informers always running per registered cluster | `k8cache` imports `k8s.io/client-go/dynamic/dynamicinformer` — Headlamp DOES use informers for at least part of its invalidation strategy, not a purely request-driven design with zero watches | Import evidence in `cacheInvalidation.go` | Headlamp's own design is itself a hybrid (some watching, some on-demand), not "zero informers" — a useful corrective against over-simplifying Option B as "what Headlamp does"; Headlamp more closely resembles Option C/E than pure Option B |
| Plugin architecture, resource pagination, frontend rendering, topology/graph handling | Not investigated this pass | Not investigated this pass | — | **UNVERIFIED** — out of this investigation's scope (informer lifecycle specifically); flagged for a separate, dedicated comparison if those areas become the active focus of a future phase |

**Explicitly not claimed:** that Headlamp "handles scale better" in any measured, comparable sense — no side-by-side benchmark was run (would require the same controlled environment this phase's own measurement methodology notes are honest about not fully providing). The claim made here is narrower and evidenced: Headlamp's shipped, real architecture treats per-context clientset/cache creation as on-demand with explicit cleanup, which is real precedent that this class of design is workable in a production multi-cluster Kubernetes UI — not proof it's correct for Kubilitics' specific real-time-Dashboard requirements.

---

## Recommended Direction

**Not approved, not implemented.** Reasoned recommendation only, for the approval gate:

Move toward **Option E (Hybrid)**: cluster registration persists metadata and performs a cheap, bounded, non-watch connectivity/version check only (no informers); the first request that needs informer-backed data (Dashboard open, a resource-list page, Topology if it turns out to depend on this layer — Q18 above is unresolved) triggers `StartClusterCache` exactly as today, reusing every existing idempotency/lock/VALID-04 lifecycle-correctness guarantee unchanged; an idle-TTL (duration TBD, needs its own evidence-gathering — not guessed here) stops the cache for a cluster with no active Dashboard WebSocket connection and no recent resource-page reads.

**Why not B or C alone:** B (fully lazy, no TTL) still leaves a cluster warm forever once first viewed, which is fine for a small number of actively-used clusters but doesn't help a user who briefly checked 40 clusters once each — exactly the scenario the ~297×N finding is most concerning for. C (feature-scoped) without a TTL has the same "warm forever once touched" property. D (lazy+TTL, no feature-scoping) saves on idle clusters but still starts all 27 informers for a cluster even if the user only ever opens one resource-list page — missing the 20-of-27-informers-have-no-Dashboard-consumer finding's full benefit. E combines both: feature-scoping bounds the *activation* cost, TTL bounds the *idle* cost.

**Why this is not an implementation order:** the correctness questions flagged UNVERIFIED in §10 (items 1, 3, 4, 5, 17, 18, 20 specifically) are not optional nice-to-haves — items 5 (TTL-races-request) and 20 (thundering herd) in particular describe failure modes with no existing analogue in the current codebase to reuse a pattern from, and item 18 (does Topology even depend on this layer) is a factual gap that could silently break a major feature if assumed incorrectly. None of these can be responsibly closed by more investigation alone — they need a real prototype to test against, which is implementation, which this phase is explicitly not authorized to do.

---

## Implementation Plan

**Sketch only, not to be executed without separate approval:**

1. Add an explicit "activation" concept to `OverviewCache` — likely a `EnsureClusterCache(ctx, clusterID, client) error` that does what `StartClusterCache` does today but is called from request-serving paths (Dashboard open, resource-list page, WebSocket subscribe) instead of registration/startup.
2. Change the 5 "start on registration/startup" call sites (ListClusters enrichment, kickBackgroundReconnect, both addClusterWithSource branches, LoadClustersFromRepo) to NOT call `StartClusterCache`/`EnsureClusterCache` — registration persists metadata and tests connectivity only.
3. Wire `EnsureClusterCache` into the actual consumers: `resources.go`/`workloads.go`'s `GetInformerManager` call sites, Dashboard's WebSocket-subscribe path, and wherever Topology is confirmed (not assumed — close Q18 first) to need it.
4. Add idle-TTL tracking — likely a last-access timestamp per cluster, checked by a background ticker (reusing the existing ticker-lifecycle patterns already hardened by VALID-04's own investigation into ticker/goroutine leaks).
5. Add the thundering-herd bound (Q20) — reuse Phase I-B's `errgroup.SetLimit` pattern for "many clusters activated near-simultaneously."
6. Preserve every existing VALID-01/02/04 guarantee — each has its own regression test suite; all must still pass unchanged.

## Test Strategy

- Unit tests for the new `EnsureClusterCache` idempotency/concurrency behavior, mirroring the existing `StartClusterCache` tests.
- Concurrency tests for Q1/Q3/Q4/Q5/Q20 specifically — these are the genuinely new race surfaces.
- Regression run of every existing VALID-01/02/04 test, unchanged.
- A real (not mocked) before/after goroutine/RSS measurement at the same N=1/10/26 tiers this investigation used, now with an idle/active split to prove the "registered ≠ active" claim with real numbers.

## Rollback Strategy

Feature-flag the activation-gating behavior (environment variable or config flag defaulting to today's eager behavior) so a regression can be reverted to "always eager" without a code rollback, consistent with this engagement's established preference for additive, reversible changes over risky rewrites.

## Acceptance Criteria

- Idle registered clusters measurably cost near-zero goroutines/memory (re-measured, not assumed).
- Active clusters perform identically to today (no latency regression for the common case).
- All VALID-01/02/04 tests pass unchanged.
- Q1/Q3/Q4/Q5/Q20 each have a passing, deterministic (not wall-clock-fragile) regression test.
- Topology's dependency on this layer (Q18) is confirmed either way, with the correct behavior implemented for whichever answer is true.
- No new goroutine leak under repeated activate/idle/TTL-expire/reactivate cycling (soak-tested).

## Remaining Unknowns

1. Whether Call Site #1 (`ListClusters`'s synchronous retry-on-every-poll for unreachable clusters) should itself be bounded by the same negative-failure cache `kickBackgroundReconnect` already has — flagged in the call-site inventory, not previously documented elsewhere in this engagement.
2. The precise per-component goroutine breakdown (§ Goroutine Ownership) — needs real pprof labeling, not done this pass.
3. Whether Topology depends on `OverviewCache`'s informers at all (Q18) — factual gap, not resolved this pass.
4. The correct TTL duration — no evidence gathered this pass on real user cluster-switching cadence to inform this.
5. Whether informer-level watch failures (as opposed to connection-test failures) are surfaced to users in any way today (Q7) — not confirmed.
6. File-descriptor count per cluster — not measured (only goroutines/RSS were sampled).
7. True independent-API-server behavior at N≥26 — the shared-API-server methodology explicitly does not answer this.

## Decision / Approval Gate

**This investigation recommends Option E (Hybrid lazy+TTL+feature-scoped) as the direction worth prototyping, but explicitly does not approve or begin implementation.** Per instruction, stopping here. Awaiting explicit approval before any production code change, and recommending the Remaining Unknowns above (particularly #2, #3, and #5) be closed — or explicitly accepted as residual risk — before implementation begins, since several bear directly on correctness, not just performance.
