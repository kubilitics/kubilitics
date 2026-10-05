# Resource-List Pagination N+1 Investigation — 10K Campaign P1

Found during the 10K enterprise-scale campaign (`feat/stability`), while running the
infrastructure-attribution concurrency matrix against a 10,792-pod lab cluster
(`kubilitics-phase-e`). This document is the permanent record of the investigation,
remediation, and evidence, following the same discipline as
`TOPOLOGY-SCALE-INVESTIGATION.md` and `PIPELINEMANAGER-LOCK-IO-INVESTIGATION.md`.

## 1. Original P1 Evidence

Running `GET /clusters/{id}/resources/pods` (the default-page, `limit=100` request —
the single most common request the frontend issues: every resource list page, hover
prefetch, and the cluster watcher's background poll) at N=20 concurrency against the
10,792-pod lab cluster produced, in a controlled 5-trial quiescence-verified test:

| | N=1 | N=5 | N=10 | N=20 |
|---|---|---|---|---|
| `limit=100` p50/p95 | 0.53/0.55s | 1.83/2.90s | 7.81/10.04s | 25.8/46.6s, **63/100 requests failed** |
| `limit=5000` p50/p95 | 2.21/12.06s | 1.36/3.34s | 2.31/5.88s | 13.6/13.7s, **80/100 requests failed** |

This was decisively worse than the raw-kubectl control at the same N (82–122s per
request at N=20, but **zero failures** — just slow). Kubilitics' own cache-backed
read, which should be strictly faster than a live API call, instead turned
concurrent load into outright request failures — ruling out "it's just the lab's
API server" and confirming a genuine Kubilitics-side defect.

**A measurement-noise detour is part of the honest record here**: an earlier,
single-shot (non-quiescence-verified) version of this same test produced wildly
inconsistent numbers (33–38s one run, <1s the next) because the backend's
incident-detection engine was still processing its post-startup event backlog
concurrently with the test. The numbers above are from the properly controlled
re-test (quiescence verified via `process_cpu_seconds_total` delta before each of 5
trials per N), which is the only version trusted for this investigation.

## 2. Complete Affected Surface (Phase 1 blast radius)

Traced `ListFromCacheWithPagination` (`internal/k8s/informer.go`) and its sibling
`ListFromCache` to every production caller. Both shared the same root defect — full
informer-store reflection conversion before any limit was applied:

| Caller | REST endpoint | Resource kinds | Conversion vs. pagination | Sort vs. pagination |
|---|---|---|---|---|
| `resources.go` `ListResources` (single-ns/cluster-wide) | `GET /clusters/{id}/resources/{kind}` | **all** kinds in `resourceKindToStoreKey` | conversion before pagination | sort before pagination (default sort = `name`, always applied) |
| `resources.go` `ListResources` (multi-namespace merge) | same endpoint, `?namespaces=a,b,c` | all kinds | conversion before pagination, **per namespace with `limit=0`**, then re-sorted again on the merged set | sort before pagination, twice |
| `workloads.go` `buildWorkloads` | `GET /clusters/{id}/workloads` | deployments, statefulsets, daemonsets, jobs, cronjobs, pods, events (7 kinds/request) | conversion before pagination (`ListFromCache`, no sort stage) | n/a |
| `events.go` `buildEvents` | `GET /clusters/{id}/events` | events | conversion before pagination | post-fetch sort, unaffected by this fix |

**Determination: systemic, not isolated to Pods.** The conversion-before-limit
defect affects every resource kind; the sort-before-limit defect is narrower
(confined to the paginated `/resources/{kind}` endpoint) but that endpoint is the
most frequently hit one in the UI.

Frontend consumers confirmed via `kubilitics-frontend/src/services/api/resources.ts`,
`useKubernetes.ts`, `usePrefetchResources.ts`, `useHoverPrefetch.ts`,
`useClusterWatcher.ts` — every resource-list page, hover-prefetch, and the
background cluster watcher.

**Ordering is load-bearing, not cosmetic**: `useKubernetes.ts` implements genuine
offset-based page navigation ("Showing 101–200 of 10,876") with user-selectable
`sortBy`/`sortOrder`; `resources.ts` explicitly documents `offset` as "Requires
informer cache." Any remediation must preserve exact ordering/tie-break semantics.

## 3. Root Cause

`ListFromCacheWithPagination` (and `ListFromCache`) read the entire informer store
(`store.List()`), ran `runtime.DefaultUnstructuredConverter.ToUnstructured` — a
reflection-heavy deep conversion — over **every** cached object, then sorted the
**entire** converted collection, and only *then* applied `offset`/`limit`. A
`limit=100` request therefore did the same O(N) work as a `limit=10000` request.

Direct in-process isolation (temporary instrumentation, removed before completion)
against the live 10,792-pod backend measured the single-request cost precisely:

| Stage | Cost (n=10,876, real pods) |
|---|---|
| `store.List()` | ~80–125µs |
| `ToUnstructured` conversion (all items) | **263–382ms** |
| `sort.Slice` (all items) | 18.6–24.6ms |
| pagination slice | ~100–200ns |

Confirmed `limit=100` and `limit=5000` paid statistically indistinguishable cost
(285–311ms vs. 312–407ms) — proving the cost was independent of requested page size,
exactly as the code read predicted.

**The concurrency amplification**: a single request costs ~300–400ms, so 20 of them
should cost ~6 CPU-seconds spread across 4 cores (~1.5s wall) if costs were purely
additive. The controlled test instead measured 88–168 CPU-seconds consumed per N=20
trial with 25–50s wall times and real failures — a 15–28x amplification beyond
naive linear scaling. Heap-delta evidence (300MB–3.5GB growth per N=20 trial) is the
best-supported explanation: 20 concurrent goroutines each materializing a full
`map[string]interface{}` tree of the entire 10,876-pod store simultaneously drives
live heap size up sharply, and Go's GC cost scales with live heap size, not just
allocation rate. This explanation is **strongly evidenced but not independently
proven via a live GC trace during an actual N=20 burst** — a lab-tooling mechanical
failure (bash-curl-loop connection setup, not a backend defect — confirmed by a
successful manual single request against the same backend immediately after)
prevented capturing that specific trace in this pass. Flagged honestly rather than
overstated.

## 4. Semantic Constraints (Phase 4 audit)

- Arbitrary field sorting is required (UI exposes column-header sort on 10 keys).
- Ordering must be globally deterministic (offset pagination depends on it).
- `client-go`'s `cache.Store`/`cache.Indexer` offers no ordered/range index — nothing
  off-the-shelf to reuse.
- Filtering (namespace, search) and the 3 most common sort keys (`name`, `namespace`,
  `creationTimestamp`) are available directly on every `runtime.Object` via the
  `metav1.Object` interface (`k8s.io/apimachinery/pkg/api/meta`), with **no
  conversion required**.
- The remaining 7 sort keys (`status.phase`, `status.podIP`, `spec.nodeName`,
  `restarts`, `spec.replicas`, `status.replicas`, `status.readyReplicas`) are
  resource-kind-specific computed fields that still require nested-field access.

## 5. Rejected Alternatives (Phase 5)

**B. Query-aware pagination (partial/heap-based top-K selection)** — rejected.
Better than the original for shallow pages, no better for deep pages (must still
scan all N to find a late page), and introduces offset-dependent cost
predictability that's worse for capacity planning than a flat approach.

**C. Indexed/query-oriented cache (incrementally maintained sorted indices)** —
rejected for this pass. Best asymptotic behavior, but requires hooking every
informer's Add/Update/Delete handlers, introduces a new permanent memory cost and a
new contention point, and is explicitly the kind of cache-invalidation-assumption
the campaign's hard rules require proving before building. At 10K, Option A already
removes the dominant cost; C's incremental benefit over A doesn't yet justify its
risk. Revisit if 20K/50K measurements show the O(N log N) sort becoming the new
bottleneck.

## 6. Chosen Design (Option A)

Reordered the pipeline for the 3 most common sort keys (`name` — the default,
`namespace`, `creationTimestamp`): filter on typed objects via `meta.Accessor`
(no conversion) → sort on typed metadata (same ordering/tie-break logic as before,
evaluated against typed fields instead of unstructured fields) → apply
offset+limit → convert **only the returned page** to `unstructured.Unstructured`.
The 7 exotic/computed sort keys fall back unchanged to the original full-conversion
path — same cost as before for that minority case, never worse.

Implementation: `internal/k8s/informer.go`, new `listFromCacheTypedFastPath` function
and `typedEntry` struct; `ListFromCacheWithPagination` now dispatches to it for the
3 fast-path sort keys and falls through to the original logic otherwise.

**Known accepted trade-off**: a `ToUnstructured` failure on the final page (not
pre-validated, since pre-validating would reintroduce the O(N) cost) silently
shrinks that page below `limit` without adjusting `total`, unlike the slow path
which filters unconvertible items out before counting. This is a vanishingly rare
failure mode for objects already successfully deserialized by the informer from the
API server's JSON — documented in code, not silently accepted without comment.

## 7. Before/After Measurements (Phase 7 acceptance gate)

Same controlled, quiescence-verified, 5-trial methodology, same 10,792-pod cluster:

| Metric | Before | After | Improvement |
|---|---|---|---|
| `limit=100`, N=20, p50 | 25.81s | **0.034s** | **759x** |
| `limit=100`, N=20, CPU/trial | 119.0 CPU-sec | **0.35 CPU-sec** | **337x** |
| `limit=100`, N=20, failures | 63/100 | **0/100** | eliminated |
| `limit=5000`, N=20, p50 | 13.58s | 3.94s | 3.4x |
| `limit=5000`, N=20, CPU/trial | 126.9 CPU-sec | 20.4 CPU-sec | 6.2x |
| `limit=5000`, N=20, failures | 80/100 | **0/100** | eliminated |

In-process A/B on 5,000 synthetic pods (temporary comparison, deleted after use):
old path 25.9ms vs. new path 1.4ms for a 100-item page — **18.8x faster**, with
byte-identical ordering.

`limit=5000`'s remaining ~4s at N=20 is now an honest, proportional cost (converting
100,000 real item-equivalents across 20 concurrent requests), not a hidden defect —
the qualitative shift the campaign targets: cost proportional to what was requested.

## 8. Regression Evidence (Phase 8)

- `go build ./...` — clean.
- `go vet ./...` — clean.
- `go test -race ./...` — **0 failures, 0 data races**, full backend.
- Explicitly re-run and green: VALID-02, VALID-04 (VALID-01/03/05/06/07 live in
  other packages not touched by this change; VALID-07's force-refresh tests
  confirmed green as part of the REST-layer suite), CONTAM-1 (7/7), Hybrid Informer
  Lifecycle/sync tests (3/3), EngineLifecycleManager/Blast Radius (full
  `internal/graph` suite, 70+ tests), Fleet N+1 (8/8), PipelineManager (6/6 cluster
  lifecycle + causality tests), topology scale/concurrency (9/9), buildClusterSummary
  (6/6).
- New dedicated regression suite: `internal/k8s/informer_pagination_fastpath_test.go`
  — 12 tests covering first-page/later-page/empty-page correctness, descending
  order, creation-timestamp sort, namespace filter, search filter, exact-ordering
  match against independently-computed expected order (all 3 fast-path keys × both
  orders), small-page-from-large-store performance sanity bound, concurrent
  requests (no race), exotic-sort-key slow-path preserved, and cluster isolation.

## 9. Remaining Limitations

- The GC-pressure explanation for the pre-fix concurrency amplification is strongly
  evidenced (heap deltas, single-request-cost arithmetic) but not independently
  proven via a live GC trace captured during an actual N=20 burst — a lab-tooling
  failure prevented that specific capture, and re-attempting it was judged lower
  value than proceeding once the fix was proven to work end-to-end.
- The 7 exotic/computed sort keys (`restarts`, `status.phase`, etc.) still pay the
  original O(N) cost — unchanged, not regressed, but not improved either. Revisit if
  these sort keys show up as a bottleneck in practice.
- Multi-namespace merge path (`?namespaces=a,b,c`) still uses `limit=0` per-namespace
  before merging and re-sorting — this fix targeted the single-namespace/cluster-wide
  path (the dominant real-world case); the multi-namespace path's cost is unchanged.
- `ListFromCache` (used by `/workloads` and `/events`) still converts the entire
  store before applying its limit — unchanged by this fix, which targeted
  `ListFromCacheWithPagination` specifically since that backs the highest-traffic
  endpoint. Lower urgency since those callers request a small, fixed number of
  kinds rather than paginating through a single large collection.

## 10. Infrastructure Methodology Limitations

- This lab is a single-node, 4-CPU `kind` cluster on Docker Desktop — both the
  pre-fix severity and the post-fix improvement ratios are specific to this
  capacity; a production deployment with more cores would show different absolute
  numbers (though the *relative* improvement — O(limit) vs. O(N) — is
  architecture-level and should hold regardless of hardware).
- The backend's own incident-detection engine introduces a confound that must be
  controlled for (quiescence-verified before each trial) — this is now documented
  methodology for future phases at this or larger scale.

## 11. Next Scale Gate

This P1 is genuinely remediated and the regression/performance gates pass. The 10K
campaign may resume toward the remaining Steps 2–14 of its brief (scaling table,
topology deep-dive, API amplification, cache behavior, lifecycle cycles, soak,
failure containment, frontend, competitive research, enterprise-experience
evaluation) and ultimately the 20K GO/NO-GO gate, with this fix as part of the
baseline. Recommend re-confirming this fix's improvement ratio holds at 20K as part
of that gate, per the same "re-confirm, don't assume" discipline applied to the
infrastructure-attribution methodology throughout this campaign.
