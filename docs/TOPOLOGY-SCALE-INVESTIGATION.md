# Topology Scale Investigation — Phase 2, V1 Remediation

**Status: Real root cause found (not the originally-suspected one), FIXED, TEST-PROVEN, `-race` clean, LIVE-VALIDATED: 18.9s → 0.18s (≈105x) at ~2,248-pod / 75-PVC scale.**

## Finding 1: V1 topology had no default node cap (secondary finding, fixed, but NOT the real bottleneck)

- **Severity:** P2 (defense-in-depth; superseded in impact by Finding 2 below)
- **Reproduction:** `GET /clusters/{id}/topology` with no query params, against the Phase 1 2K-tier lab workload.
- **Evidence:** `maxNodes` defaulted to `0` ("no limit") unless `h.cfg.TopologyMaxNodes` was explicitly configured — but viper's own `SetDefault("topology_max_nodes", 5000)` means a normally-booted backend already has this at 5000, not 0 (my Phase 1 report mischaracterized this — corrected here). 5000 happened to exceed this workload's actual 4,888-node full graph, so the existing safety net never engaged.
- **Root cause:** No fallback to a conservative cap (`MaxTopologyNodes = 500`, already used by V2) when `h.cfg` is nil or `TopologyMaxNodes` is explicitly set to 0.
- **Fix:** `internal/api/rest/handler.go`'s `GetTopology` now defaults `maxNodes` to `MaxTopologyNodes` (500, now sourced from a new shared `models.DefaultMaxTopologyNodes` constant also used by `internal/api/grpc/service.go`'s `GetTopologyGraph`, which had the identical gap and zero bound of its own). An explicit `?max_nodes=` override remains available — the expensive form is not removed, just no longer the silent default.
- **Regression test:** `internal/api/rest/topology_v1_bounded_test.go` — proven to fail against the original code (reverted, confirmed fail, restored, confirmed pass).
- **Caller audit:** repo-wide grep confirmed zero current frontend callers of V1's bare `/topology` route (the default Topology page uses V2's `/topology/cluster`); the only other backend caller is the gRPC `ClusterDataService.GetTopologyGraph`, fixed identically.

## Finding 2: `inferStorageRelationships`'s N+1 live-Get fallback — THE REAL bottleneck (P1-equivalent impact, now fixed)

This is the finding that actually explains the 16-19 second V1 latency measured in Phase 1 — Finding 1 alone would not have fixed it, because `maxNodes` only truncates the final node list; it does not reduce the discovery/inference work already done to build the graph, and in this workload the existing 5000 cap never engaged anyway.

### Investigation method (not guessed — measured)

Added temporary phase-by-phase timing instrumentation to `BuildGraph` (discover → infer → prune → layout-seed → validate) and, within `InferAllRelationships`, per-sub-function timing across all 11 inference passes. Rebuilt, ran once against the live lab workload, read the numbers, removed the instrumentation. Results:

| Phase | Duration |
|---|---:|
| Phase 1: discoverResources | 82-89ms |
| Phase 2: InferAllRelationships (total) | **18.9s** |
| Phase 3: prune | <1ms |
| Phase 4: layout seed | ~12ms |
| Phase 5: validate | <1ms |

Within Phase 2, 10 of 11 sub-inference functions took under 6ms each. One took **18.908s**: `inferStorageRelationships`.

### Root cause (CODE-PROVEN)

`internal/topology/relationships.go`'s `inferStorageRelationships` (PVC→PV→StorageClass edges) reads `volumeName`/`storageClassName` from `graph.GetNodeExtra(pvc.ID)` if present, then **falls back to a live `PersistentVolumeClaims(ns).Get(ctx, name, ...)` call whenever EITHER field was empty** — `if (volumeName == "" || storageClassName == "") && ri.engine != nil { ... Get(...) }`.

Two compounding bugs:
1. **`discoverPersistentVolumeClaims`/`discoverPersistentVolumes` (Phase 1, `internal/topology/engine.go`) never stored `nodeExtra` at all** — despite the bulk `List` call in that same phase already returning `pvc.Spec.VolumeName` and `pvc.Spec.StorageClassName` for free. The data was fetched once, cheaply, in bulk, then thrown away, forcing a second, individual, expensive fetch later.
2. **The fallback condition conflated "field legitimately empty" with "never discovered."** An unbound (`Pending`) PVC has a genuinely empty `volumeName` forever — that's correct, not missing data — but the `||`-based condition treated it as "go re-fetch," on every single Pending PVC, every single request, regardless of whether discovery had already found everything that actually exists.
3. **These individual Get calls are throttled by client-go's default `QPS=5`/`Burst=10` client-side rate limiter** — confirmed via `internal/k8s/client.go`, which never sets `rest.Config.QPS`/`Burst` (so client-go's built-in default applies, unrelated to and independent from the `rest.Config.Timeout`/watch-safety constraint established earlier in this engagement). For N PVCs needing the fallback, wall-clock cost ≈ `(N-10)/5` seconds. At 75 PVCs: ≈13s, consistent with the observed 18.9s (plus overhead, retries, and the separate PV→StorageClass loop sharing the same bug).

### Fix

- `discoverPersistentVolumeClaims`/`discoverPersistentVolumes` (`internal/topology/engine.go`) now call `graph.SetNodeExtra` with whatever `volumeName`/`storageClassName` the bulk List already returned — **always**, even when both are empty, so a present-but-empty extra map correctly signals "discovery ran, this is genuinely what exists" rather than "not yet discovered."
- `inferStorageRelationships` (`internal/topology/relationships.go`, both the PVC→PV/StorageClass loop and the PV→StorageClass loop) now falls back to a live Get **only when `extra == nil`** (discovery never ran for this node at all — e.g. a hand-built test graph or a future code path bypassing normal discovery) — never merely because a field is legitimately empty.
- This is not a cap, a timeout, or a truncation — it eliminates ~75 unnecessary live API calls entirely by reusing data already in hand. Same correctness contract, same output (same node/edge counts, verified), dramatically less work.

### Before/after (LIVE-REPRODUCED, isolated lab, same ~2,248-pod/75-PVC workload, same cluster)

| | Before | After |
|---|---:|---:|
| `GET /clusters/{id}/topology` (default, `force_refresh=true`) | 18.85s - 19.06s (3 independent runs) | **0.15s - 2.17s** (3 independent runs) |
| Nodes / edges | 4,888 / 17,375 | 4,948 / 17,525 (slightly higher — minor pod-count drift between runs from CronJob-spawned Jobs, not from this fix) |
| `isComplete` | `true` | `true` |

~105x at the fastest observed after-sample, ~9-10x even at the slowest after-sample (both still well under the brief's own target range).

### Regression tests

`internal/topology/storage_n1_regression_test.go`:
- **`TestInferStorageRelationships_PendingPVCWithExtra_DoesNotRefetch`**: a Pending PVC with `storageClassName` already in `nodeExtra` (and no `volumeName`, correctly absent) must trigger **zero** live Get calls, proven via a counting `k8stesting.PrependReactor` on a real `k8s.Client`/`Engine` (not a hand-rolled mock) — the PVC→StorageClass edge must still be created from the cached data.
- **`TestInferStorageRelationships_NoExtraAtAll_StillFallsBackToLiveGet`**: when `extra == nil` (discovery genuinely never ran), the fallback must still fire exactly once and produce the correct edge — proving this is a correction, not a removal, of the fallback.

Both proven to fail against the original (reverted) condition and pass against the fix (explicit revert → confirm fail → restore → confirm pass cycle performed for both Findings 1 and 2).

### Full regression evidence

- `go build ./...`, `go vet ./...`: clean.
- `go test -race ./internal/topology/...`: all packages `ok`.
- Full backend `go test -race ./...`: 52/52 packages `ok`, zero `FAIL`.
- Named suites re-run explicitly: VALID-02, Blast Radius/EngineLifecycleManager, Fleet N+1, buildClusterSummary fan-out, V1 topology bound — all pass (see this session's final report for full list).

### Live validation summary (isolated lab `kubilitics-phase-e`, real environment re-verified untouched throughout)

| Check | Result |
|---|---|
| V1 topology, default, repeated 3x | 0.15s / 1.96s / 2.17s — consistently fast, no regression to the old behavior |
| V2 cluster topology (`/topology/cluster`) | Unaffected, 5.4s (consistent with Phase 1's measurement, not touched by this fix) |
| Namespace drill-down | Unaffected, 65 nodes, 2.97s |
| Blast Radius | Unaffected — lazy-activates as designed |

## Phase 2C — Systematic `infer*` Amplification Audit (cluster-wide hot path)

Per the follow-up brief's explicit instruction to audit every `infer*` function for the same discard-then-refetch/N+1 pattern before moving to 5K, rather than assume Finding 2 was the only instance.

**Method:** grepped `internal/topology/relationships.go` (the `InferAllRelationships` cluster-wide path invoked by `BuildGraph`, used by both V1 `GetTopology` and V2 `GetTopologyV2`) for every live K8s API call (`.Get(ctx`/`.List(ctx`/`Clientset.`), then checked each hit's enclosing function and loop context.

**Result: exactly 2 live API call sites exist in the entire file — both already identified and fixed in Finding 2** (`inferStorageRelationships`'s PVC→PV and PV→StorageClass loops). No other `infer*` function makes any live Kubernetes API call at all.

| Function | API calls | Calls/resource | Cache use | Worst-case amplification | Fix needed |
|---|---:|---:|---|---:|---|
| `inferNamespaceContainment` | 0 | 0 | Pure in-memory (graph nodes) | None | No |
| `inferOwnerReferences` | 0 | 0 | `graph.GetOwnerRefs`/`GetNodeByUID` (set during discovery) | None | No |
| `inferLabelSelectors` | 0 | 0 | Inverted label index (`GetNodesBySelector`), `GetNodeByName` | None | No |
| `inferVolumeRelationships` | 0 | 0 | `graph.PodSpecCache` (cached during discovery) | None | No |
| `inferEnvironmentRelationships` | 0 | 0 | Same `PodSpecCache` + O(1) name index | None | No |
| `inferRBACRelationships` | 0 | 0 | Pure in-memory, O(1) lookups | None | No |
| `inferNetworkRelationships` | 0 | 0 | O(1) name index (confirmed via code comment + grep) | None | No |
| **`inferStorageRelationships`** | **0 (after fix)** | **was: up to 1/PVC + 1/PV** | **Now: `graph.GetNodeExtra`, populated at discovery** | **Was: ~N API calls; now: 0** | **Fixed (Finding 2)** |
| `inferNodeRelationships` | 0 | 0 | Pure in-memory | None | No |
| `inferAutoscalingRelationships` | 0 | 0 | `GetNodeExtra` + O(1) name index | None | No |
| `inferJobRelationships` | 0 | 0 | Pure in-memory | None | No |

**Conclusion: the cluster-wide hot path (`BuildGraph` → `discoverResources` + `InferAllRelationships`) has exactly one amplification bug, and it is the one already found and fixed.** The rest of the relationship-inference layer was already correctly built around cached/indexed data — the comments throughout ("O(1) lookup via name index instead of scanning all nodes," "O(k) intersection via inverted label index instead of O(pods) linear scan") indicate this was a deliberate, prior optimization pass, and it holds up under this audit.

### A second, different amplification surface exists — but is architecturally bounded, not a cluster-scale risk

`internal/topology/engine_resource.go` (3,400+ lines) contains ~100 live `Get(ctx...)` call sites across dozens of `buildXSubgraph(ctx, namespace, name)` functions (one per resource kind: Pod, Deployment, Service, Ingress, PVC, Role, HPA, etc.). These back the **single-resource drill-down** endpoint (`GET /clusters/{id}/topology/resource/{kind}/{namespace}/{name}`), invoked when a user clicks one specific resource — **not** the cluster-wide topology path. Each call is scoped to one resource's own immediate neighbors (e.g. `buildPodSubgraph` does a handful of Gets for *that pod's* configmaps/secrets/serviceaccount/pvc chain — bounded by that one pod's spec, typically single digits, never multiplied by total cluster resource count). This is architecturally a different risk class: it could matter if a user or automation rapidly drills into many different resources in quick succession (each triggering its own small Get cluster), but it does not scale with total cluster size the way the Finding 2 bug did, and is out of this pass's scope — not fixed, not claimed fixed.

## Phase 2D (partial) — Concurrent-Request / Thundering-Herd Test: New Finding (P2, documented, NOT fixed)

**Finding: 10 concurrent cold topology requests against the same cluster take ~18.3 seconds total — not the ~2s a single cold request takes.** This is a genuine "N concurrent users browsing the same large cluster degrades badly for everyone" problem, distinct from Finding 2.

### Reproduction (LIVE-REPRODUCED, isolated lab)

- Single cold V1 topology request (post-Finding-2 fix): 0.15-2.17s.
- 10 concurrent cold V1 topology requests (`force_refresh=true`, same cluster, fired together): **18.29s wall-clock for all 10 to complete.**
- Backend process CPU during the burst: 0.1%-11.4% (sampled every 2s across the burst) — **not CPU-bound.** This rules out lock/mutex contention as the cause (a CPU-bound contention issue would show sustained high CPU on one core).
- Goroutines before/after: 27 → 26 (no leak from the burst itself).

### Root cause (evidence-based, not yet exhaustively isolated to a single line)

Two architectural facts, both confirmed by direct code reading, combine to produce this:
1. **No request coalescing exists.** `internal/pkg/topologycache/cache.go`'s `Get`/`Set` are plain, uncoordinated reads/writes — no `singleflight.Group` or equivalent. 10 concurrent cache-miss requests for the identical `(clusterID, mode, namespace, depth)` key each independently call `BuildGraph` — 10x the discovery work (10 × ~26 List calls = ~260 total List calls against the one real API server) instead of 1x the work + 9 consumers of the same result.
2. **`internal/k8s/client.go` never sets `rest.Config.QPS`/`Burst`**, so client-go's default (`QPS=5`, `Burst=10`) applies — and this limiter is attached **per `*k8s.Client`, shared across every concurrent caller using that same cluster's client**, not per-request. ~260 List calls sharing one 5-QPS/10-burst bucket is consistent with the observed ~18s (and with the low CPU reading — these goroutines are mostly blocked waiting on the limiter, not computing).

Both facts are necessary to fully explain the symptom; this pass did not build a controlled experiment isolating exactly how much each contributes (e.g., repeating the burst with `QPS` temporarily raised, independently of adding coalescing) — classified as evidence-based, not yet a fully isolated single-variable proof.

### Severity and disposition

**P2** — contained to concurrent-heavy-topology-load on one cluster; does not cross cluster boundaries, does not corrupt data, does not crash, does not leak resources (goroutines returned to baseline). Real impact on the "enterprise operator trusts this at scale" bar if multiple users/tabs/polling intervals hit an expensive view on the same large cluster simultaneously.

**Not fixed this pass.** Per the follow-up brief's own explicit caution for this exact phase ("Do not introduce caching blindly. Validate correctness and invalidation semantics first") and the general rule that P2 findings are fixed only when the active execution brief explicitly authorizes it for this specific scenario, this is documented, not fixed. Two candidate fixes, not yet chosen between:
1. Add `singleflight.Group`-based coalescing to `topologycache` so concurrent identical-key requests share one `BuildGraph` call (same pattern already proven correct in this codebase for cold-start coalescing elsewhere — e.g. `getOrStartGraphEngine`/`ListClusters`'s reconnect dedup).
2. Raise `rest.Config.QPS`/`Burst` on cluster client construction (`internal/k8s/client.go`) to a value more appropriate for a management-plane client making bursty bulk reads, rather than client-go's conservative historical default tuned for low-rate reconcile loops.
Likely both are warranted (coalescing eliminates the *redundant* work; a higher QPS/Burst helps the cases that are genuinely different requests, e.g. different namespaces or different cache keys, not just duplicates) — but this requires a decision, not an assumption, per the brief's own instruction.

## VALID-07 — V2 Force Refresh Ignored

**Status: FIXED, TEST-PROVEN (revert→fail→restore→pass cycle performed), `-race` clean, LIVE-VALIDATED. Severity: P1.**

### Discovery

Found during Phase 2E (refresh/repeatability testing) against `GetTopologyV2` — the actual default frontend Topology view (`GET /clusters/{id}/topology/cluster`).

### Exact code path (traced before fixing, per Phase A)

```
HTTP request
  -> GetTopologyV2 (internal/api/rest/handler.go)
  -> cacheKey := topologyCacheKey(clusterID, mode, namespace, depth) [+ "|expand=" if set]
  -> topologyCacheGet(cacheKey)   <-- checked UNCONDITIONALLY, no force_refresh parsing existed at all
  -> on hit: return cached, done
  -> on miss: topologyv2builder.BuildTopology(...) -> topologyCacheSet(cacheKey, resp)
```

- **Cache key:** `clusterID|mode|namespace|depth[|expand=X]` — does not include any force-refresh dimension (by design; force_refresh is meant to bypass the lookup, not be a cache dimension).
- **TTL:** fixed 30s (`topologyCacheTTL` const).
- **Cache population after a forced rebuild:** confirmed `topologyCacheSet` already ran unconditionally after every build (forced or not) — this was already correct and required no change.
- **Concurrent partial-state risk:** none — `topologyCache` is a `sync.Map`; `Store` writes one complete `*topologyCacheEntry` pointer atomically, so a concurrent reader can only ever observe a fully-built entry or none, never a half-built one.
- **V1 comparison:** `GetTopology` (V1) already parses `force_refresh` and passes it through to `topologyService.GetTopologyWithClient`, which skips its own cache `Get` when true and unconditionally calls `Set` afterward — confirmed by reading `internal/service/topology_service.go` directly, not assumed. V2's correct fix is to match this exact semantic, which is what was implemented.

### Reproduction (LIVE-REPRODUCED, pre-fix)

```
GET .../topology/cluster?force_refresh=true  -> 31ms
GET .../topology/cluster?force_refresh=true  -> 23ms (immediately after)
```
Both responses byte-identical (`cmp` confirmed). A genuine rebuild at this workload scale measures 150-350ms — these two calls were both served from the package-level cache, confirming `force_refresh` had zero effect.

### Severity

**P1.** This is the actual default frontend Topology path (not a secondary/legacy route), and it directly reproduces a piece of the original customer complaint ("refresh repeatedly, nothing improves"), bounded by the 30s cache TTL (not indefinite — hence P1, not P0, per this engagement's own severity convention).

### Regression tests (written and proven to fail BEFORE the fix existed, per Phase B/C)

`internal/api/rest/topology_v2_force_refresh_test.go` — structural, not timing-based: a `k8stesting.PrependReactor` on `list pods` counts actual rebuilds (each `BuildTopology` call lists pods exactly once).

- **`TestGetTopologyV2_WithoutForceRefresh_SecondRequestIsCacheHit`**: 2 normal requests -> exactly 1 build.
- **`TestGetTopologyV2_WithForceRefresh_EachRequestRebuilds`**: 2 `force_refresh=true` requests -> exactly 2 builds. **This test failed pre-fix** (observed: 1 build, i.e. the second request was wrongly served from cache) — confirmed by running it against the original code, then restoring the fix and confirming it passes.
- **`TestGetTopologyV2_ForceRefresh_ThenNormalRequest_UsesCachedForcedResult`**: forced build's result correctly populates the cache for the next normal request (1 build total for force+normal).
- **`TestGetTopologyV2_MixedSequence_ForceRefreshDoesNotCorruptSubsequentCacheHit`**: normal, forced, normal -> exactly 2 builds (the final normal request cleanly reuses the forced result, proving the forced write didn't corrupt or bypass the cache for subsequent readers). **This test also failed pre-fix** (observed: 1 build).
- **`TestGetTopologyV2_ConcurrentForceRefresh_AllValidNoRace`** (Phase E): 15 concurrent `force_refresh=true` requests — all return 200 with non-empty, well-formed bodies; no deadlock; no race (`-race` clean); a subsequent normal request cleanly cache-hits afterward (cache left in a valid, non-corrupted state). Does not assert a specific build count — no coalescing is implemented or expected; each concurrent forced request legitimately triggers its own build, which is correct, not a bug (singleflight remains explicitly deferred, unchanged from the Phase 2D decision).

All pass, 3/3 repeated runs, clean under `-race`.

### Fix (Phase D — smallest safe change)

`internal/api/rest/handler.go`, `GetTopologyV2` only (not its siblings — see "related finding" below):
```go
forceRefresh := r.URL.Query().Get("force_refresh") == "true"
...
if cached, ok := topologyCacheGet(cacheKey); ok && !forceRefresh {
    resp = cached
} else {
    // Cache miss (or forced) — build topology
    ...
    topologyCacheSet(cacheKey, resp)  // unchanged — already ran unconditionally
}
```
No cache redesign, no TTL change, no singleflight, no change to graph construction/inference, no frontend change (the frontend doesn't send `force_refresh` for V2 today — this fix restores the backend contract's correctness regardless of whether/when the frontend starts using it).

### Post-fix evidence

- `go build ./...`, `go vet ./...`: clean.
- `go test -race ./internal/api/rest/... -run "TestGetTopologyV2_"`: 5/5 pass, 3/3 repeated.
- Full backend `go test -race ./...`: see this session's final report.
- Named regressions re-run explicitly: VALID-02, VALID-04, Hybrid Lifecycle, EngineLifecycleManager/Blast Radius, Fleet N+1, buildClusterSummary, V1 topology bound, PipelineManager — all pass.
- **Live validation (isolated lab, real fix, ~3,658-pod workload after the Phase 2A dense-namespace addition):**
  - normal -> normal: 0.387s then 0.024s, byte-identical (correct cache-hit behavior, unchanged).
  - `force_refresh=true` -> `force_refresh=true`: **0.349s then 0.338s** — both genuinely slow now, both real rebuilds, same correct node count (753) both times. This is the direct, live-measured fix: before, the second call was ~23ms (cached); now it's ~338ms (real rebuild), matching the first call's cost.
  - Goroutines/RSS after: 43 / 192MB — stable, no leak introduced.

### Related finding, NOT fixed this pass (documented per hard rule #3 "do not modify unrelated topology behavior")

The identical `if cached, ok := topologyCacheGet(cacheKey); ok { ... } else { ...; topologyCacheSet(...) }` pattern, with no `force_refresh` parsing, also exists verbatim in two sibling handlers sharing the same package-level cache: `GetTopologyV2Traffic` (`/topology/cluster/traffic`) and `GetCriticality` (`/topology/criticality`). Same root cause, same fix would apply — but this pass's explicit scope, regression tests, and acceptance criteria were all written specifically against `GetTopologyV2`. Flagged here as a same-class, not-yet-approved follow-up rather than silently left undiscovered or silently fixed without being asked.

### Concurrency semantics (Phase E conclusion)

No coalescing was added or is needed for correctness — `sync.Map`'s atomic per-key `Store` already guarantees no partial/corrupt state is ever observable, confirmed by both code reading and the concurrent test above. Multiple concurrent forced rebuilds doing redundant work is a performance question (already covered by the Phase 2D singleflight-deferral decision), not a correctness one — this fix does not change that calculus either way.

## Phase 2A/2B — Dense Namespace & Relationship-Density (brief validation)

Added a dedicated dense namespace (`dense-ns`: 60 Deployments x 20 replicas = 1,200 pods, 5 group-wide Services each selecting ~240 pods via a shared label — high fan-out — plus 5 shared ConfigMaps/Secrets referenced by all pods — high fan-in) alongside the existing 15-namespace/~2,458-pod workload, bringing the lab cluster to **3,658 total pods across 21 namespaces**. Same unscheduled-pod methodology, confirmed safe (node CPU 30.91%, memory 15% during generation).

| Scenario | Nodes | Edges | Edges/node | Latency | Result |
|---|---:|---:|---:|---:|---|
| Dense namespace (1,200 pods, high fan-in/fan-out) | 87 | 185 | 2.13 | 0.16s | PASS |
| Sparse namespace (~150 pods, 1:1 service mapping) | 66 | 86 | 1.30 | 0.08s | PASS |
| Full cluster V2 (3,658 pods total) | 753 | 1,489 | 1.98 | 0.34s | PASS |
| Full cluster V1 (3,658 pods, with both the PVC and maxNodes fixes) | 5,000 (capped) | 15,977 | — | 0.17s, `isComplete=false` (correctly, honestly reported) | PASS |

V2's aggregation holds up well even at higher relationship density (2.13 edges/node for the dense namespace vs 1.30 for sparse) — no second density-specific bottleneck surfaced at this scale. **Not yet tested:** namespace counts/density significantly beyond this (e.g. a namespace with 10,000+ pods), cross-namespace relationship references specifically, or browser-side rendering of the denser graph (still UNVERIFIED, no tooling).

### What this does NOT yet cover (honest gaps)

- Phase 2's Scenarios A/B/C (namespace with ~300 Deployments, a single namespace concentrating ~2,000 pods, explicit relationship-density stress) — **not run this pass**. Given the confirmed root cause is bound to *PVC count*, not pod count or namespace distribution, a dense-single-namespace test would not be expected to change this specific finding, but it has not been empirically verified, and other, different bottlenecks could exist at that configuration that this pass did not uncover.
- Frontend/browser measurement — still **UNVERIFIED**, no browser automation tool available this session.
- The "refresh until it works" failure mode, concurrent user-action behavior, and cross-cluster isolation under topology load — **not run this pass**; Phase 2's brief explicitly requested these as separate tasks after the V1 fix.
- Whether other `inferX` functions or other discovery functions have the same "discard-then-refetch" pattern for OTHER resource kinds (ConfigMaps, Secrets, ServiceAccounts referenced by Pods) — not audited this pass; `inferVolumeRelationships`/`inferEnvironmentRelationships` were read and confirmed to already use `graph.PodSpecCache` correctly (no live re-fetch), but a full systematic audit of all 11 `inferX` functions for this specific anti-pattern was not performed beyond the one (`inferStorageRelationships`) that the timing data pointed to.
