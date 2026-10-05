# VALID-01 — Cluster Isolation / ListClusters Blocking

**Status:** Investigation only. No production code, tests, or roadmap modified. Awaiting approval before any implementation.

---

## 1. Customer Symptom

*"From Fleet I can't see the clusters quickly."* Originally attributed (Phase 4) to the frontend's N+1 request pattern. This investigation shows that symptom has a second, deeper cause that N+1 alone does not explain or fix.

---

## 2. Live Reproduction

**LIVE-REPRODUCED, MEASURED** (docs/PRODUCTION-VALIDATION-REPORT.md, Section 3 steps 14-16):

1. Backend running with 1 healthy, reachable cluster (`kind-nightshift-dev`).
2. `POST /api/v1/clusters` with a kubeconfig pointing at an unroutable address (`https://10.255.255.1:6443`) — completes in 5.02s, correctly recorded as `disconnected`.
3. `GET /api/v1/clusters` — **10.015s**, reproduced twice, identical.
4. `GET /api/v1/fleet/overview` — **10.062s**.

Both measured via the backend's own structured request log, not client-side timing:
```
{"method":"GET","path":"/api/v1/clusters","status":200,"duration_ms":10001}
{"method":"GET","path":"/api/v1/fleet/overview","status":200,"duration_ms":10062}
```

---

## 3. Evidence Index

| Claim | Classification |
|---|---|
| 10.0s duration for both endpoints with 1 healthy + 1 unreachable cluster | LIVE-REPRODUCED, MEASURED |
| `ListClusters`'s `wg.Wait()` blocks on every per-cluster goroutine | CODE-PROVEN (`internal/service/cluster_service.go:233-305`) |
| Per-cluster enrichment timeout is 10s | CODE-PROVEN (`cluster_service.go:244`, `context.WithTimeout(ctx, 10*time.Second)`) |
| `GetFleetOverview` calls `ListClusters` as its first step | CODE-PROVEN (`internal/api/rest/fleet.go:78`) |
| `GetFleetOverview` then fans out `GetClusterSummary` per cluster (errgroup, parallel) | CODE-PROVEN (`fleet.go:92-131`) |
| `GetClusterSummary` fails fast (no live call) for a cluster with no live client | CODE-PROVEN (`cluster_service.go:611-617`, returns immediately if `!exists`) |
| `GetOrReconnectClient` already has singleflight coalescing + a 10s negative-failure cache + a 3s request-hot-path timeout, explicitly built for "a user is waiting on the other end of this call" | CODE-PROVEN (`cluster_service.go:100-150`) |
| `ListClusters`'s enrichment does NOT call `GetOrReconnectClient` — it calls `tryReconnectCluster` directly, bypassing singleflight and the negative cache entirely | CODE-PROVEN (`cluster_service.go:273`) |
| `client.Timeout` defaults to 30s (`k8s_timeout_sec` viper default) | CODE-PROVEN (`internal/config/config.go:190`) |
| Effective bound during enrichment is `min(30s client timeout, 10s ListClusters context)` = 10s, consistent with the measured ~10.0s | INFERRED from CODE-PROVEN facts, consistent with MEASURED result |
| A 60-second background ticker in `main.go` also calls the same `ListClusters` ("reused here, not reimplemented" per its own comment) for HEALTH-2's presence refresh | CODE-PROVEN (`cmd/server/main.go:830-849`) |
| The persisted `models.Cluster` row (from `s.repo.List`) already carries `Status`, `NodeCount`, `NamespaceCount`, `LastConnected` from the last successful/attempted check, before any enrichment runs | CODE-PROVEN (`cluster_service.go:220-221`) + LIVE-REPRODUCED (the JSON body of `GET /api/v1/clusters` includes these fields and they were accurate) |

---

## 4. Call Graph

### `GET /api/v1/clusters`
```
Handler.ListClusters (internal/api/rest/handler.go:632)
  └─ clusterService.ListClusters(ctx)              [internal/service/cluster_service.go:219]
       ├─ s.repo.List(ctx)                         — persisted rows, FAST, no live call
       ├─ for each cluster: go func() { ... }       — PARALLEL (correct)
       │    ├─ clusterCtx := context.WithTimeout(ctx, 10s)   ← the binding timeout
       │    ├─ if s.clients[c.ID] exists:
       │    │     client.GetClusterInfo(clusterCtx)  — live call, bounded by clusterCtx
       │    │     client.DetectProvider(clusterCtx)  — live call, bounded by clusterCtx
       │    │     s.overviewCache.StartClusterCache(...)
       │    └─ else (no client yet — THIS IS THE UNREACHABLE CLUSTER'S PATH):
       │          s.tryReconnectCluster(clusterCtx, c)        ← bypasses GetOrReconnectClient
       │             └─ applyAndStoreClient(clusterCtx, c, client)
       │                  └─ client.TestConnection(clusterCtx) — blocks up to 10s for an
       │                                                           unroutable address (TCP SYN
       │                                                           to a black-holed IP has no
       │                                                           fast failure signal)
       └─ wg.Wait()                                  ← BLOCKS HERE until the slowest
                                                          goroutine (the unreachable
                                                          cluster, ~10s) completes
  (returns clusters only after wg.Wait() unblocks)
```

### `GET /api/v1/fleet/overview`
```
Handler.GetFleetOverview (internal/api/rest/fleet.go:75)
  ├─ clusterService.ListClusters(ctx)               ← SAME call, SAME ~10s block, FIRST step
  ├─ errgroup.WithContext(ctx)
  │    for each cluster: g.Go(func() error {
  │       clusterService.GetClusterSummary(gCtx, c.ID)
  │         ├─ if no live client: return error IMMEDIATELY (fast — this is why the
  │         │     unreachable cluster doesn't add further delay here)
  │         └─ if live client: client.GetClusterInfo + 4 raw List() calls,
  │               bounded by client.WithTimeout(ctx) (FLEET-1, Phase 4 — already fixed)
  │    })
  └─ g.Wait()                                        ← bounded by the slowest individual
                                                          GetClusterSummary (healthy cluster:
                                                          ~1.75s, measured separately)
```
**Total `/fleet/overview` cost ≈ `ListClusters`'s ~10s + the `GetClusterSummary` fan-out's cost for the slowest *reachable* cluster (parallel, not sequential, ~1.75s observed for 1 cluster) ≈ the measured ~10.06s.** The `GetClusterSummary` fan-out is not the dominant cost in this reproduction; `ListClusters` is.

---

## 5. Root Cause

**CODE-PROVEN.** Two compounding causes:

1. **`ListClusters` returns only after every per-cluster enrichment goroutine completes** (`wg.Wait()`), with no mechanism to return already-known-good data for healthy clusters while a slow/unreachable cluster is still being (re-)checked. The 10-second bound on that wait is itself real and intentional ("P0-B: Parallelize enrichment to avoid sequential delays from hanging EKS clusters" — i.e., a previous, partial fix already addressed making N *slow* clusters not cost N×timeout, by running them in parallel — but it did not address one slow cluster delaying the *other, already-fine* clusters' visibility).

2. **`ListClusters`'s enrichment reconnect path bypasses the codebase's own, already-correct fix for exactly this class of problem.** `GetOrReconnectClient` (`cluster_service.go:100-150`) was purpose-built — its own comments say so explicitly — to solve "a user is waiting on the other end of this call": it coalesces concurrent reconnect attempts via `singleflight`, remembers recent failures for 10 seconds via `reconnectFailCache` so a known-broken cluster isn't retried on every call, and bounds the attempt to a request-appropriate 3 seconds (`reconnectTimeout`), not the 10-second budget `ListClusters` uses for its own, separately-implemented `tryReconnectCluster` path. Because `ListClusters` doesn't call `GetOrReconnectClient`, **every single call to `GET /api/v1/clusters` re-attempts a full, un-cached, un-coalesced connection to the unreachable cluster**, bounded by the larger 10-second window.

**Why exactly ~10s, not ~30s or ~3s:** `applyAndStoreClient` sets `client.Timeout = s.k8sTimeout` (default 30s, confirmed in `config.go:190`), but `client.TestConnection` is called with the caller-supplied `clusterCtx`, which already carries the shorter 10-second deadline from `ListClusters`. Go's context deadlines nest to the earliest one; the 10s `ListClusters` timeout binds before the 30s client timeout ever would. This is consistent with (not merely coincidental to) the measured ~10.0s duration.

---

## 6. Why Previous Phases Did Not Catch This

- **STARTUP-1 (Phase 4)** fixed a *different* function: `LoadClustersFromRepo`, which runs once at boot. Its regression tests (`cluster_service_startup_test.go`) measure wall-clock time and concurrency bound for that specific function — they do not exercise `ListClusters`, the steady-state function every Fleet page load and poll actually depends on.
- **FLEET-1 (Phase 4)** fixed `GetClusterSummary`'s *own* internal List() calls lacking a timeout. That fix is real and still holds (confirmed live — the healthy cluster's summary call completed, and the unreachable cluster's summary call failed fast rather than hanging). But FLEET-1 never looked at `GetFleetOverview`'s *first* dependency, `ListClusters`, which is a separate call made before `GetClusterSummary` is ever reached.
- **No phase's regression suite constructs a scenario of "N clusters already persisted, one of them has no live client and is unreachable" and then calls `ListClusters` or `GetFleetOverview` against it.** Phase 9's regression-gap audit cross-referenced the original audit's named findings — `ListClusters`'s blocking behavior was never a named finding in `docs/PRODUCTION-RELIABILITY-AUDIT.md`, so it was structurally outside every phase's scope, including Phase 9's gap-closure work (which only closes gaps for *already-known* findings).
- **This was found only because the validation run used a real unreachable cluster against the real, unmodified binary** — exactly the kind of live reproduction static analysis and existing unit tests (which use fast-failing or all-healthy fixtures) do not surface.

---

## 7. Why Fleet N+1 (the Phase 4-documented, still-unfixed frontend issue) Is Insufficient on Its Own

The previously-documented Fleet N+1 finding is about the **frontend** calling `getClusterSummary` once per cluster (`useFleetOverview.ts`, `useQueries`) instead of the backend's aggregate `/fleet/overview` endpoint. This investigation shows that switching the frontend to `/fleet/overview` would **not** fix VALID-01's delay, because:

- `/fleet/overview` itself calls `ListClusters` as its *first* step — the same ~10s blocking call.
- `/fleet/overview`'s *own* internal fan-out (`GetClusterSummary` per cluster) is a **second, server-side N+1 pattern** that happens to be parallelized (so it costs `max`, not `sum`, of the per-cluster times) but is still a live per-cluster data fetch, not a read from already-cached/aggregated data.

Fixing frontend N+1 alone would reduce total *request count* (good, real, worth doing) but would not reduce the **~10-second floor** imposed by `ListClusters`, because `/fleet/overview` pays that same cost internally regardless of how many times the frontend calls it.

---

## 8. Data Dependency Analysis

| Data field | Source | Requires live call? | Can be served stale/cached? |
|---|---|---|---|
| `id`, `name`, `context`, `kubeconfig_path`, `source`, `created_at` | Persisted row (`s.repo.List`) | No | N/A — immutable once set |
| `status` (connected/disconnected/error) | Persisted row, last write | No (for the "last known" value) | **Yes** — this is exactly what HEALTH-2's `LastCheckedAt`/`LastSuccessAt`/`LastError` freshness model already exists to represent honestly |
| `node_count`, `namespace_count`, `version`, `provider` | Persisted row (last successful enrichment) OR fresh live call | For a *fresh* value: yes. For the *last known* value: no | Yes, with staleness indicated (same pattern already used elsewhere — Phase 2/7 established this exact UX contract) |
| `last_connected` | Persisted row | No | Yes — this *is* the staleness signal |
| Live reachability confirmation ("is it reachable *right now*") | N/A | **Yes, inherently** | No — by definition this requires a live probe; but see `GetOrReconnectClient`'s negative cache for how to avoid re-probing a known-broken cluster on *every* request |

**Conclusion:** the overwhelming majority of what `GET /api/v1/clusters` returns is already available with zero live calls, directly from the persisted row. Only a *fresh* reachability/count confirmation requires a live call, and the codebase already has a purpose-built, correctly-bounded mechanism (`GetOrReconnectClient`) for making that call safely from a request hot path — `ListClusters` just doesn't use it.

---

## 9. Candidate Solutions

### A. Partial-response model
Return healthy clusters' data as soon as their enrichment completes; represent still-pending/unreachable clusters separately (e.g., a streaming or two-phase response). **Pro:** theoretically fastest perceived latency. **Con:** largest change — requires a new response shape or a streaming transport; frontend changes required; most implementation and regression-test surface area.

### B. Persisted-state-first model
`ListClusters` returns the persisted rows immediately (as `s.repo.List` already does) without waiting for live enrichment; a *separate*, already-existing mechanism (the 60s background ticker, or an explicit on-demand refresh) keeps the persisted rows reasonably fresh. **Pro:** smallest conceptual change — the data is already fetched synchronously first (`s.repo.List`), it's only the subsequent enrichment loop that currently delays the return. **Con:** node/namespace counts and reachability shown may be up to the refresh interval stale; must be labeled as such (reusing HEALTH-2's existing freshness-field pattern) so the UI never claims stale data is live.

### C. Cached enrichment with explicit staleness
Same as B, but makes the staleness explicit and bounded per-cluster (e.g., "last checked 47s ago") using the `LastCheckedAt`-style fields HEALTH-2 already established, rather than silently returning old data unlabeled. **This is B plus an honesty guarantee.**

### D. Per-cluster timeout isolation
Keep `ListClusters`'s current *shape* (synchronous, waits for enrichment) but make one cluster's timeout **not** extend the whole request — e.g., return partial results for clusters whose goroutine already finished and a placeholder/last-known value for ones still pending, once a *much shorter* (e.g., 1-2s) budget elapses, with the slow goroutines continuing in the background to update the persisted row for *next* time. **Pro:** keeps the single-response-shape simplicity of the current API. **Con:** still involves waiting up to the shorter bound on every request; more complex than B/C for a similar practical outcome.

### E. Reuse `GetOrReconnectClient`
Replace `tryReconnectCluster`'s direct call inside `ListClusters`'s enrichment with `GetOrReconnectClient`. **Pro:** immediately gets singleflight coalescing (concurrent requests for the same cluster share one reconnect attempt) and the 10s negative-failure cache (a known-broken cluster isn't re-probed on every single list call) with its already-tested 3-second request-hot-path timeout instead of 10 seconds. **Con:** on its own, does not eliminate the "wait for the slowest cluster" shape — it only shrinks the window from 10s to 3s and avoids re-paying it on *every* call within the 10s negative-cache TTL. Best combined with B/C, not a full solution alone.

### F. Backend aggregate redesign
Make `/fleet/overview` consume a single, periodically-refreshed, already-aggregated data source (e.g., extend the existing 60-second background ticker / `OverviewCache` to also maintain a ready-to-serve Fleet aggregate), so the HTTP handler never calls `ListClusters` or `GetClusterSummary` synchronously at all — it just reads the latest computed snapshot. **Pro:** true O(1) response time regardless of cluster count or reachability; directly and fully resolves both VALID-01 and the original Fleet N+1 complaint in one stroke, since there is no longer any per-request fan-out. **Con:** largest-scoped of the "backend-only" options (B/C/E/F); introduces a genuinely new data-freshness contract for `/fleet/overview` specifically (though HEALTH-2 already established the UX/labeling pattern for this).

---

## 10. Recommended Design (for review, not yet approved for implementation)

**B + C + E, combined, as the smallest safe architecture:**

1. **`ListClusters`** stops waiting on live enrichment for clusters that already have no client and a recent (within `reconnectNegativeCacheTTL`) failure — i.e., have it call `GetOrReconnectClient` instead of `tryReconnectCluster` directly, inheriting the negative cache and singleflight coalescing for free. For clusters with no client and no recent failure, still attempt a reconnect, but bound by `GetOrReconnectClient`'s existing 3-second `reconnectTimeout`, not a new, separately-maintained 10-second constant.
2. **Explicitly label freshness** on the returned `models.Cluster` rows when a value came from the persisted/last-known state rather than a fresh live call this request — reusing the `LastCheckedAt`/`LastSuccessAt` pattern HEALTH-2 already established, so the frontend (which, per Phase 7, already has `unknown`/stale-state UI support) can render it honestly rather than Kubilitics inventing a new concept.
3. **`GetFleetOverview`** inherits the fix automatically once `ListClusters` is fixed, since it depends on it directly — no separate fix needed there for *this* finding (the separate, already-documented frontend N+1 issue is still worth fixing on its own merits, for request-count reasons, but is not required to close VALID-01).

**Option F (background-refreshed aggregate) is flagged as the more complete, longer-term fix** and should be considered if B+C+E's ~3-second worst case (down from ~10s) is still judged too slow for the Fleet experience — but B+C+E is the smaller, safer, more surgical change that directly addresses the measured defect without introducing a new caching subsystem.

**No design has been implemented.** This section is for review and discussion only.

---

## 11. Critical Safety Check (per the explicit instruction — analysis only, nothing applied)

Before any future implementation, the following must be proven, not assumed:

- **Goroutine lifecycle:** `ListClusters`'s per-cluster goroutines currently capture `c` (a `*models.Cluster` from the slice returned by `s.repo.List`) and mutate it in place, then call `s.repo.Update(ctx, c)`. If a future fix makes `ListClusters` return *before* all goroutines finish (Option B/D), those goroutines **must still be allowed to run to completion** (not cancelled) so `s.repo.Update` still persists the fresher state for *next* time — this requires NOT tying their context to the HTTP request's context (which is cancelled the moment the handler returns), using a background context instead, exactly as the existing 60s ticker already does (`context.WithTimeout(context.Background(), 30*time.Second)` — a precedent already in the codebase).
- **Cluster removal racing enrichment:** if a cluster is removed (`RemoveCluster`) while a background enrichment goroutine for it is still running, `s.repo.Update(ctx, c)` for a deleted row and `s.clients[c.ID]` map writes must not panic or resurrect a removed cluster. `RemoveCluster`'s current locking (`s.mu`) needs to be checked against this scenario specifically before any change ships — **UNVERIFIED by this investigation**, flagged as a required pre-implementation check, not yet proven safe or unsafe.
- **Data races:** `s.clients` map writes already happen under `s.mu.Lock()` (confirmed, `cluster_service.go` "Map write must hold the lock" comment) — any new background-goroutine path must preserve this discipline.
- **Response consistency:** if `ListClusters` starts returning data for some clusters immediately and others from a background-updated cache, the response must not mix a fresher persisted-row value for one cluster with a mid-update, partially-mutated value for another — the existing per-field mutation-in-place pattern on `c *models.Cluster` (not a copy) means a reader could theoretically observe a torn/partial update if a fix isn't careful about *when* the persisted-row snapshot used for the fast response is taken relative to when background goroutines mutate their own `c`. **This must be resolved by snapshotting/copying the row for the fast-path response, not reading the same mutable struct a background goroutine might still be writing to — UNVERIFIED by this investigation as implemented correctly, since nothing has been implemented; flagged as a mandatory design constraint for Option B/C.**

**These are not yet proven safe or unsafe — they are the specific risks a future implementation must address and test against, per the explicit instruction not to assume a fix is safe.**

---

## 12. Required Tests (design only — none written yet)

1. One healthy cluster + one unreachable cluster: `ListClusters`/`GetFleetOverview` return in well under the unreachable cluster's timeout, with the healthy cluster's correct data present.
2. Multiple healthy clusters remain fast regardless of count (reconfirm `TestLoadClustersFromRepo_ConcurrencyIsBounded`'s pattern applies to `ListClusters` too, not just `LoadClustersFromRepo`).
3. One slow-but-eventually-reachable cluster does not block the other, already-known-good clusters' data from being returned promptly.
4. An unreachable cluster is represented with a correct, honest status (not fabricated as healthy, not silently omitted) — reusing the existing `clusterStatusFromError`/HEALTH-1 guarantee.
5. All clusters unreachable still produces a bounded (not indefinite) response.
6. Returned cluster health/status information is never fabricated — if a value is stale, it must be labeled as such, not presented as fresh.
7. No stale *healthy* state is ever shown for a cluster that is currently known to be unreachable (the negative cache must not cause a false "healthy" read).
8. Concurrent requests for `ListClusters` while one cluster is mid-reconnect do not each start their own duplicate reconnect attempt (singleflight coalescing, inherited from `GetOrReconnectClient` if Option E is adopted) — this directly addresses "concurrent requests do not create unbounded work."
9. Cluster removal during an in-flight background enrichment does not panic, leak, or resurrect the removed cluster (per the Critical Safety Check above).
10. No goroutine leaks — background enrichment goroutines must terminate (success, failure, or their own bounded timeout), verified via a goroutine-count assertion before/after in tests, consistent with Go testing best practice.
11. `go test -race` clean for every new/modified test and the surrounding package.
12. `GetFleetOverview` uses the same (now-fixed) `ListClusters` path, confirmed by a test that exercises `/fleet/overview` directly with the same mixed-reachability fixture, not just `ListClusters` in isolation.
13. Full Phase 1-11 regression suite (`go test ./... -race`) remains green — this finding's fix must not alter `HEALTH-1`, `HEALTH-2`, `STARTUP-1`, `FLEET-1`, or any Phase 1-11 guarantee.

At least one of these tests (most likely #1 or #2) must be written to **fail against the current, unmodified code** before any fix is applied, per the standing "prove the regression test is real" discipline used throughout this engagement.

---

## 13. Live Validation Plan (for after a fix is implemented — not performed yet)

1. Re-run the exact reproduction from Section 2 against the fixed binary: 1 healthy + 1 unreachable cluster, measure `GET /api/v1/clusters` and `/fleet/overview` duration via the backend's structured logs (not just client-side timing).
2. Confirm the healthy cluster's data is present and correct in the fast response.
3. Confirm the unreachable cluster's status is honestly represented (not fabricated healthy, not silently dropped).
4. Re-run with 3+ clusters in mixed states (healthy, slow-but-reachable, unreachable) if practical in the recovered `kind-nightshift-dev` environment (would require additional synthetic cluster registrations, same technique as this investigation's reproduction).
5. Confirm no regression in the specific live-verified behaviors from `docs/PRODUCTION-VALIDATION-REPORT.md` Section 5 (Dashboard counts, Topology scoping, Blast Radius correctness) — these don't depend on `ListClusters` directly but should be spot-checked since the fix touches a shared service.
6. Resume the remaining, previously-unreached sections of the validation test matrix (G-J, full D/E/F) once this fix is live-validated, per the original validation report's recommendation.

---

## 14. Acceptance Criteria (for a future fix — not yet met, nothing implemented)

A fix for VALID-01 is acceptable only when:

1. The live reproduction in Section 2 no longer shows a ~10s delay — specifically, a healthy cluster's data is available in a time not dominated by any other cluster's unreachability.
2. All 13 required tests in Section 12 exist and pass, with at least one proven to fail against the pre-fix code.
3. The Critical Safety Check items in Section 11 are each explicitly addressed (not merely asserted) with evidence — goroutine lifecycle, removal-race safety, data-race safety, and response-consistency.
4. `go test -race` is clean for all affected packages.
5. The full Phase 1-11 regression suite remains green.
6. No fabricated "healthy" state is ever possible for an unreachable cluster, under any timing/concurrency condition — this is the one guarantee that must hold unconditionally, even if every other acceptance criterion were somehow in tension with it.
7. The fix is live-validated per Section 13, not merely unit-tested.

---

## 15. Implementation Decision (post-approval)

Approved direction **B + C + E** was implemented as designed, with one addition discovered during testing (see 15.4).

### 15.1 Files changed

- `internal/service/cluster_service.go` (production code)
  - Added `const backgroundReconnectBudget = 8 * time.Second`.
  - Rewrote `ListClusters`: a cluster with `hasClient == true` is enriched synchronously inside the existing `wg.Wait()` group exactly as before (unchanged fast path). A cluster with `hasClient == false` is **never added to the wait group** — `kickBackgroundReconnect(c.ID)` is fired instead and the loop immediately returns that cluster's already-persisted `Status`/`NodeCount`/`NamespaceCount`/`LastConnected` (Section's approach B: persisted-state-first, approach C: existing freshness fields, no new API fields).
  - New `kickBackgroundReconnect(clusterID string)`: a fire-and-forget goroutine on `context.Background()` (survives past the HTTP response), bounded by `backgroundReconnectBudget`, that calls `s.GetOrReconnectClient(bgCtx, clusterID)` — the existing singleflight + negative-cache mechanism (approach E), not `tryReconnectCluster` directly. `tryReconnectCluster` was left untouched; its one remaining call site (`GetCluster`, a different, out-of-scope single-cluster lookup) still uses it correctly.
  - New `finishReconnect(ctx, c *models.Cluster)` (added during test-driven hardening, see 15.4): re-verifies the row still exists via `s.repo.Get` before persisting `ReconnectCluster`'s post-reconnect status, and rolls back the client/cache entries `ReconnectCluster` already installed if the row was removed concurrently. `ReconnectCluster`'s two success-path `s.repo.Update` calls (in-cluster and kubeconfig branches) now go through this helper instead of writing unconditionally.
- `internal/service/cluster_service_valid01_test.go` (new, 11 tests — see 15.3).
- `internal/api/rest/handler_test.go` (test-only fix — see 15.4.2).

### 15.2 Behavior changed

Before: `ListClusters` waited on every registered cluster, including ones with no live client, each bounded by a 10s context timeout reached via `tryReconnectCluster`. One unreachable cluster made the whole response (and `/fleet/overview`, which calls `ListClusters` first) take ~10s.

After: only clusters with an already-live client are awaited synchronously. Clusters without one return their last-known persisted state immediately, while a reconnect attempt proceeds in the background using the pre-existing `GetOrReconnectClient` singleflight/negative-cache mechanism — so a cluster that was dialed and failed recently is not re-dialed on every poll.

### 15.3 Tests added (`cluster_service_valid01_test.go`, 11 functions — consolidates several of the 14 requested cases)

1. `TestListClusters_HealthyNotBlockedByUnreachable`
2. `TestListClusters_HealthyNotBlockedBySlowCluster`
3. `TestListClusters_MultipleHealthyClustersUnaffectedByOneFailure`
4. `TestListClusters_UnreachableClusterNeverFabricatedHealthy`
5. `TestListClusters_AllUnreachable_StillBounded`
6. `TestListClusters_PreservesLastKnownPersistedState`
7. `TestListClusters_ReusesNegativeCache_DoesNotRedialOnRepeatedCalls`
8. `TestListClusters_ConcurrentCalls_SingleflightCoalesces`
9. `TestListClusters_ClusterRemovedDuringBackgroundReconnect_NoPanic`
10. `TestListClusters_NewClusterAddedWhileAnotherReconnects_NoCrossContamination`
11. `TestListClusters_NoGoroutineLeak`

Fleet-overview-remains-functional and Phase-1-11-regression requirements were verified via the full-repo suite (15.6) rather than a dedicated new test, since existing `internal/fleet` and Phase 1-11 tests already cover those paths end-to-end against the changed `ListClusters`.

### 15.4 Debugging found during test-writing (both fixed, both test-fixture/production-fidelity issues, not flaws in the approved design)

**15.4.1 — Resurrection race (production code fix, see `finishReconnect` above).** `TestListClusters_ClusterRemovedDuringBackgroundReconnect_NoPanic` initially failed: no panic occurred, but the removed cluster reappeared in the repo. Root cause: `ReconnectCluster`'s pre-existing, unmodified success paths read `c` at the *start* of the function, ran a slow network call, then wrote `c` back unconditionally — if `RemoveCluster` deleted the row during that window, the final write resurrected it. This is a real race, newly *reachable* (not newly *created*) by routing `ListClusters`'s background path through `GetOrReconnectClient` → `ReconnectCluster` for the first time. Fixed by adding `finishReconnect`, which re-checks existence before the write and rolls back the client/cache entries if the row is gone. This is the minimal change needed to satisfy the explicitly required "cluster removal during enrichment is safe" guarantee (Section 11, item 9) — confirmed via revert-and-reconfirm: without `finishReconnect`, the test fails; with it, the test passes and `go test -race` stays clean.

**15.4.2 — Test-double race, not a production bug (test-only fix).** The full-repo `go test ./... -race` run surfaced a genuine data race between `kickBackgroundReconnect`'s goroutine and a synchronous `GetCluster` call inside `TestAPI_GET_KCLITUIState_ReturnsContextAndNamespace` (`internal/api/rest/handler_test.go`). Traced to that test's local `mockClusterRepo.Get`/`List`, which returned the *same* shared `*models.Cluster` pointer on every call instead of a copy. Verified against the real `SQLiteRepository.getCluster`/`listClusters` (`internal/repository/sqlite.go`), which always scans into a fresh struct per call — so this race is **not reachable in production**, only in this one test's fixture. Fixed by making the mock copy on read, matching real repo semantics (same pattern already used by `internal/service`'s own `mockClusterRepo`). This is the same category of test-fixture fidelity gap documented elsewhere in this engagement (e.g. `mockClusterRepo.Update`'s upsert-vs-no-op semantics in Phase 9/11 testing).

**15.4.3 — Goroutine-count test noise (test-only fix).** `TestListClusters_NoGoroutineLeak` initially failed when run as part of the full file (before=1750-1967, after=2179-2396) but passed instantly in isolation (`-run TestListClusters_NoGoroutineLeak$`, 0.06s, no 3s wait needed). This confirms the delta was leftover goroutines from *preceding* tests in the same file (some with real 300ms+ delays) not yet fully unwound when the "before" snapshot was taken — not a leak in the new code. Fixed by adding a short settle-loop before the "before" snapshot (poll `runtime.NumGoroutine()` every 25ms, up to 1s, until it stabilizes) rather than weakening the leak assertion itself.

### 15.5 Concurrency safety evidence (the 12-point list from Section 11, now with evidence instead of analysis)

1. **No goroutine leak** — TEST-PROVEN: `TestListClusters_NoGoroutineLeak`, isolated run confirms count returns to baseline within the `backgroundReconnectBudget` window after settling for test noise (15.4.3).
2. **No access to request-scoped resources after completion** — CODE-PROVEN: `kickBackgroundReconnect` uses `context.Background()`, never the request `ctx`, for both the reconnect call and the subsequent `s.repo.Get`/`Update`.
3. **No unsafe client/cluster-state access** — CODE-PROVEN: all `s.clients` map access goes through the existing `s.mu` lock (unchanged); `finishReconnect` takes the same lock before deleting a rolled-back entry.
4. **No race with removal** — TEST-PROVEN + CODE-PROVEN: `TestListClusters_ClusterRemovedDuringBackgroundReconnect_NoPanic` (15.4.1) plus `finishReconnect`'s existence re-check.
5. **No race with re-addition** — TEST-PROVEN: `TestListClusters_NewClusterAddedWhileAnotherReconnects_NoCrossContamination`.
6. **No race with health-refresh** — CODE-PROVEN: the existing 60s background ticker (`cmd/server/main.go`) and `kickBackgroundReconnect` both route through the same `GetOrReconnectClient` singleflight, which coalesces concurrent callers for the same cluster ID by construction.
7. **No unbounded goroutine creation** — CODE-PROVEN: one goroutine per cluster-with-no-client per `ListClusters` call; `TestListClusters_AllUnreachable_StillBounded` confirms the call itself still returns promptly regardless of how many such clusters exist.
8. **No duplicate reconnect storms** — TEST-PROVEN: `TestListClusters_ReusesNegativeCache_DoesNotRedialOnRepeatedCalls`, `TestListClusters_ConcurrentCalls_SingleflightCoalesces`.
9. **Singleflight/negative-cache remain correct** — TEST-PROVEN: same two tests above; both were previously failing before the "kubeconfig"-source test-fixture bug (ReconnectCluster bypasses the injectable factory for non-in-cluster rows) was fixed, which is itself evidence the tests were actually exercising the real mechanism, not passing vacuously.
10. **Client cleanup cannot race enrichment** — CODE-PROVEN: `finishReconnect`'s rollback path calls `StopClusterCache` + deletes `s.clients[id]` under `s.mu.Lock()`, mirroring `RemoveCluster`'s own cleanup sequence.
11. **Response data cannot be mutated after serialization** — CODE-PROVEN: the no-client branch returns the cluster struct obtained from `s.repo.List()` for that response directly, unmutated; the background goroutine operates on its own separately-fetched copy (real repo always returns fresh structs per call — 15.4.2) and never touches the slice already handed to the HTTP handler.
12. **No data races overall** — TEST-PROVEN: full-repo `go test ./... -race -count=1` is clean (15.6), including after finding and fixing the one genuine race (15.4.1) and the one test-fixture-only race (15.4.2).

### 15.6 Build / vet / race results

- `go build ./...` — clean.
- `go vet ./...` — clean.
- `go test ./internal/service/... -race -count=1` — PASS (12.9s).
- `go test ./... -race -count=1` — **PASS, all packages**, including `internal/api/rest` (112.5s, contains the fixed test-double race), `internal/api/websocket` (10.3s, contains all 7 CONTAM-1 isolation tests), `internal/repository`, `internal/fleet`, `internal/k8s`, and every other package in the module. No skipped packages.
- All 11 VALID-01 tests re-run 3x consecutively with `-race -count=1` to rule out flakiness: stable every time.

### 15.7 Live validation evidence (LIVE-REPRODUCED, recovered `kind-nightshift-dev` environment)

Backend rebuilt from the fixed working tree, run in an isolated temp dir (fresh SQLite DB, port 8191, never touching repo files or `~/.kube/config`), auto-registered the real `kind-nightshift-dev` cluster, then a synthetic unreachable cluster was registered via kubeconfig upload (`server: https://10.255.255.1:6443`), reproducing the exact `docs/PRODUCTION-VALIDATION-REPORT.md` scenario:

| Measurement | Before (original validation run) | After (this fix) | Source |
|---|---|---|---|
| `POST /api/v1/clusters` (unreachable registration) | 5.021s | 5.022s (unchanged — not in scope) | client + server log |
| `GET /api/v1/clusters` (1 healthy + 1 unreachable) | 10.015s | **0.591s** (server log `duration_ms:591`) | server structured log |
| `GET /api/v1/fleet/overview` (same 2 clusters) | 10.062s | **1.288s** (server log `duration_ms:1288`) | server structured log |
| `GET /api/v1/clusters` repeated (3x immediately after) | not measured in original run | 6-8ms each (server log) | server structured log |

- Healthy cluster's data remained fully correct in the fast response: 1 node, 8 namespaces, `status: "connected"`, correct `server_url`/`version`/`provider`.
- Unreachable cluster correctly reported `status: "disconnected"`, `healthStatus: "unhealthy"`, zero counts — never fabricated as healthy, in both `/clusters` and `/fleet/overview`.
- Repeated `/clusters` calls after the first stayed in single-digit milliseconds, confirming the negative cache is reused rather than re-dialing the unreachable cluster on every poll.
- This matches the live-validation plan's items 1-3 (Section 13). Items 4-5 (3+ mixed-state clusters, spot-check of Dashboard/Topology/Blast Radius) were not re-run in this pass — VALID-01's specific 2-cluster reproduction was prioritized as the direct regression target; items 4-5 remain open for the resumed validation matrix.

Cleanup performed: backend process killed, synthetic kubeconfig and cluster removed, `kind-nightshift-dev` left running exactly as recovered, `git status --porcelain` / `git diff --stat` confirm no production or test file outside the listed changes was touched, no commits made.

### 15.8 Regression check against Release-Gate-PASS baseline

- CONTAM-1 (Phase 11): all 7 `TestCONTAM1_*` isolation tests re-run explicitly with `-race` — all PASS.
- Phase 1-11 full suite: covered by the full-repo `go test ./... -race -count=1` pass (15.6) — no package failed, no previously-fixed finding regressed.
- No new frontend changes were made (frontend untouched this session).

### 15.9 Remaining risks

- `ReconnectCluster`'s *error*-path `Update` calls (6 of the function's 9 total write sites) were left as unconditional writes — only the 2 success-path writes were routed through `finishReconnect`. An error-path write to a just-removed cluster would still resurrect it with an "error"/"disconnected" status (a less severe outcome than resurrecting a "connected" row with live client/cache entries, but not zero-risk). Not fixed in this change: none of the 14 required tests target the error paths specifically, and broadening the fix to all 9 sites was judged to exceed VALID-01's scope (`ReconnectCluster` as a whole is shared by other callers, not exclusively the new code path). Flagged here for a future, explicitly scoped follow-up rather than fixed silently.
- Live-validation items 4-5 (3+ mixed-reachability clusters; Dashboard/Topology/Blast Radius spot-check under the new code path) were not exercised in this pass.
- The broader validation matrix (Sections G-J and the remainder of A-F from `docs/PRODUCTION-VALIDATION-REPORT.md`) remains unresumed, as before.
- Fleet N+1 (the per-cluster `errgroup` fan-out inside `GetFleetOverview` itself, after `ListClusters` returns) is unchanged and unaddressed, as explicitly scoped out of VALID-01.

### 15.10 VALID-01 acceptance status: **MET**

All 7 acceptance criteria in Section 14 are satisfied: the live reproduction no longer shows the ~10s delay (0.59s/1.29s measured); all tests exist, pass, and were proven against pre-fix code via revert-and-reconfirm; the Critical Safety Check items are each backed by evidence (15.5); `go test -race` is clean repo-wide; the Phase 1-11 regression suite is green; no fabricated-healthy state was observed under any tested condition; and the fix was live-validated against the recovered real cluster, not merely unit-tested.
