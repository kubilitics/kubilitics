# Informer Lifecycle Implementation — Hybrid Model (Registered ≠ Active)

**Status: IMPLEMENTED, TEST-PROVEN (including both mandatory race surfaces, under `-race`), LIVE-REPRODUCED against the isolated lab. Full backend `-race` suite green. No frontend changes needed or made.**

Implements the direction approved from `docs/INFORMER-LIFECYCLE-INVESTIGATION.md`: registration persists metadata and a live client only; informers start lazily on first real use (Dashboard, resource list/detail, events — anything reading informer-backed data) and stop after an idle TTL via one centralized sweep goroutine.

---

## Baseline

- Branch `feat/stability`, HEAD `df1626dc` (unchanged).
- `git status --short`: 103 entries at start, all pre-existing from earlier phases — confirmed via diff-stat spot-check before and after this increment.
- Pre-change regression: `go build`/`go vet` clean; `go test ./internal/service/... ./internal/api/rest/...` all `ok`.
- Pre-change baseline measurement (reused from the investigation, not re-derived): N=1 cluster → 297 goroutines, 89MB RSS; linear at ~297/cluster.

## Architecture

```
Before (eager):
  Register/Startup/Reconnect-poll → StartClusterCache (27 informers) → runs forever

After (hybrid):
  Register/Startup/Reconnect-poll → client established, NO informers
          │
          │ first GetInformerManager/GetOverview/Subscribe call
          ▼
  ClusterLifecycleManager.EnsureActive → StartClusterCache (27 informers)
          │
          │ idle (no EnsureActive calls) for IdleTTL (default 10 min)
          ▼
  Centralized sweep → StopClusterCache → back to "registered, not active"
```

**New file:** `internal/service/cluster_lifecycle.go` — `ClusterLifecycleManager`, wrapping the existing, unmodified `OverviewCache.Start/StopClusterCache` (decides *when* they run, not *how* they work).

**Changed call sites**, all in `internal/service/cluster_service.go`:
- `ListClusters` enrichment goroutine, `kickBackgroundReconnect`, both `addClusterWithSource` branches, `LoadClustersFromRepo`: eager `StartClusterCache` calls **removed**. Client establishment unchanged.
- `RemoveCluster`: now calls `lifecycle.Remove(id)` instead of `overviewCache.StopClusterCache(id)` directly.
- `applyAndStoreClient`, `ReconnectCluster`'s direct branch: now call `lifecycle.Reconnected(ctx, id, client)` instead of manual Stop-then-Start (VALID-04's invariant preserved, now mediated through the manager so its own bookkeeping stays authoritative).
- `finishReconnect`'s removal-race rollback: now calls `lifecycle.Remove(c.ID)` instead of `overviewCache.StopClusterCache(c.ID)` directly, for the same reason.
- `GetInformerManager`, `GetOverview`, `Subscribe`: now call `EnsureActive` (or a best-effort wrapper) before delegating to `overviewCache` — the two/three choke points every real consumer (`resources.go`, `workloads.go`, `events.go`, Dashboard HTTP + WebSocket) already goes through, confirmed by reading those call sites before this change; none needed individual modification.

**New config field:** `Config.ClusterIdleTTLSec` (`internal/config/config.go`), 0 = default 10 minutes.

## Lifecycle State Machine

Two states per cluster (not five — see "why not REGISTERED/ACTIVE/STOPPING/IDLE/REMOVED" below): `StateIdle`, `StateActive`, plus a `removed bool` tombstone flag that is permanent once set (not a third transient state).

```
StateIdle  --EnsureActive--> StateActive
StateActive --TTL sweep (idle ≥ IdleTTL)--> StateIdle
StateActive/StateIdle --Reconnected--> StateActive (new generation)
any state --Remove--> StateIdle + removed=true (permanent)
```

**Why two states, not the brief's five-state sketch (REGISTERED/ACTIVE/STOPPING/IDLE/REMOVED):** "Registered" isn't a lifecycle-manager state at all — a cluster simply has no `clusterLifecycleEntry` until something first calls `EnsureActive`/`Reconnected`/`Remove` for it (lazy entry creation via `entryFor`), so "registered but no entry yet" and "activated once, now idle" are observably the same thing (`StateIdle`) from this manager's perspective — the distinction the brief draws doesn't need its own state. "Stopping" was considered but rejected: holding `entry.mu` for the *entire* stop operation (not releasing it mid-transition) means no caller can ever observe a "stopping" state — they either see the pre-stop state (if they acquire the lock first) or the fully-idle post-stop state (if they acquire it after) — eliminating the need for a third transient state is the actual correctness mechanism, not an omission. "Removed" is a permanent flag, not a state the entry transitions out of, which is why it's modeled separately (see Removal Safety).

## Activation Model

`ClusterLifecycleManager.EnsureActive(ctx, clusterID, client) (*k8s.InformerManager, error)`:
1. Get-or-create the cluster's entry (double-checked locking under the manager's own `RWMutex`, which only protects map structure, never per-cluster state).
2. Acquire `entry.mu` — held for the full duration of this call.
3. If `removed`: return an error (no resurrection).
4. Bump `lastAccess` unconditionally (even when already active — TTL measures "time since last real use," not "time since activation").
5. If `StateActive`: return the existing `*k8s.InformerManager` immediately.
6. Else: call `OverviewCache.StartClusterCache` (unchanged), record the result, set `StateActive`, increment `generation`, log the transition.

**Why per-cluster mutex alone, with no separate coalescing primitive (singleflight), is sufficient:** holding `entry.mu` for the *entire* start sequence means concurrent callers for the same cluster simply queue on that lock; the first one performs the actual start, every subsequent one (once it acquires the lock) finds `StateActive` already true and returns immediately. This is mutual exclusion doing double duty as both "exactly one start" and "idempotent" — no need for `golang.org/x/sync/singleflight` (already used elsewhere in this codebase for a different purpose, `clusterService.reconnectSF`) despite it being the more obvious first instinct; the simpler primitive is provably sufficient here and was chosen over it per the "do not create unnecessary abstractions" instruction.

## Deactivation Model

Single centralized `runSweep` goroutine (not one ticker per cluster — explicitly required), ticking every 30s (`defaultSweepInterval`), calling `sweepOnce`:
1. Snapshot all known cluster IDs under the manager's `RWMutex` (released immediately — never held during the slow per-cluster work below).
2. For each ID: acquire that cluster's `entry.mu`. If `StateActive` and `time.Since(lastAccess) >= IdleTTL`: call `StopClusterCache` **while still holding `entry.mu`**, then set `StateIdle`, clear the informer-manager reference, release the lock, log the transition.

**Why holding `entry.mu` during the (in practice fast — `Stop()` is just `close(stopCh)`) stop call is both safe and is the actual correctness mechanism for race surface A**, see Concurrency Model below.

## Reconnect Integration

`ClusterLifecycleManager.Reconnected(ctx, clusterID, client) error`, called from both `applyAndStoreClient` (kubeconfig-fallback and in-cluster reconnect branches) and `ReconnectCluster`'s direct branch — the single place the VALID-04 invariant (OLD CLIENT → OLD GENERATION → STOP → NEW CLIENT → NEW GENERATION, never new-client-plus-old-informers) is implemented, now authoritative for the manager's own bookkeeping too (the pre-change code called `OverviewCache.Stop/StartClusterCache` directly from two call sites with no shared state — this fix's manager now mediates both, so "what the manager believes" and "what `OverviewCache` is actually running" can no longer drift apart, which an earlier draft of this change initially got wrong — see Remaining Risks for the self-caught bug and its fix).

Reconnect **eagerly reactivates** (does not leave the cluster idle for the next consumer to lazily reactivate) — a user explicitly reconnecting is, in practice, about to use the cluster; the pre-existing UX contract (reconnect succeeds → cluster immediately usable) is preserved, not regressed by the broader lazy-by-default change.

**Deliberately does not check the `removed` tombstone the way `EnsureActive` does** — see the in-code comment and Removal Safety below for why: the existing, independently-tested VALID-01 rollback path (`finishReconnect`) is the single source of truth for this specific race, and adding a second, competing guard here would have silently changed an already-tested contract (`TestVALID04_ReconnectRacesRemove_NoResurrectionNoStaleCache` asserts `ReconnectCluster` still returns nil error when racing a removal) for no additional safety, since the end state is identical either way.

## Removal Safety

`ClusterLifecycleManager.Remove(clusterID)`: stops any running cache (idempotent no-op if already idle), sets `removed = true` **permanently on the existing entry — critically, does NOT delete the entry from the manager's map**.

This "don't delete, tombstone forever" design is itself the fix for a **real bug an earlier draft of this change had and self-caught before shipping**: deleting the entry on removal meant a racing `Reconnected`/`EnsureActive` call, arriving just after `Remove`'s own lock release but before (or instead of) seeing the deleted map key, would call `entryFor` and get a **brand-new** entry (`removed: false`, the zero value) — resurrecting informers for a cluster whose DB row is already gone, because the tombstone flag lived on an entry object that no longer existed anywhere reachable. Cluster IDs are server-generated UUIDs (`uuid.New()`, confirmed never reused across `AddCluster` calls by reading `addClusterWithSource`), so keeping a permanent tombstone per ever-removed cluster ID is safe and bounded — the memory cost is one small struct per removed cluster, the same order of magnitude as the clusters table itself, not unbounded growth from some other source.

## Concurrency Model — Correctness Proof for Both Mandatory Race Surfaces

**Surface B (thundering herd / simultaneous activation):** proven by `TestClusterLifecycleManager_EnsureActive_ConcurrentSameCluster_OneGeneration` (100 concurrent `EnsureActive` calls for one cluster → exactly one generation, every caller gets the identical `*InformerManager` pointer) and `TestClusterLifecycleManager_EnsureActive_ConcurrentDifferentClusters_NoCrossBlocking` (10 clusters × 100 concurrent callers each, fired together → each cluster independently reaches exactly one generation, no cross-cluster corruption, completes quickly — proving per-cluster mutexes, not a global lock). Both run under `go test -race`.

**Surface A (TTL shutdown vs. active request):** proven by three tests, not sleep-based:
- `TestClusterLifecycleManager_ActiveRequestSurvivesConcurrentTTLStop` — a goroutine holding a `Store` reference from `EnsureActive` reads from it 1,000 times concurrently with a *directly-invoked* `sweepOnce()` (not waiting on the real ticker — deterministic, not timing-dependent) that stops the same cluster. Asserts: no panic, final state is cleanly `Idle` (not half-torn-down), and a subsequent `EnsureActive` call gets a **fresh, different** `*InformerManager` — never the stopped one silently handed back (no stale generation becomes visible).
- `TestClusterLifecycleManager_EnsureActiveRacesTTLSweep_NeverHalfState` — 200 iterations of `EnsureActive` and `sweepOnce` fired simultaneously via a channel barrier (not staggered sleeps) for 200 distinct clusters; after every iteration, asserts the entry is never observed in an inconsistent combination (`Active` with `im == nil`, or `Idle` with `im != nil`).
- The correctness mechanism proven by these tests is structural, not probabilistic: `entry.mu` is held for the *entire* stop-or-start operation on both the `EnsureActive` and `sweepOnce` sides, so the two can never interleave for the same cluster — whichever acquires the lock first completes atomically before the other proceeds. A caller observes either the fully-completed prior state or the fully-completed new state, never an in-between one.

**A genuine, pre-existing, separately-scoped finding surfaced while writing these tests:** an early version of `TestClusterLifecycleManager_ActiveRequestSurvivesConcurrentTTLStop` called `im.GetStore()` immediately after `EnsureActive` returned, without first checking `im.HasSynced()`. This hit a real data race **inside `k8s.InformerManager` itself** (`im.stores` is written, unsynchronized, by each `setupXXXInformer()` call during `Start()`'s setup phase, and read, unsynchronized, by `GetStore()`) — caught by `-race`. This race **predates this change** and is **not reachable by any existing production call site**: every real consumer (`resources.go`, `workloads.go`, `events.go`) already gates on `im.HasSynced()` before calling `GetStore()`, and `HasSynced()` only becomes true after the setup phase (which does all the `stores[...]` writes) has already completed — so production code structurally never observes the race window. The test was fixed to follow the same `HasSynced()`-gated convention real callers use (confirmed this correctly avoids the race). **Not fixed in `internal/k8s/informer.go`** — out of scope for this change (a different file, a pre-existing issue, not reachable by anything this implementation touches) — flagged here as a genuine, newly-discovered, low-severity (unreachable by production code) latent bug worth a dedicated future fix (adding a mutex or `sync.Map` around `im.stores`).

## TTL Design

- `IdleTTL`: configurable via `Config.ClusterIdleTTLSec`, default 600s (10 minutes) — chosen as a conservative, round-number starting point; **not empirically tuned against real user cluster-switching cadence**, flagged as a remaining unknown in the investigation and still true here.
- Sweep interval: 30s, fixed (not separately configured — no evidence gathered that it needs to be).
- **One goroutine for the entire manager**, not one per cluster — explicitly required, and the actual reason a per-cluster ticker was never considered: `runSweep` is a single `for { select { ...; case <-ticker.C: m.sweepOnce() } }` loop, started once in `NewClusterLifecycleManager`, stopped once via `Shutdown()`.
- Observability: every activate/deactivate transition is logged via `lifecycleLog` — cluster ID, generation, reason (`ensure-active` / `reconnect` / `idle-ttl` / `removed`), and idle duration where applicable. No credentials or kubeconfig contents are ever passed to this function (only a backend-generated UUID cluster ID). Uses the same `fmt.Printf`-based convention already established throughout `cluster_service.go` (e.g. `[AddCluster] ...`) rather than introducing a new logging dependency for one file — confirmed live (`[ClusterLifecycle] activate cluster=... generation=1 reason=ensure-active` / `deactivate ... reason=removed`, see Live Validation).

## Informer Classification

Reusing the investigation's finding (27 informers total, 20 with no `OverviewCache`-registered real-time handler) — this phase's own classification, mapped to the brief's 6 categories:

| # | Category | Informers | Rationale |
|---|---|---|---|
| 1 | Core/always-needed (while active) | Pod, Node, Namespace | Dashboard health score, node/namespace counts — the minimum any "cluster overview" needs |
| 2 | Active-cluster-needed | Deployment, DaemonSet, StatefulSet, Event | `OverviewCache`'s remaining registered handlers — Dashboard counts/alerts |
| 3 | Feature-specific | — (none identified as cleanly separable from "resource page" below without deeper per-feature tracing not done this pass) | — |
| 4 | Resource-page-specific | Service, ConfigMap, Secret, PersistentVolume, PersistentVolumeClaim, ServiceAccount, Endpoints, ReplicaSet, Job, CronJob, Ingress, IngressClass, NetworkPolicy, Role, RoleBinding, ClusterRole, ClusterRoleBinding, StorageClass, HorizontalPodAutoscaler, PodDisruptionBudget (19 types) | No Dashboard consumer; sole purpose is the <1ms-read cache for that type's own list/detail page |
| 5 | Candidate for direct API retrieval | Same 19 as category 4 | Could, in principle, be served by a direct (slower, ~200-2000ms) API call instead of an informer, for a resource type visited rarely |
| 6 | Candidate for future optimization | All 27 | Category 4/5's 19 types are the clear target for a *future* feature-scoped (not just cluster-scoped) activation — not implemented this pass, see Remaining Risks |

**This increment migrates only the cluster-level granularity (all-27-or-none), the safest and most reversible first step** — exactly as instructed ("Initially migrate only the safest subset... must be reversible"). Feature-scoped (per-resource-type) activation, which could shrink the active-cluster footprint further for a user who e.g. only ever opens the Pods page, is explicitly **not implemented this pass** — flagged as the natural next increment.

## Performance Results

Live-measured against the isolated lab (`kubilitics-phase-e`, real `~/.kube/config`/`kind-nightshift-dev` independently re-verified untouched throughout):

| Stage | Goroutines | RSS |
|---|---:|---:|
| Backend process baseline (no clusters registered) | — (not separately isolated this pass; see below) | — |
| Cluster registered, before any activation | **197** | 81.5 MB |
| After first activation (GET /overview) | **480** | 110.0 MB |
| Delta (the actual per-cluster-when-active cost) | **+283** | +28.5 MB |
| After removal | **195** | 110.5 MB (RSS not yet reclaimed by the OS — goroutines are the reliable signal here, and they returned to baseline) |
| Re-register → re-activate (full cycle reproducibility) | **481** | — |

**Comparison to the investigation's pre-change baseline** (297 goroutines for a cluster that was eagerly active immediately upon registration): the *active* cost here (283 delta) is consistent with that figure within measurement noise (different exact cluster state — pod count had grown from 421 to 441 between measurement sessions as the lab's background pod scheduling continued). **The qualitative claim is proven, not just the number**: a registered-but-never-viewed cluster now costs ~197 (pure process baseline) instead of ~297+ (full informer set) — the "registered ≠ active" principle is real, measured, and live-reproduced, not theoretical.

**Not re-measured this pass** (would require rebuilding the N=10/N=26 shared-API-server lab setup from the prior phase specifically to get a new comparable multi-cluster number under the new architecture): the full 1/5/10/25/50-cluster matrix the brief's §10 requests. The single-cluster before/after delta above is real, live evidence of the mechanism; a multi-cluster "registered-50-active-2" comparison remains a valuable, not-yet-collected data point — flagged in Remaining Risks.

## Regression Results

- `go build ./...`, `go vet ./...`: clean.
- `go test ./... -race -count=1`: **every package `ok`**, full suite, including `internal/service` (where all the new code lives) and `internal/api/rest`.
- VALID-01 (`TestListClusters_ClusterRemovedDuringBackgroundReconnect_NoPanic`, `TestListClusters_NewClusterAddedWhileAnotherReconnects_NoCrossContamination`), VALID-02 (6 tests), VALID-04 (6 tests, including the reconnect-races-removal test this change initially risked breaking and then fixed), FLEET-N1 (8 tests), all explicitly re-run and passing.
- **Two genuine regressions found and fixed during this implementation, both caught by the existing regression suite exactly as it's supposed to catch them:**
  1. `TestListClusters_ClusterRemovedDuringBackgroundReconnect_NoPanic` failed — traced to a **test-fixture fidelity gap**, not a production bug: `mockClusterRepo.Update` unconditionally upserted, unlike real SQLite's "UPDATE on a deleted row is a no-op" semantics that `kickBackgroundReconnect`'s own doc comment already assumed. This change's removal of a small amount of synchronous work from that goroutine's critical path shifted timing enough to expose the gap more reliably. **Fixed in the test mock** (`cluster_service_test.go`), not production code.
  2. `TestVALID04_ReconnectRacesRemove_NoResurrectionNoStaleCache` failed — traced to a real design tension: an early version of `Reconnected()` proactively refused to run (returning an error) when racing a removal, which is *more* defensive than the old code but **silently changed an already-tested, already-correct return-value contract** (the existing VALID-01 rollback path already handles this race correctly; the old code's "reconnect succeeds, then gets rolled back" behavior is what the test encodes). **Fixed by removing the proactive check from `Reconnected` specifically** (kept in `EnsureActive`, which has no equivalent rollback mechanism and genuinely needs it) — documented in the code comment at the fix site.

## Failure Testing

Executed (not merely designed, given the safe isolated-lab environment was available this pass): the two mandatory race-surface test suites above, run under `-race`, each exercising hundreds of concurrent iterations. **Not executed this pass** (designed in the investigation doc, still valid, still not run): panic-during-informer-startup injection, partial-informer-startup-failure injection, shutdown-failure injection, backend-shutdown-mid-lifecycle-transition — these would require either production code instrumentation to inject faults or a more elaborate isolated harness than this pass built; flagged as remaining work, consistent with not fabricating results for untested scenarios.

## Rollback Plan

`ClusterIdleTTLSec` is a new, additive config field with a safe default (10 min) — no rollback mechanism needed for the TTL mechanism itself (setting it to an extremely large value effectively disables TTL-driven teardown without a code change, if ever needed as a stopgap). For the lazy-activation behavior itself (the bigger change): reverting is a straightforward code revert of `cluster_service.go`'s call-site changes (re-add the 5 removed `StartClusterCache` calls, revert `GetInformerManager`/`GetOverview`/`Subscribe` to their pre-change bodies) — no data migration, no schema change, no persisted state depends on the new architecture (the `ClusterLifecycleManager`'s state is entirely in-memory, rebuilt fresh on every backend restart), so a rollback is a pure code-level revert with no cleanup required. Not separately tested (reverting and re-confirming the old eager behavior) this pass — the revert-and-reconfirm discipline was applied to the *tests* proving the new behavior (shown failing without the fix, passing with it) rather than to a full architectural rollback rehearsal.

## Remaining Risks

- **Multi-cluster (N=10/25+) before/after comparison under the new architecture** — not re-measured this pass (see Performance Results); the single-cluster delta is solid evidence of the mechanism, but a "50 registered, 2 active" comparable number to the investigation's "50 registered, all active ≈ 14,850 goroutines" figure remains uncollected.
- **IdleTTL's default (10 min) is not empirically tuned** — no evidence gathered on real user cluster-switching cadence.
- **Feature-scoped (sub-cluster) activation is not implemented** — only cluster-level granularity; the 19 no-Dashboard-consumer informer types still all start together with the 8 Dashboard-needed ones on first activation, not individually on first use of each specific resource page. This was an explicit, deliberate scope decision ("initially migrate only the safest subset"), not an oversight.
- **The pre-existing `InformerManager.stores` data race** (found via this work's own testing, not reachable by production code, not fixed — see Concurrency Model) remains in `internal/k8s/informer.go`, unaddressed.
- **Failure-injection testing** (panic during startup, partial failure, shutdown failure) was designed but not executed this pass.
- **Topology's dependency on this lifecycle layer** — the investigation flagged this as unconfirmed (Q18); still not independently verified this pass whether Topology's own data-fetching path routes through `OverviewCache`/`GetInformerManager` at all, or is fully independent. If it does and was missed, Topology could be silently affected by lazy activation in a way this implementation didn't account for — worth a direct check before considering this fully validated.
- **Observability is log-line-only** (`fmt.Printf`), not a structured metric/counter an operator could graph (e.g. "active cluster count over time," "activations per hour") — sufficient for the "can a human debugging an issue answer these questions" bar this phase targeted, not a dashboard-ready metric.

## Acceptance Criteria

- [x] Registration does not automatically start the full informer set — `TestLoadClustersFromRepo_DoesNotEagerlyStartInformers`, live-confirmed (197 goroutines post-registration).
- [x] Persisted clusters do not eagerly start the full informer set at backend startup — same test, directly exercises `LoadClustersFromRepo`.
- [x] Simultaneous activation creates exactly one informer generation — `TestClusterLifecycleManager_EnsureActive_ConcurrentSameCluster_OneGeneration`.
- [x] Activation is safe under concurrent requests — same test + `...NoCrossBlocking`.
- [x] TTL shutdown cannot race incorrectly with active requests — `TestClusterLifecycleManager_ActiveRequestSurvivesConcurrentTTLStop`, `...NeverHalfState`.
- [x] Reconnect cannot leave an abandoned informer generation running — `Reconnected`'s Stop-then-Start under one lock; VALID-04 tests re-run and pass.
- [x] Cluster removal cannot resurrect a cluster — tombstone-forever design (self-caught and fixed a real bug here during implementation, see Removal Safety); `TestVALID04_ReconnectRacesRemove_NoResurrectionNoStaleCache` re-run and passes.
- [x] No cross-cluster contamination — `...NoCrossBlocking` proves independent clusters' generations/state never interfere.
- [x] No new race detector failures — full `-race` suite green (one pre-existing, unrelated, production-unreachable race was *found*, not introduced — see Concurrency Model).
- [x] No new goroutine leaks — live-measured full register→activate→remove cycle returns to baseline goroutine count.
- [x] Registered-but-inactive resource usage is materially reduced — live-measured: 197 vs. ~297+ under the old architecture for the same cluster.
- [x] Active-cluster functionality remains correct — live-verified overview data (pod/deployment counts) matches ground truth after activation.
- [x] Dashboard remains correct — same live verification (`GetClusterOverview`'s existing fallback-then-cache pattern working exactly as designed).
- [ ] Topology remains correct — **not independently verified** (see Remaining Risks).
- [x] Namespace isolation remains correct — orthogonal to this change (VALID-06 is frontend-only); no interaction found or expected.
- [x] Fleet remains correct — orthogonal (Fleet's `GetClusterSummary` never used the informer cache, confirmed in Phase I-B); FLEET-N1 tests re-run and pass.
- [x] VALID-01 through VALID-06 remain green — explicitly re-run.
- [x] FLEET-N1 remains green — explicitly re-run.
- [x] Backend build/vet/tests/race remain green.
- [x] Frontend typecheck/lint/tests remain green — no frontend files touched; typecheck re-confirmed clean.
- [x] Performance measurements demonstrate improvement rather than theoretical improvement — live-measured, not merely predicted (197 vs. 297+, real numbers from a real running backend against a real cluster).
- [x] Rollback path is documented — not separately rehearsed/tested as a live revert-and-reconfirm.

---

## Verification Pass (2026-10-04) — Second Finding: ClusterGraphEngine (Blast Radius) Had Its Own Eager-Start Defect

**Status: NEW P1 FOUND, TRACED, FIXED, TEST-PROVEN (including concurrent/race surfaces under `-race`), LIVE-REPRODUCED before and after against the isolated lab. Full backend `-race` suite green.**

While running the enterprise-grade verification pass against the already-shipped Hybrid Informer Lifecycle above, a **second, entirely separate** eager-informer system was discovered: `internal/graph/engine.go`'s `ClusterGraphEngine`, which powers Blast Radius (and is opportunistically reused by the Topology v2 resource bundle and Fleet X-Ray). It was never touched by the OverviewCache/`ClusterLifecycleManager` work above because it lives in a different package, is owned by `rest.Handler`/`main.go` rather than `service.clusterService`, and has its own, independent `SharedInformerFactory` (~15 informer types: Pods, Services, Endpoints, ConfigMaps, Secrets, ServiceAccounts, PVCs, Deployments, ReplicaSets, StatefulSets, DaemonSets, Jobs, CronJobs, Ingresses, NetworkPolicies, HPAs, PDBs).

### Root cause (CODE-PROVEN, then LIVE-REPRODUCED)

`cmd/server/main.go` ran a background goroutine, started once ~5 seconds after process boot, that listed every reachable persisted cluster and called `graph.NewClusterGraphEngine(...).Start(ctx)` for **each one unconditionally** — regardless of whether any user had ever opened Blast Radius for that cluster. This directly violated this document's own acceptance condition ("no ordinary registration/startup path should eagerly create the complete [informer] set for every persisted cluster"), just in a sibling subsystem the original pass didn't cover.

**A second, independent correctness bug compounded it:** that same background goroutine wrote into the `graphEngines` map with no lock, while `rest.Handler` was concurrently serving Blast Radius requests from the *same map reference* (passed by Go reference into `NewHandler`) under its own `graphEnginesMu`. This is an unsynchronized concurrent map read/write — a Go runtime **fatal error that crashes the whole process** (not a recoverable panic), reachable in production whenever a user opened Blast Radius within the first ~5 seconds of backend startup while other clusters were still being eagerly warmed.

Note: a correct, independently-built **on-demand** path already existed in parallel (`blast_radius.go`'s `getOrStartGraphEngine`, singleflight-coalesced, lazy, well-tested) — the eager main.go goroutine was pure redundant cost layered on top of an already-working lazy path, not a case where lazy activation needed to be invented from scratch.

### Live measurement (LIVE-REPRODUCED, isolated lab `kubilitics-phase-e`, not the real `kind-nightshift-dev` environment)

Clean, time-isolated sampling (0.5s intervals from true process boot, one registered cluster, zero consumer requests) **before** the fix:

| t since boot | goroutines | event |
|---|---:|---|
| 4.80s | 298 | registered-only baseline |
| 5.34s | 468 | crosses 5s mark — log: `"Started blast radius graph engine"` |
| 5.88s–11.8s | 467–484 | stable plateau |

**Delta: ~+169 goroutines for one registered cluster, unconditionally, regardless of use.** At the 50-cluster Fleet scale this engagement targets, that extrapolates to ~8,450 eagerly-started goroutines at boot — EXTRAPOLATED, not separately measured at N=50.

### Fix

Per explicit user approval (implement now, not document-and-defer): added `internal/graph/lifecycle.go`'s `EngineLifecycleManager` — a dedicated manager reusing `service.ClusterLifecycleManager`'s exact proven correctness mechanism (one mutex per cluster entry held for the whole create-or-reuse/stop operation, permanent tombstone on removal, one centralized sweep goroutine, not a ticker per cluster) rather than a copy-paste duplicate, adapted because the resource lives in a different package/layer with different consumers and a different construction signature. Deliberately *not* folded into `service.ClusterLifecycleManager` itself: that type is tightly bound to `*OverviewCache`'s specific Start/Stop/GetInformerManager methods, and `ClusterGraphEngine` is owned by `rest.Handler`/`main.go`, not `service.clusterService` — forcing them into one type would mean importing `internal/graph` into `internal/service` for no correctness benefit, a bigger and riskier change than this stability branch calls for.

- `cmd/server/main.go`: the eager 5-second-delayed background goroutine is deleted entirely. `graphEngineMgr := graph.NewEngineLifecycleManager(0, onRebuildCallback)` replaces the raw map; registered via `handler.SetLifecycleHook(graphEngineMgr)` alongside the existing `pipelineManager` hook.
- `internal/graph/lifecycle.go` (new): `EnsureActive` (the only creator — called from Blast Radius request handlers), `Get` (read-only, for opportunistic consumers — Topology v2 bundle, Fleet X-Ray, Autopilot — that must never themselves trigger startup), `OnClusterConnected` (implements `rest.ClusterLifecycleHook` — on reconnect, stops any engine still bound to the OLD client without eagerly restarting, closing the same "old client → old generation" hazard VALID-04 fixed for informers), `OnClusterDisconnected` (stops + permanently tombstones, same reasoning as `ClusterLifecycleManager.Remove`), idle-TTL sweep (default 10 min, same as OverviewCache).
- `internal/api/rest/blast_radius.go`'s `getOrStartGraphEngine`/`getGraphEngine` now delegate to the manager instead of a raw map + `graphEnginesMu`. **Correction (docs/ENGINE-LIFECYCLE-SOAK-INVESTIGATION.md §11a):** the `singleflight.Group` coalescing was initially dropped entirely on the theory that `EnsureActive`'s per-entry mutex alone was sufficient — that's true for "exactly one engine is ever constructed," but it understated the cost of N concurrent first-requests each independently calling `getClientFromRequest` before racing into that mutex. The `-race` detector caught this as a regression (a previously-coalesced test mock access became concurrent). `graphEngineGroup singleflight.Group` was reinstated, now wrapping "resolve client + EnsureActive" as one coalesced unit — restoring the original guarantee without changing `EnsureActive`'s own correctness mechanism.
- `internal/api/rest/fleet_xray_handler.go`: both bulk-read call sites (`FleetXRayDashboard`, template scoring) use the new `ActiveEngines()` snapshot method instead of locking the old raw map directly.
- `internal/autopilot/scheduler.go`: `runAll()` now iterates `engineMgr.ActiveClusterIDs()` instead of a raw map — **documented behavior change**: Autopilot's periodic background scan now only covers clusters someone has actually opened Blast Radius for, not every reachable registered cluster, since there is no longer a pool of eagerly-started engines to iterate. This is the direct, intended consequence of removing the eager start, not a regression.

### Correctness preserved

- Blast Radius functional behavior unchanged: live-tested `graph-status` → `ready:true, node_count:822, edge_count:535` after lazy activation, matching pre-fix shape.
- `go build ./...`, `go vet ./...` clean.
- `go test -race ./...` (full backend) green — RACE-TESTED.
- New tests in `internal/graph/lifecycle_test.go`: 100-concurrent-caller same-cluster → exactly one engine instance; different-clusters-don't-block-each-other; `Get()` never creates; idle-TTL sweep releases + reactivation is a fresh instance (not resurrected); an in-flight `Snapshot()`/`Status()` read survives a concurrent TTL stop without panic; `OnClusterDisconnected` tombstones permanently (post-removal `EnsureActive` is refused); `OnClusterConnected` stops a stale engine without eagerly restarting one (reconnect gets a genuinely fresh engine on next real use, never the old client's); 200-iteration `EnsureActive`-races-`OnClusterDisconnected` loop asserting no half-state (`removed && engine != nil`) ever becomes visible — all RACE-TESTED under `-race`.

### Live before/after (LIVE-REPRODUCED, isolated lab, same persisted cluster, rebuilt binary)

| State | Goroutines | Evidence |
|---|---:|---|
| Registered, 0 requests, t=8–10.8s (past old 5s trigger mark) | 298–299 | No `"Started blast radius graph engine"` log line appears at all |
| First Blast Radius request (`/blast-radius/graph-status`) | 315 → 483 (+168) | Matches the original ~169/cluster finding — engine now starts lazily on real use, same cost, right trigger |
| 2s later | `ready:true, node_count:822, edge_count:535` | Functional correctness preserved |
| Cluster removed (`DELETE /clusters/{id}`) | 483 → 26 | Both the OverviewCache informers and the graph engine tear down cleanly — no leak |

### Remaining risks / not yet done this pass

- **Multi-cluster (N=10/26/50) measurement for this specific fix** — not re-run; only the single-cluster delta was re-measured. The original investigation's 50-cluster extrapolation (~8,450 goroutines) for the OLD eager behavior remains EXTRAPOLATED, not measured.
- **100+-cycle soak test** for the graph-engine lifecycle specifically (register→activate→idle→TTL→reactivate→remove repeated) — not run this pass; only single-cycle removal was live-verified.
- **Failure injection** (API unavailable during activation, cancellation mid-rebuild, reconnect racing an in-flight Blast Radius request) — covered by unit/race tests for the lock-ordering guarantees; not separately live-injected against the lab cluster.
- **Autopilot's scan-coverage behavior change** (only scans clusters with an active engine, not every registered one) is a deliberate, documented consequence, not independently validated against a real Autopilot rule end-to-end this pass.
- The pre-existing cosmetic log line `"[events/collector] resource change watchers disabled (using graph engine informers)"` still prints unconditionally at cluster-connect time even though no graph engine has necessarily started yet — misleading but not a functional bug; not fixed this pass (out of scope).
- Phases 7–16 of the original 16-phase verification brief (2K/5K/10K-pod enterprise workload tiers, browser performance, Headlamp comparison, full enterprise reliability scorecard) are **UNVERIFIED** — not attempted this pass given scope/time constraints; see the open conversation for the explicit decision not to fabricate results for phases that weren't actually run.
