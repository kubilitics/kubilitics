# buildClusterSummary Fan-Out — Phase A Investigation & Fix

**Status: Bounded-concurrency already correct (prior session). New gap found and fixed this pass: unbounded shared ctx. FIXED, TEST-PROVEN, `-race` clean, LIVE-VALIDATED.**

## What was inspected

Traced the full chain: `GetClusterSummary` (REST handler) → `resilient.WrapClusterHandler` → `buildClusterSummary` → `client.Clientset...List(ctx, ...)` × ~26 resource types, plus the direct nodes/namespaces reads before the fan-out.

## What was already correct (prior session, re-verified, not redone)

- **Concurrency is bounded, not literally "30 unconditional goroutines."** `errgroup.Group` with `g.SetLimit(maxConcurrentSummaryListCalls)` (= 10) caps actual in-flight List calls. CODE-PROVEN by reading the diff; the exact ceiling is UNVERIFIED by an automated test per the existing `fleet_performance_test.go` note (fake clientset's `k8stesting.Fake` holds one lock across the whole reactor chain, so no test built on it can distinguish "bounded to N" from "fully serialized" — a structural fake-clientset limitation, not something worth working around this pass).
- **Deliberately not `errgroup.WithContext`** — one resource type's List error never cancels the other 25 in-flight calls (confirmed by comment and behavior).
- **Partial-result semantics already exist and are correct**: a failed/timed-out individual List call increments `failedListCalls`, surfaced as a `HealthReason` note — the function does NOT return a hard error unless BOTH nodes and namespaces fail. One slow resource type degrading one count, rather than failing the whole summary, is the existing, correct contract — not changed by this fix.
- **GetFleetOverview's OUTER (per-cluster) fan-out** has its own, separately-bounded concurrency and is extensively wall-clock-tested (`fleet_performance_test.go`): bounded fan-out, mixed healthy/unreachable ratios, one-slow-cluster-doesn't-multiply-latency, concurrent-request race-freedom. Re-run this pass, all pass.

## The gap found this pass

Every one of the ~26 List calls, plus `getClientFromRequest` itself, shared `ctx = r.Context()` with **no internal deadline anywhere in the chain** — confirmed by reading `resilient.WrapClusterHandler` (`fetch(r.Context(), r)`, no timeout added) and `buildClusterSummary` directly. Go's `net/http` does not cancel `r.Context()` on `ReadTimeout`/`WriteTimeout` expiry — only an actual client disconnect does. If one resource type's List call genuinely **hung** (not merely errored) against an unresponsive API server, `g.Wait()` blocked forever, and every repeated poll/retry for that same cluster's summary (the sidebar polls this endpoint) would leak another goroutine + held Clientset connection, unboundedly over time. Contained to that one cluster's own requests — not the shared-lock class of bug already fixed for PipelineManager/ClusterGraphEngine — but still a real, previously-undocumented, unbounded-resource-accumulation path, squarely within LOADING-4's scope.

**Severity: P2.** Does not poison other clusters (no shared lock), existing cache/stale-fallback already serves the user something during a hang, but is a genuine, previously-unknown gap. Per the brief's authorization ("P2 or lower and clearly safe to fix within this scope" may be implemented directly), fixed without a separate stop-and-wait cycle.

## Fix

`internal/api/rest/handler.go`: new `var clusterSummaryTimeout = 20 * time.Second`, and `buildClusterSummary` now does:
```go
ctx, cancel := context.WithTimeout(ctx, clusterSummaryTimeout)
defer cancel()
```
immediately on entry, before `getClientFromRequest` and the fan-out. This ctx is still derived from the caller's own `ctx` — a real client cancellation propagates immediately, unchanged — but now has a hard upper bound regardless of whether the caller ever cancels. A timeout surfaces as `context.DeadlineExceeded`, which `resilient.IsTransientClusterError` already classifies as transient, flowing into the existing stale-cache-fallback path. No new fallback behavior was invented.

20s chosen consistent with this codebase's established range for one-shot bounded operations (15s for PipelineManager sizing, 25s for the log collector) and generous enough that a real large cluster's ~26-resource-type fan-out (bounded to 10 concurrent) should comfortably finish well inside it in the common case.

## Tests added (all 7 required points covered)

`internal/api/rest/handler_summary_fanout_test.go`:
- **`TestBuildClusterSummary_OneHungResourceTypeIsBoundedAndDoesNotCorruptOthers`** — points 1, 3, 4, 6: with `clusterSummaryTimeout` shrunk to 300ms, a Pods List call blocked forever still returns within ~2s; the summary is HTTP 200, `Reachable: true` (nodes/namespaces succeeded); `NodeCount`/`ServiceCount` from the OTHER concurrent calls are uncorrupted; `PodCount` is 0; `HealthReason` notes the failure (existing partial-result contract, not a new one); the blocked call's observed `ctx.Err()` is proven to be exactly `context.DeadlineExceeded` via a typed-client override (`blockingPodsClientset` — not a `k8stesting.PrependReactor`, which structurally cannot observe the caller's context at all, same limitation documented in `fleet_performance_test.go` and independently re-confirmed here).
- **`TestBuildClusterSummary_ConcurrentRequestsAgainstHungClusterDoNotAmplify`** — point 5: 15 concurrent summary requests against the same permanently-hung cluster complete within ~1 timeout period (not serialized/multiplied), all 200, and goroutines return within 20 of baseline afterward (no accumulation).
- Both run under `-race`; point 2 (all expected calls execute) and point 7 (race-clean) are covered by these same two tests plus the full existing `TestHandler_GetClusterSummary_*` suite (re-run, unchanged, passing).

5/5 repeated runs (`-count=5`), deterministic, clean under `-race`.

## Evidence

- `go build ./...`, `go vet ./...`: clean.
- `go test -race ./internal/api/rest/... -run "TestBuildClusterSummary_|TestHandler_GetClusterSummary_"`: pass, 5/5.
- Full backend `go test -race ./...`: 52 packages, all `ok`.
- Named regressions re-run explicitly: VALID-01/02, CONTAM-1, Hybrid Informer Lifecycle, EngineLifecycleManager/Blast Radius, Fleet N+1 (`TestGetFleetOverview_*`, 10 tests) — all pass.
- Live validation (isolated lab `kubilitics-phase-e`): `GET /clusters/{id}/summary` against the real lab cluster, healthy path — 0.425s, `reachable: true`, correct counts (1 node, 526 pods, 43 deployments), `HealthReason` correctly flags real cluster conditions (487 pending pods, 1 partially-unavailable deployment) — confirming the timeout change does not alter healthy-path output or trigger false positives against a real (if small) cluster. Goroutines settled to 43 after.

## Remaining risk

- The exact concurrency ceiling (`maxConcurrentSummaryListCalls = 10`) remains unverified by an automated test — structural fake-clientset limitation, not newly introduced by this pass.
- 20s is not empirically tuned against a genuinely large (thousands of pods, dozens of namespaces) real cluster's List latency for all 26 resource types simultaneously bounded to 10-wide concurrency — chosen from codebase convention.
