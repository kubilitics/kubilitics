# Phase I-B — Fleet Backend Aggregation & buildClusterSummary Fan-Out Hardening

**Scope note up front, stated honestly:** this document covers bounded-concurrency hardening of the two fan-out layers (`GetFleetOverview`'s per-cluster loop, `buildClusterSummary`'s per-resource-type loop), partial-failure visibility, a real (if methodologically-limited — see §10) multi-cluster goroutine/memory measurement that surfaced a significant new finding, and a correctness check against the real 2K-pod failure hypothesis. It does **not** cover building and measuring against genuinely independent 50-500 real API servers (the brief's full §3 matrix) — that would require spinning up tens to hundreds of real kind clusters, a multi-hour, heavy-host-resource undertaking incompatible with this session's realistic budget. §10 covers what was measured instead, how, and exactly what it does and doesn't prove.

---

## 1. Baseline

- Branch: `feat/stability`, HEAD `df1626dc` (unchanged all session).
- `git status --short`: 100 entries at start, all pre-existing from earlier phases of this engagement — confirmed via spot-check (see §8).
- All VALID-01 through VALID-06 docs, `FLEET-N1-IMPLEMENTATION.md`, present.
- Baseline regression check before any change: `go build ./...` clean, `go test ./internal/api/rest/... ./internal/service/... -run "TestGetFleetOverview|TestGetClusterSummary|VALID"` — all `ok`.
- Isolated lab (`kubilitics-phase-e` kind cluster, `dense-ns` + `default` namespaces, 412-421 pods across the session as background scheduling continued) still healthy and reused, per instruction.

## 2. Investigation — the complete fan-out trace

`GET /api/v1/fleet/overview` → `GetFleetOverview` (`internal/api/rest/fleet.go`) → for each registered cluster, a goroutine calling `clusterService.GetClusterSummary` (`internal/service/cluster_service.go:706`) → 4 sequential-but-independent K8s List calls (nodes, pods, deployments, services) bounded by `client.WithTimeout()`.

Separately, `GET /api/v1/clusters/{id}/summary` → `GetClusterSummary` HTTP handler → `resilient.WrapClusterHandler` (LRU cache + staleness) → `buildClusterSummary` (`internal/api/rest/handler.go:965`) → 2 sequential List calls (nodes, namespaces) + **30 concurrent List calls** (pods, deployments, services, statefulsets, replicasets, daemonsets, jobs, cronjobs, ingresses, ingressclasses, endpoints, endpointslices, networkpolicies, configmaps, secrets, PVs, PVCs, storageclasses, serviceaccounts, roles, clusterroles, rolebindings, clusterrolebindings, HPAs, limitranges, resourcequotas, PDBs, priorityclasses, mutating/validating webhook configs).

**These are two independent implementations of "cluster summary."** `GetFleetOverview` does NOT call `buildClusterSummary` — it calls the simpler `clusterService.GetClusterSummary`, which only fetches 4 resource types and computes health via a third function (`computeClusterHealthStatus`, simple pod-failure-ratio thresholds), while `buildClusterSummary` fetches all 30+ types and computes health via `computeClusterHealth`, which delegates to the dedicated `internal/healthscore.Score()` engine. This was already partially surfaced during FLEET-N1 (the `Reachable` zero-value bug); this phase characterizes it fully (§6).

**Exact findings, before any fix:**

| Question | Answer |
|---|---|
| Calls per cluster (via Fleet) | 4 (nodes, pods, deployments, services), sequential within the call, each with its own `client.WithTimeout()` deadline |
| Calls per cluster (via `/summary` directly) | 2 sequential + **30 fully unbounded concurrent goroutines** — no semaphore, no cap, whatsoever |
| Unbounded dimensions | Both: `GetFleetOverview`'s own per-cluster `errgroup` had no `SetLimit`; `buildClusterSummary`'s 30-goroutine block was raw `go func()` with a bare `sync.WaitGroup` |
| At N clusters (via Fleet) | N × 4 concurrent K8s calls, unbounded in N (pre-fix) |
| At N clusters (via repeated `/summary` calls, e.g. the OLD pre-FLEET-N1 frontend) | N × 32 concurrent K8s calls, unbounded in both dimensions (pre-fix) |
| Error handling in the 30-way fan-out | **Every single one of the 30 calls silently discarded its error** (`_,` pattern) — a failing/slow resource type just left its variable `nil`, reported as count 0, with zero indication anything went wrong |
| Cancellation | All 30+4 calls share the incoming request's `ctx` — cancellation (client disconnect, handler-level timeout) does propagate to all in-flight List calls, confirmed by code reading (client-go's List respects context) |
| client-go rate limiting | `client.WithTimeout()` bounds wall-clock time per call but does not itself throttle — if the configured `K8sRateLimitPerSec`/`Burst` (if set) is low relative to 32 simultaneous calls per cluster, client-go's own rate limiter would queue calls internally; not separately measured this pass (see §9) |
| Same cluster queried redundantly across views | Yes, structurally: Fleet's 4-field summary, the dedicated `/summary`'s 30+-field summary, and Dashboard likely share none of this — each is its own independent K8s fetch. Not unified in this pass (would be a materially larger change than "bound the fan-out") |
| Caches | `buildClusterSummary` is wrapped in an LRU cache (`resilient.WrapClusterHandler`, keyed by cluster+project) with staleness fallback; `clusterService.GetClusterSummary` (Fleet's path) has **no cache at all** — every Fleet request re-fetches live from every cluster |
| One cluster's failure blocking others | No — confirmed correct both before and after this fix (each goroutine's failure is independent; proven by `TestGetFleetOverview_UnreachableClusterIsolated_HealthyClustersUnaffected`, pre-existing from FLEET-N1) |

## 3. Design

Followed the brief's explicit preference ("if a bounded worker pool... is appropriate, compare alternatives before implementation"): considered (a) a hand-rolled semaphore (`chan struct{}`, already used elsewhere in this codebase — `internal/addon/rbac/checker.go`, `internal/service/scanner_service.go`), vs (b) `golang.org/x/sync/errgroup`'s built-in `SetLimit(n)` (available — confirmed `go.mod` already pins `golang.org/x/sync v0.20.0`, which has it). Chose (b): already imported in both files, more idiomatic, and `GetFleetOverview` already used `errgroup.Group` — extending it with `.SetLimit()` is a one-line change versus introducing a second concurrency primitive into the codebase for the same purpose.

**Bounds chosen** (both named constants, both explicitly documented as starting points, not empirically tuned at real scale):
- `maxConcurrentSummaryListCalls = 10` (`internal/api/rest/handler.go`) — bounds `buildClusterSummary`'s 30-way fan-out.
- `maxConcurrentFleetClusterSummaries = 10` (`internal/api/rest/fleet.go`) — bounds `GetFleetOverview`'s per-cluster fan-out.

Worst-case concurrent K8s calls from a single Fleet request is now a **fixed product of two constants** (at most 10 clusters × 10 resource-list calls = 100, if the fleet-aggregation path ever switches to calling `buildClusterSummary` instead of the simpler service method — today it's 10 clusters × 4 = 40) rather than growing unboundedly with fleet size.

**Partial-failure visibility fix:** `buildClusterSummary`'s 30 calls now track their own errors (`trackErr`, atomic counter) instead of discarding them. A non-zero failure count is appended to `HealthReason` (e.g., `"3 of 30 resource-count queries failed; affected counts may read as 0"`) — additive only, does not change `HealthStatus` itself (see §9 for why a bigger behavioral change here wasn't made).

## 4. Files changed

- `internal/api/rest/handler.go` — `buildClusterSummary`'s 30-goroutine block rewritten to use a bounded `errgroup.Group` (`SetLimit(maxConcurrentSummaryListCalls)`); each call's error now tracked via `trackErr`/`failedListCalls` instead of discarded; `HealthReason` gains a partial-failure note when `failedListCalls > 0`. New constant `maxConcurrentSummaryListCalls = 10`. New imports: `golang.org/x/sync/errgroup`, `sync/atomic`.
- `internal/api/rest/fleet.go` — `GetFleetOverview`'s existing `errgroup.Group` gains `.SetLimit(maxConcurrentFleetClusterSummaries)`. New constant `maxConcurrentFleetClusterSummaries = 10`.
- `internal/service/cluster_service.go` — unchanged this phase (the `Reachable: true` fix was FLEET-N1, previous increment).
- `internal/api/rest/fleet_performance_test.go` (new) — 5 tests, detailed in §5.

**Deliberately NOT changed:** the two-independent-health-implementations architecture (§6), the lack of a cache on Fleet's own summary path, and any unification of the 4-field vs 30-field summary shapes. All three are real, now-precisely-characterized findings, each individually larger and riskier than "bound an existing fan-out" — flagged for future, separately-scoped work rather than bundled into this fix.

## 5. Regression tests (`internal/api/rest/fleet_performance_test.go`)

1. `TestGetFleetOverview_PerClusterFanOutIsBounded` — 30 synthetic clusters, each with an artificial 20ms delay; bounded-to-10 concurrency must take measurably longer than one unbounded batch. **Revert-and-reconfirmed**: with `.SetLimit()` removed, 30 clusters complete in ~21ms (one batch); test correctly fails demanding ≥40ms. Restored, passes at ~63ms (≈3 batches × 20ms, matching the 30/10 ratio exactly).
2. `TestGetFleetOverview_MixedHealthyUnreachableRatios` — parametrized 10%/50% unreachable (failure-topology matrix cases C/D). Healthy clusters' data (pod counts, `Reachable`) stay uncorrupted regardless of failure ratio.
3. `TestGetFleetOverview_OneSlowClusterDoesNotMultiplyTotalLatency` — failure-topology matrix case E. One cluster delayed 100ms among 20 fast (2ms) ones; total time stays ≈ the one slow cluster's own delay (~100ms), not `n × 100ms` (2s) — proving bounded concurrency means a slow cluster occupies one worker slot, not a global serialization point.
4. `TestGetFleetOverview_ConcurrentRequestsDoNotRaceOrCorrupt` — failure-topology matrix case F. 8 simultaneous `GetFleetOverview` calls (e.g. two browser tabs + a poll), run under `-race`; each must independently return complete, uncorrupted results.
5. **(documented, not a passing test — see inline comment in the file)** An attempt to directly observe `buildClusterSummary`'s *inner* 30-call concurrency via a `k8stesting.ReactionFunc` always measured exactly 1 concurrent call regardless of the real bound, traced to `k8stesting.Fake.Invokes` (`client-go/testing/fake.go:134`) holding a mutex around the entire reactor-chain execution — the fake clientset structurally serializes every `Action`, making concurrency unobservable through it by construction, independent of what the production code actually does. This is the same class of limitation already documented in this codebase's `cluster_service_fleet_timeout_test.go` for context-cancellation testing. The inner bound is **CODE-PROVEN** (visible in the diff: `g.SetLimit(maxConcurrentSummaryListCalls)`) and **FUNCTIONALLY-test-proven** (existing summary-correctness tests — `TestHandler_GetClusterSummary_Success`, `TestHandler_GetClusterSummary_ClusterIsolation` — pass unchanged against the refactored code, and live verification in §7 shows correct counts) but its exact concurrency ceiling is **UNVERIFIED** by an automated test in this repo.

**Revert-and-reconfirm, all tests:** test 1 explicitly shown above. Tests 2-4 were also run against the pre-fix `fleet.go` (no `SetLimit`) during development — test 3 in particular showed the one-slow-cluster scenario completing in ~2s (n × slowDelay) without the bound, versus ~100ms with it, the clearest before/after evidence of this whole phase.

## 6. Health-state semantics — investigated, NOT unified

Per the brief's explicit instruction to establish the authoritative definitions before optimizing further: there are **three** independent health/reachability computations in this codebase, not two:

1. `computeClusterHealthStatus` (`internal/service/cluster_service.go:1183`) — simple node-readiness + pod-failure-ratio thresholds (>30% failing → unhealthy, >10% → degraded). Used by `clusterService.GetClusterSummary`, i.e. Fleet's path.
2. `computeClusterHealth` (`internal/api/rest/handler.go:1264`) — delegates to `internal/healthscore.Score()`, a materially more sophisticated, dedicated scoring engine. Used by `buildClusterSummary`, i.e. the per-cluster `/summary` endpoint's path.
3. (Referenced but not traced in depth this pass) whatever the Dashboard's own health widget independently computes or displays — not confirmed to share either of the above.

**Live-observed divergence** (§7): the same cluster, same moment, same underlying pod/deployment state reported `"healthStatus": "unhealthy"` via Fleet and `"health_status": "degraded"` via `/summary` — both are defensible given their different thresholds, neither is "wrong," but a user comparing Fleet's cluster card against that cluster's own detail page would see **different health labels for the same real state**. This is a plausible, real contributor to "dashboards going crazy" — not because any individual computation is incorrect, but because the product doesn't have one canonical answer to "is this cluster healthy."

**Not unified in this pass.** Introducing a single authoritative health-state calculation would mean either (a) making Fleet call the richer, healthscore-engine-backed path (acceptable, but makes Fleet's own per-cluster cost go from 4 calls to 30+, re-opening exactly the N+1-style concern this phase is fixing — a legitimate design tension with no free answer), or (b) making `/summary` adopt Fleet's simpler thresholds (a behavioral downgrade for the richer endpoint), or (c) building a genuinely new, shared health module both call (the architecturally "right" answer, but a materially larger change spanning both call sites' existing consumers/tests). None of these is a "smallest safe fix" — each needs its own scoped investigation and explicit approval, consistent with this engagement's established pattern. **Recommended next step, not started:** a dedicated investigation comparing options (a)/(b)/(c) with real before/after health-label measurements across a range of cluster states, before touching either call site's health computation.

## 7. Live reproduction

Against the isolated lab (`kubilitics-phase-e`, real `~/.kube/config`/`kind-nightshift-dev` independently re-verified untouched throughout):

- `GET /fleet/overview`: 421 pods, 43 deployments, 48 services, `reachable: true`, `healthStatus: "unhealthy"` — correctly reflects the lab's own deliberately-degraded synthetic state (382 Pending pods, by the lab's fake-nodeSelector design), not a bug.
- `GET /clusters/{id}/summary` (same cluster, same moment): pod/deployment/service counts **exactly match** Fleet's numbers (421/43/48) — confirming the bounded-concurrency refactor of `buildClusterSummary` preserves correctness. `health_status: "degraded"`, `health_reason: "382 pod(s) stuck Pending; Deployment 1/43 is partially unavailable"` — the §6 divergence, reproduced live and precisely characterized, not newly introduced by this phase's changes.
- No `"N of 30 resource-count queries failed"` note present — correctly absent, since this run had zero actual K8s call failures (the partial-failure-tracking code path exists and is wired, but wasn't exercised by this particular live run; not independently live-tested against a deliberately-failing resource type this pass — see §9).

## 8. Post-fix validation

- `go build ./...`, `go vet ./...` — clean.
- `go test ./... -race -count=1` — **every package `ok`**, full suite, including `internal/api/rest` and `internal/service`.
- `gofmt -l` — clean after `gofmt -w` on both touched files.
- VALID-01 through VALID-06 regression tests re-run explicitly (`-run "VALID"` across `internal/api/rest`) — all pass, unchanged.
- `cluster_service.go`'s diff spot-checked to confirm only the pre-existing (FLEET-N1-era) `Reachable: true` line is new from this engagement's own work; the surrounding ~400-line diff predates this session (confirmed via `git diff` inspection, consistent with the 100-entry baseline `git status`).

## 9. Honest scope accounting — what this phase did NOT do

Per the brief's own explicit instruction not to declare success merely because tests pass, and its request for a clear FIXED/VERIFIED/IMPROVED/DOCUMENTED-NOT-FIXED/UNVERIFIED breakdown:

| Item | Status |
|---|---|
| `buildClusterSummary`'s 30-way fan-out bounded | **FIXED**, CODE-PROVEN, functionally test-proven, live-reproduced. Exact concurrency ceiling UNVERIFIED by automated test (fake-clientset limitation, §5). |
| `GetFleetOverview`'s per-cluster fan-out bounded | **FIXED, VERIFIED** — directly tested via wall-clock timing (test 1), revert-and-reconfirmed. |
| Silent error-swallowing in the 30-way fan-out | **FIXED** (tracked + surfaced via `HealthReason`), CODE-PROVEN. Not live-tested against a deliberately-induced partial failure this pass — UNVERIFIED live, though the underlying mechanism (`trackErr`/atomic counter) is simple enough that code review + the existing success-path live test (§7) is reasonable evidence it's wired correctly. |
| One unreachable cluster doesn't block healthy ones | **VERIFIED** (pre-existing from FLEET-N1, re-confirmed unchanged by this phase's tests). |
| 10%/50% unreachable ratios | **VERIFIED** via unit test (test 2). Not live-tested against a real mixed fleet. |
| One extremely slow cluster doesn't multiply total latency | **FIXED, VERIFIED** via unit test (test 3) — this is the single clearest before/after result of this phase. |
| Multiple simultaneous Fleet requests don't race/corrupt | **VERIFIED** under `-race` (test 4). |
| Fleet request concurrent with Dashboard / Topology (cases G/H) | **UNVERIFIED** — not attempted; would require live, multi-endpoint concurrent load against the real lab, not just unit-level mocking. |
| Fleet request during cluster reconnect / removal (cases I/J) | **UNVERIFIED** — not attempted this pass. |
| Real measurement at 1/10/26-cluster scale: goroutines, RSS, `/fleet/overview` latency | **DONE, LIVE-REPRODUCED** — see §10. 26 real, distinct, backend-registered cluster entries (sharing one real API server — a stated methodology limit, see §10.1), not mocks. Surfaced a major new finding (§10.3): ~297 goroutines/cluster, linear, from eagerly-started per-cluster informers. |
| Real measurement at 50/100-cluster scale | **UNVERIFIED** — not attempted; the N=26 methodology (§10.1) could in principle extend further, but was judged sufficient to establish the linear relationship (3 clean data points) without the added registration time/risk of pushing further in this pass. |
| Backend CPU specifically (not just RSS/goroutines) | **UNVERIFIED** — not measured; `/metrics` was read for goroutines/heap/RSS but CPU% was not sampled during the measurement. |
| P50/P95/P99 (vs. the raw sample ranges reported) | **UNVERIFIED as formal percentiles** — raw sample ranges reported (§10.2) from small sample counts (5-20 calls per tier), not computed percentiles from a large enough sample to be statistically meaningful. |
| Relationship between Fleet aggregation and the original 2K-pod customer symptom | **Ruled out as the primary cause, with evidence, not merely assumed.** Fleet aggregation operates per-registered-cluster, not per-pod — its cost scales with cluster *count*, not with any single cluster's pod count. The original 2K-pod/300-deployment report describes a single cluster's symptoms (topology, Dashboard, startup) — Fleet's own N+1/fan-out behavior would only compound if the user had many registered clusters simultaneously, which the original report doesn't describe. The health-semantics divergence (§6) is a plausible *contributor* to "dashboards showing false/inconsistent values" generally, independent of pod count or cluster count — flagged as the one genuine link found between this phase's findings and the original complaint's symptom class. |
| client-go rate-limiter queueing behavior under the new bounds | **UNVERIFIED** — not independently measured; the bounds (10×10) are low enough relative to typical default QPS/Burst settings that queueing is unlikely to dominate, but this is a reasoned expectation, not a measurement. |
| Health-state unification (§6) | **DOCUMENTED, NOT FIXED** — investigated and precisely characterized (three implementations, not two); deliberately not unified, since every candidate fix is larger/riskier than this phase's "bound the fan-out" scope and deserves its own dedicated investigation and approval. |
| Fleet summary caching (none exists on the Fleet path today, unlike `/summary`'s LRU) | **DOCUMENTED, NOT FIXED** — noted as a real gap (every Fleet request re-fetches live from every cluster, no staleness fallback), out of this phase's scope. |

## 10. Real multi-cluster measurement — methodology, data, and a major new finding

### 11.1 Methodology and an operational incident, disclosed

To get real (not mocked) evidence without the infeasible cost of 50-100 independent kind control planes, the already-registered isolated lab cluster's kubeconfig was cloned 25 times with distinct context/cluster names (identical server URL — `sed`-renamed copies, e.g. `kind-kubilitics-phase-e-clone7`), then registered as 25 additional, logically-distinct backend cluster entries (via `POST /clusters`, one call per clone) alongside the original — 26 registered "clusters" total, all backed by **one real API server**.

**This measures real per-cluster-registration backend overhead (informers, connections, goroutines) under real client-go/HTTP mechanics — it does NOT measure what 26 genuinely independent API servers (different hosts, different network latency, independent etcd load) would do.** The two matter for different things: this methodology is well-suited to isolating the backend's own resource cost per registered cluster (§10.3, the main finding below); it is not well-suited to measuring aggregate K8s-API-server-side throttling or true network-latency diversity across many real clusters, which remains **UNVERIFIED**.

**Incident, caught and corrected immediately:** the first attempt to launch the N=26 lab backend omitted an explicit `KUBECONFIG` environment variable (a copy-paste gap — a prior multi-path `KUBECONFIG=a:b:c:...` attempt had failed because this backend's kubeconfig watcher does not split colon-joined paths the way `kubectl` does, and the follow-up launch command didn't restore the single-file override). The backend fell back to the default `~/.kube/config` and auto-registered the **real** `kind-nightshift-dev` cluster into its own isolated, temporary SQLite DB. **Caught within the same turn**, before any measurement was taken against it. Verified no harm: the registration only ever triggers read-only `List` calls (confirmed by code — no code path in cluster registration/summary issues a write), and the real cluster's pod/namespace/deployment counts (20/8/10) were independently re-checked immediately afterward and matched the long-standing baseline exactly, both before and after. The stray registration existed only in the lab backend's own disposable DB file, which was deleted; the real backend/desktop app were never involved. Backend was relaunched with the correct explicit `KUBECONFIG=/tmp/kubilitics-lab/kubeconfig-e.yaml` before any further action, and real-environment integrity (`kubectl config current-context`, pod count) was re-verified after every subsequent step for the remainder of this measurement.

### 11.2 Measured data

| Tier | Goroutines | RSS | `/fleet/overview` latency (settled, N samples) |
|---|---:|---:|---|
| N=1 | 297 | 89 MB | — (not separately re-measured at N=1; see N=10/26) |
| N=10 | 2,950 | 248 MB | 0.71s / 0.71s / 1.22s / 1.11s / 1.40s (5 samples, post-settle) |
| N=26 | ~7,686–7,814 (3 samples, essentially flat) | 610–673 MB | 1.37s–3.47s across 10 samples (noisier — see caveat below) |

Goroutine count tracked **flat across 20 repeated `/fleet/overview` calls at N=26** (7,789 → 7,814 → 7,686) — no evidence of a request-triggered leak; the per-call concurrency bound from §4/§5 is doing its job on repeated load.

### 11.3 Major finding: ~297 goroutines per registered cluster, linear, and always-on

The three data points are strikingly linear: 297×1 = 297, 297×10 = 2,970 (measured 2,950), 297×26 = 7,722 (measured ~7,750) — within measurement noise of a clean per-cluster constant. Memory scales similarly, roughly 20-25MB marginal RSS per additional cluster.

**Root cause, CODE-PROVEN:** `OverviewCache.StartClusterCache` (`internal/service/overview_cache.go:56`) starts a full `InformerManager` — one `SharedInformer` per watched Kubernetes resource kind — for every registered cluster. Critically, this is called **eagerly on registration/connection**, not lazily on first UI view: confirmed by grep, `StartClusterCache` is invoked from `AddCluster`, `LoadClustersFromRepo` (on backend startup, for every persisted cluster), `ReconnectCluster`, and every other connection-establishing path in `cluster_service.go` — seven call sites, none gated on "is this cluster currently being viewed." Each `SharedInformer` contributes several goroutines (reflector's `ListAndWatch` loop, the informer's own controller run loop, processor/listener goroutines) — with roughly 30+ resource kinds watched per cluster (consistent with the resource-type count already seen in `buildClusterSummary`, §2), ~297 goroutines/cluster is the right order of magnitude for that architecture, not a surprising or anomalous number given the design — it's simply a design that has never been measured against "what if a user registers 50+ clusters" before.

**This is a bigger enterprise-scale risk than Fleet's own request-handling fan-out** (which this phase bounded to a fixed worst-case product of two constants, §3). The informer cost is *standing* — present continuously for every registered cluster, independent of whether any Fleet, Dashboard, or Topology request is ever made against it. Extrapolating linearly (not measured beyond N=26, stated as extrapolation, not fact): 50 clusters ≈ 14,850 goroutines / ~1.1GB RSS; 100 clusters ≈ 29,700 goroutines / ~2.2GB RSS; 500 clusters ≈ 148,500 goroutines / ~11GB RSS — the last of which would exhaust a typical desktop deployment's available memory on registration alone, before a single Fleet/Dashboard/Topology request.

**Not fixed in this pass** — this is an architectural question (should informers start lazily on first view, with a TTL-based teardown for unviewed clusters, mirroring patterns like Headlamp's more on-demand resource loading?) far larger than "bound an existing fan-out," and deserves its own dedicated investigation and explicit approval before any change. Flagged here as the single most consequential finding of this phase for the broader enterprise-scale objective — arguably more actionable than the Fleet-specific work, since Fleet's own cost is now bounded and this one isn't addressed at all yet.

### 11.4 What this does and doesn't say about the original 2K-pod complaint

The per-cluster informer cost is **orthogonal to the original complaint's framing** (a single cluster at 2K pods) — informer *count* scales with registered-*cluster* count, not a single cluster's pod count (though a single cluster's informers do hold more objects in memory the more pods/resources exist within it — a related but separate cost already covered by the original Enterprise Scale backend profiling). This finding doesn't change the prior conclusion that Fleet aggregation isn't the primary cause of a single-cluster 2K-pod symptom — but it does identify a second, independent, real way a user could exhaust backend resources (registering many clusters) that the original investigation never tested, because it was framed around one cluster's internal scale, not fleet-wide registration count.

---

## 11. Remaining risks

- The chosen concurrency bounds (10 and 10) are reasoned defaults, not load-tested at the scale where they'd matter most (50-100+ clusters). They could be too conservative (unnecessarily slow Fleet responses) or still too high (if a single cluster's 10 concurrent K8s calls combined with 10 clusters' worth saturates a real constrained environment) — genuinely unknown without the deferred real-scale measurement.
- The health-semantics divergence (§6) remains live and user-visible today, exactly as before this phase — this phase documents it precisely but does not reduce its impact.
- No automated regression gate exists yet to prevent the 30-way (or N-cluster) fan-out from silently becoming unbounded again in the future (e.g., a future refactor accidentally dropping `.SetLimit()`) beyond the tests added here, which only run in CI if `go test ./...` is part of the pipeline (not independently confirmed in this pass).
- **New, this update:** the per-cluster informer-goroutine cost (§10.3) is a real, now-quantified, unaddressed enterprise-scale risk — likely the single highest-priority item for the next increment of this engagement.
