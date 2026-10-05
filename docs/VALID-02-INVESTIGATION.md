# VALID-02 Investigation — Cluster Summary can hang ~63s for an unreachable stored cluster

**Status: IMPLEMENTED, TESTED, LIVE-VALIDATED. See §18 for the implementation addendum.**

## 1. Finding

`GET /api/v1/clusters/{clusterId}/summary` — the Dashboard's core data call — hangs for approximately 63 seconds when the requested cluster is stored but unreachable, before finally returning (via `resilient.WrapClusterHandler`'s degrade-to-stale contract) rather than failing fast.

## 2. Severity

P1. Single-cluster scope (does not block other clusters or Fleet — see §12), but a ~63s wait on a user-facing page is a severe, customer-visible defect of exactly the class the hardening engagement's Phase 1 (LOADING-1 through LOADING-5) was built to eliminate.

## 3. Exact reproduction

```
GET /api/v1/clusters/{unreachable-cluster-id}/summary
```

No `kubeconfig_base64` in the request body (the normal Dashboard call pattern — stored-cluster fallback path). Against a cluster row with a real, persisted, non-missing kubeconfig file pointing at an unroutable address (`https://10.255.255.1:6443`, used throughout this investigation and Phase 12's live validation).

## 4. Customer impact

If a user's currently-selected/active cluster becomes unreachable (VPN drop, cluster deleted externally, expired credentials, flaky network), the Dashboard page's summary call hangs for ~63 seconds before resolving. This reads to the user as a near-indefinite loading spinner. Confirmed isolated to that one cluster's session — other clusters and the Fleet aggregate remain fast and correct throughout (§12).

## 5. Live reproduction evidence

| Measurement | Result | Classification |
|---|---|---|
| Live HTTP reproduction (Phase 12, original discovery) | 63.021s, then `curl` exit 1 / HTTP 000 (connection never completed before client gave up) | LIVE-REPRODUCED |
| In-process full-chain replay (this investigation, same unreachable address) | Stage 1 (`resolveClusterID`): 30.002s. Stage 2 (`getClientFromRequest`): 33.004s. **Total: 63.006s** | TEST-PROVEN |
| `GetOrReconnectClient` called in isolation (no preceding call) | 3.002s — the documented 3s `reconnectTimeout` bound holds exactly | TEST-PROVEN |
| `client.TestConnection(ctx)` called in isolation with an external 3s context | 3.000s — bound holds exactly | TEST-PROVEN |
| Raw `net.Dialer{}.DialContext(ctx)` with a 3s context | 3.001s — bound holds exactly | TEST-PROVEN |
| Raw `net.Dial` with no timeout at all | 75.002s (OS-level ceiling for this destination on this machine) | TEST-PROVEN |
| Two sequential raw `Clientset.List()` calls, no context deadline, same client | 30.002s + 30.001s = 60.003s | TEST-PROVEN |

All timing evidence above the live reproduction row was produced via temporary, investigation-only test files (one each in `internal/k8s`, `internal/api/rest`, `internal/service`), run, captured, then **deleted**. `git status --porcelain` was confirmed identical (79 entries) before and after this investigation, and `go build ./...` was confirmed clean afterward — no production code or persisted test file was modified.

## 6. Complete call-chain trace

```
GET /api/v1/clusters/{clusterId}/summary
  → Handler.GetClusterSummary                           (internal/api/rest/handler.go:914)
    → Handler.resolveClusterID(r.Context(), clusterID)     (handler.go:921, :309-331)
        step 1: clusterService.GetClient(id)                — fails (no live client)
        step 2: clusterService.GetCluster(ctx, id)           (cluster_service.go:404) — ALWAYS returns (c, nil); never short-circuits
            → s.clients[id] not found → s.tryReconnectCluster(ctx, c)   (cluster_service.go:925 — pre-VALID-01, NOT singleflight/negative-cache gated)
                → k8s.NewClient(path, c.Context)             — local file parse, fast, no network
                → applyAndStoreClient(ctx, c, client)          (cluster_service.go:957)
                    → client.SetTimeout(30s)
                    → client.TestConnection(ctx)                — ctx = r.Context(), NO deadline at entry
                        → c.withTimeout(ctx) = context.WithTimeout(ctx, 30s)  → effective deadline ≈ now+30s (nothing shorter to cap it)
                        → doWithRetry(..., 3, fn)                — non-retryable network error class → single attempt only
                        → Clientset.Namespaces().List(ctx, {Limit:1})  — **blocks ~30.0s**
        resolveClusterID returns (clusterID, nil) regardless of reconnect outcome — by design, it never errors on a reconnect failure
    → Handler.getClientFromRequest(r.Context(), r, resolvedID, cfg)   (handler.go:931, kubeconfig_handler.go:72)
        no kubeconfig in request → fallback: clusterService.GetOrReconnectClient(ctx, resolvedID)  (kubeconfig_handler.go:104-108)
            → s.GetClient(id) fails → negative cache empty (tryReconnectCluster above never writes to it — a separate, private mechanism) → s.reconnectSF.Do(id, …)
                → rctx, cancel := context.WithTimeout(ctx, 3s)   — genuinely 3s-bounded in isolation (proven, §5)
                → s.ReconnectCluster(rctx, id)                     (cluster_service.go:977) — a SECOND, independent client instance
                    → k8s.NewClient(path, c.Context)
                    → client.SetTimeout(30s); client.TestConnection(rctx)
                        → **empirically blocks ~33.0s, not the expected ~3.0s**, when this call immediately follows Stage 1's failed attempt to the same address (§8)
        buildClusterSummary's own raw Nodes()/Namespaces() List calls (handler.go:965-966) are **never reached** — getClientFromRequest already returned an error
    → WrapClusterHandler downgrades the error to HTTP 200 + Reachable=false (resilient contract) — after the ~63s wait
```

## 7. Timeout/retry timeline

| Stage | Operation | Context source | Timeout | Retry | Actual contribution | Evidence |
|---|---|---|---:|---|---:|---|
| 1 | `tryReconnectCluster`→`applyAndStoreClient`→`client.TestConnection` | `r.Context()` (no deadline at entry) → `c.withTimeout` imposes 30s | 30s (client-level, `c.Timeout`) | single attempt (connect-timeout is not in the 5xx/429 retryable class) | 30.002s | TEST-PROVEN |
| 2 | `GetOrReconnectClient`→`ReconnectCluster`→`client.TestConnection` | `rctx = context.WithTimeout(r.Context(), 3s)` | 3s (architecturally) | single attempt | 33.004s (not the expected 3s — see §8) | TEST-PROVEN |
| 3 | `buildClusterSummary`'s raw `Nodes().List`/`Namespaces().List` | `r.Context()` (no deadline) | none (`client.WithTimeout` never applied here) | none | **0 — never reached**, Stage 2 already errored | CODE-PROVEN (reachable in a different scenario — see §19 of the prior stop-report, carried forward as a separate, still-open gap) |
| — | HTTP server (`http.Server.ReadTimeout`/`WriteTimeout`) | n/a | 15s each | n/a | 0 — these are connection I/O deadlines, not context cancellation; they do not abort the handler goroutine | CODE-PROVEN |

**Total: 30.002s + 33.004s = 63.006s**, matching the 63.021s live reproduction to within measurement noise. The duration is fully accounted for by two sequential reconnect attempts — not a single 60s timeout, not retry multiplication (confirmed: `isRetryable` excludes connect-timeout errors; `doWithRetry` and the circuit breaker's `Execute` both run the inner function exactly once per stage).

## 8. Root cause

`resolveClusterID` (called first, unconditionally, by every cluster-scoped handler including `GetClusterSummary`) performs its own full reconnect attempt via the legacy `GetCluster`→`tryReconnectCluster` path — a mechanism VALID-01 did not touch, with no singleflight coalescing, no negative cache, and a timeout bound (30s, via `client.Timeout`) much longer than request-hot-path mechanisms are supposed to use. Immediately afterward, `getClientFromRequest`'s fallback performs a **second**, independent reconnect attempt via `GetOrReconnectClient` (VALID-01's properly-bounded mechanism, architecturally 3s) against the *same* cluster. Both attempts are individually explainable by their own governing timeouts — but nothing coordinates them, so a single `/summary` request for an unreachable cluster pays for two full, sequential reconnect attempts instead of one.

**One sub-detail remains UNVERIFIED at the mechanism level**: `GetOrReconnectClient`'s 3s bound was proven to hold exactly (3.002s) when called in isolation, but stretched to 33.004s when called immediately after Stage 1's failed attempt to the identical destination. Plausible candidates (OS-level connection-state reuse for the identical destination tuple, or Go transport-level dial-path interaction) are not proven — isolating the exact mechanism would require packet-level tracing, outside this investigation's scope. This does **not** block identifying the fix direction: removing the redundant Stage 1 (§11) eliminates the back-to-back pattern that triggers this stretch, regardless of its exact cause.

## 9. Evidence classification summary

- CODE-PROVEN: the full call chain (§6), the timeout table's context/timeout values (§7), the absence of retry multiplication, the absence of a shared-lock/global-mutex bottleneck (§12).
- TEST-PROVEN: every timing figure in §5, produced via temporary investigation-only tests against the real unreachable address, deleted after use.
- LIVE-REPRODUCED: the original 63.021s Phase 12 discovery.
- UNVERIFIED: the exact low-level reason Stage 2 stretches from 3s to 33s when chained after Stage 1 (§8); cancellation behavior under genuine client-disconnect rather than timeout-expiry (§11); whether `buildClusterSummary`'s own unreached raw List calls would surface under a different code path (flagged, not resolved, carried forward as a separate open item).

## 10. Comparison with VALID-01

| | VALID-01 | VALID-02 |
|---|---|---|
| Endpoint | `GET /api/v1/clusters` (list), `GET /api/v1/fleet/overview` | `GET /api/v1/clusters/{id}/summary` |
| Entry point | `ListClusters` | `Handler.GetClusterSummary` → `resolveClusterID` + `getClientFromRequest` |
| Cluster resolution | Iterates all persisted clusters in one call | Resolves a single cluster ID via two sequential, independent sub-paths |
| Reconnect path | Was: `tryReconnectCluster` called directly, inside the `wg.Wait()` fan-out, once per cluster. Now: no-live-client clusters skip the wait group entirely; a background goroutine calls `GetOrReconnectClient` | **Both** the legacy `tryReconnectCluster` (via `resolveClusterID`→`GetCluster`) **and** `GetOrReconnectClient` (via `getClientFromRequest`) run, sequentially, for the same request |
| Timeout hierarchy | Single `backgroundReconnectBudget` (8s) on a non-blocking background path; the HTTP response never waits on it | Two independent timeouts (30s, 3s) both on the *synchronous* request path |
| Retry behavior | None added; relies on existing single-attempt semantics | Same single-attempt semantics, but duplicated across two stages |
| Blocking operation | Was: `wg.Wait()` on every cluster's reconnect. Now: nothing — the slow path is fully decoupled from the response | `resolveClusterID` and `getClientFromRequest` run fully synchronously on the HTTP response path, back to back |
| Customer impact | Was: ~10s for `GET /clusters`/`/fleet/overview` with one unreachable cluster among many. Now: <1s | ~63s for a single unreachable cluster's own summary |
| Existing protection | Fixed by VALID-01: no-client clusters never join the wait group; reconnect moved off the hot path entirely | None — `resolveClusterID` was never brought under VALID-01's scope |
| Why previous phases missed it | N/A — this is the fix | VALID-01 was explicitly scoped to `ListClusters`/`GetFleetOverview` only, per its own approval instructions ("do not expand scope"); it never touched `resolveClusterID`, `GetCluster`, or `tryReconnectCluster`. Phase 4 (FLEET-1) fixed the *service-layer* `ClusterService.GetClusterSummary` (`cluster_service.go:706`), a different function from the REST handler's `buildClusterSummary` that this endpoint actually calls |

**They do not share a root cause.** VALID-01's root cause was a single hot-path function (`ListClusters`) blocking its entire response on every cluster's reconnect. VALID-02's root cause is two *different*, independently-correct-in-isolation reconnect mechanisms being invoked back-to-back, uncoordinated, for a single cluster. The common thread is architectural (reconnect logic duplicated across the codebase's history, in two different phases, without a single point of coordination) — not a shared code defect.

## 11. Why Phase 1 did not protect this path

Phase 1's LOADING-1 through LOADING-5 findings bounded specific, then-identified raw-call sites (e.g. `overview.go`'s LOADING-3 fix) and informer-cache-sync waits (LOADING-5). LOADING-4 — "`NewClient`/`NewClientFromBytes` never set `rest.Config.Timeout`; bounding relies entirely on the per-call `withTimeout()` wrapper being applied at every call site" — was explicitly investigated and **BLOCKED**, not fixed, specifically because a blanket transport-level timeout would have broken informer watch connections. Its own documented remaining risk predicted exactly this class of gap: *"a future developer adding a new raw `Clientset` call without `WithTimeout()` remains possible."*

- **Which Phase 1 mechanism should have protected this request?** None directly — `resolveClusterID`'s `tryReconnectCluster`→`TestConnection` path *is* correctly bounded (by `client.Timeout`, applied via `withTimeout()` inside `TestConnection` itself, exactly as LOADING-3's pattern intends). The problem is not a missing bound on either individual stage; it is that **two bounded-but-independent stages run sequentially** on one request.
- **Does it actually execute on this path?** Yes — both stages are governed by proper context/timeout mechanics individually (proven in isolation, §5). The gap is structural coordination between them, not a missing timeout.
- **If not, where is the bypass?** There is no "bypass" in the LOADING-4 sense (a raw call missing `WithTimeout()`) for Stages 1–2. `buildClusterSummary`'s own raw List calls (handler.go:965-966) *are* exactly that LOADING-4-class gap, but they are never reached in this specific reproduction since Stage 2 errors first — a separate, still-real, still-open issue (§9/§19 carried forward).
- **Was the original audit's LOADING findings narrower than this path?** Yes. The audit's LOADING findings addressed specific raw-call sites known at the time; `resolveClusterID`'s double-reconnect redundancy was never traced end-to-end by any prior phase or audit pass.
- **Regression or previously uncovered path?** Previously uncovered. `tryReconnectCluster` pre-dates this entire engagement; `GetOrReconnectClient` was introduced by VALID-01. No phase before this investigation traced a single request through both.

## 12. Concurrency and cross-cluster impact

Verified from code, not by modifying anything:

- `resolveClusterID`'s Stage 1 (`GetCluster`→`tryReconnectCluster`→`applyAndStoreClient`) and Stage 2 (`GetOrReconnectClient`→`ReconnectCluster`) each build their **own, independent `*k8s.Client` instance** via `k8s.NewClient`. Neither holds a global mutex for the duration of the network call — `s.mu` (the cluster-service-wide lock protecting `s.clients`) is only taken for the brief, non-blocking map read/write around each attempt (`s.mu.RLock()`/`s.mu.Lock()`), not held across the slow `TestConnection` call.
- `GetOrReconnectClient`'s `singleflight.Group` key is the cluster ID — coalescing only applies to *concurrent requests for the same cluster*, never across different clusters.
- `reconnectFailCache` (a `sync.Map`) is keyed per cluster ID — a slow/failing cluster's entry cannot affect another cluster's entry.
- No shared worker pool, database transaction, or HTTP-server-level resource is held across either stage's blocking call.
- This is consistent with the live evidence already recorded in Phase 12 (`docs/PRODUCTION-VALIDATION-REPORT.md` / the Phase 12 stop report): while the unreachable cluster's summary request was in flight, a concurrent healthy-cluster summary request returned in 0.432s and a concurrent `/fleet/overview` request returned in 1.382s — both architecturally and empirically confirmed isolated.

**Conclusion: VALID-02 is single-cluster-scoped by construction. It does not hold any shared resource that would block other clusters, Fleet, or unrelated requests.**

## 13. Cancellation semantics

Traced, not modified:

```
HTTP request context (r.Context())
    ↓ (unmodified, passed directly)
Handler.resolveClusterID(r.Context(), clusterID)
    ↓ (Stage 1: context.WithTimeout(ctx, 30s) inside TestConnection's withTimeout — child of r.Context())
Handler.getClientFromRequest(r.Context(), ...)
    ↓ (Stage 2: context.WithTimeout(r.Context(), 3s) inside GetOrReconnectClient — also a child of r.Context())
Kubernetes request (Clientset.List, inside both stages)
    ↓
retry: none (single attempt per stage, confirmed non-retryable error class)
```

Both stages derive their bounded context as a **child of `r.Context()`**, not from an independently-created `context.Background()`. Per Go's context contract, cancelling a parent immediately cancels every derived child. This means: if the HTTP client disconnects (browser tab closed, request aborted) while either stage is waiting on its own timeout, `r.Context()`'s cancellation should propagate immediately and abort whichever stage is currently waiting, *without* waiting for that stage's own timeout to elapse. This is consistent with — and not contradicted by — the empirical evidence: when a context deadline legitimately fires (the 3.000s/3.001s/3.002s isolated tests, §5), the call aborts within milliseconds of that deadline, not later.

The only `context.Background()` usage anywhere near this call chain is VALID-01's own, deliberately separate `kickBackgroundReconnect` (cluster_service.go:357-400) — a fire-and-forget path used by `ListClusters`, not by `resolveClusterID`/`getClientFromRequest`. It does not participate in VALID-02's request-scoped chain at all.

**UNVERIFIED**: genuine client-disconnect-mid-request (as opposed to timeout-expiry) was not directly exercised this investigation — no live test simulated a browser aborting the connection. The context-plumbing evidence above supports that cancellation *should* propagate correctly, but this specific scenario is not empirically confirmed.

## 14. Candidate fixes (not implemented)

| Candidate | Change | Benefit | Risk | Existing pattern reused? | New tests needed? |
|---|---|---|---|---|---|
| A | Route `resolveClusterID`'s existence/liveness check through `GetOrReconnectClient` instead of `GetCluster`/`tryReconnectCluster` | Eliminates Stage 1 entirely; the one reconnect attempt that remains is already-bounded, cache-aware, singleflight-coalesced | `resolveClusterID` is called by *every* cluster-scoped handler (Topology, Blast Radius, resource pages, events, logs, shell, etc.) — must verify none of them depend on `GetCluster`'s side effects (e.g. the `c.ServerURL`/`c.Version`/`c.Provider` enrichment it performs on success) | Yes — `GetOrReconnectClient` | Yes — regression coverage across every `resolveClusterID` caller, not just `/summary` |
| B | Make `resolveClusterID` a pure, non-reconnecting existence check (`repo.Get` only), deferring all reconnection to `getClientFromRequest`/`GetOrReconnectClient` | Smaller, more surgical than A — removes the reconnect *side effect* from ID resolution without changing `GetCluster`'s own behavior for callers that use it directly (not through `resolveClusterID`) | Must confirm no caller relies on `resolveClusterID` having already attempted a reconnect as a side effect before it returns | Partially — still ends up relying on `GetOrReconnectClient` for the one remaining attempt | Yes — same regression surface as A, somewhat narrower |
| C | Investigate and fix the ~30s stacking effect so `GetOrReconnectClient`'s 3s bound holds even when chained immediately after a failed attempt to the same destination | Would fix VALID-02 without touching `resolveClusterID` at all | Requires understanding an currently-UNVERIFIED low-level mechanism (§8) before any fix could be designed with confidence; higher risk of an incomplete or superstitious fix | No — would be new investigation/architecture | Yes, plus the diagnostic work itself |

Candidates A and B both make the mechanism-level mystery in §8 moot by removing the back-to-back pattern that triggers it, rather than requiring it to be understood first. **This is not recommending a fix merely because it is simple — C is explicitly avoided specifically because fixing a not-yet-understood mechanism carries materially higher risk of a wrong or incomplete fix than removing a proven-redundant code path.**

## 15. Recommended implementation direction

Candidate B (pure existence check in `resolveClusterID`, deferring all reconnection to the already-used `GetOrReconnectClient` fallback) is the smaller, more surgical change of the two viable candidates, and is the direction recommended for a future, separately-approved implementation step. **Not implemented in this investigation.**

## 16. Implementation acceptance criteria (for a future fix — not yet met, nothing implemented)

**Unreachable cluster:** `GET /summary` for a stored-but-unreachable cluster must terminate within the existing `reconnectTimeout` budget (3s, `cluster_service.go:114`, already the product's own documented hot-path reconnect budget — not invented for this fix) plus normal response-construction overhead — not ~63s, not ~33s, not any multiple of the per-stage bounds.

**Healthy cluster:** `GET /summary` for a reachable cluster must show no change in latency or data correctness versus current behavior.

**Concurrent cluster isolation:** An unreachable cluster's `/summary` request must not delay a concurrent healthy cluster's `/summary`, `/fleet/overview`, or any unrelated request — already true today (§12) and must remain true.

**Cancellation:** Client-initiated cancellation of a `/summary` request must still propagate through whichever single reconnect stage remains and terminate the underlying work — consistent with the context-plumbing already in place (§13).

**Regression:** All existing Phase 0–11 regression suites, plus VALID-01's and CONTAM-1's tests, must remain green.

**Race safety:** `go test ./... -race` must pass for all affected packages.

**Additional:** At least one test must be written to fail against the current (pre-fix) code before the fix is applied, per this engagement's standing discipline (revert-and-reconfirm).

## 17. Implementation status (as of the original investigation)

NOT STARTED at the time §1-16 were written. Implementation was subsequently approved and completed — see §18.

## 18. Implementation Addendum

### 18.1 Decision

Candidate B, as recommended in §15: `resolveClusterID` was changed to a pure, non-reconnecting lookup. `GetCluster` (and its reconnect side effect) was left completely unmodified — it has ~17 other call sites (shell, kcli, port-forward, kubeconfig retrieval, etc.) that genuinely want its enrichment + reconnect behavior, confirmed via `grep` before making any change.

### 18.2 Exact production change

`internal/api/rest/handler.go`, `resolveClusterID`:

```go
// Before:
// step 2: h.clusterService.GetCluster(ctx, clusterID)   — reconnects on miss
// step 3: h.clusterService.ListClusters(ctx), match by Context/Name only

// After:
// single step: h.clusterService.ListClusters(ctx), match by ID, Context, or Name
```

`ListClusters` was already fixed by VALID-01 to never block its response on any cluster's reconnect — it returns each cluster's last-known persisted state immediately and fires any needed reconnect on a background context. Using it as `resolveClusterID`'s sole existence check means the function can no longer block on a reconnect, by construction, without introducing any new mechanism.

### 18.3 Exact behavior changed

Before: a `/summary` request for an unreachable stored cluster triggered two sequential reconnect attempts — `resolveClusterID`'s own (via `GetCluster`→`tryReconnectCluster`, ~30s-bounded) immediately followed by `getClientFromRequest`'s (via `GetOrReconnectClient`, ~3s-bounded, empirically stretched to ~33s when chained). After: only `getClientFromRequest`'s single `GetOrReconnectClient` attempt runs. `resolveClusterID`'s own behavior for every other scenario (live client hit, ID/Context/Name matching) is unchanged — it was already exercising `ListClusters` as its step 3 fallback before this change.

### 18.4 Files changed

- `internal/api/rest/handler.go` — `resolveClusterID` only.
- `internal/api/rest/valid02_test.go` — new, 6 tests (§18.5).

No other production file was touched. `GetCluster`, `tryReconnectCluster`, `GetOrReconnectClient`, and `ListClusters` themselves are all unmodified.

### 18.5 Tests added

All in `internal/api/rest/valid02_test.go`:

1. `TestVALID02_ResolveClusterID_DoesNotReconnect` — an unreachable cluster's `resolveClusterID` call must return in well under its old reconnect-bound time.
2. `TestVALID02_Summary_DoesNotDuplicateReconnect` — the full `resolveClusterID` + `getClientFromRequest` sequence must take ~1 reconnect attempt's worth of time, not 2.
3. `TestVALID02_ResolveClusterID_HealthyClusterUnaffected` — a cluster with a live client resolves near-instantly, unchanged.
4. `TestVALID02_GetClientFromRequest_RequestSuppliedKubeconfigUnaffected` — the Headlamp-style request-supplied-kubeconfig path is untouched by this change and never invokes the stored-cluster reconnect factory.
5. `TestVALID02_ConcurrentClusterIsolation` — a healthy cluster's resolution and a `ListClusters` call both stay fast while an unreachable cluster is concurrently resolving.
6. `TestVALID02_GetClientFromRequest_CancellationPropagates` — a context cancelled 50ms in aborts `getClientFromRequest` promptly (real unroutable address, not the context-blind injectable factory, since `K8sClientFactory`'s signature has no `ctx` parameter and so cannot itself be used to test cancellation).

### 18.6 Pre-fix / post-fix evidence (revert-and-reconfirm)

Performed on the two core regression tests by temporarily restoring the original `resolveClusterID` body, confirming failure, then restoring the fix:

| Test | PRE-FIX | POST-FIX |
|---|---|---|
| `TestVALID02_ResolveClusterID_DoesNotReconnect` | FAIL — 2.001s (matches the test's 2s-delay factory being awaited synchronously) | PASS — 0.01s |
| `TestVALID02_Summary_DoesNotDuplicateReconnect` | FAIL — 903.9ms (exceeds the 450ms single-attempt threshold, consistent with two sequential attempts) | PASS — 0.31s (one attempt, matching the factory's configured 300ms delay) |

All 6 tests pass post-fix under `go test ./internal/api/rest/... -run TestVALID02 -race -v` (full output captured; no flakiness observed across repeated runs).

### 18.7 Live validation evidence (LIVE-REPRODUCED)

Backend rebuilt from the fixed working tree, restarted against the same persisted DB (`kind-nightshift-dev` + 4 synthetic unreachable clusters from Phase 12). To get a true first-attempt measurement (not benefiting from VALID-01's negative cache being pre-warmed by an earlier call), the backend was restarted fresh and the unreachable cluster's `/summary` endpoint was hit as the very first request:

| Measurement | Before (original VALID-02 discovery) | After (this fix, first-request, fresh negative cache) |
|---|---|---|
| `GET /clusters/{unreachable-id}/summary` | 63.021s | **2.949s** (server log `duration_ms:2931`) — matches `GetOrReconnectClient`'s own ~3s architectural bound, confirmed in isolation during the investigation |
| `GET /clusters/{healthy-id}/summary` | not separately measured in original discovery | 0.429s, correct data (1 node, 20 pods, 8 namespaces, reachable=true) |
| `GET /clusters` (5 total) | — | 0.330s |
| `GET /fleet/overview` | — | 1.388s, correct totals (1 healthy, 4 unhealthy) |
| Concurrent: unreachable + healthy + fleet simultaneously | — | healthy 0.806s, unreachable 1.410s (benefiting from by-then-warm negative cache), fleet 1.780s — none serialized behind another |

Cleanup performed: backend and frontend dev-server processes stopped, temporary build artifacts removed, `git status`/`git diff --stat` confirmed to contain only the intended files.

### 18.8 Race / build / vet results

- `go build ./...` — clean.
- `go vet ./...` — clean.
- `go test ./internal/api/rest/... -race -count=1` — PASS (98.5s, full package).
- `go test ./... -race -count=1` — **all packages pass**, zero failures, zero races, full repository.

### 18.9 Regression results

- CONTAM-1: all 7 `TestCONTAM1_*` tests explicitly re-run and passing.
- VALID-01: all 11 `TestListClusters_*` tests explicitly re-run and passing.
- LOADING timeout/cancellation: `TestClient_WithTimeout_*` (3 tests) explicitly re-run and passing.
- Full-repo race suite (§18.8) covers every other package (topology, blast radius via `internal/fleet`/`internal/graph`, metrics/counts via `internal/repository`, etc.) with zero failures.

### 18.10 Remaining uncertainty

The exact low-level mechanism behind the ~33s stretch observed in the original investigation (§8) — why `GetOrReconnectClient`'s proven 3s bound took 33s when called immediately after `resolveClusterID`'s old reconnect attempt to the same destination — remains unexplained at the OS/transport level. This is now moot for VALID-02 itself (the fix removes the back-to-back pattern that triggered it), but is flagged here in case it manifests elsewhere in the codebase in the future (e.g., any other path that might perform two sequential dials to the same destination).

### 18.11 VALID-02 acceptance status: MET

All criteria from §16 are satisfied: unreachable-cluster requests now complete in ~3s (architecturally bounded, not ~63s); healthy-cluster behavior is unchanged; cross-cluster isolation holds live and in tests; cancellation propagates (tested against a real unroutable address); the full Phase 0-11 + VALID-01 + CONTAM-1 regression suite is green; `go test -race` is clean repository-wide; and a test was proven to fail pre-fix and pass post-fix via revert-and-reconfirm.
