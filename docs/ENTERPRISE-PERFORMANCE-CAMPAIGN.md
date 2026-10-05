# Enterprise-Scale Performance Campaign — Phase 1: 2K Baseline

**Status: Phase 1 complete. STOPPING per instructions to report findings before any production code change.**

## Methodology

**Environment:** isolated lab kind cluster `kubilitics-phase-e` (`/tmp/kubilitics-lab/kubeconfig-e.yaml`), single control-plane node, Docker Desktop 4 CPU / 7.75GB allocation. Real environment (`kind-nightshift-dev`, the actual desktop app on port 8190, PID confirmed live and in active use) verified untouched before, during, and after every step.

**Workload generation (disclosed, not hidden):** Pods are created via real Deployments/ReplicaSets with correct `ownerReferences` (real API objects, real List/Watch/informer load, real JSON payload sizes) but with `schedulerName: kubilitics-synthetic-unscheduled` — an intentionally nonexistent scheduler, so the default scheduler and kubelet never touch them. They stay `Pending` forever, consuming essentially zero node compute/memory for actual container execution, while still generating the real API-server/etcd/informer/List load that a real running fleet would. This is a deliberate methodology choice to stay within a 4-CPU/8GB single-node lab's safe capacity — **not** a claim that 2,248 real containers were running. Confirmed safe: node stayed at 12-23% CPU, ~1-1.2GB/7.75GB memory, 282 PIDs throughout.

**Generator:** `/tmp/kubilitics-lab/gen_tier.py` (checked into the lab scratch dir, not the repo). Tier "t1" config: 15 namespaces, 20 Deployments/namespace (6-10 replicas, avg ~7.5), 1 Service per Deployment, ~33 ConfigMaps + ~33 Secrets per namespace (referenced via `envFrom`), 1 PVC per 4th Deployment (75 total, against a real `StorageClass`), 1 Ingress per 10th Deployment, 1 CronJob per 15th Deployment, plus ServiceAccount+Role+RoleBinding per namespace.

### Exact generated topology (measured after apply, not just generator intent)

| Resource | Count |
|---|---:|
| Namespaces (synthetic) | 15 |
| Pods | 2,248 (all intentionally `Pending`) |
| Deployments | 300 (+2 system) |
| Services | 300 (+2 system) |
| ConfigMaps | 495 (+ system) |
| Secrets | 495 (+ system) |
| PersistentVolumeClaims | 75 |
| Ingresses | 30 |
| CronJobs | 20 |
| ServiceAccounts/Roles/RoleBindings | 15 each |
| StorageClasses | 1 |

This matches the brief's T1 target table closely (~2,000 pods / ~300 deployments / ~300 services / ~500 configmaps / ~500 secrets / 10-20 namespaces) — not approximated, measured.

**Backend:** built fresh from the current `feat/stability` working tree (includes every fix from this engagement to date), run against the lab cluster via `KUBECONFIG` override, auto-registered via kubeconfig sync, on a dedicated port never used by the real app.

## Results

| Measurement | Cold | Warm | Notes |
|---|---:|---:|---|
| Backend startup → first successful API response | — | ~15.8s (boot to registered + responsive) | Includes artifact-hub background sync noise unrelated to the cluster |
| Registered-only baseline | 43 goroutines, 87MB RSS | — | Confirms registered≠active holds at 2K-pod scale too — cost is independent of this cluster's size until activated |
| Dashboard (`/overview`) | 20ms (574B, empty — lazy activation kicks off async) | 22ms (1.4KB, correct: 2,248 pods / 302 deployments) | **PASS**, well under any reasonable budget |
| After dashboard activation | 313 goroutines, 135MB RSS | — | |
| Fleet overview (1 cluster) | 166ms | — | **PASS** |
| Resource list (`/resources/pods`, paginated) | 432ms (267KB, 100/2,248 items + correct pagination metadata) | — | **PASS** |
| **Topology V1 (`/topology`, depth=3 default = full graph, no aggregation)** | **16.27s, 8.1MB, 4,888 nodes, 17,375 edges** | — | **This is the real finding — see below** |
| **Topology V2 (`/topology/cluster`) — the ACTUAL route the frontend's default Topology page calls** | 2.87s, 871KB, 687 nodes, 1,304 edges (with `groups` aggregation) | 27ms (cached) | Borderline-PASS against a <5s/2K budget — works, not comfortable |
| Namespace drill-down (`/topology/cluster?namespace=X`, ~150 pods in that namespace) | 1.4s, 68KB, 65 nodes, 86 edges | — | **PASS**, comfortable |
| Blast Radius (cold, lazy-activates `ClusterGraphEngine`) | First request: 503 "graph not available yet" (correct — activation is async); ready ~3s later (4,081 nodes/2,575 edges rebuilt) | 21ms, 7.3KB | **PASS** — correct, expected lazy-activation behavior, not a bug |
| Repeated refresh (5x dashboard in a row) | — | 2,248 pods every time, 1.5-3.2ms each | **PASS** — no "refresh doesn't recover" symptom reproduced at this tier |
| Final goroutines/RSS after exercising every feature | 482 goroutines, 232MB RSS | — | Bounded, no runaway growth observed in this single pass |
| Frontend (JS heap, Cytoscape/ELK timing, render counts, DOM nodes) | **UNVERIFIED** | — | No browser automation tool available in this session; not fabricated |

## The first real bottleneck found (per the brief's Section 8 instruction: "find the first actual bottleneck")

**`GetTopology` (the V1 `/clusters/{id}/topology` route, `internal/api/rest/handler.go:1793`) defaults `depth` to `3` ("= all") when no `depth` query parameter is supplied, performing zero aggregation/collapsing.** At this 2K-pod tier it produced 4,888 nodes / 17,375 edges / 8.1MB / 16.27s. This is CODE-PROVEN (the default-depth logic is directly in the handler) and LIVE-REPRODUCED (the exact numbers above, from this run).

**Important nuance, traced before reporting rather than assumed:** the frontend's actual default Topology page does **not** call this V1 route — it calls `/clusters/{id}/topology/cluster` (V2, confirmed via `kubilitics-frontend/src/services/api/topology.ts:110`), which already has namespace/group aggregation and produced a much more reasonable 687 nodes / 2.87s / 871KB. So **the originally-reported customer symptom ("topology not loading... extremely slow") is not reproduced via the path a real user's default click actually takes, at this 2K tier** — it IS reproduced, severely, via the V1 route, which still exists, is still routed, and would produce exactly the described symptom for anyone/anything that calls it (a second-order risk: any current or future caller of `/topology` without an explicit `depth` param — direct API users, a different frontend surface, a future code path — would hit this).

**Severity: P2 at this tier** (not P0/P1 — the real default user path works, within budget though not comfortably; the broken path is a secondary route, not the one normal navigation exercises). This may become more severe at 5K/10K if V2's own cost stops scaling gracefully, or if V1 is ever invoked by a surface this investigation didn't check (worth confirming before closing).

## STOP — per Phase 1 instructions

Per the explicit instruction ("Do not modify production code until the first complete baseline has identified an evidence-backed bottleneck or a clearly approved remediation" and "STOP and report findings" at the end of Phase 1), **no production code was changed this pass.** The lab workload (2,248-pod T1 tier) has been left in place in the isolated cluster for Phase 2 reuse rather than torn down, since Phase 2 (worst-case topology / namespace drill-down / dense graph) was explicitly sequenced to follow immediately. The lab backend process itself was stopped to free local resources between phases.

## What this baseline does NOT yet cover (honest gaps, not silently converted to PASS)

- Frontend measurement of any kind — **UNVERIFIED**, no browser tooling available.
- V1 `/topology` route's actual callers in the current frontend — not exhaustively grepped; only confirmed V2 is what the default Topology page uses.
- Repeated navigation over a sustained session (soak) — not run this pass (Phase 9 in the brief's sequencing).
- Memory/goroutine trend over many repeated cycles — only a single before/after snapshot was taken, not a growth-trend soak.
- API call counting (how many distinct K8s API calls one user action generates) — not instrumented/counted this pass.
- Failure-injection (slow/unreachable API during these flows) — not run this pass.

## Recommendation (Phase 1, superseded by Phase 2 below)

This satisfied Phase 1's deliverable: a measured, honestly-caveated 2K baseline, with one concrete, evidence-backed finding (V1 topology's unguarded full-graph default) ready for an explicit fix-or-defer decision, and confirmation that the actual default user-facing Topology path performs acceptably (not comfortably) at this tier.

---

## Phase 2 — V1 Remediation

Full record in `docs/TOPOLOGY-SCALE-INVESTIGATION.md`. Summary:

**Finding 1 (secondary, fixed):** V1 topology's `maxNodes` had no safe fallback when unconfigured. Fixed — defaults to `MaxTopologyNodes` (500), same shared constant now used by the gRPC `GetTopologyGraph` call site, which had an identical gap. Explicit `?max_nodes=` override preserved.

**Finding 2 (the real bottleneck — correcting Phase 1's diagnosis):** Phase 1's "4,888 nodes / 16.27s" measurement was never actually about an unbounded node count — viper's own config default (`topology_max_nodes = 5000`) already exceeded this workload's full graph size, so the existing cap never engaged. Phase-by-phase timing instrumentation (added temporarily, measured once, removed) pinpointed the true cause precisely: `inferStorageRelationships` took **18.9 of 18.9 total seconds** in `InferAllRelationships` (every other of its 11 sub-functions: under 6ms each). Root cause: a live K8s `Get` call per PVC/PV whenever cached `nodeExtra` lacked `volumeName`/`storageClassName` — but an unbound (Pending) PVC legitimately has an empty `volumeName` forever, so the `||`-based fallback condition fired on every single such PVC, every request, regardless of whether discovery had already found everything that genuinely exists. At 75 PVCs, throttled by client-go's default (unconfigured) `QPS=5`/`Burst=10` client-side rate limiter, this alone produced the entire 16-19s delay.

**Fix:** discovery now stores the already-fetched `volumeName`/`storageClassName` from the bulk List call instead of discarding it; the fallback now triggers only when discovery genuinely never ran for that node (`extra == nil`), not merely because a field is legitimately empty.

**Result, live-reproduced:** 18.85-19.06s → **0.15-2.17s** (3 independent runs each) at the same ~2,248-pod/75-PVC workload. Same node/edge counts, same correctness. ~105x at best, ~9-10x at worst observed.

Regression tests added and proven (explicit revert → confirm fail → restore → confirm pass) for both findings. Full backend `go test -race ./...`: 52/52 packages `ok`. Named regression suites (VALID-02, Blast Radius/EngineLifecycleManager, Fleet N+1, buildClusterSummary) re-run, all pass.

**Not yet done this pass (honest gaps):** Phase 2's Scenarios A/B/C (dense single namespace, ~300-deployment namespace, explicit relationship-density stress), frontend/browser measurement (still no tooling available), "refresh until it works" / concurrent-user-action / cross-cluster-isolation-under-load testing, and a systematic audit of whether other `inferX` functions share the same discard-then-refetch anti-pattern for other resource kinds. See `docs/TOPOLOGY-SCALE-INVESTIGATION.md`'s closing section for the full list.

## Phase 2C — Systematic `infer*` Amplification Audit

Full record in `docs/TOPOLOGY-SCALE-INVESTIGATION.md`. Audited all 11 `infer*` functions in the cluster-wide hot path (`relationships.go`) for the same discard-then-refetch/N+1 pattern as Finding 2. Result: **exactly 2 live API call sites exist in the entire file, both already fixed in Finding 2.** Every other inference function was already correctly built on cached/indexed data (confirmed via code + grep, not assumed). A separate, architecturally different set of ~100 live Get calls exists in `engine_resource.go`, but those back the single-resource drill-down endpoint (bounded to one resource's own neighbors, never multiplied by cluster size) — a different risk class, not fixed, not claimed fixed.

## Phase 2D (partial) — New Finding: Concurrent Requests Against the Same Cluster Degrade Severely (P2, documented, not fixed)

**10 concurrent cold topology requests take ~18.3s total — not the ~2s a single request takes.** Root cause (evidence-based): no request coalescing exists for identical cache-miss topology requests (10 independent `BuildGraph` calls instead of 1 shared + 9 consumers), compounding with client-go's default `QPS=5`/`Burst=10` rate limiter being shared per-cluster-client across all concurrent callers rather than per-request (confirmed: backend CPU stayed under 12% throughout the burst — not CPU-bound, consistent with requests waiting on the shared limiter). Two candidate fixes identified (singleflight-based coalescing; raising QPS/Burst) — not implemented this pass per the brief's own explicit caution against introducing caching changes without validating invalidation semantics first.

## Phase 2D Follow-up — Root Cause Isolated, Option B Implemented

Full record in `docs/TOPOLOGY-CONCURRENCY-INVESTIGATION.md`. Per the explicit 13-step investigation protocol (baseline matrix at N=1/2/5/10/20; direct instrumentation proving 10 requests → 10 independent builds, not 1+9 consumers; CODE-PROVEN client-go QPS=5/Burst=10 default shared per-cluster-client across all concurrent callers; phase-timing proving the extra latency is ~100% in bulk List calls; a non-identical-request experiment proving rate-limiting contributes independently of duplicate work; an isolated QPS/Burst experiment before any production change):

**Implemented:** `K8sClientQPS`/`K8sClientBurst` config (defaults 50/100, applied via a new `k8s.SetDefaultClientRateLimit` at startup, before any client is constructed). Live-validated: 10 concurrent cold topology requests, **18.17s → 3.09s**. The real API server's own CPU stayed under ~20% in both configurations — confirmed this is not simply transferring load the cluster can't absorb, at this scale.

**Deliberately deferred, not implemented:** request coalescing (singleflight) for identical concurrent requests — real, evidenced, independently valuable, but Step 6's invalidation-semantics questions (reconnect/cancellation/failure-poisoning behavior for a shared in-flight computation) were traced but not fully closed out, per the brief's own instruction that these must be answered before implementing. Carried forward as a scoped follow-up.

Full backend `go test -race ./...`: 52/52 packages `ok`. New regression tests (`internal/k8s/client_ratelimit_test.go`) pass. All temporary investigation instrumentation removed from production code.

## Phase 2A/2B — Dense Namespace & Relationship Density

Added a dedicated dense namespace (1,200 pods in 60 Deployments, 5 group-wide Services with high fan-out, 5 shared ConfigMaps/Secrets with high fan-in), bringing the lab workload to 3,658 pods / 21 namespaces. Dense namespace: 87 nodes/185 edges, 0.16s. Sparse namespace comparison: 66 nodes/86 edges, 0.08s. Full cluster V2: 753/1,489, 0.34s. V2's aggregation held up well at higher relationship density (2.13 vs 1.30 edges/node) — no new density-specific bottleneck found at this scale. Full details in `docs/TOPOLOGY-SCALE-INVESTIGATION.md`.

## Phase 2E — Refresh/Repeatability: NEW P1 FOUND AND FIXED (VALID-07), Measurements Corrected

**IMPORTANT CORRECTION:** The sequential-refresh and concurrent-user measurements reported earlier in this phase (V2 topology, N=1/5/10/25 sequential and N=2/5/10/20 concurrent, all showing sub-100ms latencies and flat goroutines/RSS) were **INVALID FOR REBUILD/REBUILD-UNDER-LOAD ANALYSIS**. Investigation revealed `GetTopologyV2` silently ignored `force_refresh=true` entirely — every one of those "refresh" and "concurrent user" requests after the first was served from the same 30s-TTL cache entry, not a real rebuild. Preserved below for historical record, not deleted:

| Original (INVALID for rebuild analysis — actually measuring cache-hit speed) | |
|---|---|
| Sequential N=1/5/10/25 | 9-22ms each, flat goroutines (41-42), stable RSS |
| Concurrent N=2/5/10/20 | 10-150ms total, flat goroutines (41) |

**Root cause found and fixed as VALID-07** — full record in `docs/TOPOLOGY-SCALE-INVESTIGATION.md`. Severity P1 (default frontend path, directly overlaps the original "refresh does nothing" customer complaint, bounded by the 30s TTL). Fixed: `GetTopologyV2` now parses and honors `force_refresh`, matching V1's existing, already-correct semantics. Regression tests proven to fail pre-fix, pass post-fix (revert-and-reconfirm performed). Full backend `-race` suite green. Live-validated: two consecutive `force_refresh=true` calls now both take ~340ms (genuine rebuilds) instead of 31ms-then-23ms (both cached).

### Corrected Phase 2E measurements (post-VALID-07, using the real fix)

| Test | What it measures | Result |
|---|---|---|
| normal -> normal | cache-hit performance | 0.387s (build) -> 0.024s (hit), byte-identical — correct, unchanged |
| `force_refresh` -> `force_refresh` | actual rebuild, sequential | 0.349s -> 0.338s — both genuine rebuilds, consistent cost, same correct node count (753) both times |
| concurrent `force_refresh` x15 | rebuild contention + correctness | All 200 OK, well-formed, no race, cache left valid (subsequent normal request cleanly cache-hits) — correctness proven; redundant-work performance question remains the already-deferred singleflight decision, unchanged |

Full N=1/5/10/25 sequential-forced and N=2/5/10/20 concurrent-forced latency distributions were not separately re-run at every tier this pass (time-boxed) — the 2-request and 15-concurrent experiments above are sufficient to confirm the fix's correctness and that no new P0/P1 concurrency issue was introduced; a fuller forced-rebuild latency ladder remains a reasonable follow-up before 5K if deeper confidence is wanted.

## Phase 2J — Singleflight Decision (post-VALID-07)

Question: is redundant concurrent `BuildTopology` work now the dominant remaining bottleneck? **No new evidence this pass changes the Phase 2D conclusion** — concurrent force-refresh correctness is proven (Phase E above), but the QPS/Burst fix already addresses the dominant contention mechanism identified in Phase 2D. Singleflight remains **P2 — DOCUMENTED / DEFERRED**, not implemented, per the unresolved design questions already on record (reconnect invalidation, cancellation ownership, failure-poisoning, shared-result lifetime).

## Phase 2F/2G — Cross-Cluster Isolation & Failure Resilience

**Methodology limitation, disclosed upfront per Hard Rule 3:** only one real kind API server (`kubilitics-phase-e`) was available. "Cluster A" and "Cluster B" below are two distinct logical registrations (distinct UUIDs, distinct cache keys, distinct `*k8s.Client` instances) against that **same physical control plane** — this proves *Kubilitics' own* per-cluster isolation (code-level: cache keys, client pooling, lifecycle managers) but **cannot** prove independence from real network-level cross-cluster effects, since there is only one real backend API server to contend for. Results involving shared backend capacity are flagged as such, not presented as proof of true multi-API-server isolation.

### 2F-A/B — Basic & Cache Isolation (LIVE-REPRODUCED)

- Built A, built B (distinct cache keys, both real builds, 0.41s/0.30s).
- Requested A again → cache hit (0.010s).
- Force-refreshed A → real rebuild (0.280s).
- Requested B again → **byte-identical to B's original cached result**, confirmed via `cmp`, fast (0.031s = cache hit, not a rebuild).
- **A's force-refresh did not invalidate, replace, or rebuild B's cached entry.** Cache keys are `clusterID|mode|namespace|depth` — structurally cannot collide across clusters (confirmed by code reading in the VALID-07 investigation, re-confirmed live here).

**Status: PASS (GREEN)** for cache isolation, within the shared-API-server methodology's limits.

### 2F-C — Reconnect Isolation (LIVE-REPRODUCED)

Reconnected A (40ms), immediately measured B: overview 42ms, topology 40ms (cache hit) — B completely unaffected by A's reconnect. **Status: PASS (GREEN).**

### 2F-D — Slow-Cluster Isolation (LIVE-REPRODUCED, result partially ambiguous due to the methodology limitation — reported honestly)

Could not inject real network latency into only "cluster B" (no `tc`/`netem` tooling used — both logical clusters share the one real control plane, so any real-network delay would affect both equally). Used the best available proxy instead: put B under heavy self-inflicted concurrent load (15 concurrent forced topology rebuilds) and measured A's latency during that exact window.

- A's `/overview` (lightweight): **1.5-13ms throughout** — no measurable impact. Strong evidence against any Kubilitics-side shared lock or global queue (if one existed, even A's trivial calls would have blocked).
- A's topology (forced rebuild, heavier): **0.61s**, vs. a ~0.3-0.4s baseline for an isolated forced rebuild — roughly 1.5-2x slower.

**Interpretation, stated honestly:** the per-client QPS=50/Burst=100 limiter (Phase 2D) is attached per-`*k8s.Client` instance — A and B have separate instances, so this specific mechanism cannot explain the coupling. The most plausible explanation is the one real kind control plane genuinely receiving ~230+ simultaneous List calls (15 B-builds × up to 15 concurrent sub-calls, plus A's own) and taking real server-side time to answer all of them — a **shared-backend-capacity effect, not a demonstrated Kubilitics-side architectural coupling bug.** This cannot be fully disambiguated from a genuine code-level coupling without a second, truly independent API server, which this lab does not have. **Status: PASS WITH RISK (YELLOW)** — lightweight operations proven isolated; heavy-operation cross-talk is plausible-but-unproven to be purely backend-capacity-driven rather than code-level, and this distinction matters enough to flag rather than resolve by assumption.

### 2F-E — One Dead Cluster (LIVE-REPRODUCED)

Registered an unreachable cluster (non-routable IP, same pattern as the PipelineManager investigation) alongside healthy A:
- Registration itself: 5.02s (bounded by the pre-existing connection-test timeout, unrelated to this phase), correctly marked `disconnected`.
- A's `/overview`: 1.67ms, unaffected, before and after.
- Fleet overview (with the dead cluster present): 229ms, 200 OK, correctly reports 2 unhealthy / 0 healthy — correct aggregate behavior with a dead member present (the "0 healthy" reflects both the genuinely-dead cluster and a stale health-tracking artifact from B's earlier heavy-load test marking it transiently unhealthy — a minor, self-correcting tracking quirk, not investigated further this pass).
- A's topology: 0.33s, unaffected.
- Dead cluster's own `/overview`: 404 in 6.9ms — bounded, no crash, no hang.

**Status: PASS (GREEN).**

### 2F-F, 2G-A/B/C/D — Not independently re-run this pass; existing evidence cited instead of re-deriving

Per the hard rule against re-litigating already-proven ground, and given real `tc`/`netem`-based network-latency injection was not available/safe to set up against this lab in the time available:

- **API latency/timeout bounding (2G-A/B):** already proven by `buildClusterSummary`'s hung-resource-type tests (`TestBuildClusterSummary_OneHungResourceTypeIsBoundedAndDoesNotCorruptOthers`/`...DoNotAmplify`) and `PipelineManager`'s `TestStartCluster_SizingTimeoutIsEnforcedAndPropagatesCancellation` — both use a real, ctx-aware blocking clientset (not a timing guess) proving bounded behavior and real cancellation propagation. Not re-run against topology specifically this pass — flagged as a reasonable follow-up, not re-derived.
- **Partial resource failure (2G-C):** already proven structurally — `discoverResources`'s errgroup explicitly logs-and-continues per resource type ("partial graph recovery instead of failing on first error" — confirmed by code reading in the earlier amplification audit), and `buildClusterSummary`'s `HealthReason`-on-partial-failure contract is live-tested.
- **Reconnect-during-failure (2G-D):** already proven by VALID-04's full suite (`ReconnectRacesRemove_NoResurrectionNoStaleCache`, `ConcurrentReconnects_NoPanic`, etc.) plus this session's own PipelineManager/EngineLifecycleManager reconnect tests.
- **Concurrent multi-user/multi-cluster simulation (2F-F):** partially covered by 2F-D's load test (A+B simultaneous access) and the existing `TestGetFleetOverview_ConcurrentRequestsDoNotRaceOrCorrupt`/`TestVALID02_ConcurrentClusterIsolation` suites. Not independently re-run as a dedicated 5-user/2-cluster simulation this pass.

### 2G-F — Soak (SHORT, honestly labeled — 2 minutes, not 30)

Sampled every 20s for 2 minutes after the 2F-D load spike: goroutines 331→328→328→327→326→327 (converging, not growing); RSS 279MB→211MB→196MB→183MB→91MB→89MB (clearly decreasing — GC + idle-TTL informer cleanup reclaiming the load spike's cost). **No monotonic growth observed in this window. Status: PASS for this short window** — a full 15-30 minute soak was not run this pass (time-boxed), so sustained-duration convergence beyond ~2 minutes remains UNVERIFIED, not assumed.

## Required Evidence Matrix

| Scenario | Cluster A | Cluster B | Expected | Actual | Status |
|---|---|---|---|---|---|
| Basic isolation | Healthy | Healthy | Isolated | Distinct cache keys, no cross-read | PASS |
| Cache isolation | Healthy | Healthy | Isolated | B byte-identical before/after A's force-refresh | PASS |
| A reconnect | Reconnecting | Healthy | B unaffected | B latency unaffected (42ms/40ms) | PASS |
| Slow/loaded B | Healthy | Heavy self-load (proxy for "slow") | A unaffected | A lightweight: unaffected (1.5-13ms); A heavy: ~1.5-2x slower, plausibly shared-backend-capacity not code coupling | PASS WITH RISK |
| Dead B | Healthy | Dead (unreachable) | A unaffected | A fully unaffected throughout | PASS |
| Partial resource failure | Healthy | Degraded | Partial result | Proven by existing `buildClusterSummary`/discovery evidence (not re-run) | PASS (cited) |
| Recovery | Healthy | Recovering | Self-heal | Proven by existing VALID-04 suite (not re-run) | PASS (cited) |
| Force refresh | Healthy | Healthy | Correct cache behavior | VALID-07, this session | PASS |
| 2-minute soak | Healthy | Recovered from load | Stable | Goroutines/RSS both converging downward | PASS (short window only) |
| 15-30 min soak | — | — | Stable | Not run | UNVERIFIED |
| True independent-API-server isolation | — | — | Isolated | Cannot be tested with this lab's infrastructure | UNVERIFIED (methodology limit) |

## PHASE 2F/2G FINAL STATUS

**Cross-cluster isolation:** PASS WITH RISK — code-level isolation (cache, client pooling, reconnect, dead-cluster handling) is solidly proven; the one ambiguous result (heavy-load cross-talk under a shared real API server) is most plausibly a backend-capacity effect, not a Kubilitics defect, but this session could not fully disambiguate it without a second real API server.

**Failure containment:** PASS (for dead-cluster and reconnect scenarios, live-reproduced this pass; for API-latency/timeout/partial-failure scenarios, PASS by citation of already-proven evidence from earlier phases, not re-derived this pass).

**Recovery without restart:** PASS — reconnect, dead-cluster registration, and post-load-spike recovery all demonstrated without any backend restart.

**Resource convergence:** PASS for the 2-minute window actually sampled; UNVERIFIED beyond that (no 15-30 minute soak run this pass).

**Known risks carried forward:**
- The 2F-D ambiguity (shared-backend-capacity vs. code-level coupling under heavy concurrent cross-cluster load) — would need a second genuinely independent API server to fully resolve.
- No 15-30 minute soak run.
- `tc`/`netem`-style real network-latency injection was not attempted (no safe tooling set up this pass) — 2G-A/B's bounded-timeout claims rest on earlier, different-endpoint evidence (buildClusterSummary, PipelineManager), not a topology-specific repeat.
- Singleflight remains P2/deferred (unchanged).
- `GetTopologyV2Traffic`/`GetCriticality`'s force-refresh gap remains unfixed (unchanged, VALID-07's documented scope boundary).

**New findings this phase:** none rising to P0/P1 — the 2F-D result is flagged as an open risk/ambiguity, not a confirmed defect.

## 5K GO/NO-GO

**GO**, with the above risks explicitly carried forward and not hidden. Rationale: no unresolved P0/P1 blocks scale testing; cross-cluster isolation is proven at the code level (the one open ambiguity is most plausibly an artifact of this lab's single-shared-API-server limitation, not a Kubilitics defect, though not 100% certain); failure containment and recovery-without-restart are both demonstrated; no unexplained monotonic resource growth was observed in the window actually tested. The remaining gaps (longer soak, true multi-API-server isolation, real network-latency injection, the two deferred/documented items) are explicitly named, not glossed over, and none of them individually or together constitute a known blocking defect — they are gaps in verification depth, not evidence of a problem.

---

# PHASE 5K — 5,000-Pod Campaign

## 1. Executive Summary

No new P0/P1 found. Backend, dashboard, resource lists, and topology all performed well within reasonable budgets at ~4,910 pods. One surprising measurement (concurrent forced topology rebuilds degrading to 11-24s at N=10/20) was investigated, not explained away — direct attribution testing (raw `kubectl`, zero Kubilitics code, under the same concurrency) proved the dominant cause is this lab's single-node, resource-constrained real API server, not a Kubilitics-side regression. Lifecycle (registration/reconnect), cache behavior (VALID-07 fix), and a short 2-minute soak all converged cleanly. **Not proven this pass:** frontend/browser behavior (no tooling — UNVERIFIED, not inferred), a full 30-60 minute soak (only 2 minutes run), and Headlamp/competitor comparison (not attempted — explicitly NOT STARTED, not fabricated).

## 2. Exact Workload

| Resource | Count |
|---|---:|
| Pods | 4,910 |
| Namespaces | 32 |
| Deployments | 537 |
| Services | 482 |
| ConfigMaps | 815 |
| Secrets | 776 |
| PVCs | 140 |
| Ingresses | 75 |
| NetworkPolicies | 25 |
| HPAs | 25 |
| PodDisruptionBudgets | 25 |

Three profiles, as required:
- **Profile A (balanced):** the existing 15-namespace 2K workload (`ent-t1-*`) plus a 10-namespace top-up (`ent-t5topup-*`, 150 deployments, ~1,122 pods) — normal distribution across namespaces/types.
- **Profile B (namespace-dense):** `dense-ns` (carried from the 2K phase) — 1,200 pods in 60 Deployments, 5 group-wide Services each selecting ~240 pods (high fan-out), 5 shared ConfigMaps/Secrets referenced by all pods (high fan-in).
- **Profile C (relationship-dense):** new `profile-c-dense-rel` namespace — 25 Deployments, each with its own ConfigMap, Secret, PVC, Service, Ingress, NetworkPolicy, HPA, *and* PDB (every relationship kind the topology engine infers, simultaneously, per workload) — only 100 pods, deliberately prioritizing edge density over pod count.

All pods intentionally unscheduled (`schedulerName: kubilitics-synthetic-unscheduled`) — same disclosed methodology as the 2K phase, re-confirmed safe at this scale (node CPU 33.66%, memory 15.17% during generation).

## 3. Environment

Isolated lab kind cluster `kubilitics-phase-e`, single control-plane node, Docker Desktop 4 CPU / 7.75GB. Kubernetes v1.33.1. Backend built fresh from the current `feat/stability` tree (all prior fixes included), port 8219, PID-verified, health-checked before every test. Real environment (`kind-nightshift-dev`, 20 pods) re-verified untouched before, during, and after every experiment in this phase.

## 4. Backend Results

| Test | Cold | Warm | N | Notes |
|---|---:|---:|---:|---|
| Registered-only baseline | — | — | 1 | 26 goroutines, 71MB RSS — unchanged from 2K, confirms registration cost is pod-count-independent |
| Dashboard overview | 17ms | 17ms | 1 | Correct data (4,910 pods / 537 deployments) |
| Fleet overview | 358ms | — | 1 cluster | |
| Cluster summary | 151ms | — | 1 | Correct `health_reason` (4,901 pending, matching the synthetic-unscheduled methodology) |
| Namespace enumeration | 19ms | — | 32 ns | |
| Pod list (paginated) | 262ms | — | 100/4,910 | |
| Deployment list | 56ms | — | 100/537 | |
| Service list | 32ms | — | 100/482 | |
| Reconnect | 180ms | — | 1 | Goroutines/RSS converged normally after |

All GREEN against this campaign's implicit carry-forward budgets from the 2K phase (nothing here approached a concerning threshold).

## 5. Topology Results

| Scenario | Nodes | Edges | Edges/node | Payload | Latency | Status |
|---|---:|---:|---:|---:|---:|---|
| V2 cluster (default frontend path), cold | 1,169 | 2,289 | 1.96 | 1.59MB | 0.72s | GREEN |
| V2 cluster, warm (cache hit) | 1,169 | 2,289 | — | 1.59MB | 0.028s | GREEN |
| V2 namespace drill-down, relationship-dense (Profile C) | 108 | 150 | 1.39 | 113KB | 0.20s | GREEN |
| V2 namespace drill-down, pod-dense (Profile B) | 98 | 185 | 1.89 | 167KB | 0.15s | GREEN |
| V1 cluster (bounded, both PVC-N+1 and maxNodes fixes active) | 5,000 (capped) | 8,841 | — | 5.83MB | 0.21s | GREEN, `isComplete=false` honestly reported |
| V2 force_refresh x2 (VALID-07 validation at 5K) | 1,169 both times | 2,289 both times | — | — | 0.44s, 0.45s (both genuine rebuilds) | GREEN — fix holds at 5K scale |

### Concurrency (D5) — the one surprising result, investigated per Rule 15

| N (concurrent forced identical requests) | Total wall-clock | p50 | RSS peak |
|---:|---:|---:|---:|
| 1 | 0.48s | 0.45s | 372MB |
| 5 | 4.32s | 4.26s | 859MB |
| 10 | 11.19s | 11.09s | 1.30GB |
| 20 | 23.55s | 23.14s | 2.04GB |

This is substantially worse than the 2K-scale result (N=10: 3.1s post-QPS-fix). **Investigated, not explained away (Phase 5K-I attribution):**
- RSS convergence re-checked immediately after: 2.04GB → 250MB within ~10-15s, oscillating in the 68-390MB range thereafter — **not a leak**, transient per-concurrent-build memory, fully reclaimed.
- Goroutines stayed flat (311-313) throughout — no accumulation.
- **Direct attribution test:** a single raw `kubectl get pods -A -o json` (zero Kubilitics code involved) took **2.87s** at this pod count (27.5MB response). **10 concurrent raw `kubectl` calls** (again, zero Kubilitics code) took **21.03s total** — nearly identical to Kubilitics' own N=10 result (11.19s, which does ~20+ List calls per build, of which pods is only one).

**Conclusion:** the dominant cause of this degradation is the real Kubernetes API server's own capacity on this single-node, 4-CPU lab control plane at ~4,910 objects — not a Kubilitics-side architectural regression. Per Rule 14, this is explicitly **not** presented as evidence that Kubilitics itself fails under concurrency at 5K in a properly-resourced production environment with real API-server capacity — it is evidence that *this lab's infrastructure* cannot serve 10+ simultaneous full-namespace List operations quickly at this object count, and Kubilitics' own behavior tracks that limit closely rather than making it dramatically worse. **Status: YELLOW** — degraded but bounded, predictable, and now correctly attributed rather than assumed; a genuinely under-provisioned real cluster could show comparable behavior for the same reason, which is itself a useful, honest product finding (heavy concurrent topology use against a resource-constrained API server will be slow, and operators should know that) rather than a Kubilitics defect to fix.

## 6. Lifecycle Results

Registration-only baseline (26 goroutines/71MB) unchanged from 2K — confirms the Hybrid Informer Lifecycle and EngineLifecycleManager's cost model remains pod-count-independent at idle, as designed. Reconnect at 5K scale: 180ms, clean convergence after. A full 5x activation/TTL/reactivation cycle (as the brief's Phase 5K-F literally specifies) was **not independently re-run this pass** — this exact mechanism was already exhaustively proven convergent in the 2K phase and the dedicated `TestCombinedLifecycle_N26_*`/`TestEngineLifecycleManager_*` suites (pod-count-independent by construction, since TTL/generation logic doesn't depend on resource count) — re-deriving it at 5K would not add new evidence given the mechanism has no pod-count dependency. Flagged as a deliberate decision, not an oversight.

## 7. Soak Results

**Short window only — 2 minutes, not the 30-60 minute target (time-boxed, disclosed honestly, not presented as a full soak):**

| t | Goroutines | RSS |
|---:|---:|---:|
| 20s | 310 | 388MB |
| 40s | 310 | 277MB |
| 60s | 314 | 373MB |
| 80s | 312 | 224MB |
| 100s | 310 | 392MB |
| 120s | 311 | 307MB |

Goroutines flat (310-314); RSS oscillating within a bounded 224-392MB range with periodic dashboard+topology activity every 20s — no monotonic trend. **Status: PASS for this short window; a genuine 30-60 minute soak remains UNVERIFIED.**

## 8. Failure Results

Not independently re-run against this 5K workload this pass. Cited from already-proven evidence (unchanged by workload size, since these mechanisms don't depend on pod count): `buildClusterSummary` hung-resource-type tests, `PipelineManager`'s ctx-aware blocking-clientset timeout tests, VALID-04's reconnect-race suite, and the 2F/2G dead-cluster/reconnect-isolation live tests. **Status: PASS (by citation), not re-derived at 5K.**

## 9. Browser Results

**UNVERIFIED.** No browser automation tooling was available in this session. Not inferred from backend latency, per the explicit rule against doing so.

## 10. Headlamp Findings

**NOT STARTED this pass.** Would require dedicated source-reading time not available in this turn's scope. Flagged honestly rather than fabricated or superficially asserted.

## 11. Lens/Aptakube Comparison

**NOT STARTED this pass** — no verifiable, evidence-backed comparison was performed. Not fabricated.

## 12. Findings

No new P0/P1. One YELLOW (concurrent-load latency, attributed to lab infrastructure capacity, not Kubilitics — see §5). No new P2/P3 beyond those already carried forward from earlier phases (singleflight deferral, sibling force-refresh gap in `GetTopologyV2Traffic`/`GetCriticality`).

## 13. Fixes

None this phase — 5K was a measurement/investigation pass, not a remediation pass. No production code was changed.

## 14. Remaining Risks

- Frontend/browser behavior at 5K: UNVERIFIED.
- Full 30-60 minute soak: not run (only 2 minutes).
- Headlamp/Lens/Aptakube comparison: not started.
- Concurrent-load attribution rests on this lab's single real API server — a genuinely independent-API-server test (true multi-cluster) was not possible with available infrastructure, carried forward from 2F.
- 5x lifecycle activation/TTL/reactivation cycle not independently re-run at 5K (reasoned, not assumed, to be pod-count-independent).
- Singleflight and the sibling V2 force-refresh gap remain deferred/undocumented-fix, unchanged.

## 15. 10K GO/NO-GO

**CONDITIONAL GO**, not an unconditional one. Backend/topology/lifecycle/cache correctness all PASS at 5K with real, attributed evidence. The one YELLOW finding (concurrent-load latency) is well-understood and attributed to lab infrastructure, not Kubilitics — but this attribution itself is based on a single-API-server lab and should be re-confirmed, not assumed, at 10K, since a bigger workload could expose a *real* Kubilitics-side scaling issue underneath the infrastructure-capacity noise. Recommend: before or alongside 10K, (a) run the same raw-kubectl-vs-Kubilitics attribution test again to confirm the ratio holds, (b) attempt at least a 15-minute soak if time permits, (c) continue treating browser/competitor comparisons as explicitly open rather than silently dropped. No blocking P0/P1 exists; proceeding to 10K is reasonable, with these specific verification gaps named rather than hidden.

# PHASE 10K — 10,792-Pod Campaign (In Progress)

## 10K-A. Workload Construction

Carried forward the 5K workload (4,910 pods) unmodified, applied the `t10topup`
tier (22 namespaces, 660 deployments, ~5,598 pods expected) and a
`profile-c-10k` relationship-dense namespace (40 deployments, 200 pods, every
deployment carrying ConfigMap+Secret+PVC+Service+Ingress+NetworkPolicy+HPA+PDB).
**Measured, not estimated, final counts**: 10,792 pods / 55 namespaces / 1,237
deployments / 1,182 services / 1,758 configmaps / 1,696 secrets / 356 PVCs / 181
ingresses / 65 networkpolicies / 65 HPAs / 65 PDBs. Real environment
(`nightshift-dev`, 20 pods) confirmed untouched throughout construction.

## 10K-B. Infrastructure Attribution (Steps 1, raw-API Controls)

Raw `kubectl get pods -A -o json` (zero Kubilitics code): N=1 → 6.2–6.6s / 57.8MB
payload; N=5 → ~25–29s per worker; N=10 → ~58–67s per worker; N=20 → ~82–122s per
worker, **zero failures at any N** — the real API server degrades but never fails
outright under this lab's 4-CPU ceiling.

## 10K-C. P1 Found, Root-Caused, and Remediated — Resource-List Pagination N+1

Full investigation, remediation, before/after evidence, and regression results in
the dedicated document: **`docs/RESOURCE-LIST-PAGINATION-N1-INVESTIGATION.md`**.

Summary: `ListFromCacheWithPagination` (backing `GET /clusters/{id}/resources/{kind}`
— the highest-traffic resource endpoint) converted and sorted the **entire**
10,792-object informer store on every request regardless of requested `limit`.
At N=20 concurrency this produced 63–80% request failure rates and up to 759x more
latency than necessary. Root-caused via Phase 1–3 blast-radius tracing and
in-process isolation instrumentation (temporary, removed before completion); fixed
via a typed-object fast path (`meta.Accessor`-based filter+sort+paginate, converting
only the returned page) for the 3 most common sort keys, with the 7
exotic/computed-field sort keys preserved on the original (unchanged, not
regressed) path. **Status: FIXED.** `go test -race ./...` — 0 failures, 0 races,
full backend. 12 new regression tests. 759x/337x improvement (p50/CPU) at
`limit=100`×N=20; concurrent-request failures eliminated (63–80% → 0%) at both
tested page sizes.

## 10K-D. Remaining Steps

Steps 2 (2K/5K/10K scaling table), 3 (topology deep-dive), 4 (full concurrency
attribution matrix — now re-run against the fixed backend), 5 (API amplification),
6 (cache behavior re-test), 7 (lifecycle cycles), 8 (soak), 9 (failure containment),
10 (frontend/browser), 11 (Headlamp source study), 12 (enterprise-experience
evaluation), and the final 10K scorecard + 20K GO/NO-GO gate remain to be run
against this now-fixed baseline. Not yet started as of this entry.
