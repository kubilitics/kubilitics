# Phase 1 — Reliability Foundation: Execution Record

**Companion to:** `docs/PRODUCTION-RELIABILITY-AUDIT.md`, `docs/PRODUCTION-HARDENING-ROADMAP.md`, `docs/PRODUCTION-BASELINE.md`
**Date:** 2026-10-02
**Scope:** LOADING-1, LOADING-2, LOADING-3, LOADING-4, LOADING-5, TOPOLOGY-2 (timeout-mismatch half), LIFECYCLE-2 (timeout half) — exactly the Phase 1 findings named in the roadmap. No Phase 2+ work was started.

---

## Finding: LOADING-1

- **Severity:** P0
- **Status:** FIXED
- **Root Cause:** `backendRequest`/`backendRequestText` (`kubilitics-frontend/src/services/api/client.ts`) called `fetch()` with no `signal` at all — a hung backend handler left the returned promise pending forever.
- **Change:** Added a default 20s request timeout (`DEFAULT_REQUEST_TIMEOUT_MS`), applied via a manually-combined `AbortSignal` (not `AbortSignal.any()` — missing from jsdom's polyfill and unverified in the Tauri webview). A fired timeout is converted into an actionable `BackendApiError` ("Request timed out after Xs") rather than a raw `DOMException`, and deliberately does **not** open the circuit breaker (a single slow request must not degrade unrelated requests).
- **Files Changed:** `kubilitics-frontend/src/services/api/client.ts`
- **Regression Test:** `client.test.ts` — "passes an AbortSignal to fetch on every call", "converts a fired AbortSignal.timeout into an actionable BackendApiError", "bounds a genuinely-hanging request... once its signal is aborted" (×2, for `backendRequest` and `backendRequestText`).
- **Tests Executed:** `npx vitest run src/services/api/client.test.ts` → 47/47 pass (43 pre-existing + 4 new). Full `src/services`, `src/hooks`, `src/pages` sweep → no regressions beyond one pre-existing, unrelated failure (see "Pre-Existing Failures" below).
- **Before:** A mocked `fetch` that never resolves leaves `backendRequest`'s promise pending indefinitely (measured in Phase 0: still pending at 3000ms).
- **After:** The same hung-fetch scenario rejects with a `BackendApiError` once the internal/caller signal fires — proven directly in the new tests.
- **Known Limitations:** 20s is a safety-net default tuned for typical request shapes (resource list/detail, overview, metrics) — not every conceivable future endpoint. Callers with a known longer or shorter natural duration override it via `timeoutMs` (see LOADING-1/TOPOLOGY-2's `BackendRequestInit`).
- **Remaining Risk:** Low. The manual AbortSignal combinator is a minor addition; if `AbortSignal.any()` support is later confirmed safe everywhere this app runs, it could simplify the implementation, but is not required for correctness.

---

## Finding: LOADING-2

- **Severity:** P1
- **Status:** FIXED
- **Root Cause:** React Query's auto-injected per-query `signal` was never read in `useKubernetes.ts`'s `queryFn`s, so unmount/stale-query cancellation never reached `backendRequest`.
- **Change:** `useK8sResourceList`'s and `useK8sResource`'s `queryFn`s now destructure `{ signal }` and forward it through `listResources`/`getResource` (new optional `signal` field on `ResourceListParams`, new optional trailing `signal` parameter on `getResource`) into `backendRequest`'s `init.signal`. Scoped deliberately to these two hooks — the ones the audit named — not threaded into every API domain module.
- **Files Changed:** `kubilitics-frontend/src/hooks/useKubernetes.ts`, `kubilitics-frontend/src/services/api/resources.ts`
- **Regression Test:** `resources.test.ts` — "forwards an AbortSignal to backendRequest when provided" (×2, for `listResources`/`getResource`), plus a companion test confirming the 2-arg call shape is unchanged when no signal is given (protects the 30+ pre-existing exact-arg-count assertions in the same file).
- **Tests Executed:** `npx vitest run src/services/api/resources.test.ts src/hooks/useKubernetes.test.tsx` → 40/40 pass. Full sweep as above → no regressions.
- **Before:** `listResources`/`getResource` always called `backendRequest(baseUrl, path)` — a signal, even if a caller had one, was never forwarded.
- **After:** `listResources(..., { signal })` / `getResource(..., signal)` forward it through to `fetch()`, verified by asserting the exact 3-arg `backendRequest` call shape in the new tests.
- **Known Limitations:** Only the two resource list/detail hooks are wired. Other `useQuery` call sites across the app (metrics, shell, reports, etc.) still don't forward their query signal — consistent with the audit's own scoped finding, not a newly-discovered gap.
- **Remaining Risk:** Low.

---

## Finding: LOADING-3

- **Severity:** P1
- **Status:** FIXED
- **Root Cause:** `GetClusterOverview`'s fallback path (`kubilitics-backend/internal/api/rest/overview.go`) ran three raw `Clientset.List()` calls on `r.Context()` alone, bypassing the client's configured K8s call timeout — unlike every other resource handler, which goes through `client.withTimeout()`.
- **Change:** Added an exported `Client.WithTimeout()` (thin wrapper around the existing private `withTimeout`) so callers outside the `k8s` package can apply the same deadline. `overview.go`'s fallback now wraps all three `List()` calls in `client.WithTimeout(r.Context())`.
- **Files Changed:** `kubilitics-backend/internal/k8s/client.go`, `kubilitics-backend/internal/api/rest/overview.go`
- **Regression Test:** `client_timeout_test.go` (new) — `TestClient_WithTimeout_AppliesConfiguredDeadline`, `TestClient_WithTimeout_NoOpWhenTimeoutUnset`, `TestClient_WithTimeout_BoundsASlowOperation` (proves a context built this way actually unblocks a slow operation within the configured deadline, not just that the field is set).
- **Tests Executed:** `go test ./internal/k8s/... ./internal/api/rest/...` → all pass, including the pre-existing `TestHandler_GetClusterOverview_Success` (confirms no regression on the fallback path's happy case — I initially wrote a redundant/broken happy-path test with incomplete handler wiring; deleted it once I found the existing coverage already proved non-regression).
- **Before:** The three raw `List()` calls had no deadline beyond whatever `r.Context()` provides (which `net/http`'s server-level `ReadTimeout`/`WriteTimeout` does not reliably bound for a handler goroutine blocked on unrelated I/O).
- **After:** Same calls now run under `client.Timeout` (the cluster's configured K8s timeout), proven at the mechanism level in `client_timeout_test.go`.
- **Known Limitations:** Fake clientset (`k8s.io/client-go/kubernetes/fake`) does not propagate `context` to its reactors, so a true end-to-end "hung apiserver → handler returns in bounded time" integration test against this exact handler isn't possible with the existing test tooling. The regression test instead proves the underlying mechanism (`Client.WithTimeout`) directly and bounds a real `select`-based slow operation — the same proof `LOADING-5`'s tests use, and the only level at which this is honestly testable without standing up a real (or httptest-backed) apiserver.
- **Remaining Risk:** Low.

---

## Finding: LOADING-4

- **Severity:** P2
- **Status:** BLOCKED — not implemented this phase, with documented reason
- **Root Cause (as audited):** `internal/k8s/client.go`'s `NewClient`/`NewClientFromBytes` never set `rest.Config.Timeout`, so the underlying HTTP client has no timeout of its own; bounding relies entirely on the per-call `withTimeout()` wrapper being applied at every call site (which LOADING-3 showed can be missed).
- **Why blocked:** Verified by reading `k8s.io/client-go@v0.35.1/rest/request.go` directly (not guessed): `rest.Config.Timeout` becomes the underlying `http.Client.Timeout`, which bounds the *entire* HTTP round trip — including reading the response body. `internal/k8s/informer.go`'s `InformerManager` is built from `informers.NewSharedInformerFactory(client.Clientset, ...)` — **the same shared `Clientset`/transport** used for typed List calls. `Request.Watch()` (the mechanism every informer's reflector uses for its long-lived streaming connection) uses that same `http.Client`. Setting `Config.Timeout` globally on this shared client would therefore forcibly terminate every cluster's long-lived Watch connections every `Config.Timeout` interval, causing constant informer reconnect/relist churn across all connected clusters — a new, more severe regression than the gap it would close, and one that plausibly *compounds* COUNTS-1-style drift risk (more relists = more opportunities for a missed/`DeletedFinalStateUnknown` delete event) rather than fixing it.
- **Decision:** Per the governing execution rules ("If fixing a Phase 1 issue reveals a dependency outside Phase 1: STOP. Document the dependency. Do not automatically expand scope." and "Preserve existing architecture unless evidence demonstrates it is the cause of the problem"), I did not apply the audited fix as a blanket `Config.Timeout`. LOADING-3 (the one confirmed, concrete exploit of this gap) is already fixed via the safer, call-site-scoped approach. A correct LOADING-4 fix would require splitting the informer-facing transport from the typed-call-facing transport (e.g. a second `rest.Config`/`Clientset` built from the same credentials but with `Timeout` set, used only for non-watch calls) — that is a larger structural change than "smallest safe production change" and is better scoped as its own reviewed unit of work, not bundled into Phase 1.
- **Files Changed:** None for this finding specifically (the exported `Client.WithTimeout()` added for LOADING-3 is reused infrastructure, not a LOADING-4 fix).
- **Regression Test:** N/A — not implemented.
- **Recommended path forward:** A future phase (or a standalone, separately-reviewed change) should either (a) build a second, non-watch-only `rest.Config` with `Timeout` set for handlers that make raw `Clientset` calls outside the `k8s` package's wrapped methods, or (b) audit every such raw call site (there may be few, now that LOADING-3 is fixed) and ensure each uses `client.WithTimeout()` explicitly, making the blanket transport-level change unnecessary.
- **Remaining Risk:** Low-to-moderate. The audited scenario (a future developer adding a new raw `Clientset` call without `WithTimeout()`) remains possible, but LOADING-3 closed the one concrete instance found, and the risk is now "a future miss," not a "known-and-shipped gap."

---

## Finding: LOADING-5

- **Severity:** P2
- **Status:** FIXED
- **Root Cause:** `InformerManager.Start()` (`kubilitics-backend/internal/k8s/informer.go`) called `im.factory.WaitForCacheSync(im.stopCh)` directly — `im.stopCh` only closes on an explicit `Stop()`, so if any single resource type's informer never completed its initial sync (e.g. an RBAC watch denial), the call blocked forever with no distinguishing signal between "still warming up" and "will never finish."
- **Change:** Added `waitForSync(timeout)` — a bounded wait that gives up after a timeout **or** `Stop()`, whichever comes first (verified leak-free: the background goroutine that races `stopCh`/timer against the wait always exits once the wait returns, via a `done` channel). `Start()` now calls `waitForSync(initialSyncTimeout)` (2 minutes); if it doesn't succeed, logs an actionable message and launches `retrySyncInBackground()`, which polls every `syncRetryInterval` (30s) via a non-blocking `WaitForCacheSync(alreadyClosedChan)` until success or `Stop()`. This only ever affects a background goroutine (`StartClusterCache` launches `Start` via `go func(){}`) — never an HTTP request.
- **Files Changed:** `kubilitics-backend/internal/k8s/informer.go`
- **Regression Test:** `informer_sync_test.go` (new) — `TestInformerManager_WaitForSync_TimesOutIfNeverStarted` (uses a `PrependReactor` that always fails `list` on Pods, simulating the audit's own RBAC-denial example, so the sync genuinely never completes — not just "never started," which turned out to report vacuously synced since `WaitForCacheSync` only considers informers that were actually started), `TestInformerManager_WaitForSync_SucceedsWhenStarted` (happy-path non-regression), `TestInformerManager_RetrySyncInBackground_StopsPromptlyOnStop` (proves no goroutine leak — the retry loop exits on `Stop()` well before its 30s ticker would otherwise fire).
- **Tests Executed:** `go test ./internal/k8s/... -run TestInformerManager -v` → 3/3 pass. `go test ./internal/k8s/... ./internal/service/...` (full package) → all pass. Full `go build ./...` and `go vet ./internal/k8s/... ./internal/api/rest/...` → clean.
- **Before:** A permanently-failing resource sync blocks `Start()`'s goroutine forever; no log signal distinguishes this from normal warmup.
- **After:** `Start()` returns (with an error, logged) within 2 minutes; the cache keeps attempting to sync every 30s in the background without blocking anything further, and `Stop()` halts the retry loop promptly (proven via the stop-respects test, not just asserted).
- **Known Limitations:** The "surface failure as a visible per-cluster health flag" half of the roadmap's recommendation was deliberately **not** implemented — that reaches into Phase 2's HEALTH-2 scope (no staleness/health-flag concept exists yet anywhere in this codebase), and adding one here would be scope creep beyond "smallest safe change." The fix in this phase is the actionable-logging + non-blocking-retry half only.
- **Remaining Risk:** Low. Documented dependency on Phase 2 for full visibility.

---

## Finding: TOPOLOGY-2 (timeout-mismatch half)

- **Severity:** P1
- **Status:** FIXED
- **Root Cause:** `useClusterTopology.ts` raced a hardcoded 8s `Promise.race` against the topology fetch — shorter than the backend's own `topology_timeout_sec` (default 30s, `kubilitics-backend/internal/config/config.go`) — and the `Promise.race` losing branch did not actually cancel the underlying `fetch()`, so backend work continued after the UI had already shown an error.
- **Change:** Removed the `Promise.race`/`setTimeout` pattern entirely. Added `BackendRequestInit.timeoutMs` to `client.ts` (an optional per-call override of the LOADING-1 default, since topology's natural duration can legitimately exceed the generic 20s safety net) and threaded it through `getTopology()` into `backendRequest()`. `useClusterTopology` now passes `{ timeoutMs: 35_000 }` (comfortably above the backend's 30s budget, with margin), enforced via `backendRequest`'s real `AbortSignal` — so giving up client-side now actually cancels the in-flight request instead of abandoning it.
- **Files Changed:** `kubilitics-frontend/src/services/api/client.ts` (new `BackendRequestInit`/`timeoutMs` plumbing — shared with LOADING-1), `kubilitics-frontend/src/services/api/topology.ts`, `kubilitics-frontend/src/hooks/useClusterTopology.ts`
- **Regression Test:** `client.test.ts` — "honors a per-call timeoutMs override instead of the 20s default", "defaults to 20s when no timeoutMs override is given". `topology.test.ts` — "forwards an init (timeoutMs/signal) to backendRequest when provided", plus a companion unchanged-call-shape test.
- **Tests Executed:** `npx vitest run src/services/api/client.test.ts src/services/api/topology.test.ts` → 72/72 pass. Full sweep → no regressions.
- **Before:** Client gives up at 8s regardless of the backend's 30s budget; the abandoned fetch keeps running server-side.
- **After:** Client timeout (35s) exceeds the backend's configured ceiling, and giving up now sends a real abort signal through `fetch()`.
- **Known Limitations:** 35s is a static constant with a comment cross-referencing the backend's `topology_timeout_sec` config key — it is not fetched dynamically from the backend's actual configured value. If an operator raises `topology_timeout_sec` above 35s in their deployment, this constant would need a matching update. This is the same class of drift risk the audit itself flagged for the original 8s/30s mismatch, now with a comment as a tripwire rather than eliminated structurally (eliminating it structurally would require a new "fetch backend config" capability, out of scope for a minimal Phase 1 change). TOPOLOGY-1 (namespace scoping, Phase 5) is explicitly **not** addressed here — this fix only reconciles the timeout budgets and adds real cancellation.
- **Remaining Risk:** Low-to-moderate (the static-constant drift risk above).

---

## Finding: LIFECYCLE-2 (timeout half)

- **Severity:** P2
- **Status:** FIXED
- **Root Cause:** Two parts, per the audit: (a) no client-side timeout on the delete request, and (b) the delete mutation's `onError` never cleared `clusterToRemove`, leaving the confirmation dialog visibly open after a failed delete.
- **Change:** Part (a) was already closed as a side effect of LOADING-1 — `deleteCluster()` (`kubilitics-frontend/src/services/api/clusters.ts`) already routes through `backendRequest`, which now has the 20s default timeout + actionable `BackendApiError`. This phase's remaining work was part (b): added `setClusterToRemove(null)` to the mutation's `onError` in `kubilitics-frontend/src/pages/Settings.tsx`, mirroring the existing `onSuccess` cleanup.
- **Files Changed:** `kubilitics-frontend/src/pages/Settings.tsx`, `kubilitics-frontend/src/pages/__tests__/page-smoke.test.tsx` (test infrastructure: made `useClustersFromBackend`'s and `deleteCluster`'s mocks controllable per-test instead of static, reusing the existing smoke-test mock setup rather than duplicating it in a new file)
- **Regression Test:** `page-smoke.test.tsx` — new `describe('delete cluster — error path (LIFECYCLE-2)')` block: renders `Settings` with one mocked cluster, clicks the delete-trigger icon button (located via its lucide `trash2` SVG class, since the button has no accessible text), confirms via the "Remove Cluster" button, and asserts the dialog closes even though the mocked `deleteCluster` rejects.
- **Tests Executed:** `npx vitest run src/pages/__tests__/page-smoke.test.tsx` → 10/10 pass. **Verified the test actually catches the bug**: reverted the `Settings.tsx` fix via `git stash`, re-ran the same test, confirmed it fails exactly as expected (dialog stays open, `waitFor` times out) — then restored the fix and confirmed all 10 tests pass again. Full `src/pages`/`src/services`/`src/hooks` sweep → no regressions.
- **Before:** A rejected `deleteCluster` call leaves `clusterToRemove` set, so the `AlertDialog` (`open={!!clusterToRemove}`) stays open.
- **After:** `onError` clears `clusterToRemove`, closing the dialog; a toast still surfaces the error.
- **Known Limitations:** None beyond LIFECYCLE-2's own explicitly Phase-1-scoped half (removal-lifecycle correctness, stale health, cross-cluster contamination are Phase 2).
- **Remaining Risk:** Low.

---

## Pre-Existing Failures (not introduced by this phase, not fixed — out of scope)

`src/pages/ClusterPickerPage.test.tsx` has 2 failing assertions (`expect(screen.getByText(/no clusters found/i))...` and a related one) that **pre-exist on unmodified `main`**, verified directly: stashed all Phase 1 changes, re-ran the test in isolation, same 2 failures occurred with identical stack traces. This is unrelated to any Phase 1 finding (not in LOADING-1..5/TOPOLOGY-2/LIFECYCLE-2's scope) and was left untouched per the "do not fix unrelated code" rule. Restored all Phase 1 changes immediately after confirming this.

---

## Files Changed (full list, Phase 1)

**Backend:**
- `kubilitics-backend/internal/api/rest/overview.go` (LOADING-3)
- `kubilitics-backend/internal/k8s/client.go` (LOADING-3 — exported `WithTimeout`)
- `kubilitics-backend/internal/k8s/informer.go` (LOADING-5)
- `kubilitics-backend/internal/k8s/client_timeout_test.go` (new, LOADING-3 regression tests)
- `kubilitics-backend/internal/k8s/informer_sync_test.go` (new, LOADING-5 regression tests)

**Frontend:**
- `kubilitics-frontend/src/services/api/client.ts` (LOADING-1, LOADING-2 groundwork, TOPOLOGY-2's `timeoutMs`)
- `kubilitics-frontend/src/services/api/client.test.ts` (regression tests for the above)
- `kubilitics-frontend/src/services/api/resources.ts` (LOADING-2)
- `kubilitics-frontend/src/services/api/resources.test.ts` (regression tests)
- `kubilitics-frontend/src/hooks/useKubernetes.ts` (LOADING-2)
- `kubilitics-frontend/src/services/api/topology.ts` (TOPOLOGY-2)
- `kubilitics-frontend/src/services/api/topology.test.ts` (regression tests)
- `kubilitics-frontend/src/hooks/useClusterTopology.ts` (TOPOLOGY-2)
- `kubilitics-frontend/src/pages/Settings.tsx` (LIFECYCLE-2)
- `kubilitics-frontend/src/pages/__tests__/page-smoke.test.tsx` (LIFECYCLE-2 regression test + reusable mock infra)

**Documentation:**
- `docs/PRODUCTION-HARDENING-EXECUTION.md` (this file)

No other files were modified. No tests were weakened, deleted, or skipped to make anything pass. No unrelated code (including the pre-existing `kubilitics-desktop` deletions already present in the working tree at session start) was touched.

---

## Phase 1 Acceptance Gate — Assessment

1. **Every Phase 1 finding is FIXED or explicitly BLOCKED/UNVERIFIED with evidence.** → 6 of 7 FIXED (LOADING-1, LOADING-2, LOADING-3, LOADING-5, TOPOLOGY-2, LIFECYCLE-2); 1 of 7 BLOCKED with documented evidence and reasoning (LOADING-4).
2. **Regression tests exist for every fixed finding.** → Yes, enumerated above per finding; the LIFECYCLE-2 test was explicitly verified to fail against the pre-fix code.
3. **Relevant tests pass.** → Yes: full backend `go test ./internal/...` all pass; full frontend `src/pages src/services src/hooks` sweep passes except the 2 pre-existing, unrelated, out-of-scope failures.
4. **No critical Phase-1 operation can remain indefinitely pending.** → LOADING-1/2 bound every `backendRequest`/`backendRequestText` call; LOADING-3 bounds the Overview fallback's raw K8s calls; LOADING-5 bounds informer cache-sync waiting; TOPOLOGY-2 bounds and reconciles the topology fetch's timeout budgets with real cancellation; LIFECYCLE-2 ensures the delete-cluster UI never appears stuck. LOADING-4's blanket-timeout gap remains (BLOCKED), but its one confirmed concrete exploit (LOADING-3) is closed.
5. **Cancellation behaves correctly.** → Verified: LOADING-1's timeout doesn't open the circuit breaker for a single slow request (isolated); LOADING-5's retry loop exits promptly on `Stop()` (no leak); TOPOLOGY-2's abort actually propagates to `fetch()`.
6. **Timeout errors are actionable.** → All converted to `BackendApiError` with a clear "Request timed out after Xs" message, not raw `DOMException`s.
7. **Cluster isolation is preserved.** → LOADING-1's per-request timeout doesn't affect other clusters/endpoints; LOADING-5's per-cluster `InformerManager` retry loop is independent per cluster; LOADING-4 was explicitly *not* implemented specifically because the naive fix would have broken cluster isolation (cutting watches across all clusters sharing a timeout-bound transport) — the BLOCKED decision itself is in service of this gate.
8. **No unrelated production behavior was changed.** → Confirmed via `git status`/`git diff` review after each finding; the one pre-existing unrelated test failure was investigated, confirmed pre-existing, and left untouched.
9. **No new P0/P1 regression was introduced.** → Full backend and frontend regression sweeps confirm this.
10. **Evidence is documented.** → This document.

**Phase 1 acceptance: PASS, with one finding (LOADING-4) explicitly BLOCKED and documented rather than forced through.** The roadmap's Phase 1 gate text — "No critical user operation can hang indefinitely" — is met for every confirmed-live hang path from the audit (STARTUP-1 is Phase 2/4, not Phase 1). LOADING-4 was a defense-in-depth, P2, "not verified to have caused a production incident" finding whose naive fix would have introduced a worse regression than the gap it closed; blocking it with full evidence is the correct outcome of this phase's own anti-hallucination and scope-control rules, not a failure of the phase.

---

PHASE 1 COMPLETE — STOPPED FOR APPROVAL

---
---

# Phase 2 — Cluster Lifecycle: Execution Record

**Date:** 2026-10-02
**Scope (exact finding IDs, per `docs/PRODUCTION-HARDENING-ROADMAP.md`):** STARTUP-1, HEALTH-1, HEALTH-2, CONTAM-1, LIFECYCLE-1 (lock-in test only). Nothing else. Verified against the roadmap text before touching any code.
**Phase 1 diff inspected before starting:** yes — re-read `kubilitics-backend/internal/api/rest/overview.go`, `internal/k8s/client.go`, `internal/k8s/informer.go`, and the frontend `client.ts`/`useKubernetes.ts`/`useClusterTopology.ts`/`Settings.tsx` diffs from Phase 1 to confirm none of them touch cluster lifecycle code before starting Phase 2 work.

## Step 1 — Revalidation of Phase 2 findings against current (post-Phase-1) code

| Finding | Status before this phase | Evidence re-read | Phase 1 touched it? |
|---|---|---|---|
| STARTUP-1 | CONFIRMED | `cluster_service.go:706-773` — sequential `for _, c := range clusters` loop, `loadStartupTimeout = 8s`, unchanged byte-for-byte from the audit. | No — Phase 1 touched `overview.go`, `informer.go`, `client.go`'s `WithTimeout` export; never `LoadClustersFromRepo`. |
| HEALTH-1 | CONFIRMED | `manager.go:94-102` (now 81-109 pre-edit) — `Reachable: true` still a hardcoded literal with no surrounding conditional. | No. |
| HEALTH-2 | CONFIRMED | `presence/types.go` — no `LastCheckedAt`/`LastSuccessAt`/`LastError` fields existed; `k8s.Client` had `lastSuccessTime`/`lastError` but no exported "last checked" accessor. | No. |
| CONTAM-1 | CONFIRMED | `internal/api/websocket/handler.go:212`, `SetupInformerHandlers` — re-confirmed zero call sites anywhere in the repo via `grep -rn "SetupInformerHandlers("`. Still dead code, still inert (no resource events are broadcast through this path today). | No. |
| LIFECYCLE-1 | ALREADY FIXED (per audit) | `cluster_service.go:586-598`, `RemoveCluster` — still only touches `s.repo`, `s.clients` map, `s.overviewCache`; no client/network call anywhere in the function body. Confirmed unchanged. | No. |

No discrepancy between the audit and current code was found for any Phase 2 finding — all 5 proceeded as scoped.

## Step 2 — Cluster lifecycle map (as traced, not redesigned)

```
kubeconfig / in-cluster / manual discovery
   (internal/cluster/discovery: KubeconfigFileSource, KubernetesSecretSource,
    ManualSource — Enumerate() only, never dials the network)
        │
        ▼
cluster definition (DiscoveredCluster: Identity, Source, optional SessionID/Provider)
        │  Manager.Refresh() dedups across sources, first-wins by identity key
        ▼
persistence (repository.ClusterRepository: SQLite single-conn — db.SetMaxOpenConns(1),
   WAL + 5s busy_timeout, so concurrent Update()s from Phase 2's new bounded
   fan-out serialize safely — or Postgres pool)
        │
        ▼
client creation (clusterService.buildClientForCluster → k8s.NewClient /
   k8s.NewClientFromBytes, or clientFactory override in tests)
        │
        ▼
connection test (client.TestConnection — circuit-breaker + retry + Client.Timeout
   via withTimeout; LoadClustersFromRepo now fans this out concurrently, bounded
   by loadClustersConcurrency=10, instead of sequentially — Phase 2/STARTUP-1)
        │
        ├─ success ──────────────┐
        │                        ▼
        │              client registered: s.clients[id] = client (mutex-guarded)
        │                        │
        │                        ▼
        │              informer/cache init: OverviewCache.StartClusterCache →
        │              k8s.InformerManager.Start (Phase 1's bounded initial-sync
        │              wait + background retry — unchanged by Phase 2)
        │                        │
        │                        ▼
        │              health tracking: client.updateHealth() on every
        │              TestConnection/GetClusterInfo call — lastSuccessTime,
        │              lastError, and (new in Phase 2) lastCheckedTime
        │                        │
        │                        ▼
        │              presence reachability: discovery.Manager.Snapshot() now
        │              calls the wired ReachabilityChecker (clusterService.GetClient
        │              + client.HealthStatus()/LastCheckedAt()) per registered
        │              cluster — fails closed if ever unwired (Phase 2/HEALTH-1/2)
        │
        └─ failure ──► c.Status = clusterStatusFromError(err); client NOT
                        registered; no informer cache started; failure is fully
                        local to this cluster's loop iteration/goroutine — never
                        touches another cluster's state (Phase 2 isolation)

refresh/reconnect:
   - ListClusters/GetCluster: live GetClusterInfo() refresh per cluster on every
     read (pre-existing, unbounded per-cluster goroutines — not part of Phase 2's
     scoped findings, left untouched)
   - tryReconnectCluster: rebuilds a client when none is registered (e.g. after
     restart) — unchanged
   - periodic 60s ticker (main.go): now ALSO calls clusterService.ListClusters()
     (refreshes health) before discoveryMgr.Refresh() (rebuilds the discovery
     snapshot) — new in Phase 2/HEALTH-2, reusing ListClusters' existing
     refresh-on-read pattern instead of inventing a second health-check loop

removal: RemoveCluster — repo.Delete + delete(s.clients, id) + StopClusterCache
   (closes the informer's stopCh). No network call. Locked in with a new
   regression test this phase (LIFECYCLE-1).

cleanup: StopClusterCache → InformerManager.Stop() → close(stopCh) → Phase 1's
   waitForSync/retrySyncInBackground goroutines observe the closed channel and
   exit promptly (verified in Phase 1, re-verified intact this phase).

re-addition: AddCluster — unaffected by a prior removal; same buildClientForCluster
   path. Idempotency (remove → re-add) verified by existing + new tests.

dead/inert path (CONTAM-1, left alone): WebSocket SetupInformerHandlers — never
   called, hardcodes clusterID="", ServeWS never reads cluster_id. No resource
   events flow through it today, so no live cross-cluster contamination exists;
   deferred rather than resumed (see Finding: CONTAM-1 below).
```

## Step 3 — Cluster isolation verification

Tested combinations (all via deterministic fakes — no real cluster, VPN, or cloud credentials required):

| Scenario | Test | Result |
|---|---|---|
| N uniform-delay clusters (simulates several slow-but-reachable clusters) | `TestLoadClustersFromRepo_ConcurrentNotSequential` | 5 clusters × 150ms each completed in 303ms (not 750ms) — concurrent, not sequential. |
| Many more clusters than the concurrency bound (simulates unreachable/hanging clusters at scale) | `TestLoadClustersFromRepo_ConcurrencyIsBounded` | 25 clusters, observed max concurrent connections = exactly 10 (the configured bound) — not unbounded, not 1. |
| Healthy + unreachable mix | `TestLoadClustersFromRepo_OneFailureDoesNotAffectOthers` | 2 healthy clusters end up `"connected"` with live registered clients; 1 failing cluster ends up non-`"connected"` with no registered client — neither affects the other's recorded status. |
| Reachability check isolation (HEALTH dimension) | `TestManager_Snapshot_UsesWiredReachabilityChecker_PerClusterIsolation` | Two clusters, one checker returning `Reachable:true`/success, one returning `Reachable:false`/error — asserted neither's `LastError`/`LastSuccessAt` leaks onto the other. |
| Cluster removal vs. a client whose further calls would be caught | `TestClusterService_RemoveCluster_NeverDialsRemoteCluster` | Reactor-instrumented fake client proves zero calls happen during `RemoveCluster`, and removing an already-removed cluster also dials nothing. |

**Not separately tested this phase (honest gap, not claimed as covered):** authentication-failure and RBAC-failure as distinct error *classification* scenarios — `clusterStatusFromError`'s classification logic is pre-existing and was not modified by Phase 2 (only the loop structure around it changed from sequential to bounded-concurrent), so no new test was added for it specifically. The isolation property that matters for Phase 2 (one cluster's outcome, whatever its error type, never affects another's) is proven generically by `TestLoadClustersFromRepo_OneFailureDoesNotAffectOthers` regardless of which error type is simulated.

## Step 4 — Client lifecycle

No change to client ownership model: each cluster has exactly one `*k8s.Client` in `s.clients[id]`, written/read under `s.mu` (`sync.RWMutex`), same as before Phase 2. `LoadClustersFromRepo`'s new concurrent fan-out does not create duplicate clients — each goroutine builds and owns exactly one client for its own cluster ID, and registration (`s.clients[c.ID] = client`) is mutex-guarded so concurrent writers from different clusters never race (confirmed via `-race`). No client is closed by `RemoveCluster` while another operation could still be using it — `RemoveCluster` only removes the client from the map; any in-flight call already holding a reference to the old `*k8s.Client` value keeps using it safely (Go doesn't invalidate a value out from under an existing reference), and no new caller can obtain it from the map after removal. Failed connection attempts (`clientErr != nil` or `connErr != nil` in `loadOneClusterFromRepo`) never register a client and never start an informer cache — no zombie resources are created on the failure path (unchanged behavior, re-verified).

## Step 5 — Informer / cache lifecycle

Re-verified Phase 1's `waitForSync`/`retrySyncInBackground` mechanism is untouched by Phase 2 (confirmed via `git diff` on `informer.go` for this phase — zero changes). `StopClusterCache` → `InformerManager.Stop()` → `close(im.stopCh)` is the same single exit path for cancellation used by both the Phase 1 retry loop and normal removal; Phase 2 didn't add a second one. Verified via the existing `TestInformerManager_RetrySyncInBackground_StopsPromptlyOnStop` (Phase 1, re-run this phase) that `Stop()` still halts background work promptly. `RemoveCluster`'s call to `StopClusterCache` is unconditional and local — confirmed via `TestClusterService_RemoveCluster_NeverDialsRemoteCluster`, which also implicitly confirms this path doesn't panic or hang when the cluster being removed has a registered client.

## Step 6 — Kubeconfig discovery

Re-confirmed unchanged from the audit: `discovery.Manager.Refresh()`/`Enumerate()` only parse kubeconfig YAML — zero network calls (`kubeconfig_source.go`'s `Enumerate` was not touched this phase). Connection testing remains a fully separate concern (`ClusterService`/`k8s.Client`), now bounded, isolated (per-goroutine, no shared cancellation), and independently reported (each cluster's own `c.Status`) — exactly per Step 6's requirement. Concurrency was NOT introduced blindly: `loadClustersConcurrency=10` was chosen deliberately (documented in the code comment) after considering exec-based auth plugin subprocess spawning (aws eks get-token, gke-gcloud-auth-plugin) and the target "100+ cluster" persona — fanning out all N connections unboundedly was explicitly rejected in favor of a bounded worker-pool-style limit, consistent with this phase's "do not blindly parallelize" instruction.

## Step 7 — Health (boundary check only, not fixed beyond HEALTH-1/HEALTH-2's explicit scope)

HEALTH-1 and HEALTH-2 were explicitly assigned to Phase 2 by the roadmap, so both were fixed (see findings below) — this is not scope creep, it's the roadmap's own scope. No other health-adjacent behavior (e.g. frontend health dashboards, cluster health scoring in `internal/healthscore`) was touched. Phase 2's lifecycle changes do not make any pre-existing health behavior worse: `GetClusterSummary`'s own health computation (used by Fleet) is untouched; the new periodic `ListClusters()` call in the 60s ticker reuses that function's existing, unmodified refresh logic rather than adding a competing one.

---

## Finding: STARTUP-1

- **Severity:** P0
- **Status:** FIXED
- **Root Cause:** `LoadClustersFromRepo` (`cluster_service.go`) connected to every persisted cluster sequentially; N slow/unreachable clusters cost N × `loadStartupTimeout` (8s) — measured in Phase 0 at 24.005s for 3 synthetic unroutable clusters.
- **Change:** Extracted the per-cluster body into `loadOneClusterFromRepo` (identical logic, no behavior change) and replaced the sequential loop with a bounded `errgroup.WithContext(ctx)` + `g.SetLimit(loadClustersConcurrency=10)` fan-out — reusing the exact pattern already proven correct in `fleet.go`'s `GetFleetOverview` (errgroup, mutex-free since each goroutine only touches its own cluster row, always returns `nil` so one cluster's failure never cancels the group's context for the others). The concurrency bound was a deliberate choice (not "parallelize everything"): documented reasoning covers exec-based auth plugin subprocess cost and the "100+ cluster" target persona.
- **Files Changed:** `kubilitics-backend/internal/service/cluster_service.go`
- **Regression Test:** `cluster_service_startup_test.go` (new) — `TestLoadClustersFromRepo_ConcurrentNotSequential`, `TestLoadClustersFromRepo_ConcurrencyIsBounded`, `TestLoadClustersFromRepo_OneFailureDoesNotAffectOthers`. Also required a thread-safety fix to the test-only `mockClusterRepo` (added a `sync.Mutex` — the real SQLite/Postgres repos are already safe for concurrent `Update()`, confirmed by reading `sqlite.go`'s `db.SetMaxOpenConns(1)` + WAL + busy_timeout; the plain-map test fake was not).
- **Tests Executed:** `go test ./internal/service/... -race` → all pass, no data races.
- **Before:** 5 clusters × 150ms delay each (simulating slow connections) = sequential loop would cost 750ms.
- **After:** Same 5 clusters complete in 303ms — measured, not estimated. 25 clusters with always-failing connections: observed max concurrent in-flight connections = exactly 10 (the configured bound), confirmed empirically via an atomic counter in a fake-clientset reactor.
- **Known Limitations:** `GetClusterSummary` (used by Fleet, a different handler) still makes raw, un-timed `Clientset` calls — this is FLEET-1's own UNVERIFIED caveat from the audit, assigned to Phase 4, not touched here.
- **Remaining Risk:** Low. The bound (10) is a judgment call, not derived from a measured resource ceiling; if real-world exec-auth-plugin resource usage turns out to tolerate much higher concurrency, 10 may be conservative — easy to tune later, not a correctness risk either direction.

---

## Finding: HEALTH-1

- **Severity:** P0
- **Status:** FIXED
- **Root Cause:** `discovery.Manager.Snapshot()` set `Reachable: true` as a hardcoded literal for every registered cluster, with no connectivity check anywhere in the function.
- **Change:** Added `ReachabilityChecker` (a function type) and `Manager.SetReachabilityChecker()` to the `discovery` package (avoids a circular import between `discovery` and `service`). Wired in `main.go` to a closure using `clusterService.GetClient(sessionID)` + `client.HealthStatus()` — the client registry and per-client health tracking that already existed and were already correct, reused rather than reinvented. **Deliberately fails closed**: with no checker wired (e.g. in older/other callers or tests), `Reachable` is now `false`, not the old hardcoded `true` — "unverified" must never present as "healthy."
- **Files Changed:** `kubilitics-backend/internal/cluster/discovery/manager.go`, `kubilitics-backend/cmd/server/main.go`, `kubilitics-backend/internal/cluster/presence/types.go` (new fields, see HEALTH-2)
- **Regression Test:** `manager_test.go` — `TestManager_Snapshot_FailsClosedWithoutReachabilityChecker` (proves the new fail-closed default), `TestManager_Snapshot_UsesWiredReachabilityChecker_PerClusterIsolation` (proves per-cluster correctness and that results don't leak between clusters).
- **Tests Executed:** `go test ./internal/cluster/discovery/... -race` → all pass, including all pre-existing tests (none asserted the old `Reachable: true` default, confirmed by grep before changing it).
- **Before:** Every registered cluster's `Reachable` field is `true` regardless of actual state — confirmed in Phase 0 by reading the literal.
- **After:** `Reachable` reflects `clusterService.GetClient()` + `client.HealthStatus()` — a cluster with no live client (never connected, disconnected, or removed) now reports `Reachable: false`.
- **Known Limitations:** Reachability reflects the *last check* (from `TestConnection`/`GetClusterInfo`, now also re-run every 60s via the periodic `ListClusters()` call — see HEALTH-2), not a live check performed at the moment `/api/v1/presence` is polled. A cluster that goes offline has a worst-case ~60s window before `Reachable` flips, not an instant one. Making this fully live (a bounded preflight-per-poll) was considered and rejected this phase as a larger architectural change than "wire to a real check" calls for — documented here rather than silently accepted.
- **Remaining Risk:** Low. The 60s staleness window is bounded and visible (via `LastCheckedAt`), which is the core HEALTH-1/HEALTH-2 ask — "never represent stale/unknown state as current HEALTHY" is satisfied because staleness is now representable and bounded, even though it isn't zero.

---

## Finding: HEALTH-2

- **Severity:** P1
- **Status:** FIXED
- **Root Cause:** No staleness/last-checked concept existed anywhere — `presence.RegisteredCluster` had no timestamp fields at all, and `k8s.Client` tracked `lastSuccessTime`/`lastError` internally but had no "last checked" (as opposed to "last succeeded") signal, and no exported accessor usable outside the `k8s` package for freshness purposes.
- **Change:** Added `lastCheckedTime` to `k8s.Client` (set on every `updateHealth` call, success or failure — distinct from `lastSuccessTime`, which only moves on success) and an exported `LastCheckedAt()` getter (added without changing `HealthStatus()`'s existing 4-value signature, to avoid touching its two existing test call sites). Added `LastCheckedAt`/`LastSuccessAt`/`LastError` to `presence.RegisteredCluster`, populated from the `ReachabilityChecker` in `Snapshot()`. Added a periodic re-check: the existing 60s discovery-refresh ticker in `main.go` now also calls `clusterService.ListClusters()` first (reusing its existing, unmodified live-`GetClusterInfo`-per-cluster refresh logic) so staleness is bounded to ~60s instead of "until the next unrelated page view." Minimally surfaced on the frontend: `RegisteredCluster` TS type gained the 3 new optional fields, and `ClusterPickerPage`'s existing reachability-dot tooltip now appends a "checked Xs/Xm ago" suffix when available (additive, no layout/behavior change to the dot itself).
- **Files Changed:** `kubilitics-backend/internal/k8s/client.go`, `kubilitics-backend/internal/cluster/presence/types.go`, `kubilitics-backend/cmd/server/main.go`, `kubilitics-frontend/src/types/resilient.ts`, `kubilitics-frontend/src/pages/ClusterPickerPage.tsx`
- **Regression Test:** `client_timeout_test.go` — `TestClient_LastCheckedAt_AdvancesOnEveryAttempt` (proves the new timestamp advances on both success and the zero-value-before-any-check case). `manager_test.go`'s isolation test (above) also asserts `LastCheckedAt`/`LastSuccessAt`/`LastError` are populated correctly per cluster.
- **Tests Executed:** `go test ./internal/k8s/... ./internal/cluster/discovery/... -race` → all pass. Frontend: `npx tsc --noEmit` clean; `ClusterPickerPage.test.tsx` → same 6/8 passing as before (2 pre-existing, unrelated failures unchanged — see Pre-Existing Failures).
- **Before:** No way to distinguish "checked 2 seconds ago" from "checked 10 minutes ago" from "never checked."
- **After:** `LastCheckedAt` is populated on every check and visibly surfaced; measured directly in the new `k8s` test.
- **Known Limitations:** `Latency` (named in the roadmap's scope bullet list) was deliberately not implemented — it would require wrapping every `TestConnection`/`GetClusterInfo` call site with timing, a larger change than the staleness-timestamp core ask, and isn't mentioned in the Phase 2 gate text (only "a visible last-checked timestamp" is). Documented as a deferred nice-to-have, not silently dropped.
- **Remaining Risk:** Low.

---

## Finding: CONTAM-1

- **Severity:** P1 (dormant — feature remains inert)
- **Status:** DEFERRED (not fixed, not blocked — explicitly deferred per the roadmap's own stated option)
- **Root Cause (unchanged from audit):** `internal/api/websocket/handler.go`'s `SetupInformerHandlers` is the only caller of `Hub.BroadcastResourceEvent`, hardcodes `clusterID=""`, and is itself never called anywhere in the repo. `ServeWS` never reads a `cluster_id` to scope a client's subscription.
- **Evidence this phase:** Re-confirmed via `grep -rn "SetupInformerHandlers("` across the whole repo — exactly one match, the function's own definition. No resource/topology events are broadcast through this path today; it is inert, not degraded.
- **Decision:** The roadmap's own Phase 2 scope text gives an explicit option: *"If this work is not prioritized this phase, explicitly mark CONTAM-1 as 'deferred, feature remains inert' rather than silently leaving it ambiguous."* Resuming it would mean modifying the WebSocket subscription model (`ServeWS`, `Client.AcceptsCluster`, every `BroadcastResourceEvent` call site) — a larger unit of work than this phase's other 4 findings, with zero current user-facing benefit since the feature has no live callers to fix. Per the Phase 2 instructions' own anti-scope-creep rule ("if an architectural change appears necessary outside Phase 2: STOP. Do not expand scope."), I did not start this work.
- **Files Changed:** None.
- **Regression Test:** None added — nothing was changed to regress. (Note: this is explicitly a deferral, not a "fixed" claim — no regression coverage is claimed for it.)
- **Recommended path forward:** Before any future work resumes this real-time pipeline: wire `ServeWS` to read `cluster_id` (or require a subscribe message) and tag every `BroadcastResourceEvent` call with the real originating cluster ID, then add the integration test the original audit already specified (client subscribed to cluster B never receives a cluster-A-tagged message).
- **Remaining Risk:** None additional today (inert). Risk is deferred to whoever next touches this code path without re-reading this note.

---

## Finding: LIFECYCLE-1

- **Severity:** P3 (informational in the audit — a confirmed-correct guarantee, not a bug)
- **Status:** ALREADY FIXED — locked in with a new regression test this phase, per the roadmap's explicit instruction.
- **Root Cause:** N/A — `RemoveCluster` was already correct (local-only, no remote dial).
- **Evidence:** `cluster_service.go:586-598` — unchanged from the audit; only touches `s.repo`, `s.clients`, `s.overviewCache`.
- **Change:** None to production code. Added the missing automated test.
- **Files Changed:** `kubilitics-backend/internal/service/cluster_service_removal_test.go` (new)
- **Regression Test:** `TestClusterService_RemoveCluster_NeverDialsRemoteCluster` — uses a fake-clientset reactor on `"*"`/`"*"` to detect ANY call made through the cluster's client; proves zero such calls happen during `RemoveCluster` (after resetting the flag past `AddCluster`'s own legitimate one-time connectivity check), confirms the client and repo row are actually gone, and confirms removing an already-removed cluster fails cleanly (idempotent, no hang, no second dial).
- **Tests Executed:** `go test ./internal/service/... -run TestClusterService_RemoveCluster -v` → 3/3 pass (1 new, 2 pre-existing).
- **Before:** Guarantee existed in code but was unverified by any automated test.
- **After:** Guarantee is now proven by a test that would fail if a future change introduced a remote dial into the removal path.
- **Known Limitations:** None.
- **Remaining Risk:** None.

---

## Pre-Existing Failures (unchanged from Phase 1, not touched)

Same 2 pre-existing, unrelated failures in `src/pages/ClusterPickerPage.test.tsx` noted in the Phase 1 record. Re-confirmed present and unchanged after Phase 2 (same assertion, same stack trace, same count — 6/8 passing in that file both before and after this phase's changes).

## Phase 1 Regression Protection — Verified Intact

- `go test ./internal/k8s/... ./internal/api/rest/... ./internal/service/... -race` → all pass (covers LOADING-3's `overview.go` fix, LOADING-5's informer sync fix, and their regression tests).
- Frontend: `npx vitest run src/services/api/client.test.ts src/services/api/topology.test.ts src/pages/__tests__/page-smoke.test.tsx` → all pass (covers LOADING-1/2's `client.ts` timeout, TOPOLOGY-2's reconciled budget, LIFECYCLE-2's dialog-cleanup fix).
- `git diff` confirms zero changes to any Phase-1-owned file beyond what Phase 2 legitimately needed to touch (`overview.go`, `client.go`, `informer.go` have no NEW diffs this phase beyond what Phase 1 already introduced — verified by diffing this session's changes in isolation from Phase 1's).
- No Phase 1 behavior was modified to accommodate Phase 2 — every Phase 2 change is additive (new fields, new functions, new call sites) except the one necessary restructuring (`LoadClustersFromRepo`'s loop → bounded fan-out), which doesn't touch any Phase-1-owned code.

## Phase 2 Acceptance Gate — Assessment

1. **All Phase 2 findings FIXED or explicitly BLOCKED/UNVERIFIED with evidence.** → 4 of 5 FIXED (STARTUP-1, HEALTH-1, HEALTH-2, LIFECYCLE-1-locked-in); 1 of 5 DEFERRED with full documented reasoning (CONTAM-1) — the roadmap itself authorized this specific outcome.
2. **Healthy clusters remain usable when another cluster fails.** → Proven by `TestLoadClustersFromRepo_OneFailureDoesNotAffectOthers` and `TestManager_Snapshot_UsesWiredReachabilityChecker_PerClusterIsolation`.
3. **Cluster lifecycle operations are bounded.** → `LoadClustersFromRepo`'s connection fan-out is bounded (10, measured); informer sync remains bounded (Phase 1, re-verified); removal is immediate and local.
4. **Removal is deterministic.** → `TestClusterService_RemoveCluster_NeverDialsRemoteCluster` proves no network dependency, and idempotent re-removal.
5. **Re-addition is deterministic.** → `AddCluster` path is unaffected by Phase 2's changes; existing `TestClusterService_AddCluster_Idempotent` (pre-existing) plus the removal test's own add-then-remove sequence exercise this.
6. **No zombie client/informer/cache lifecycle remains in tested paths.** → Verified: failed connections never register a client or start an informer cache (Step 4); `StopClusterCache`'s cancellation path is the same one Phase 1 already proved leak-free.
7. **Regression tests cover every fixed finding.** → Yes, enumerated above (STARTUP-1 ×3, HEALTH-1 ×2, HEALTH-2 ×1 new + shared isolation test, LIFECYCLE-1 ×1).
8. **Phase 1 behavior remains intact.** → Verified above with explicit re-runs.
9. **No unrelated P0/P1/P2 work was introduced.** → Confirmed via `git status`; every changed file maps to one of the 5 scoped findings. CONTAM-1 was explicitly NOT expanded into a fix.
10. **All evidence documented.** → This document.

**Phase 2 acceptance: PASS**, with CONTAM-1 explicitly deferred (not fixed, not blocked — a third, roadmap-authorized outcome for dead/inert code) rather than either force-fixed beyond scope or left ambiguous.

---

PHASE 2 COMPLETE — STOPPED FOR APPROVAL

---
---

# Phase 3 — Data Correctness: Execution Record

**Date:** 2026-10-02
**Scope (exact finding IDs, per `docs/PRODUCTION-HARDENING-ROADMAP.md`):** COUNTS-1, METRICS-1, METRICS-2, plus COUNTS-2 and METRICS-3 (lock-in only — already correct). Nothing else.
**Phase 1/2 diff and tests reviewed before starting:** yes — confirmed Phase 1/2 touched `overview.go`, `client.go`, `informer.go`, `cluster_service.go`, `discovery/manager.go`, `presence/types.go`, and frontend `client.ts`/`useKubernetes.ts`/`useClusterTopology.ts`/`Settings.tsx`/`ClusterPickerPage.tsx` — none of which overlap with Phase 3's metrics/counts code paths (`overview_cache.go`'s pod counter, `internal/metrics/`, and the frontend memory/CPU parsers), so no Phase 1/2 behavior needed to change for Phase 3.

## Step 1 — Revalidation of Phase 3 findings against current (post-Phase-2) code

| Finding | Status before this phase | Evidence re-read |
|---|---|---|
| COUNTS-1 | CONFIRMED (matches Phase 0's reproduction exactly) | `overview_cache.go`'s `updatePodStatus` — `obj.(*corev1.Pod)` type assertion, unchanged; `cache.DeletedFinalStateUnknown` still never unwrapped anywhere in the repo (re-confirmed via grep). |
| METRICS-1 | CONFIRMED | `internal/metrics/aggregate.go`'s `parseCPUToMilli`/`parseMemoryToMi` — still blindly stripping unit-letter suffixes without applying their scale factor, byte-for-byte unchanged from the audit. |
| METRICS-2 | PARTIALLY CONFIRMED / PARTIALLY ALREADY FIXED (see below — this is the one finding where current code disagreed with the audit's blanket characterization, in a direction that *narrowed* the fix, not one that revealed a false alarm) | Re-read all ~8 files the audit named. **2 of 8 (`Nodes.tsx`'s `parseMemoryCapacityToMi`/`parseMemoryUsageToMi`, `NodeDetail.tsx`'s local `parseMemoryToMi`) were already correctly guarded** (`Number.isFinite` checks, return `number \| null`, percentage computation already treats `null`/zero-denominator as unknown rather than 0%) — confirmed via direct code read, not assumed. These were left untouched per "if already fixed, do not modify it." **The remaining 6 real reimplementations across `lib/utils.ts`, `ClusterCapacity.tsx`, `MetricsDashboard.tsx` (×2 pairs), `PodDetail.tsx`, and `useClusterUtilization.ts` were confirmed still broken** (`parseFloat(x) \|\| 0`/`parseInt(x) \|\| 0`/`Number.isNaN(v) ? 0 : v` patterns, plus two independent unit-scaling bugs found during re-verification: a bare-CPU-number magnitude heuristic and lowercase-letter memory suffixes being treated as valid decimal units). |
| COUNTS-2 | ALREADY FIXED (per audit) | `handler.go`'s `buildClusterSummary` — still correctly resolves a fresh client per request via `getClientFromRequest(ctx, r, clusterID, ...)`, keyed by the resolved cluster ID. Confirmed unchanged. |
| METRICS-3 | ALREADY FIXED (per audit) | `internal/service/metrics_service.go`, `internal/metrics/metrics_server_provider.go` — `resource.Quantity` → bytes conversions still consistently use `.Value()`/correct power-of-1024 division. Not modified. |

No STOP condition was triggered for any finding — METRICS-2's partial-already-fixed status is a *narrowing* of scope within the same finding ID (2 of 8 named files didn't need the fix), not a contradiction requiring a full stop; this is recorded transparently rather than silently claiming all 8 were fixed.

## Step 2 — Value traces (SOURCE → ... → DISPLAY)

### Metric: Pod Count (COUNTS-1)
- **Source:** Kubernetes Pod informer (`k8s.InformerManager`, `internal/k8s/informer.go`)
- **Collection:** `OverviewCache.updatePodStatus` — incremental per-event counter (`ov.Counts.Pods++`/`--`), **not** a store recompute like every sibling counter (deliberate O(1) optimization — pods can number in the thousands and the Running/Pending/Succeeded/Failed phase breakdown needs per-pod state, not just a count)
- **Transformation:** phase bucketing via `incrementPhaseCounter`/`decrementPhaseCounter`
- **Aggregation:** per-cluster total in `ov.Counts.Pods`
- **Cache:** `OverviewCache.overviews[clusterID]`, in-memory, updated on every informer event
- **DTO/API:** `GET /clusters/{id}/overview` → `models.ClusterOverview.Counts.Pods`
- **Frontend state/Display:** Dashboard `ClusterCapacity`/`LiveSignalStrip` widgets
- **Scope:** per-cluster (keyed by `clusterID` throughout)
- **Unit:** count (integer)
- **Semantics:** number of pods currently known to the informer's local cache
- **Freshness:** real-time via Watch events; now also self-healed every `podReconcileInterval` (5 min, matching the informer factory's own resync period)
- **Unknown/null behavior:** N/A (always a definite integer once the cache has started); prior to initial sync, `OverviewCache.GetOverview` returns `(nil, false)` — callers already treat that as "not ready," not zero

### Metric: Memory/CPU usage and limits (METRICS-1, METRICS-2)
- **Source:** Kubernetes Metrics API / metrics-server (live usage), Pod/Container spec `resources.requests`/`resources.limits` (admission-validated, not live-fetched)
- **Collection:** backend `internal/metrics/aggregate.go` (pod usage aggregation for the brain/addon layer); frontend fetches raw quantity strings via `getNodeMetrics`/`getPodMetrics`/resource list responses
- **Transformation:** quantity-string parsing — **this is where both METRICS-1 and METRICS-2 lived**
- **Canonical internal representation:** memory → bytes (frontend `parseK8sQuantityToBytes`) / Mi where a function's existing contract already committed to Mi (backend `parseMemoryToMi`, kept for its 2 existing callers); CPU → millicores (both backend `parseCPUToMilli`/`MilliValue()` and frontend `parseK8sCpuToMillicores`) — matching the representation already used elsewhere in the codebase (`internal/api/grpc/service.go`'s `parseMillicores`/`parseMemoryBytes`), not a new convention
- **Scope:** per-cluster (every call site threads `clusterId`; no cross-cluster aggregation found or introduced)
- **Unknown/null behavior:** backend parsers return `(0, false)` (unchanged contract, now correctly computed only when truly unparseable); new frontend canonical parsers return `null` — never `NaN`, never a silently-substituted 0 — for missing/invalid/negative input

### Metric: `/summary` sidebar counts (COUNTS-2, already correct)
- **Source:** live `Clientset.List()` calls scoped to the resolved cluster's client
- **Scope:** per-cluster, resolved via `getClientFromRequest(ctx, r, clusterID, ...)` — confirmed cannot cross-contaminate (see Step 3)
- **Unit:** count
- **Unknown behavior:** a failed fetch downgrades to `Reachable=false` + any LRU-cached prior summary marked `Stale=true` (an existing, already-correct freshness model — not duplicated or touched this phase, per Step 8's instruction to reuse existing freshness metadata)

## Step 3 — Cluster scoping audit

Audited every Phase-3-touched metric for cluster identity leakage risk:
- `OverviewCache` (pod counts): keyed by `clusterID` string throughout (`overviews[clusterID]`, `informers[clusterID]`, `podPhases[clusterID]`, `stopChs[clusterID]`) — confirmed no shared/global state. The COUNTS-2 lock-in test added this phase (`TestHandler_GetClusterSummary_ClusterIsolation`) additionally proves, end-to-end through the REST handler, that two clusters with deliberately different mock data never see each other's counts, including after interleaved requests (A → B → A again, ruling out LRU cache key collisions).
- Frontend memory/CPU parsers (METRICS-2): these are pure functions (`string → number | null`) with no cluster context at all — cluster scoping happens entirely upstream, at the query-key/fetch level (already covered by existing `useKubernetes.ts`/React Query key audits from the original investigation). No contamination risk was found or introduced by migrating their internals to the canonical parser, since the function signatures and call sites (which already carry the correct per-cluster data) were not changed.
- No implicit cluster identity was found in any Phase-3-touched code; nothing required redesign on this axis.

## Step 4 — Pod count lifecycle verification (COUNTS-1)

| Scenario | Verified by | Result |
|---|---|---|
| Normal ADD | `TestUpdatePodStatus_NormalAddAndDelete` | Count increments correctly |
| Normal DELETE | `TestUpdatePodStatus_NormalAddAndDelete` | Count decrements correctly |
| Tombstone (`DeletedFinalStateUnknown`) DELETE | `TestUpdatePodStatus_TombstoneDelete_Decrements` | **The core fix** — now decrements exactly like a normal delete (previously stuck, reproduced failing against the pre-fix code, confirmed passing after) |
| Duplicate DELETE (same UID twice, including a redundant tombstone) | `TestUpdatePodStatus_DuplicateDelete_NoNegativeCount` | Count does not go negative (the existing `if oldPhase, exists := phases[uid]; exists` guard already handled this correctly — confirmed, not newly added) |
| Re-addition after delete | `TestUpdatePodStatus_ReAddAfterDelete` | Count becomes correct (1, not 0 or 2) |
| MODIFIED phase transition | `TestUpdatePodStatus_PhaseTransition` | Buckets move correctly, total count unaffected (previously untested) |
| Zero resources | `TestUpdatePodStatus_ZeroResources` | Reports 0, not a stale/undefined value |
| Resync/rebuild convergence | `TestReconcilePodCountsFromStore_ConvergesToInformerTruth` | **New safety net** — `reconcilePodCountsFromStore` (runs every `podReconcileInterval`=5min, matching the informer factory's own resync cadence) recomputes `Counts.Pods` and the phase breakdown directly from the informer store, converging even after the incremental counters are corrupted by an unrelated/future event-delivery edge case (simulated by directly corrupting the counters, standing in for whatever caused the drift) |
| Reconciliation goroutine cleanup | `TestRunPodCountReconciliation_StopsPromptlyOnStopClusterCache` | Exits promptly on `StopClusterCache` — no leaked goroutine polling a removed cluster forever |

**Decision on "prefer deriving from canonical store" (per Phase 3 Step 4):** did **not** switch `Counts.Pods` to a full per-event store recompute — that was the design `updatePodStatus`'s own comment explicitly rejected for performance (recomputing the phase breakdown from `store.List()` on every single Pod event reintroduces an O(n)-per-event cost on clusters with thousands of pods, the exact cost the incremental design was built to avoid). Instead: fixed the confirmed root cause (tombstone unwrap) directly, and added a periodic (5-minute) full reconciliation from the store as a bounded safety net against any *other* missed-event class — satisfying "derive from canonical store when appropriate" without the O(n)-per-event regression. This is a measured tradeoff, not a default to "add validation everywhere": the reconciliation only runs once per 5 minutes per cluster, an O(n) cost already comparable to the pre-existing informer resync's own O(n) work at the same cadence.

## Step 5 — Memory/CPU unit conversion testing (METRICS-1, METRICS-2)

Both the backend Go tests (`aggregate_test.go`) and frontend TS tests (`k8sQuantity.test.ts`) cover the same matrix per the Phase 3 instruction:

| Case | Backend (`TestParseCPUToMilli`/`TestParseMemoryToMi`) | Frontend (`k8sQuantity.test.ts`) |
|---|---|---|
| Zero | ✅ `"0m"`, `"0"` | ✅ `"0"`, `"0Mi"` |
| Small values | ✅ `"10.5m"` (rounds to nearest whole millicore — documented, not a bug: K8s has no sub-millicore precision) | ✅ `"512Ki"` |
| Normal production values | ✅ `"250m"` | ✅ `"256Mi"`, `"250m"` |
| Large values | ✅ `"64"` cores | ✅ `"4Gi"` |
| Maximum realistic values | — (not separately cased; large-value case covers the same code path) | ✅ `"10Pi"`, `"2Ti"` |
| Invalid | ✅ `"not-a-number"`, `"500x"` | ✅ `"not-a-number"`, `"32Zz"`, `"Mi256"` |
| Negative | — (Go test didn't separately case this; `resource.ParseQuantity` accepts negative CPU/memory syntactically, which is itself a pre-existing, out-of-scope behavior of the already-correct `grpc/service.go` pattern being reused) | ✅ explicit null-on-negative, both string and numeric input |
| NaN/Infinity | — (not a valid Go string input shape for this path) | ✅ explicit null for `NaN`/`Infinity`/`-Infinity` numeric input |
| Missing/empty | ✅ `""` | ✅ `null`, `undefined`, `""`, `"-"`, whitespace |
| The actual bug cases | ✅ `"1"` (whole core, previously parsed as 1 milli instead of 1000) | ✅ `"512Ki"` (previously would have been scaled as if Mi in some reimplementations), `"100M"` (decimal mega, distinct from binary Mi) |

A real bug in my own new frontend parser was caught by this exact test matrix before it shipped: `parseK8sCpuToMillicores("500x")` initially returned `500000` instead of `null` because `Number.parseFloat` parses a leading numeric prefix and ignores trailing garbage — fixed with a full-string regex validation before parsing, re-verified green.

## Step 6 — Impossible values

No new arbitrary hardcoded limits were introduced (per the explicit instruction against e.g. "memory > 1 PB = invalid"). Validation implemented is purely data-integrity based: `Number.isFinite` checks (rejects `NaN`/`Infinity`), explicit rejection of negative quantities (memory/CPU cannot be negative — a negative parse result indicates upstream corruption, not a valid reading), and full-string regex matching (rejects any input with trailing garbage after a numeric+unit shape, like `"500x"` or `"Mi256"`). No ceiling was imposed on how *large* a value can be — the "maximum realistic values" test (`"10Pi"`) exists to confirm large values pass through correctly, not to reject them.

## Step 7 — Utilization semantics

Explicitly traced for every file touched this phase: in every case, utilization already meant **usage / allocatable-or-capacity** (not usage/requested) — confirmed by reading each denominator's source (`node.status.allocatable`, `node.allocatableCpuMillicores`/`allocatableMemoryBytes` from `.status.allocatable`). This semantic was **not changed** — only the numerator/denominator *parsing* was fixed, not the percentage formula itself, per "do not assume these values, verify them" and "do not redesign without evidence." Where a percentage's existing handling of a zero/missing denominator was already correct (`Nodes.tsx`'s `memCapMi != null && memCapMi > 0 ... : null`), it was left untouched. Where a file's existing "unknown" signal was a flag rather than null-propagation (`useClusterUtilization.ts`'s `metricsAvailable`, `PodDetail.tsx`'s `-1` sentinel for "no limit set"), that signal was preserved as-is — the fix was scoped to making the numbers feeding it correct, not to redesigning each file's unknown-state architecture, which is a larger change than this phase's findings called for.

## Step 8 — Stale data

No new freshness model was introduced for Phase 3 data. `/summary`'s existing `Stale`/`Reachable` envelope (COUNTS-2) was reused as-is. Phase 2's `LastCheckedAt`/`LastSuccessAt`/`LastError` freshness model (cluster health) is a distinct concept from Phase 3's metric correctness and was not duplicated or touched.

## Step 10 — Source-of-truth audit

- **Pod counts:** two representations exist — `OverviewCache`'s live incremental counter (now self-healing, Step 4) and `buildClusterSummary`'s direct-List-call count (COUNTS-2, already correct, independent, unpaginated-but-correct). Both are necessary: the former is the real-time dashboard path (sub-millisecond reads), the latter is the on-demand sidebar path with its own LRU/staleness envelope. Neither was deleted or merged — their purposes and performance characteristics (informer cache vs. direct API call) are genuinely different, and no evidence showed either was redundant.
- **Memory/CPU parsers:** consolidated from 6 independent, each-separately-buggy reimplementations down to delegating to one canonical, tested module (`k8sQuantity.ts`) on the frontend, and reusing the existing correct pattern (`resource.ParseQuantity`) already proven in `grpc/service.go` on the backend. The 2 files that already had their own correct, independently-arrived-at implementation (`Nodes.tsx`, `NodeDetail.tsx`) were left as-is rather than forced onto the new shared utility — "do not automatically delete/replace existing code" was honored; they simply didn't need the change.

## Finding: COUNTS-1

- **Severity:** P0
- **Status:** FIXED
- **Root Cause:** `OverviewCache.updatePodStatus`'s `DELETED` handling never unwrapped `cache.DeletedFinalStateUnknown`, so a delete inferred from a relist (rather than observed directly on the watch) silently failed its `obj.(*corev1.Pod)` type assertion and returned before decrementing — permanent, one-directional count drift.
- **Evidence:** Reproduced in Phase 0 via a standalone harness; re-confirmed unchanged in this phase via direct code read before fixing.
- **Change:** (1) Unwrap `cache.DeletedFinalStateUnknown` before the type assertion. (2) Added a periodic (5-minute) reconciliation (`reconcilePodCountsFromStore`) that recomputes `Counts.Pods` and the phase breakdown directly from the informer's canonical Pod store, self-healing any drift beyond the specific tombstone case — bounded to the same cadence as the informer factory's own resync, so no new per-event cost.
- **Files Changed:** `kubilitics-backend/internal/service/overview_cache.go`
- **Source of Truth:** the informer's Pod store (`k8s.InformerManager.GetStore("Pod")`) — the incremental counter is now a cache of that truth, self-healing every 5 minutes instead of being the sole, permanently-authoritative state.
- **Units/Scope:** count, per-cluster (keyed by `clusterID`).
- **Tests:** `overview_cache_pods_test.go` (new) — 8 tests covering the full Step 4 matrix (see table above).
- **Tests Executed:** `go test ./internal/service/... -race` → all pass. Verified the tombstone-fix test fails against the pre-fix code (manually reverted the 3-line fix, confirmed the test fails with the exact expected message, restored the fix, confirmed green again).
- **Before:** A `DeletedFinalStateUnknown`-wrapped delete left the pod counter stuck at a too-high value permanently (reproduced: 2 pods added, one deleted via tombstone, counter stayed at 2 instead of dropping to 1).
- **After:** Same scenario now correctly drops to 1; a corrupted counter (simulated) converges back to the store's truth (3) within one reconciliation cycle.
- **Remaining Risk:** Low. The 5-minute reconciliation bounds drift from any event-delivery edge case, known or not yet discovered.

## Finding: METRICS-1

- **Severity:** P2
- **Status:** FIXED
- **Root Cause:** `parseCPUToMilli`/`parseMemoryToMi` (`internal/metrics/aggregate.go`) blindly stripped a single trailing unit letter without applying its scale factor — correct only for the one fixed-format string (`"<n>.00Mi"`/`"<n>.00m"`) their only caller at the time produced. Re-verification in this phase found this also meant **bare whole-core CPU strings (e.g. `"1"`) were silently treated as 1 millicore instead of 1000** — a concrete, demonstrable bug, not just a theoretical risk.
- **Change:** Replaced both with `resource.ParseQuantity(s)` + `.MilliValue()`/`.AsInt64()`-or-`.Value()`, matching the already-correct, already-proven pattern in `internal/api/grpc/service.go`'s `parseMillicores`/`parseMemoryBytes` — reused, not reinvented.
- **Files Changed:** `kubilitics-backend/internal/metrics/aggregate.go`
- **Source of Truth:** `k8s.io/apimachinery/pkg/api/resource.Quantity` — the same canonical Kubernetes quantity parser the rest of the codebase already uses correctly elsewhere.
- **Units:** CPU → millicores, memory → mebibytes (preserving each function's existing contract for its callers in `history.go`).
- **Tests:** `aggregate_test.go` (new, package had zero prior test coverage) — `TestParseCPUToMilli` (11 cases), `TestParseMemoryToMi` (11 cases), `TestAggregatePodUsages` (4 cases including mixed-unit summation and invalid-entry resilience).
- **Tests Executed:** `go test ./internal/metrics/... ./internal/api/grpc/...` → all pass.
- **Before:** `parseCPUToMilli("1")` → `(1, true)` (should be 1000).
- **After:** `parseCPUToMilli("1")` → `(1000, true)` — measured directly in the new test.
- **Remaining Risk:** Low.

## Finding: METRICS-2

- **Severity:** P1
- **Status:** FIXED (for the 6 of 8 audited files confirmed still broken; 2 of 8 were already correct and left untouched — see Step 1)
- **Root Cause:** Independent hand-rolled memory/CPU parsers across the frontend, several silently coercing invalid input to 0 via `parseFloat(x) || 0`/`Number.isNaN(v) ? 0 : v` patterns, plus two distinct unit-scaling bugs found during re-verification (a magnitude-based "cores vs. millicores" guess for bare CPU numbers in `MetricsDashboard.tsx`, and lowercase letters treated as valid decimal memory suffixes in `ClusterCapacity.tsx` — neither is valid Kubernetes quantity grammar).
- **Change:** Created one canonical, tested module `kubilitics-frontend/src/lib/k8sQuantity.ts` (`parseK8sQuantityToBytes`, `parseK8sCpuToMillicores`), both returning `number | null` — never `NaN`, never a silently-substituted 0. Migrated the 6 confirmed-broken local parsers (`lib/utils.ts: parseMemory`, `ClusterCapacity.tsx: parseCpuMillis`/`parseMemoryBytes`, `MetricsDashboard.tsx`: 2 CPU + 2 memory functions, `PodDetail.tsx: parseCPUToMillicores`/`parseMemoryToBytes`, `useClusterUtilization.ts: parseCpuMillicores`/`parseMemoryBytes`) to delegate to it. Each file's existing `number`-returning contract and existing "unknown" signaling architecture (whichever it already had: null-propagation, a boolean flag, or a sentinel value) was preserved — only the internal parsing correctness was fixed, not each file's broader UI contract, per Step 7's "do not redesign without evidence."
- **Files Changed:** `kubilitics-frontend/src/lib/k8sQuantity.ts` (new), `kubilitics-frontend/src/lib/utils.ts`, `kubilitics-frontend/src/features/dashboard/components/ClusterCapacity.tsx`, `kubilitics-frontend/src/components/resources/MetricsDashboard.tsx`, `kubilitics-frontend/src/pages/PodDetail.tsx`, `kubilitics-frontend/src/hooks/useClusterUtilization.ts`
- **Source of Truth:** none previously existed; `k8sQuantity.ts` is now it for all 6 migrated call sites plus any future consumer.
- **Units:** memory → bytes (frontend canonical), CPU → millicores; `parseMemory`/`parsePodMemoryMi` kept their pre-existing Mi-unit contracts at the boundary for their specific callers.
- **Tests:** `k8sQuantity.test.ts` (new) — 18 tests covering the full Step 5 matrix per function, including the real bug the test suite itself caught (see Step 5).
- **Tests Executed:** `npx tsc --noEmit` clean; `npx eslint` clean on all touched files; full `npx vitest run src/pages src/hooks src/components src/features` sweep → 408/411 pass, the 3 failures confirmed pre-existing and unrelated (verified by reverting all Phase 3 changes via `git stash` and re-running in isolation — identical failures, identical stack traces).
- **Before:** `ClusterCapacity.tsx`'s `parseMemoryBytes` and 5 sibling functions silently returned 0 (or a wrongly-scaled number) for malformed or differently-unit-suffixed input.
- **After:** All 6 delegate to a parser that returns `null` on genuinely invalid input (never a silently-wrong number) and correctly handles every valid Kubernetes quantity suffix (binary Ki/Mi/Gi/Ti/Pi/Ei, decimal K/M/G/T/P/E, nanocores/microcores/millicores/whole cores for CPU).
- **Known Limitations:** Did not redesign the 6 migrated files' percentage/aggregate-display logic to add new "unknown" UI states beyond what each already had (e.g., did not add null-propagation to `useClusterUtilization.ts`'s per-node aggregation, which still contributes 0 for an unparseable single node's reading while relying on its existing cluster-wide `metricsAvailable` flag for the aggregate unknown signal) — this would be a larger, separate change than "fix the parser," and real-world exposure is low since metrics-server output is itself a structured, validated API response, not free-form user input.
- **Remaining Risk:** Low-moderate. The documented known limitation above is a real, if narrow, gap — a single corrupted-but-present metrics reading from one node would still contribute a parsed value based on best-effort recovery rather than being excluded from the sum, though it can no longer be *wrongly scaled* (the actual METRICS-2 bug class) since the parser itself is now correct.

## Finding: COUNTS-2 (lock-in)

- **Severity:** P3 (informational — already correct)
- **Status:** ALREADY FIXED — locked in with a new regression test.
- **Root Cause:** N/A.
- **Change:** None to production code.
- **Files Changed:** `kubilitics-backend/internal/api/rest/cluster_handler_test.go`
- **Tests:** `TestHandler_GetClusterSummary_ClusterIsolation` (new) — two clusters with deliberately different mock node/namespace counts; asserts cluster A's summary never reflects cluster B's data and vice versa, including after an interleaved A→B→A fetch sequence (rules out LRU cache-key collisions).
- **Tests Executed:** `go test ./internal/api/rest/... -run TestHandler_GetClusterSummary` → 2/2 pass.
- **Remaining Risk:** None.

## Finding: METRICS-3 (lock-in)

- **Severity:** P3 (informational — already correct)
- **Status:** ALREADY FIXED — audit's existing evidence re-confirmed, no new test added.
- **Root Cause:** N/A.
- **Change:** None.
- **Files Changed:** None.
- **Rationale for no new test:** the audit's METRICS-3 evidence was a direct code read across 4 files (`metrics_service.go`, `metrics_server_provider.go`, `metrics_aggregate.go`, `addon/scanner/resource_check.go`, `addon/financial/rightsizing.go`) confirming consistent `.Value()` + correct power-of-1024 usage — re-confirmed unchanged this phase. Since METRICS-1's fix (replacing the two actually-broken parsers with the same `resource.Quantity` pattern) now makes this convention more thoroughly exercised project-wide, a dedicated new test for METRICS-3 specifically was judged lower-value than the matrix already added for METRICS-1/METRICS-2; this is recorded as a deliberate choice, not an oversight.
- **Remaining Risk:** None newly introduced.

## Metric Contract Table

| Metric | Source | Scope | Unit | Semantics | Unknown State |
|---|---|---|---|---|---|
| Pod count (dashboard) | Pod informer store | per-cluster | count | pods currently known to the local cache | cache-not-ready → `GetOverview` returns `(nil, false)`, not 0 |
| Pod/Node/Deployment/Service count (`/summary`) | live `Clientset.List()` | per-cluster | count | live count at fetch time | unreachable → `Reachable=false` + `Stale=true` cached value, not a fresh 0 |
| CPU usage/limits (backend aggregation) | metrics-server / pod spec | per-cluster | millicores | instantaneous or declared value | malformed → `(0, false)`; caller decides whether to surface the `false` |
| Memory usage/limits (backend aggregation) | metrics-server / pod spec | per-cluster | mebibytes (func contract) / bytes (canonical) | instantaneous or declared value | malformed → `(0, false)` (backend) / `null` (frontend canonical) |
| Node/pod memory utilization % (`Nodes.tsx`, already correct) | metrics-server vs. `.status.allocatable` | per-cluster | percent | usage / allocatable capacity | denominator ≤ 0 or numerator unparseable → `null`, rendered distinctly from 0% |
| Cluster-wide CPU/memory utilization % (`useClusterUtilization.ts`) | metrics-server vs. node allocatable, summed | per-cluster | percent | usage / allocatable capacity | no successful metrics fetch → `metricsAvailable: false` (pre-existing, unchanged) |

## Pre-Existing Failures (unchanged from Phase 1/2, not touched)

Same `ClusterPickerPage.test.tsx` (2 failures) as previous phases, plus one newly-noticed-but-pre-existing failure in `AddClusterDialog.test.tsx` (unrelated to any Phase 1/2/3 work — a kubeconfig-upload dialog test, timing/mock-related) — explicitly verified via `git stash` to fail identically on the unmodified base before any Phase 3 changes were made.

## Phase 1/2 Regression Protection — Verified Intact

- `go test ./internal/k8s/... ./internal/api/rest/... ./internal/service/... ./internal/cluster/... -race` → all pass (covers every Phase 1 and Phase 2 fix and its regression tests).
- Frontend: full `src/pages src/hooks src/components src/features` sweep (408/411, 3 pre-existing unrelated failures) exercises Phase 1's `client.ts`/`useKubernetes.ts`/`useClusterTopology.ts`/`Settings.tsx` changes and Phase 2's `ClusterPickerPage.tsx` tooltip addition alongside Phase 3's changes with no new failures.
- No Phase 1 or Phase 2 file required modification for Phase 3 (confirmed via the scope check at the top of this record).

## Phase 3 Acceptance Gate — Assessment

1. **Every Phase 3 finding fixed or explicitly blocked/unverified.** → COUNTS-1, METRICS-1, METRICS-2 FIXED; COUNTS-2, METRICS-3 locked in (already correct). No finding blocked.
2. **A displayed metric has a traceable source.** → Documented in the Metric Contract Table and the Step 2 value traces.
3. **Units are correct.** → METRICS-1/METRICS-2 fixed exactly this; verified via the full backend+frontend test matrix.
4. **Scope is correct.** → Step 3 audit found no contamination risk in Phase-3-touched code; COUNTS-2's isolation test proves it end-to-end for the one handler where cluster identity flows through a cache key.
5. **Invalid values cannot silently appear as valid.** → `NaN`/`Infinity`/negative/garbage all rejected (return `null`/`(0,false)` with an explicit ok-flag), proven in both language test suites.
6. **Unknown data is distinguishable from zero.** → Preserved and, where broken, restored: `Nodes.tsx`/`NodeDetail.tsx` (already correct, untouched), `useClusterUtilization.ts`'s `metricsAvailable`, `PodDetail.tsx`'s `-1` sentinel, backend's `(0, false)` ok-flag.
7. **Stale data is not silently presented as current where freshness matters.** → COUNTS-2's existing `Stale`/`Reachable` envelope reused, not duplicated or broken.
8. **Cluster A cannot contaminate Cluster B in tested paths.** → Proven for `/summary` (new isolation test); no contamination risk found in the pure-function memory/CPU parsers (no cluster context to contaminate).
9. **Regression tests exist for every fixed finding.** → COUNTS-1 (8 tests), METRICS-1 (11+11+4 tests), METRICS-2 (18 tests), COUNTS-2 (1 new isolation test).
10. **Relevant Phase 1 and Phase 2 tests still pass.** → Verified above.
11. **No new P0/P1 regression exists.** → Full backend suite + frontend sweep both clean beyond pre-existing, unrelated, explicitly-verified failures.
12. **No unrelated work was introduced.** → Confirmed via `git status`; every changed file maps to a Phase 3 finding. Topology, startup, Fleet, and health were not touched.

**Phase 3 acceptance: PASS.**

---

PHASE 3 COMPLETE — STOPPED FOR APPROVAL

---
---

# Phase 4 — Startup & Fleet: Execution Record

**Date:** 2026-10-02
**Scope (exact finding IDs, per `docs/PRODUCTION-HARDENING-ROADMAP.md`):** STARTUP-1 (completion/verification), FLEET-1 (lock-in + resolve the UNVERIFIED caveat). Nothing else.
**Git safety:** no branch/checkout/reset/merge/rebase/stash/commit/push operations were performed. Repository state (branch `feat/terminal`) was treated as externally owned throughout — only source/test/doc files were modified, per this phase's explicit instruction.
**Phase 1/2/3 changes reviewed before starting:** confirmed via `git diff`/code read that none of this phase's planned changes overlap Phase 1 (`client.ts`, `overview.go`'s LOADING-3 fix, `informer.go`), Phase 2 (`discovery/manager.go`, `presence/types.go`, `cluster_service.go`'s STARTUP-1 bounded-concurrency code — re-used, not modified), or Phase 3 (`overview_cache.go`'s pod counter, `internal/metrics/`, frontend parsers).

## Step 1 — Revalidation

| Finding | Status before this phase | Evidence |
|---|---|---|
| STARTUP-1 | Phase 2's bounded-concurrency fix (`loadClustersConcurrency=10`, `errgroup.SetLimit`) CONFIRMED unchanged in `cluster_service.go`. But Phase 4's own measurement (below) proved the fix, while correct, was incomplete: `LoadClustersFromRepo` was still called **synchronously** from `main()` before the HTTP listener bind, so N>10 hanging clusters still produced multi-batch delays (measured: 18.02s for a 100-cluster/15-hanging mix) before the app became reachable at all. |
| FLEET-1 | CONFIRMED the audit's UNVERIFIED caveat was real, not hypothetical: `GetClusterSummary`'s 4 raw `Clientset` List calls ran on `ctx` alone, same bug class as LOADING-3's Overview-handler fix, never fixed for this call path. Separately confirmed `client.Timeout` **is** reliably set in production (all client-registration paths call `client.SetTimeout(s.k8sTimeout)`, and `s.k8sTimeout` is always >0 in production since `main.go` always constructs `ClusterService` with a real, viper-loaded `cfg` — `K8sTimeoutSec` defaults to 30 via `viper.SetDefault("k8s_timeout_sec", 30)`). |

No STOP condition triggered — both findings' root causes were confirmed to still exist exactly as scoped.

## Step 2 — Startup milestones measured

| Milestone | Definition | Measurement | Method |
|---|---|---|---|
| T0 | process start | — | not independently measured (process spawn overhead is OS/Go-runtime-level, outside this phase's code changes) |
| T1 | configuration ready | — | UNVERIFIED — not independently instrumented; bundled into T3 below |
| T2 | kubeconfig/persisted cluster definitions available | — | UNVERIFIED — not independently instrumented; bundled into T3 below |
| T3 | backend HTTP listener ready (empty DB, autoload disabled) | **~45ms** (internal log timestamps: `"Initializing SQLite database"` at `14:51:44.429974` → `"Server starting"` at `14:51:44.475078`) | **MEASURED** — real compiled binary (`go build ./cmd/server`), run against a temp SQLite DB, `KUBILITICS_KUBECONFIG_AUTO_LOAD=false`, `KUBILITICS_GRPC_DISABLED=true`, timestamps read from the server's own structured JSON logs |
| T3 | backend HTTP listener ready (3 persisted clusters pointing at an unroutable host, each would take 8s to time out) | **~71–77ms** (two independent runs: 0.071s, 0.077s) measured externally via polling `/healthz` until HTTP 200 | **MEASURED** — same real binary, DB seeded with 3 cluster rows (`kubeconfig_path` pointing to a synthetic kubeconfig with `server: https://10.255.255.1:6443`, a non-routable address, same technique Phase 0 used), external wall-clock polling loop (not log-timestamp-based, to also capture process/OS overhead) |
| T4 | frontend/backend communication available | — | UNVERIFIED — requires the actual frontend dev server + Tauri shell, neither available in this environment (consistent with Phase 0's documented environment limitation) |
| T5 | fleet/cluster list visible | — | UNVERIFIED — same reason; additionally, see the Fleet UX finding below, which affects this milestone's real-world timing independent of backend readiness |
| T6 | first cluster usable | — | UNVERIFIED — no live cluster available in this environment (consistent with every prior phase) |
| T7 | application fully initialized | — | UNVERIFIED — same reason |

**Before/after for the one milestone that could be directly measured (T3, the one STARTUP-1 is actually about):**
- **Before Phase 4** (Phase 2's fix, still in place): T3 = time for `LoadClustersFromRepo` to fully complete = up to `ceil(N/10) × 8s`. Measured directly this phase via a unit-level harness (reused Phase 2's test pattern, real 8s `loadStartupTimeout`, real client.TestConnection): **100 clusters / 15 hanging = 18.016s**.
- **After Phase 4**: T3 = ~45-77ms, independent of N or cluster availability (measured above, real binary, real unroutable hosts).
- **Method:** real compiled binary + real network timeouts against a non-routable IP (not simulated/estimated) for the "after" multi-cluster case; a Go-level test harness with the same real `client.TestConnection` + real `8s` timeout constant for the "before" baseline (full binary-level "before" re-measurement was not performed — see Known Limitations — but the underlying mechanism being measured, `LoadClustersFromRepo`'s own wall-clock cost, is identical whether invoked from `main()` directly or from the test harness).
- **Environment:** macOS, no Docker/live Kubernetes cluster available (consistent with every prior phase's documented environment).

## Step 3 — Startup dependency analysis

Traced every statement between `LoadClustersFromRepo`'s call site and the HTTP listener bind (`cmd/server/main.go` lines ~410–1187, re-verified before editing):
- **`LoadClustersFromRepo`'s connection-testing phase**: does NOT need to complete before the listener binds — no code between its call site and the bind reads `s.clients` in a way that requires it to be populated (confirmed by reading every `clusterService.*` call in that window; the one synchronous "log registered clusters" call reads from the repo via `ListClusters`, which gracefully handles an empty/not-yet-connected `s.clients` map, same as it already does for any not-yet-reconnected cluster after a restart — not a new code path).
- **The persisted-cluster-rows read** (`repo.List(ctx)`, fast — no network) IS needed synchronously, because the first-run auto-load branch depends on knowing whether the DB is empty.
- **Decision:** moved only the connection-testing phase to a background goroutine; kept the repo-row read and the empty/non-empty branch decision synchronous and fast. This is not "moving work to the background to make the timer look better" — the listener becoming reachable is a real, user-facing milestone (health checks, the desktop app's "backend connected" signal, and any already-fast cluster's data all become available immediately) — Step 3's own test (per Step 10's instruction) distinguishes this from a fake optimization.

## Step 4 — Unavailable cluster scenarios (bounded, deterministic)

| Scenario | Verified by |
|---|---|
| 1 healthy cluster | `TestGetClusterSummary_StillReturnsCorrectDataUnderTimeoutWrapper` (FLEET-1) — fast path still correct |
| 1 healthy + 1 unreachable (mix) | Phase 2's `TestLoadClustersFromRepo_OneFailureDoesNotAffectOthers` (re-run, unchanged, still passes — the bounded-concurrency mechanism this phase builds on is untouched) |
| Multiple healthy + multiple hanging | Phase 2's `TestLoadClustersFromRepo_ConcurrencyIsBounded` (25 clusters, bound=10, re-run, still passes) + this phase's real-binary measurement (3 hanging clusters, real unroutable host, listener bound in 71-77ms regardless) |
| Application starts / Fleet becomes usable / no global spinner | Proven by the real-binary measurement: `/healthz` returns 200 in ~75ms with 3 persisted unroutable clusters — the application does not wait for any cluster before becoming reachable |
| Unavailable clusters have explicit state | Unchanged from Phase 2 — `c.Status = clusterStatusFromError(connErr)`, still reachable via `GET /clusters` once the background load resolves |

A genuine bug was found and fixed during this real-binary testing (not merely "it worked"): the initial implementation's upfront `repo.List(ctx)` call, if it failed for any reason, silently caused **zero** clusters to be loaded (neither the background path nor the auto-load path would run), instead of the original behavior where `LoadClustersFromRepo` would at least attempt the load and clearly log a failure. Fixed by falling back to attempting the background load on a list error rather than silently skipping — verified via the same real-binary run, which now shows `"Failed to list persisted clusters; assuming clusters may exist and attempting background load..."` followed by `LoadClustersFromRepo`'s own clear error, instead of silently registering zero clusters.

## Step 5 — Fleet UX trace (newly discovered finding, documented — not fixed this phase)

Traced `backend Fleet response → frontend request → state/cache → rendering` per the explicit instruction. Finding: **the Fleet Dashboard the frontend actually renders does not use the backend's `/fleet/overview` endpoint at all.**

- `kubilitics-frontend/src/pages/FleetDashboard.tsx` uses `useFleetOverview()` (`src/hooks/useFleetOverview.ts`), which: (1) calls `getClusters()` once, then (2) fires **one independent HTTP request per cluster** via `useQueries` → `getClusterSummary(baseUrl, cluster.id)` for every cluster in the list.
- A repo-wide search confirms **zero** frontend call sites for `/fleet/overview` or `/fleet/search` — the backend's `GetFleetOverview` handler (the one the original audit's FLEET-1 finding examined and found correctly bounded/fan-out/partial-result-tolerant, and that this phase just closed the last gap in via the `GetClusterSummary` timeout fix) is **entirely unused by the frontend**.
- This directly matches the customer complaint motivating this phase's Fleet UX investigation ("From Fleet I can't see the clusters quickly"): for a fleet of N clusters, the Fleet page makes 1 + N HTTP round trips instead of 1, each subject to the browser's per-origin connection limit (queuing) and independent request/serialization overhead — not because any individual request hangs (LOADING-1/COUNTS-2 already bound and correctness-harden the per-cluster summary endpoint), but because of sheer request-count overhead that scales with fleet size.
- **Why this was NOT fixed this phase:** wiring the frontend onto the backend's aggregate endpoint is not a drop-in swap — the backend's `FleetClusterInfo` DTO doesn't currently carry several fields the frontend's `FleetCluster` type displays today (`context`, `provider`, `version`, `region`, `serviceCount`, `lastConnected`, `healthReason`). Making the swap without losing currently-displayed data would require extending the backend DTO — a change beyond "lock in + resolve the UNVERIFIED caveat" (FLEET-1's actual Phase 4 scope) and beyond "do NOT redesign Fleet visually" / "do not rewrite architecture" per this phase's explicit anti-scope-creep instructions. Per Step 5's own instruction ("First fix the underlying blocking behavior" — already done, backend side) and the mandatory-stop rule ("If an architectural change appears necessary outside Phase 4: STOP. Do not expand scope."), this is documented here as a clearly evidence-backed finding for a future phase rather than implemented now.
- **Recommended follow-up (not implemented):** extend `FleetClusterInfo` (`internal/api/rest/fleet.go`) with the currently-frontend-only fields, then rewire `useFleetOverview` to call the backend's `/fleet/overview` directly, collapsing 1+N requests to 1.

## Step 6 — Loading states

No new, independent timeout implementation was introduced. The `GetClusterSummary` fix reuses Phase 1's `client.WithTimeout()` mechanism (the exact same one LOADING-3 already established and tested) rather than inventing a new one. The background `LoadClustersFromRepo` goroutine's own per-cluster timeout (`loadStartupTimeout=8s`, Phase 0/2, unchanged) continues to guarantee every cluster connection attempt reaches a terminal state (connected/error) — this phase didn't change that guarantee, only when the *aggregate* of all attempts is allowed to block something else.

## Step 7 — Caching

No new caching was introduced. The Fleet N+1 finding (Step 5) is a duplicate-*request* problem, not solved by caching (caching N separate requests doesn't reduce the request count or the architectural mismatch) — correctly identified as requiring the DTO/wiring fix described above, not a cache.

## Step 8 — Concurrency

`loadClustersConcurrency=10` (Phase 2) was **not** changed. No new unbounded goroutines were introduced — the background `LoadClustersFromRepo` call is a single `go func(){}()`, not a new fan-out; the fan-out concurrency *inside* it is unchanged from Phase 2.

| Operation | Current concurrency | New concurrency | Reason | Resource impact | Failure isolation |
|---|---|---|---|---|---|
| `LoadClustersFromRepo`'s per-cluster connection testing | 10 (Phase 2, unchanged) | 10 (unchanged) | No evidence this phase required a different bound | None | Unchanged from Phase 2 |
| `LoadClustersFromRepo` itself, relative to `main()` | synchronous (blocking) | 1 background goroutine (not a concurrency *increase* — moves one existing sequential operation off the critical path) | Measured 18s blocking cost at realistic scale; no code after it structurally depends on its completion (Step 3) | One additional long-lived goroutine per process lifetime (not per-request) | Preserved — a cluster that never finishes connecting simply never appears as connected; doesn't affect the process or other clusters |

## Step 9 — Frontend performance

Not investigated beyond the Step 5 Fleet trace — per the explicit instruction ("Only investigate frontend rendering if backend timing does not explain the delay"), the Fleet N+1 request-count issue (Step 5) is a sufficient, evidence-backed explanation for the customer's reported Fleet slowness; no React rendering profiling was performed, and no `useMemo`/`useCallback`/`memo` changes were made (none were justified by evidence).

## Step 10 — Startup failure semantics

Verified: a cluster with a bad/unreachable config still results in `c.Status = clusterStatusFromError(connErr)` (unchanged, Phase 0/2 behavior) — never a global application failure, never an infinite spinner (the listener binds regardless), never a fake-healthy status. The application is usable (listener bound, other endpoints live) while a bad cluster is clearly, eventually marked unavailable once its bounded connection attempt resolves.

## Finding: STARTUP-1 (completion/verification)

- **Severity:** P0 (original audit)
- **Status:** FIXED (completion of Phase 2's partial fix)
- **Root Cause:** Phase 2 bounded the per-cluster connection fan-out but left `LoadClustersFromRepo`'s *aggregate* completion as a blocking dependency of the HTTP listener bind in `main()` — so N>10 hanging clusters still produced `ceil(N/10) × 8s` of total unreachability, not the "roughly constant time" the roadmap's gate text requires.
- **Evidence:** Measured 18.016s for 100 clusters/15 hanging (unit-level, real timeouts) before this phase's fix; confirmed via direct code read that `cmd/server/main.go`'s listener bind (line ~1187) is ~774 lines after the blocking call (line ~413).
- **Change:** `LoadClustersFromRepo`'s connection-testing phase now runs in a background goroutine; the HTTP listener binds without waiting for it. The persisted-cluster-rows read (fast, no network) remains synchronous so the pre-existing first-run auto-load decision is unaffected. A real bug found during live-binary testing — an upfront `repo.List` failure silently skipping cluster loading entirely — was fixed in the same change (fail-safe: attempt the background load anyway on a list error, rather than silently registering zero clusters).
- **Files Changed:** `kubilitics-backend/cmd/server/main.go`
- **Tests:** No new automated regression test was added for the `main()`-level restructuring itself (Go's `main()` isn't practically unit-testable without a larger refactor, judged out of this phase's minimal-change scope). Evidence instead comes from: (1) the real-binary measurements above (repeated twice, consistent ~71-77ms results), (2) Phase 2's existing `LoadClustersFromRepo` tests (unchanged, re-run, still passing — confirms the function's own internal behavior, which this phase didn't modify, is intact), (3) direct code-level verification that no synchronous code between the call site and the listener bind depends on the goroutine's completion.
- **Tests Executed:** Full `go test ./internal/... -race` → all pass. Two independent real-binary runs (fresh temp DB, synthetic unroutable kubeconfig) → consistent ~75ms listener-bind time with 3 persisted hanging clusters, vs. the measured 18s+ the old blocking behavior would have produced at a comparable (scaled-up) cluster count.
- **Before:** `LoadClustersFromRepo` blocking `main()` → up to `ceil(N/10) × 8s` before the app is reachable at all.
- **After:** ~45-77ms to listener-ready, independent of N or cluster availability — measured directly, not estimated.
- **Known Limitations:** T0/T1/T2/T4-T7 milestones remain UNVERIFIED — this environment has no Docker/live cluster/running frontend dev server/Tauri shell (consistent with every prior phase). The "before" 18s figure is from a unit-level harness calling the same production `LoadClustersFromRepo` function directly (real timeouts, real client code) rather than from re-running the old `main()` structure as a full binary — judged sufficient since the function being measured is identical in both cases and re-establishing the pre-fix binary would require reverting this phase's own change, measuring, then re-applying it, which was judged lower-value than the two "after" measurements already captured.
- **Remaining Risk:** Low. The new fail-safe branch (list-error → attempt background load anyway) was itself found and fixed via real-binary testing, not assumed correct — increases confidence in this area specifically.

## Finding: FLEET-1 (lock-in + UNVERIFIED caveat resolved)

- **Severity:** P3 in the original audit (informational, "confirms it's NOT a bug, with one caveat") — the caveat itself, now confirmed real, is more accurately P2 (a genuine missing-timeout gap, same class as LOADING-3, not yet shown to have caused a production incident).
- **Status:** FIXED (caveat resolved) + LOCKED IN (core correctness reconfirmed)
- **Root Cause:** `GetClusterSummary`'s 4 raw `Clientset.List()` calls (nodes, pods, deployments, services) ran on the caller's `ctx` directly, never applying `client.Timeout` via the `client.WithTimeout()` wrapper every other hardened call path (including this phase's own measurement target, and LOADING-3's Overview-handler fix) already uses.
- **Evidence:** Direct code read of `cluster_service.go`'s `GetClusterSummary`; confirmed `client.Timeout` is reliably set in production by tracing every client-registration path (`AddCluster`, `AddClusterFromBytes`, `applyAndStoreClient`, `LoadClustersFromRepo`'s `loadOneClusterFromRepo`) — all call `client.SetTimeout(s.k8sTimeout)`, and `s.k8sTimeout` is always >0 in production (`cmd/server/main.go` always constructs `ClusterService` with a real `cfg`; `K8sTimeoutSec` defaults to 30 via viper).
- **Change:** Wrapped the 4 raw List calls in `client.WithTimeout(ctx)` — the identical fix pattern LOADING-3 established for the Overview handler, reused rather than reinvented.
- **Files Changed:** `kubilitics-backend/internal/service/cluster_service.go`
- **Tests:** `cluster_service_fleet_timeout_test.go` (new) — `TestNewClusterService_AppliesConfiguredK8sTimeoutToRegisteredClients` (proves `client.Timeout` really is set in the real `cfg` construction path — not assumed), `TestGetClusterSummary_StillReturnsCorrectDataUnderTimeoutWrapper` (happy-path regression — the fix doesn't change correct behavior).
- **Known Limitation (documented, not silently dropped):** a true end-to-end "slow raw List call actually gets bounded" test against `GetClusterSummary` is not possible with the existing fake-clientset test tooling — `k8stesting.Action` (the reactor callback's parameter type) exposes no context at all (confirmed by reading client-go's `Action` interface — no `GetContext()` method exists), so a reactor-based sleep cannot be made to respect `client.WithTimeout()`'s deadline regardless of whether the production code is correct. This is the identical limitation already documented for LOADING-3. The underlying mechanism (`client.WithTimeout()` bounding a slow operation) is proven directly and unaffected by this limitation in `client_timeout_test.go`'s `TestClient_WithTimeout_BoundsASlowOperation` (Phase 1), which `GetClusterSummary` now uses identically.
- **Tests Executed:** `go test ./internal/service/... -race` → all pass, including the 2 new tests.
- **Before:** `GetClusterSummary`'s raw List calls had no effective deadline beyond whatever the caller's context provided (unreliable for a goroutine blocked on I/O, per Phase 1's own findings).
- **After:** Bounded by the same `client.Timeout` (30s default) every other hardened call path already uses.
- **Remaining Risk:** Low. Mirrors LOADING-3's already-accepted risk profile exactly.

## Finding: Fleet N+1 request pattern (newly discovered, documented, NOT fixed — out of this phase's explicit scope)

- **Severity:** P1 (estimated — directly explains a named customer complaint, but not yet measured against a real multi-cluster fleet in this environment, so not elevated to P0 without that evidence)
- **Status:** DOCUMENTED, not implemented — see Step 5 for full reasoning on why this was correctly left for a future phase rather than fixed now or silently ignored.
- **Root Cause:** The Fleet Dashboard frontend never adopted the backend's `/fleet/overview` aggregate endpoint; it independently re-implements the fan-out client-side via `useQueries`, one HTTP request per cluster.
- **Files that would need to change (not changed this phase):** `kubilitics-backend/internal/api/rest/fleet.go` (extend `FleetClusterInfo`), `kubilitics-frontend/src/hooks/useFleetOverview.ts` (rewire to the aggregate endpoint).
- **Remaining Risk:** Medium — this is the most likely explanation for the Fleet UX complaint that motivated this phase, left unresolved. Recommended for explicit prioritization in a future phase or as a standalone follow-up, since it requires backend DTO changes beyond FLEET-1's literal scope.

## Startup Performance Baseline (for future phases to compare against)

| Metric | Value | Method |
|---|---|---|
| T3 (listener ready), empty DB, no autoload | ~45ms | Real binary, internal log timestamps |
| T3 (listener ready), 3 persisted clusters pointing at an unroutable host | ~71-77ms (2 runs) | Real binary, external `/healthz` polling |
| `LoadClustersFromRepo` wall-clock cost, 100 clusters/15 hanging (no longer on the T3 critical path) | 18.016s | Unit-level harness, real `client.TestConnection` + real 8s timeout, same technique as Phase 0's baseline |
| `loadClustersConcurrency` | 10 (unchanged since Phase 2) | Code constant |
| `loadStartupTimeout` (per-cluster connection test) | 8s (unchanged since Phase 0) | Code constant |

**Acceptance criterion from the roadmap** ("Measured startup-to-usable time meets the budget established in Phase 0, regardless of the number or availability of configured clusters") — **MET** for T3 specifically: Phase 0 never established a numeric budget (it only measured the *old* N×8s cost), so this phase establishes the first real budget — ~45-77ms, now demonstrated independent of cluster count/availability. T4-T7 remain UNVERIFIED (no frontend/live-cluster environment available), consistent with every prior phase's documented environment limitation.

## Regression Protection — Phase 1, 2, 3 verified intact

- **Phase 1:** `go test ./internal/k8s/... ./internal/api/rest/...` (LOADING-3/5's tests, `client.WithTimeout` mechanism reused by this phase's FLEET-1 fix) → all pass.
- **Phase 2:** `go test ./internal/service/... ./internal/cluster/...` (STARTUP-1's bounded-concurrency tests, HEALTH-1/2's reachability tests, LIFECYCLE-1's removal-isolation test) → all pass, unchanged.
- **Phase 3:** `go test ./internal/metrics/...` + frontend `k8sQuantity.test.ts` + `src/pages src/hooks src/components src/features` sweep (408/411, same 3 pre-existing failures) → all pass, unchanged.
- Full `go test ./internal/... -race` → all pass, zero races, across the entire backend.
- No Phase 1/2/3 file was modified this phase beyond what Phase 4 legitimately needed (`cluster_service.go`'s `GetClusterSummary` — a function Phase 2/3 never touched; `main.go`'s startup sequence — Phase 2 touched `LoadClustersFromRepo`'s internals, not its call site in `main()`).

## Phase 4 Acceptance Gate — Assessment

1. **Every Phase 4 finding FIXED or explicitly BLOCKED/UNVERIFIED with evidence.** → STARTUP-1 and FLEET-1 both FIXED. The Fleet N+1 pattern, while newly discovered and significant, was never an "assigned finding" this phase — it's documented per the mandatory anti-scope-creep rule, not left ambiguous.
2. **Startup does not depend unnecessarily on unavailable clusters.** → Measured: listener binds in ~75ms regardless of persisted-cluster count/availability.
3. **Healthy clusters remain usable when other clusters hang/fail.** → Unchanged from Phase 2, re-verified.
4. **Fleet becomes usable without waiting indefinitely.** → Backend side: yes (FLEET-1 fixed). Frontend side: the N+1 pattern remains a real, documented, unfixed usability cost — acceptance for the *assigned* findings is met; the newly-discovered issue is explicitly flagged as unresolved, not claimed as fixed.
5. **All loading operations remain bounded.** → Yes — no new unbounded operation introduced; `GetClusterSummary` is now bounded like every other hardened path.
6. **Existing timeout/cancellation behavior remains intact.** → Verified via full Phase 1 regression re-run.
7. **Cluster isolation remains intact.** → Verified via full Phase 2 regression re-run.
8. **Data correctness remains intact.** → Verified via full Phase 3 regression re-run.
9. **Performance claims have measurements.** → Every number in this record is measured (real binary or real unit-level harness), none estimated; UNVERIFIED items are explicitly labeled with reasons, not silently assumed.
10. **Regression tests exist for every fixed finding.** → FLEET-1: 2 new tests. STARTUP-1: evidence via measurement + existing Phase 2 tests (see "Known Limitations" above for why no new `main()`-level test was added).
11. **No P0/P1 regression introduced.** → Full backend suite + frontend sweep both clean beyond pre-existing, unrelated, already-documented failures.
12. **No unrelated work was introduced.** → Confirmed via `git status`: only `main.go` and `cluster_service.go` (+1 new test file) changed, both directly mapping to STARTUP-1/FLEET-1. Topology, Blast Radius, and the Fleet N+1 pattern were explicitly *not* implemented, only documented.

**Phase 4 acceptance: PASS**, with the Fleet N+1 request pattern explicitly carried forward as a documented, high-value, correctly-out-of-scope finding for a future phase rather than either silently fixed (scope creep) or silently ignored (per the anti-hallucination rules).

---

PHASE 4 COMPLETE — STOPPED FOR APPROVAL

---
---

# Phase 5 — Topology: Execution Record

**Date:** 2026-10-02
**Scope (exact finding IDs, per `docs/PRODUCTION-HARDENING-ROADMAP.md`):** TOPOLOGY-1, TOPOLOGY-3. (TOPOLOGY-2's timeout-mismatch half was already fixed in Phase 1 — re-verified only, not redone.) Nothing else.
**Git safety:** no branch/checkout/reset/merge/rebase/stash/commit/push operations performed. Branch (`feat/terminal`) treated as externally owned throughout.
**Phase 1–4 changes reviewed before starting:** confirmed via code read that Phase 1's `useClusterTopology.ts` timeout fix (TOPOLOGY-2) is unchanged and is the exact mechanism this phase's fix threads a real namespace value through — not a new mechanism, not a regression risk to it.

## Step 1 — Revalidation

| Finding | Status before this phase | Evidence |
|---|---|---|
| TOPOLOGY-1 | CONFIRMED, unchanged | `useTopologyData.ts`'s call to `useClusterTopology({ clusterId, depth, enabled })` still omitted `namespace` entirely — re-read before editing, byte-for-byte the same gap as audited. |
| TOPOLOGY-3 | CONFIRMED, unchanged | `MAX_VISIBLE_NODES`'s comment still claimed backend pod aggregation that only exists in the unused-by-this-page V2 engine — re-read before editing, unchanged. |
| TOPOLOGY-2 (re-verify only) | ALREADY FIXED (Phase 1) | `useClusterTopology.ts` still uses `client.WithTimeout`-backed `backendRequest` with `timeoutMs: 35_000` — confirmed unchanged this phase; this phase's fix only adds a real namespace *value* flowing through an already-correct parameter slot, not a new timeout mechanism. |

No STOP condition triggered.

## Step 2 — Topology request flow (as traced, not redesigned)

```
UI selection (TopologyToolbar: viewMode, selectedNamespaces Set<string>, depth)
   │
   ▼
useTopologyData (src/topology/hooks/useTopologyData.ts)
   │  NEW this phase: computes backendNamespace = (namespace-filterable view
   │  AND exactly 1 namespace selected) ? that namespace : undefined
   ▼
useClusterTopology (src/hooks/useClusterTopology.ts, unchanged since Phase 1)
   │  queryKey: ['topology', clusterId, namespaceParam, depth]
   │  timeout: 35s via backendRequest's AbortController (Phase 1, unchanged)
   ▼
getTopology (src/services/api/topology.ts) → backendRequest
   │  GET /clusters/{id}/topology?namespace=<ns>&depth=<n>
   ▼
Handler.GetTopology (kubilitics-backend/internal/api/rest/handler.go:1301)
   │  filters := models.TopologyFilters{Namespace: namespace}  (single string, unchanged)
   │  30s context.WithTimeout (unchanged, Phase 1/TOPOLOGY-2 already verified this)
   ▼
topologyService.GetTopologyWithClient (internal/service/topology_service.go:112)
   │  cache key: (clusterID, "v1", filters.Namespace, depth=0-const) — VERIFIED this
   │  phase to already be correctly scoped by namespace AND cluster (not a new
   │  finding to fix — confirms this phase's change is cache-safe)
   ▼
topology.Engine.BuildGraph (internal/topology/engine.go) — UNCHANGED this phase
   │  discoverResources: filters.Namespace != "" → scoped List() calls;
   │  "" → metav1.NamespaceAll (confirmed by re-reading, unchanged)
   ▼
RelationshipInferencer.InferAllRelationships — UNCHANGED this phase, not
   re-verified in depth (no Phase 5 finding touches this; the original audit's
   TOPOLOGY-4 already checked and ruled this out as a bottleneck)
   ▼
respondJSON → frontend transformGraph → client-side filterByNamespaces
   (kept as a defense-in-depth layer, proven by this phase's new test) →
   view-mode/kind/edge filters → MAX_VISIBLE_NODES cap → ELK layout → render
```

**Per-stage characteristics (only for what this phase's findings touch):**

| Stage | Scope | Timeout | Cancellation | Cache | Concurrency |
|---|---|---|---|---|---|
| `useTopologyData` → `useClusterTopology` | now genuinely cluster+namespace scoped for the single-namespace case (NEW) | delegates to `useClusterTopology` | delegates | React Query, keyed by `[clusterId, namespaceParam, depth]` — unchanged, now exercised with real namespace values | N/A (single request) |
| `getTopology`/`backendRequest` | — | 35s (Phase 1, unchanged) | real `AbortController` (Phase 1, unchanged) | — | — |
| `GetTopology` handler | per-request, cluster-scoped via `getClientFromRequest` | 30s `context.WithTimeout` (unchanged) | propagates `ctx` to `GetTopologyWithClient` (unchanged) | — | — |
| `GetTopologyWithClient` | now genuinely namespace-scoped for the single-namespace case (consequence of this phase's frontend fix) | inherits handler's ctx | inherits | **verified this phase**: keyed by `(clusterID, mode, namespace, depth)` — correctly isolated | — |

## Step 3 — Namespace scope: proven with tests, not asserted

`src/topology/hooks/useTopologyData.test.tsx` (new, 8 tests):
1. **Single selected namespace reaches the backend request** — `params.namespace === 'team-a'` asserted on the actual `getTopology` mock call. **Verified to fail without the fix**: temporarily reverted the one-line change, re-ran, 3 of 8 tests failed with `expected undefined to be 'team-a'`; restored, all 8 pass again.
2. **Zero selected namespaces (All Namespaces) fetch unscoped** — unchanged, intentional, proven.
3. **Multiple selected namespaces fetch unscoped** — documented scope boundary (backend's `TopologyFilters.Namespace` is a single string, not a list — see TOPOLOGY-1 finding below for why this wasn't expanded to multi-namespace backend support).
4. **Cluster view mode never scopes by namespace**, even with one selected — cluster-scoped resources (Nodes, StorageClasses, etc.) would be wrongly excluded by a namespace filter; proven via `NS_FILTERABLE_VIEWS` gating.
5. **RBAC view mode never scopes by namespace** — same reasoning (ClusterRoles/ClusterRoleBindings are cluster-scoped), proven.
6. **Traffic view mode does scope by a single selected namespace** — proven (it's in `NS_FILTERABLE_VIEWS`, unchanged set, now exercised with the fix).
7. **Switching namespace issues a new, correctly-scoped backend request** (Step 9 stale-request-protection evidence) — asserts the mock was called a 2nd time with `namespace: 'team-b'` after a rerender with a different `ns` prop, proving React Query's query-key identity (`['topology', clusterId, namespaceParam, depth]`, unchanged since Phase 1) naturally produces request replacement, not request accumulation.
8. **Client-side `filterByNamespaces` still applied as defense-in-depth** even when backend-scoped — simulates a backend that (hypothetically) returns an extra namespace's resource, proves the existing client-side filter still excludes it from the displayed graph. This was an explicit, deliberate design choice (keep the client-side filter as a safety net, not remove it) rather than trusting the backend scope alone.

**Cluster-scoped resources handled intentionally (Step 3's explicit requirement):** confirmed — `NS_FILTERABLE_VIEWS = {"namespace", "traffic"}` deliberately excludes `"cluster"` and `"rbac"` view modes from namespace scoping, both at the (pre-existing, unchanged) client-side filter layer and now at this phase's new backend-scoping layer — tests 4 and 5 above prove this holds for the new layer specifically, not just the old one.

## Steps 4, 5, 6, 7 — Graph correctness, duplication, graph boundaries, cross-namespace relationships

**Not re-verified this phase.** None of these steps' subject matter (relationship resolution logic in `internal/topology/relationships.go`, node/edge identity/deduplication in `internal/topology/engine.go` and `graph.go`, DIRECT/EXTENDED/FULL scope semantics, cross-namespace reference resolution) is touched by TOPOLOGY-1 or TOPOLOGY-3 — neither finding modifies the graph builder, relationship inferencer, or depth-filtering logic. Per the explicit instruction to use ONLY assigned findings and not perform opportunistic verification/cleanup of unrelated, unmodified code, these were not re-audited. The original audit's TOPOLOGY-4 finding already checked relationship-resolution complexity (inverted label index, O(1) lookups) and ELK layout bounds, and ruled them out as the "forever" source — that finding stands, unchanged, not re-litigated here. **Marked UNVERIFIED for this phase specifically** (not "confirmed correct," since this phase did not re-check them) rather than silently assumed fine.

## Step 8 — Timeout/cancellation: re-verified intact, not re-implemented

Confirmed via code read (not re-tested with new cases, since no code changed here this phase): `useClusterTopology.ts`'s 35s client timeout + real `AbortController` (Phase 1/TOPOLOGY-2) and the backend's 30s `context.WithTimeout` (`handler.go:1339`, unchanged) are both intact and unmodified. This phase's namespace-threading change flows through the *same* `getTopology`/`backendRequest` call — it does not introduce a new request path, so no new cancellation/timeout behavior needed to be built or tested. Phase 1's existing `client.test.ts`/`topology.test.ts` timeout tests were re-run (see Regression Protection below) and still pass.

## Step 9 — Stale request protection: proven (test 7 above)

React Query's query-key identity (`['topology', clusterId, namespaceParam, depth]`) already provided this guarantee structurally since Phase 1 — this phase's fix makes `namespaceParam` vary with real values for the first time, and test 7 proves switching the selection correctly produces a new, distinctly-scoped request rather than either reusing stale data or accumulating duplicate in-flight requests. No arbitrary delay was used — the proof relies entirely on query-key/request-identity semantics, per the explicit instruction.

## Step 10 — Large cluster behavior

**UNVERIFIED — not measured this phase.** No deterministic 100/500/1000-resource fixture exercise was run against the backend topology engine. Reason: TOPOLOGY-1/TOPOLOGY-3 do not modify `internal/topology/engine.go`'s discovery, graph-construction, or serialization code — this phase's change only affects what's passed *into* the existing, unmodified discovery call (a real namespace instead of always empty/all). Since namespace-scoping now means a typical request discovers a strict subset of what it used to (one namespace instead of the whole cluster), this phase's change can only reduce discovery/construction cost for the common case, never increase it — but no new measurement was taken to quantify this, since doing so would require either a live large cluster (unavailable in this environment, consistent with every prior phase) or building a deterministic multi-hundred-resource fixture harness for the topology engine specifically, which is a larger undertaking than this phase's two assigned findings justify. Documented as UNVERIFIED rather than estimated or assumed.

## Step 11 — API call efficiency

**Not modified, not re-audited this phase.** `discoverResources`'s per-resource-type List call pattern (`internal/topology/engine.go`) is unchanged. This phase's namespace-scoping fix means those *same* List calls are now namespace-scoped instead of cluster-wide for the common case (fewer items returned per call, not fewer calls) — a reduction in response payload size, not a change in call count or concurrency. No N+1 pattern was introduced or removed by this phase's change.

## Step 12 — Graph cache: verified correctly scoped (confirms the fix is safe, no fix needed here)

Traced `topology_service.go`'s `GetTopologyWithClient`: cache key is `(clusterID, "v1", filters.Namespace, depth-const)` — **already correctly isolated by cluster AND namespace** before this phase's change. This matters directly for TOPOLOGY-1's fix: since real namespace values now reach this cache for the first time (previously always `""`), it was important to confirm the cache wouldn't serve namespace-A data under a namespace-B key or vice versa — confirmed it cannot, by reading the `Set`/`Get` call sites directly (both pass `filters.Namespace` as an explicit cache-key component). No change was made here; this is a verification finding, not a fix.

## Step 13 — Frontend rendering

**Not investigated.** Per the explicit instruction ("Only optimize rendering after backend/graph generation timing is understood" and "No speculative useMemo/useCallback/memo unless profiling/evidence demonstrates the need") — no evidence from Steps 1-12 pointed at rendering as a bottleneck for either assigned finding, so no rendering changes were made or profiled.

## Step 14 — Failure states

**Not modified.** TOPOLOGY-1/TOPOLOGY-3 don't touch error/empty/timeout/cancelled state handling — `useTopologyData`'s existing `isError`/`error`/`isLoading`/`truncated` return fields are unchanged, confirmed via the diff (only the `backendNamespace` computation and its use in the `useClusterTopology` call were added; the `MAX_VISIBLE_NODES` comment was corrected). No new failure-state work was needed or performed.

## Step 15 — Export safety

**Out of Phase 5 scope — not touched.** No Phase 5 finding concerns topology export functionality.

## Finding: TOPOLOGY-1

- **Severity:** P0
- **Status:** FIXED
- **Root Cause:** `useTopologyData.ts` called `useClusterTopology({ clusterId, depth, enabled })` without the `namespace` field, even though `useClusterTopology`/`getTopology` already supported a backend-scoping `namespace` parameter (wired in Phase 1 for TOPOLOGY-2's timeout fix) — the namespace selector only ever filtered the already-fetched, full-cluster graph client-side.
- **Evidence:** Re-confirmed unchanged before editing (Step 1); a code comment elsewhere in the same file explicitly warned "Empty set = All Namespaces = 735 resources = system freeze" — that scenario fired on every single load regardless of UI selection, confirmed via direct code trace.
- **Change:** Added a `backendNamespace` computation in `useTopologyData` — passes the selected namespace to `useClusterTopology` when (a) the current view mode is namespace-filterable (`"namespace"` or `"traffic"`) and (b) exactly one namespace is selected. For 0 (all) or 2+ (multi-select) namespaces, or for cluster/RBAC views, the backend fetch remains unscoped (unchanged behavior) and the existing client-side `filterByNamespaces` continues to do the filtering — not a regression for those cases, since that was already the only filtering mechanism for them.
- **Files Changed:** `kubilitics-frontend/src/topology/hooks/useTopologyData.ts`
- **Source of Truth for the scope decision:** the backend's `models.TopologyFilters.Namespace` (`kubilitics-backend/internal/models/topology.go:106`) is a single string field, not a list — confirmed by reading the struct and its only producer (`handler.go:1316-1317`, `r.URL.Query().Get("namespace")`, no comma-splitting). True multi-namespace backend scoping would require a backend API change beyond this finding's scope ("thread the selected namespace," not "add multi-namespace backend filtering") — documented as a deliberate, evidence-based scope boundary, not an oversight.
- **Tests:** `useTopologyData.test.tsx` (new) — 8 tests, enumerated in Step 3 above.
- **Tests Executed:** `npx vitest run src/topology/hooks/useTopologyData.test.tsx` → 8/8 pass. Verified the 3 namespace-scoping-specific tests fail against the pre-fix code (reverted, re-ran, restored). Full frontend sweep (`src/lib/k8sQuantity.test.ts src/topology src/pages src/hooks src/components src/features`) → 416/419 pass, same 3 pre-existing unrelated failures as every prior phase.
- **Before:** Selecting a single namespace still fetched the entire cluster's topology from the backend.
- **After:** Selecting a single namespace in a namespace-filterable view sends `namespace=<that namespace>` to the backend, which (per Step 12's cache verification and the unchanged `discoverResources` scoping logic) genuinely limits backend discovery to that namespace.
- **Known Limitations:** Multi-namespace selection (2+) and the cluster/RBAC view modes still fetch unscoped and filter client-side — explicitly scoped out, not silently dropped (see Source of Truth above). No live-cluster measurement of the before/after discovery cost reduction was taken (Step 10 — UNVERIFIED, no live cluster available).
- **Remaining Risk:** Low. The cache-scoping verification (Step 12) specifically closes the most concerning risk class (cross-namespace cache contamination) that this kind of fix could introduce.

## Finding: TOPOLOGY-3

- **Severity:** P2
- **Status:** FIXED (comment-correction path, per the roadmap's own explicit fallback — "port V2's pod-aggregation into V1... OR migrate the Topology page onto V2... and correct the misleading comment either way")
- **Root Cause:** A comment in `useTopologyData.ts` claimed "Backend pod aggregation (>3 pods collapse to 1 node) keeps real node counts well below this limit" — that aggregation (`internal/topology/v2/builder/pod_aggregation.go`) exists only in the V2 topology engine, used solely by the Blast Radius tab's canvas; the Topology page (this file) exclusively uses the V1 engine (`internal/topology/engine.go`), which has no pod aggregation at all.
- **Evidence:** Re-confirmed unchanged before editing; separately re-confirmed `pod_aggregation.go` still operates on `v2.TopologyNode`/`v2.TopologyEdge` types with `Category`/`Group`/`Layer`/`Extra` fields that V1's `models.TopologyNode` (`internal/models/topology.go:25-43`) does not have — porting the aggregation logic would require extending V1's node schema (affecting serialization, the frontend TS contract, and every other V1 consumer), not a drop-in copy.
- **Decision:** Given (a) the roadmap explicitly offers "correct the misleading comment" as sufficient regardless of which deeper option is chosen, (b) porting requires a V1 schema change — a larger, riskier change than this phase's two assigned findings justify, (c) migrating the whole Topology page onto V2 is an even larger change (replacing the page's entire data pipeline), and (d) TOPOLOGY-1's fix (just implemented) already substantially reduces the real-world likelihood of hitting a problematic high-pod-count scenario for the common single-namespace case — corrected the comment rather than attempting the schema port or page migration. This is a reasoned, documented choice, not a silently-skipped fix.
- **Change:** Replaced the misleading comment with an accurate one explaining: V1 has no pod aggregation, why (schema difference), and what the actual backstops are (TOPOLOGY-1's namespace scoping + the existing `MAX_VISIBLE_NODES` truncation + ELK's 300-node layout-strategy switch, all pre-existing and unchanged).
- **Files Changed:** `kubilitics-frontend/src/topology/hooks/useTopologyData.ts` (same file as TOPOLOGY-1, different section)
- **Tests:** None applicable — this is a documentation-only correction with no functional code change. Confirmed via `git diff` that only comment text changed at this location.
- **Tests Executed:** `npx tsc --noEmit` clean (confirms no syntax/type impact).
- **Before:** Comment claimed a safety net that doesn't exist in the active code path.
- **After:** Comment accurately describes the real backstops in place.
- **Remaining Risk:** Low-moderate — the underlying absence of pod aggregation in V1 is unchanged (not a regression, since it was never present); a namespace with hundreds of replicas of the same workload will still produce many individual pod nodes, now bounded by namespace scope (TOPOLOGY-1) and the 1000-node cap, but not collapsed into summary nodes the way V2/Blast Radius does. Recommended as a candidate for a future phase if this proves to matter in practice.

## Topology Request Contract (as verified this phase)

| Aspect | Value | Verified how |
|---|---|---|
| Cluster | required; path segment `/clusters/{clusterId}/topology`, resolved via `getClientFromRequest` | code read, unchanged |
| Namespace | optional query param `namespace`; single value only; omitted = all namespaces; now genuinely reaches the backend for the single-namespace, namespace-filterable-view case (this phase's fix) | `useTopologyData.test.tsx`, 8 tests |
| Scope/mode | `viewMode` (`namespace`/`cluster`/`rbac`/`traffic`/`resource`) gates whether namespace scoping applies at all (`NS_FILTERABLE_VIEWS`) — unchanged set, now enforced at both the client-filter layer (pre-existing) and the backend-scoping layer (new) | `useTopologyData.test.tsx` tests 4-6 |
| Depth | 0-3, progressive disclosure; backend-filtered post-build (unchanged, Phase 1) | code read, unchanged |
| Timeout | client: 35s (`AbortController`, Phase 1); server: 30s (`context.WithTimeout`, unchanged) | code read; Phase 1's existing tests re-run |
| Cancellation | real, via `AbortController` propagated through `backendRequest` (Phase 1, unchanged) | code read; Phase 1's existing tests re-run |
| Freshness | server-side cache keyed by `(clusterID, mode, namespace, depth)`, `force_refresh=true` bypasses it | code read (Step 12) |
| Failure states | `isLoading`/`isFetching`/`isError`/`error`/`truncated`/`truncatedTotal` — unchanged this phase | code read |

## Regression Protection — Phase 1, 2, 3, 4 verified intact

- **Phase 1:** `npx vitest run src/services/api/client.test.ts src/services/api/topology.test.ts` (TOPOLOGY-2's timeout mechanism, reused unchanged by this phase) → pass, re-confirmed as part of the full sweep.
- **Phase 2/3:** Not touched by any Phase 5 file — no backend code was modified this phase. Full `go test ./internal/... -race` → all pass, zero races, confirming zero incidental impact.
- **Phase 4:** `cmd/server/main.go`/`cluster_service.go` (STARTUP-1/FLEET-1) — not touched this phase; re-confirmed via the same full backend test run.
- Full frontend sweep: `npx vitest run src/lib/k8sQuantity.test.ts src/topology src/pages src/hooks src/components src/features` → 416/419 pass. The 3 failures are the same `ClusterPickerPage.test.tsx` (×2) and `AddClusterDialog.test.tsx` (×1) failures documented as pre-existing and unrelated in every prior phase's record — unchanged count, unchanged tests.

## Phase 5 Acceptance Gate — Assessment

1. **Every Phase 5 finding fixed or explicitly blocked/unverified.** → TOPOLOGY-1 and TOPOLOGY-3 both FIXED.
2. **Namespace selection genuinely affects backend scope.** → Proven for the single-namespace, namespace-filterable-view case (the common/default case) via 8 passing tests, 3 of which were verified to fail without the fix.
3. **Cluster isolation preserved.** → Unchanged — the `getClientFromRequest`/cluster-ID-scoped request path was not modified; cache verified (Step 12) to also isolate by cluster.
4. **Topology requests bounded.** → Unchanged — Phase 1's 30s/35s timeouts intact, re-confirmed.
5. **Cancellation works.** → Unchanged — Phase 1's `AbortController` mechanism intact, re-confirmed, reused (not reimplemented) by this phase's fix.
6. **Timeout works.** → Same as above.
7. **Older topology responses cannot overwrite newer selections.** → Proven via test 7 (React Query query-key identity).
8. **Graph relationships correct for tested Kubernetes semantics.** → UNVERIFIED this phase — not touched by either finding, not re-audited (Steps 4-7 above); the original audit's TOPOLOGY-4 finding on relationship-resolution stands unchanged.
9. **Duplicate nodes/edges controlled.** → UNVERIFIED this phase — same reasoning, unmodified code.
10. **Large deterministic graphs don't reveal unacceptable behavior.** → UNVERIFIED this phase — no fixture-based measurement was run (Step 10); the fix can only reduce discovery cost for the common case, never increase it, by construction (fewer resources requested), but this wasn't quantified.
11. **No infinite topology loading remains within Phase 5 scope.** → Unchanged from Phase 1 (TOPOLOGY-2 already closed this); this phase's fix doesn't touch the timeout/cancellation path.
12. **Regression tests exist for every fixed finding.** → TOPOLOGY-1: 8 tests. TOPOLOGY-3: comment-only change, no test applicable, `tsc` confirms no functional impact.
13. **Phases 1-4 remain intact.** → Verified above — full backend suite + frontend sweep, zero new failures.
14. **No unrelated changes introduced.** → Confirmed via `git status`: only `useTopologyData.ts` (+1 new test file) changed, both mapping directly to TOPOLOGY-1/TOPOLOGY-3. Graph correctness, relationship resolution, large-cluster performance, API call patterns, and rendering were investigated per the required steps and found to be either already-correct (Step 12's cache verification) or explicitly out of this phase's modified-code scope (Steps 4-7, 10, 11, 13) — none were "fixed" opportunistically, and none were silently assumed correct without a stated reason.

**Phase 5 acceptance: PASS**, with Steps 4-7, 10, and 11's broader topology-pipeline verification explicitly marked UNVERIFIED-this-phase (not fixed, not silently assumed) since neither TOPOLOGY-1 nor TOPOLOGY-3 touches that code — consistent with the strict scope-control instruction and the precedent set by Phase 4's Fleet N+1 documentation-not-fix decision.

---

PHASE 5 COMPLETE — STOPPED FOR APPROVAL

---

# Phase 6 — Blast Radius: Execution Record

**Findings addressed:** BLASTRADIUS-1, BLASTRADIUS-2, BLASTRADIUS-3

## Finding: BLASTRADIUS-1

- **Severity:** P1
- **Status:** FIXED (partial-sourcing, not full replacement — see Decision)
- **Root Cause:** `GetResourceTopology` (`internal/api/rest/handler.go`) always called `topologyv2builder.BuildTopology`, which internally calls `CollectFromClient` — a live, full K8s API fan-out across ~34 resource types — on every topology cache miss (30s TTL), even when the same cluster's `ClusterGraphEngine` (`internal/graph/engine.go`) was already running an informer-cached copy of the overlapping resource types for blast-radius scoring (`blast_radius.go`'s handlers already read exclusively from the engine's snapshot). The two code paths — the Blast Radius tab's canvas (topology v2) and its numeric score (graph engine) — independently re-fetched largely the same cluster state from two different, potentially inconsistent sources.
- **Evidence:** Re-confirmed via full read of `GetResourceTopology` (handler.go:1718-1830, unchanged since the original audit) and `collector_k8s.go`'s `CollectFromClient` fan-out.
- **Investigation finding not in the original audit text:** `ClusterGraphEngine`'s informers cover only 16 of the ~34 resource types topology v2 needs (`Pods, Deployments, ReplicaSets, StatefulSets, DaemonSets, Jobs, CronJobs, Services, Endpoints, ConfigMaps, Secrets, ServiceAccounts, PVCs, Ingresses, NetworkPolicies, PDBs`) — it has no RBAC, Nodes, Namespaces, PVs, StorageClasses, EndpointSlices, IngressClasses, Events, ResourceQuotas, LimitRanges, PriorityClasses, RuntimeClasses, or admission webhook informers, and its `HPAs` field is `autoscaling/v1`, not the `autoscaling/v2` type topology v2's bundle uses. A literal "source the whole bundle from the engine" fix would have silently dropped those resource types from every topology/blast-radius graph — directly violating this phase's own goal ("never silently incomplete"). Expanding the engine's own informer set to cover all 34 types was rejected as disproportionate: it would modify the already-validated (Phases 0-5) blast-radius scoring engine's live behavior for a topology-page read-path concern, a asymmetric risk/benefit trade matching the precedent set by Phase 5's TOPOLOGY-3 decision.
- **Decision:** Implemented a **partial-sourcing merge**, not a full replacement. When a `ClusterGraphEngine` is already running for the cluster and `Status().Ready` is true (confirmed via the existing readiness signal, not a new mechanism), the 16 overlapping resource types are copied from `engine.Resources()` (a new read-only accessor backed entirely by informer Lister caches — zero live API calls) and the remaining ~18 types are still live-fetched via a new `CollectRemainderFromClient`. Coverage is always 100% of the bundle regardless of whether an engine is running — this is not a reduced-fidelity fast path, only a reduced-redundancy one. If no engine is running yet, or it hasn't completed its initial sync, the full unchanged live-fetch path (`CollectFromClient`) is used, identical to pre-fix behavior.
- **Change:**
  - `internal/graph/engine.go`: added `(*ClusterGraphEngine).Resources() *ClusterResources` — exports the existing private `collectResources()` (informer-cache read, no API calls).
  - `internal/topology/v2/collector_k8s.go`: refactored `CollectFromClient` into a shared `collectFromClient(ctx, client, namespace, seed)`; added `CollectRemainderFromClient(ctx, client, namespace, seed)`. For the 16 overlapping resource-type goroutines, a non-nil `seed` short-circuits the live `paginatedCollect` call and copies from `seed` instead. `CollectFromClient`'s zero-arg behavior (`seed == nil`) is byte-identical to before this change.
  - `internal/api/rest/handler.go` (`GetResourceTopology`): on cache miss, calls the existing read-only `h.getGraphEngine(clusterID)` accessor (RLock only, no lazy-start — cannot contend with or trigger BLASTRADIUS-3's lock). If ready, builds a seed bundle from `engine.Resources()` and calls `CollectRemainderFromClient` + `topologyv2builder.BuildGraph` directly; otherwise falls back unchanged to `topologyv2builder.BuildTopology`.
- **Files Changed:** `internal/graph/engine.go`, `internal/topology/v2/collector_k8s.go`, `internal/api/rest/handler.go`.
- **Blast Radius Source Graph:** When an engine is running and ready for the target cluster, 16/34 resource types are sourced from that engine's informer cache (the SAME cache that drives `/blast-radius` scoring); the remaining ~18 are a live K8s API fetch. When no engine is running, all 34 are a live fetch (unchanged original behavior). Both paths build the identical `*topologyv2.ResourceBundle` shape and go through the same `BuildGraph`.
- **Traversal Semantics:** Unchanged — `BuildGraph`'s relationship inference and the handler's BFS/depth filtering (`ViewFilter.Filter`) are untouched by this fix; only the bundle's data source changed, not how the bundle is turned into a graph.
- **Failure Semantics:** Unchanged and preserved — `FailedResources` (BLASTRADIUS-2's mechanism) still populates normally for any of the ~18 still-live-fetched types that fail; the 16 engine-sourced types cannot "fail" in the live-API sense (no network call), so they are never spuriously added to `FailedResources`.
- **Tests:**
  - `internal/api/rest/resource_topology_engine_source_test.go`: `TestGetResourceTopology_UsesRunningEngineInsteadOfLiveFetch` — starts a real `ClusterGraphEngine` against a fake clientset with a counting reactor on `list deployments`, confirms `GetResourceTopology` issues zero additional live `list deployments` calls once the engine is ready, and that the response still contains the engine-sourced deployment.
  - `TestGetResourceTopology_LiveFetchesWhenNoEngineRunning` — companion baseline: same setup, no engine registered, confirms the live fetch still happens and the response is still correct — proves the engine-sourcing path is a genuine behavioral branch, not dead code.
- **Verified via revert-and-reconfirm:** Reverted the `GetResourceTopology` cache-miss branch to always call `BuildTopology` (the pre-fix behavior) → `TestGetResourceTopology_UsesRunningEngineInsteadOfLiveFetch` failed with "got 1" additional live call, exactly as expected. Restored the fix → both tests pass again.
- **Before:** Every topology-v2 cache miss issued a full live K8s API fan-out across ~34 resource types, regardless of whether a `ClusterGraphEngine` already held equivalent cached data.
- **After:** When a `ClusterGraphEngine` is already running and ready for the cluster, 16 of the ~34 resource types are served from its informer cache instead of a live API call; graph completeness is unchanged in both cases.
- **Regression Results:** Full backend suite (`go test ./... -race`) green, zero new failures. Frontend: no files touched by this finding.
- **Remaining Risk:** Low-moderate. The engine-sourced 16 types reflect the engine's OWN debounced rebuild cadence (2s debounce, Phase-0-era informer resync), which may be up to a few seconds staler than a fresh live List() would be — this is the same staleness the engine's own blast-radius SCORE already carries (unchanged, pre-existing, already relied upon by `/blast-radius`), so this fix does not introduce a new staleness class, only extends an already-accepted one to a second consumer. The 18 engine-uncovered types (RBAC, Nodes, Namespaces, storage, events, etc.) are unaffected — always fresh, exactly as before.

## Finding: BLASTRADIUS-2

- **Severity:** P1
- **Status:** FIXED
- **Root Cause:** In `internal/topology/v2/collector_k8s.go`'s `CollectFromClient`, 32 of 34 resource-collection goroutines (all except Pods and Events) issued a single `List(ctx, metav1.ListOptions{Limit: 500})` call and discarded the response's `Continue` token. Any resource type with more than 500 live instances in the target scope was silently truncated at 500 with no signal to the caller or the UI that the result was incomplete.
- **Evidence:** Re-confirmed via full read of the file (364 lines pre-fix) — only the Pods and Events goroutines used a continuation-loop; all 32 others matched the single-call pattern exactly as the audit described. Also confirmed the existing `FailedResources`/`recordFailure` mechanism (`collector.go`, `response.go`, `builder/graph_builder.go`) was already fully wired end-to-end from collector → `ResourceBundle` → `TopologyResponse.FailedResources` (JSON `failed_resources`) → available to the frontend, but only fires on outright `List()` errors, never on a successful-but-truncated page.
- **Decision:** Generalized the proven Pods/Events continuation-loop pattern into a single generic helper (`paginatedCollect[TList continuable, TItem any]`) applied to all 34 resource types (including re-deriving Pods/Events through it, eliminating the prior duplication), rather than writing 32 separate copy-pasted loops. Added a safety cap (`collectMaxPages = 50` × `collectPageSize = 500` = 25,000 items per resource type) so a pathological or misbehaving API server (one that never returns an empty `Continue` token) cannot make a single request paginate unboundedly; hitting the cap reuses the EXISTING `recordFailure`/`FailedResources` mechanism (not a new field) to flag that resource type as incomplete, per the instruction to prefer existing mechanisms where the architecture already supports it.
- **Change:** `internal/topology/v2/collector_k8s.go` — added `paginatedCollect` generic helper and `continuable` interface (satisfied by every client-go generated List type via its embedded `metav1.ListMeta`); converted all 34 resource-collection goroutines to use it.
- **Files Changed:** `internal/topology/v2/collector_k8s.go`.
- **Traversal Semantics:** N/A (collection-layer fix, not graph traversal).
- **Failure Semantics:** A resource type is marked incomplete in `FailedResources` in exactly two cases now (both pre-existing categories, same mechanism): (a) any page's `List()` call returns an error, or (b) the 50-page/25,000-item safety cap is reached before an empty `Continue` token is seen. Both are indistinguishable to the caller by design — either way, that resource type's data in the bundle may be partial, and `FailedResources` says so.
- **Tests:**
  - `internal/topology/v2/collector_k8s_test.go`: `TestCollectFromClient_PaginatesBeyondSinglePage` — a fake clientset with 1200 Deployments and a reactor that honors `Limit`/`Continue` like a real API server (the default fake `ObjectTracker` does not), proving the collector returns all 1200, not 500.
  - `TestCollectFromClient_SafetyCapFlagsIncompleteResourceType` — a reactor that always returns a full page with a non-empty `Continue` token (simulating a pathological non-terminating pagination), proving collection stops at exactly `collectMaxPages * collectPageSize` = 25,000 items and `"deployments"` is recorded in `FailedResources`.
- **Verified via revert-and-reconfirm:** Reverted the Deployments goroutine to the original single-call `ListOptions{Limit: 500}` pattern → `TestCollectFromClient_PaginatesBeyondSinglePage` failed ("got 500" instead of 1200), exactly as expected. Restored the fix → both tests pass again.
- **Before:** Any resource type exceeding 500 live instances was silently truncated with no caller-visible signal.
- **After:** Every resource type is paginated to completion (bounded by a 25,000-item safety cap per type), and any truncation — whether from an error or the safety cap — is surfaced via the existing `FailedResources` field already wired through to the API response.
- **Regression Results:** Full backend suite (`go test ./... -race`) green, zero new failures, including all existing `internal/topology/v2` and `internal/topology/v2/builder` tests.
- **Remaining Risk:** Low. 25,000 items per resource type comfortably exceeds realistic single-cluster resource counts for every type observed in practice; a cluster that genuinely exceeds it will now get an honest "incomplete" signal instead of a silent, confident-looking wrong answer.

## Finding: BLASTRADIUS-3

- **Severity:** P1
- **Status:** FIXED
- **Root Cause:** `getOrStartGraphEngine` (`internal/api/rest/blast_radius.go`) held `h.graphEnginesMu` (a single, map-wide `sync.RWMutex`) as a write lock across both `h.getClientFromRequest` (kubeconfig resolution / potential network calls to an unreachable cluster) and `engine.Start()` (informer factory setup). Because the lock was not scoped per-cluster, a slow or unreachable cluster's cold start serialized EVERY other cluster's `/blast-radius`, `/blast-radius/summary`, and `/blast-radius/graph-status` lookups behind it, even for clusters whose engines were already running or could start instantly.
- **Evidence:** Re-confirmed via full read of `getOrStartGraphEngine` (lines 131-175 pre-fix) — the write lock (`h.graphEnginesMu.Lock()`) scope, confirmed via `defer h.graphEnginesMu.Unlock()`, spanned the entire function body including both slow calls, exactly as audited.
- **Decision:** Chose the roadmap's second offered option ("release-before-call and re-check before inserting") over per-cluster lock sharding, implemented via `golang.org/x/sync/singleflight.Group` keyed by `clusterID` — the idiomatic Go primitive for "coalesce concurrent callers of the same key without blocking callers of a different key," which gives a strictly better guarantee than a hand-rolled per-cluster mutex map (no separate cleanup/eviction logic needed for per-cluster locks that would otherwise accumulate).
- **Change:** `internal/api/rest/handler.go` — added `graphEngineGroup singleflight.Group` field to `Handler` (zero value is ready to use). `internal/api/rest/blast_radius.go` — rewrote `getOrStartGraphEngine`: the fast-path existence check is unchanged (RLock only); the slow path now runs entirely inside `h.graphEngineGroup.Do(clusterID, ...)`, which never holds `graphEnginesMu` across `getClientFromRequest` or `engine.Start()` — the map mutex is only acquired briefly, at the very end, to insert the newly-started engine.
- **Files Changed:** `internal/api/rest/handler.go`, `internal/api/rest/blast_radius.go`.
- **Failure Semantics:** Unchanged — a failed `getClientFromRequest` still returns `nil` (surfaced by callers as 503 "Blast radius graph not available"); `singleflight.Group` propagates that same error/nil result to every caller coalesced into that `Do` call, identical to how the old TOCTOU re-check would have handled concurrent same-cluster callers.
- **Tests:**
  - `internal/api/rest/blast_radius_test.go`: `TestGetOrStartGraphEngine_SlowClusterDoesNotBlockOtherClusters` — a mock `ClusterService` whose `GetOrReconnectClient` blocks on a channel for one specific `clusterID` (deterministic, not sleep-based — avoids the previously-documented `k8stesting.Action`-has-no-`GetContext()` limitation by not relying on fake-clientset reactor timing at all). Proves a concurrent lookup for a DIFFERENT cluster completes within 3s while the slow cluster's resolution is still blocked, then unblocks the slow cluster and confirms it also completes.
  - `TestGetOrStartGraphEngine_ConcurrentSameClusterCoalesces` — 10 concurrent callers for the SAME clusterID all receive the identical engine instance, proving `singleflight` preserves the original TOCTOU guard's single-engine-per-cluster guarantee.
- **Verified via revert-and-reconfirm:** Reverted to the original single-mutex-held-across-both-calls implementation → `TestGetOrStartGraphEngine_SlowClusterDoesNotBlockOtherClusters` failed with "fast cluster's getOrStartGraphEngine was blocked by the slow cluster's cold start" after the 3s timeout, exactly as expected. Restored the fix → both tests pass again.
- **Before:** One cluster's cold-starting or unreachable client resolution blocked every other cluster's graph-engine lookups globally.
- **After:** Concurrent lookups for different clusters never block each other; concurrent lookups for the same cluster still coalesce into a single client-resolution + engine-start, now via `singleflight` instead of a double-checked map lock.
- **Regression Results:** Full backend suite (`go test ./... -race`) green, zero new failures, zero new data races detected.
- **Remaining Risk:** Low. `singleflight.Group`'s own internal mutex is held only briefly (map lookup/insert for in-flight calls), never across the slow work — this is the documented, standard behavior of the `golang.org/x/sync/singleflight` package already used elsewhere in this codebase's dependency tree.

## Blast Radius Contract (as verified/established this phase)

| Aspect | Value |
|---|---|
| Resource identity | `{Kind, Namespace, Name}` triple (`models.ResourceRef`), unchanged |
| Graph source | `ClusterGraphEngine`'s informer-cached snapshot (`/blast-radius`, `/blast-radius/summary`, `/blast-radius/graph-status` — unchanged, already engine-sourced pre-Phase-6); `GetResourceTopology`'s canvas now ALSO partially engine-sourced (16/34 types) when an engine is running and ready, else fully live (BLASTRADIUS-1) |
| Traversal direction | Unchanged — forward/reverse dependency edges per `graph.BuildSnapshot`'s existing inference rules; not modified this phase |
| Relationship semantics | Unchanged — resource-type-specific inference (owner refs, selectors, volume/configmap/secret mounts, etc.) in `internal/graph/inference.go`; not modified this phase |
| Cycle handling | Unchanged — `ComputeBlastRadiusWithMode`'s BFS uses a `visited` map (confirmed present, not re-built, during this phase's read-only re-verification); cycle-safety was already covered by the original audit and remains correct — no evidence found of regression |
| Deduplication | Unchanged — node identity (`Kind/Namespace/Name`) naturally dedupes the `visited`-map BFS; not modified this phase |
| Timeout | Reused unchanged: 30s `context.WithTimeout` on topology requests (Phase 1); `/blast-radius` itself has no explicit per-request timeout beyond the engine's own snapshot read (lock-free atomic load, effectively instant) — unchanged from pre-Phase-6 |
| Cancellation | Reused unchanged — request-context propagation through `getClientFromRequest`/`CollectRemainderFromClient`/`BuildGraph`, all `ctx`-threaded; no new cancellation mechanism introduced |
| Incomplete-data behavior | `FailedResources` (pre-existing field, now populated more completely — BLASTRADIUS-2) signals any resource type that could not be fully collected, whether from a live-API error or the new pagination safety cap; engine-sourced types (BLASTRADIUS-1) cannot populate `FailedResources` since they involve no live API call |
| Output states | Engine not yet started → `nil` (503 "not available"); engine started but not yet synced → `Status().Ready == false` (503 "still building"); engine ready, resource not found in graph → `ComputeBlastRadiusWithMode` error → 404; engine ready, resource found → 200 with result (`AuditTrail` stripped unless `?audit=true`) — all unchanged from pre-Phase-6 |

## Regression Protection — Phases 1-5 verified intact

- Full backend suite: `go test ./... -race` → **all packages pass**, zero new failures, zero data races (including `internal/api/rest`, `internal/graph`, `internal/topology`, `internal/topology/v2`, `internal/topology/v2/builder` — every package touched directly or transitively by this phase's three fixes).
- Frontend: no files touched by Phase 6 (backend-only fixes). `npx tsc --noEmit` clean; `npx vitest run src/topology/` → 8/8 pass (TOPOLOGY-1's Phase 5 regression suite, re-confirmed unaffected).
- No changes made to any file outside `internal/graph/engine.go`, `internal/topology/v2/collector_k8s.go`, `internal/api/rest/handler.go`, `internal/api/rest/blast_radius.go`, plus the three new `_test.go` files — confirmed via the diff reviewed during this phase; Fleet N+1, general topology improvements, metrics, UX, observability, chaos testing, release pipeline, kcli, and WebSocket/CONTAM-1 were explicitly NOT touched, per this phase's scope-control instruction.

## Phase 6 Acceptance Gate — Assessment

1. **Every Phase 6 finding fixed or explicitly blocked/unverified.** → BLASTRADIUS-1, BLASTRADIUS-2, BLASTRADIUS-3 all FIXED.
2. **Blast Radius traceable to actual K8s relationships.** → Unchanged — `/blast-radius` was already engine-snapshot-sourced pre-Phase-6; this phase did not alter traversal/relationship logic, only widened/deduplicated the data collection feeding the canvas view and removed a lock-contention hazard.
3. **Opening Blast Radius on a large cluster completes without redundant live API fan-out.** → Proven for the common case (engine already running): 16/34 resource types no longer live-fetched on topology cache miss (BLASTRADIUS-1 test). Full fan-out still occurs on true cold start (no engine yet) — unchanged, unavoidable without a larger engine-coverage expansion explicitly rejected as disproportionate (see BLASTRADIUS-1 Decision).
4. **A cluster with >500 of any resource type produces a complete or explicitly-flagged-incomplete graph.** → Proven via `TestCollectFromClient_PaginatesBeyondSinglePage` (1200 items fully collected) and `TestCollectFromClient_SafetyCapFlagsIncompleteResourceType` (flagged via `FailedResources` when genuinely unbounded).
5. **Two different clusters' blast-radius requests do not block each other.** → Proven via `TestGetOrStartGraphEngine_SlowClusterDoesNotBlockOtherClusters`.
6. **Never infinite loading.** → Unchanged — `getOrStartGraphEngine` still returns promptly (now even more so, since it never blocks on a different cluster); `GetGraphStatus`/`Status().Ready` remain the existing mechanism for callers to observe in-progress builds.
7. **Never silently incomplete.** → Directly addressed: BLASTRADIUS-1's partial-sourcing preserves 100% type coverage (verified via the Decision's type-by-type audit); BLASTRADIUS-2 ensures no single-page truncation goes unflagged.
8. **Regression tests exist for every fixed finding, verified via revert-and-reconfirm.** → All three findings: 2 tests each (6 total new tests), each confirmed to fail against the pre-fix code and pass against the fix.
9. **Phases 1-5 remain intact.** → Verified above — full backend suite + targeted frontend suite, zero new failures.
10. **No unrelated changes introduced.** → Confirmed via the file list above; no Fleet N+1, general topology, metrics, UX, observability, chaos-testing, release-pipeline, kcli, or WebSocket/CONTAM-1 changes.

**Phase 6 acceptance: PASS.** Resource-type cycle-safety, directionality, and relationship-semantics verification (Steps 5-8 of the phase methodology) were re-confirmed by reading (not modifying) `internal/graph`'s existing BFS/inference code and found consistent with the original audit's prior findings — not re-built, not re-tested from scratch, since neither finding touches that logic. Live-cluster performance measurement (Step 13) was UNVERIFIED-this-phase — no live large cluster was available in this environment; the fan-out reduction is structurally guaranteed (fewer live List() calls by construction) but not quantified against a real cluster, consistent with the same caveat recorded in Phase 5 for TOPOLOGY-1.

---

PHASE 6 COMPLETE — STOPPED FOR APPROVAL

---

# Phase 7 — Frontend UX Reliability: Execution Record

**Findings addressed:** UX-1, UX-2, UX-3 (the roadmap's Phase 7 scope has no discrete finding IDs like prior phases — it is written as three bullet points; these IDs are this record's own labels for traceability, not pre-existing audit IDs.)

**Note on scope:** the pasted Phase 7 instructions' Step 6 (Fleet removal — "stays pending and there is no escape") is **not** assigned to Phase 7 by `docs/PRODUCTION-HARDENING-ROADMAP.md`. Per the scope-control rule ("DO NOT fix Fleet N+1 ... unless explicitly assigned to Phase 7") and Step 6's own conditional wording ("If the relevant finding is in Phase 7 scope"), this was investigated only to the extent of confirming it is out of scope, and otherwise left untouched — flagged here as a candidate for a future phase, not silently dropped.

## Finding: UX-1 — AsyncSection/PageSkeleton/DetailPageSkeleton consistency

- **Severity:** P2
- **Status:** PARTIALLY FIXED (one concrete, representative, fully-tested fix; broader page-by-page audit explicitly UNVERIFIED — see Remaining Risk)
- **Root Cause:** `AsyncSection`/`PageSkeleton`/`DetailPageSkeleton` exist and are well-built (confirmed via full read of `AsyncSection.tsx`), but are used in only 2 / 4 / 2 places respectively across 154 page files — the overwhelming majority of pages implement loading/error ad hoc, with no guarantee of consistent timeout/abort handling. Representative investigation: `ClusterHealthWidget.tsx` (one of 7 independent data-fetching widgets on the Dashboard — itself one of the roadmap's five named "critical pages") called `useClusterOverview` and `useHealthScore` but checked neither's loading nor error state at all. Because `useHealthScore` always returns a concrete, synchronously-computed score (defaulting to "0, grade F, critical" before any data arrives), the widget rendered an alarming "At Risk" verdict with a 0 score identically whether the cluster was genuinely unhealthy, still loading, or the health check had failed outright.
- **Evidence:** Read `AsyncSection.tsx` in full (sound design, low adoption — confirmed via `grep -rl` counts). Read `ClusterHealthWidget.tsx` and `useHealthScore.ts` in full; confirmed `useHealthScore`'s return type had no loading/error signal of any kind.
- **Decision:** Given 154 pages and this phase's explicit gate ("a **sampled** set of critical pages: Dashboard, Fleet, Topology, Blast Radius, resource list/detail"), a full page-by-page retrofit was out of proportion for this phase. Fixed the confirmed, concrete bug on the Dashboard (one of the five named pages) with full regression coverage, and left the broader cross-page audit explicitly UNVERIFIED rather than claiming blanket coverage it doesn't have.
- **Change:**
  - `internal/hooks/useHealthScore.ts` → `src/hooks/useHealthScore.ts`: added `isLoading`/`isError` to the `HealthScore` return type. `isLoading` is true only while *every* viable data source (backend overview, or the direct-K8s pods/nodes fallback) has no data yet; `isError` is true only when every viable source has failed outright — a partial failure still yields a valid score via the hook's existing fallback chain, so that case is correctly NOT an error.
  - `src/features/dashboard/components/ClusterHealthWidget.tsx`: both the header's status badge ("At Risk"/"Good State"/etc.) and the body gauge now check `isLoading`/`isError` before rendering a verdict — loading shows a neutral skeleton pulse + "Loading cluster health…"; error shows an explicit "Unable to load cluster health" message with ARIA `role="alert"` and an explanation that this does not mean the cluster is unhealthy.
- **Files Changed:** `src/hooks/useHealthScore.ts`, `src/features/dashboard/components/ClusterHealthWidget.tsx`.
- **State Machine (ClusterHealthWidget):**

  | State | Trigger | Visible |
  |---|---|---|
  | INITIAL/No cluster | `!hasData` | `EmptyNoClusters` with "Connect Cluster" action |
  | LOADING | `healthScore.isLoading` | Neutral pulse skeleton + "Loading cluster health…" (`role="status"`) — no badge, no score |
  | ERROR | `healthScore.isError` | "Unable to load cluster health" message, explicitly disclaims "does not mean unhealthy" (`role="alert"`) — no badge, no score |
  | SUCCESS | neither | Existing gauge + badge + breakdown, unchanged |

- **Tests:** `src/features/dashboard/components/ClusterHealthWidget.test.tsx` (new) — 3 tests: loading state shows no fabricated "At Risk" verdict; error state shows the explicit error message and no fabricated verdict; success state (once `isLoading`/`isError` are both false) still renders the real "Good State" badge, proving the gate doesn't suppress legitimate data.
- **Verified via revert-and-reconfirm:** Reverted `isLoading`/`isError` to hardcoded `false` → loading and error tests failed exactly as expected ("At Risk" badge present when it must not be) while the success test still passed (not gated by the reverted logic). Restored the fix → all 3 pass.
- **Before:** A still-loading or failed health check rendered an identical "At Risk, 0% healthy" verdict to a genuinely critical cluster.
- **After:** Loading and error are visually and semantically distinct from both success and from each other; no fabricated verdict is ever shown.
- **Regression Results:** Full frontend sweep (422/425 tests, the same 3 pre-existing/unrelated `ClusterPickerPage`×2 + `AddClusterDialog`×1 failures documented in every prior phase) + `tsc --noEmit` clean. The 5 other `useHealthScore` consumers (`DashboardHero`, `DataDrivenInsightsCard`, `LiveSignalStrip`, `HealthScoreCard`) all consume the whole returned object rather than destructuring a fixed field set, so the additive `isLoading`/`isError` fields are non-breaking for them — confirmed by reading each call site; none were modified (none currently need the new fields to stay correct, since they render supplementary detail rather than issuing a standalone health verdict).
- **Remaining Risk:** Moderate. This fix closes one confirmed, representative instance on a named critical page. The broader claim — that every page using ad hoc loading/error handling is consistent — remains UNVERIFIED-this-phase; a full audit of all 154 pages was judged disproportionate to this phase's scope, consistent with the Phase 5/6 precedent of explicitly marking out-of-proportion verification as UNVERIFIED rather than silently assumed correct.

## Finding: UX-2 — HEALTH-2 staleness indicator consistency (Fleet, cluster picker, sidebar)

- **Severity:** P1 (the FleetDashboard crash risk alone would be P0 on live traffic)
- **Status:** FIXED
- **Root Cause:** Investigated all three named locations:
  - **Fleet** (`useFleetOverview.ts`): `mapBackendStatus`/`mapHealthStatus` both defaulted a missing or unrecognized status string to `'healthy'` (`if (!status) return 'healthy'`) — a cluster Fleet had no information about rendered identically to one confirmed healthy. Worse, `FleetDashboard.tsx`'s `statusConfig` object had no `'healthy'`-adjacent `'unknown'` entry at all, so `statusConfig[cluster.status]` would be `undefined` for any such cluster and `cfg.ringClass` would throw — crashing the whole Fleet page the first time any cluster's health genuinely couldn't be determined. Additionally, the backend's `ClusterSummary.stale`/`stale_as_of`/`reachable`/`error_message` fields (the actual Phase 2 HEALTH-2 contract surface already exposed to the frontend in `BackendClusterSummary`) were read nowhere in `useFleetOverview.ts` — Fleet showed no staleness signal at all despite the backend already providing one.
  - **Cluster picker** (`ClusterPickerPage.tsx`): already correctly avoided the unknown→healthy conflation (`reachabilityDotClass`'s `'unknown'` case was already a neutral gray, never green) — classified ALREADY FIXED for that specific bug, not modified. The staleness *age* (`lastCheckedAt`) was however only exposed via a hover-only `title` tooltip, not visible by default.
  - **Sidebar**: does not display cluster-level health/reachability staleness at all (`useResourceCounts`' `stale`/`reachable` fields are about *resource-count* cache staleness, a different, already-correct concept — not in scope here). The one cluster-status "dot" that does exist in the header/sidebar chrome, `Header.tsx`'s kubeconfig-download dropdown, had the same `?? 'healthy'` default-to-green bug as Fleet.
- **Evidence:** Read `useFleetOverview.ts`, `FleetDashboard.tsx`, `ClusterPickerPage.tsx`, `Sidebar.tsx`, `Header.tsx` in full/targeted detail; confirmed via `grep` that Sidebar has zero references to `LastCheckedAt`/`lastCheckedAt`/`reachable` in a cluster-health sense.
- **Decision:** Fixed the two confirmed defaults-to-healthy bugs (Fleet, Header) at their root (the mapping functions / color lookup), added a distinct `'unknown'` status throughout Fleet's type/render chain (not merged into `'healthy'`), threaded the already-existing-but-unused backend staleness fields (`stale`/`stale_as_of`/`reachable`/`error_message`) into Fleet's UI, and upgraded the cluster picker's staleness treatment from hover-only to an always-visible indicator (an amber ring on the reachability dot past the same 60s threshold `DataFreshnessIndicator` already uses elsewhere), so all three named locations now agree on what "unknown" and "stale" look like. Did not touch Sidebar's resource-count staleness (`useResourceCounts`) — confirmed that's a different, already-correct mechanism, out of this finding's scope.
- **Change:**
  - `src/hooks/useFleetOverview.ts`: `FleetCluster.status` gains `'unknown'`; `mapBackendStatus`/`mapHealthStatus` return `'unknown'` instead of `'healthy'` for a missing/unrecognized status (recognized vocabularies — `connected`/`healthy`, and the healthscore package's `excellent/good/fair/degraded/poor/unhealthy/critical` plus the summary endpoint's actual `healthy/degraded/unhealthy` — still map correctly, confirmed by reading both backend status-producing functions, `clusterStatusFromError` and `computeClusterHealthStatus`, directly). `FleetAggregates` gains `unknownClusters`. `FleetCluster` gains `reachable`/`stale`/`staleAsOf`/`errorMessage` (threaded from `BackendClusterSummary`) and `summaryUnavailable` (true only when the per-cluster `/summary` request itself errored, distinct from "hasn't resolved yet").
  - `src/pages/FleetDashboard.tsx`: `statusConfig` gains an `unknown` entry (neutral/slate, matching `StatusBadge`'s existing `neutral` variant convention) with a defensive `?? statusConfig.unknown` fallback; added a visible amber "stale" clock-icon indicator (tooltip gives the cached-as-of age) next to the status badge, and the badge's tooltip now also surfaces `summaryUnavailable`/`errorMessage` distinctly from a genuine `healthReason`.
  - `src/components/layout/Header.tsx`: `statusColors` gains `unknown` (slate) plus the full real vocabulary (`connected`/`disconnected`/`degraded`), and the one call site no longer defaults a missing status to `'healthy'`.
  - `src/pages/ClusterPickerPage.tsx`: added `isReachabilityStale()` (60s threshold, matching `DataFreshnessIndicator`) and an always-visible amber ring on the reachability dot when stale, alongside the existing hover tooltip (kept for the exact age).
- **Files Changed:** `src/hooks/useFleetOverview.ts`, `src/pages/FleetDashboard.tsx`, `src/components/layout/Header.tsx`, `src/pages/ClusterPickerPage.tsx`, plus test-infrastructure fixes required to actually exercise these paths (see Tests).
- **UI State Contract (Fleet cluster status):**

  | Status | Meaning | Visual |
  |---|---|---|
  | `healthy` | Backend reports healthy/connected | Emerald ring + badge |
  | `warning` | Backend reports degraded/warning | Amber ring + badge |
  | `error` | Backend reports failed/critical/disconnected | Red ring + badge |
  | `unknown` | Status missing or unrecognized — Fleet has no basis to claim health | Slate/neutral ring + badge, never green |
  | *(overlay)* `stale` | Data is from the backend's last-known-good cache, live fetch failed | Amber clock icon, tooltip gives cache age |
  | *(overlay)* `summaryUnavailable` | The `/summary` request itself failed | Badge tooltip says "Health details unavailable" instead of a fabricated reason |

- **Tests:**
  - `src/hooks/useFleetOverview.test.ts`: 2 new regression tests — missing `cluster.status` maps to `'unknown'` (not `'healthy'`), missing `summary.health_status` maps to `'unknown'` (not `'healthy'`). Updated the pre-existing empty-aggregates test for the new `unknownClusters` field (additive, not a behavior change).
  - `src/pages/__tests__/page-smoke.test.tsx`: 1 new regression test — a cluster with `status: 'unknown'` renders without crashing and shows a label distinct from "Healthy". Fixed two pre-existing test-infrastructure bugs this test surfaced (not production bugs): the `useClusterOrganizationStore` mock used a `Set` for `favorites` where the real store (and `ClusterCard`'s `.includes()` call) uses an `Array` — never previously exercised because no prior test rendered a populated cluster list; and the `StatusBadge` mock ignored the `variant`/`label` props `FleetDashboard` actually passes (the "legacy API"), always rendering empty regardless of status.
- **Verified via revert-and-reconfirm:**
  - `useFleetOverview.ts`: reverted both `if (!status)`/`if (!healthStatus)` branches back to `return 'healthy'` → both new tests failed ("expected 'unknown' to be... received 'healthy'"), exactly as expected. Restored → both pass.
  - `FleetDashboard.tsx`: reverted `statusConfig` to the original 3-key object with no `unknown` entry and no defensive fallback → the new smoke test failed with `TypeError: Cannot read properties of undefined (reading 'ringClass')` — the predicted production crash, reproduced exactly. Restored → passes.
- **Before:** A cluster Fleet had no health information for displayed as a plain green "Healthy" badge — or, for the fallback-to-`cluster.status` path with no recognized value, crashed the entire Fleet page. Staleness was invisible on Fleet entirely and hover-only on the cluster picker.
- **After:** "Unknown" is a distinct, never-green, crash-safe state across Fleet and Header; staleness is visible by default (not hover-only) on both Fleet and the cluster picker, using the same amber convention in both places.
- **Regression Results:** Full frontend sweep: 422/425 (same 3 pre-existing/unrelated failures as every prior phase). `tsc --noEmit` clean.
- **Remaining Risk:** Low. `FleetAggregates.unknownClusters` is computed correctly but not yet surfaced as its own stat card in `AggregateStrip` (would require widening the existing 7-card `lg:grid-cols-7` grid) — a minor, bounded, purely additive follow-up, not a correctness gap (the existing 4 cards — Healthy/Degraded/Failed/Total — already sum correctly without double-counting unknown clusters as healthy). `Header.tsx`'s fix has no dedicated test (low-traffic surface: a status dot in the kubeconfig-download dropdown) — verified by `tsc` type-checking and code inspection only.

## Finding: UX-3 — "Unknown" metric state distinct from "0" (Phase 3)

- **Severity:** N/A
- **Status:** ALREADY FIXED — not modified, per Step 1's explicit "if already fixed: DO NOT MODIFY."
- **Root Cause (none — verifying the audit's premise):** Investigated all consumers of `parseK8sQuantityToBytes`/`parseK8sCpuToMillicores` (`ClusterCapacity.tsx`, `useClusterUtilization.ts`, `MetricsDashboard.tsx`, `PodDetail.tsx`). An initial grep-based pass suggested a systemic "`?? 0` discards `null`/unknown" problem across all four; closer reading showed this was not the case at the primary user-visible touchpoints:
  - `useClusterUtilization.ts`'s per-node `?? 0` fallback is explicitly, correctly documented as safe: the hook's real "unknown" signal is a separate `metricsAvailable: boolean` field, and `ClusterCapacity.tsx` (the Dashboard's primary capacity widget — one of the roadmap's five named critical pages) already consumes it correctly, via a `hasMetrics` flag that switches the displayed metric's *label* itself between "used" (real metrics) and "reserved" (capacity fallback) rather than ever showing a bare, ambiguous "0%".
  - `MetricsDashboard.tsx`'s top-level `!metrics` early-return already renders a distinct, well-built "Metrics unavailable" empty state (with install instructions when metrics-server is missing) before any numeric value is ever computed — the `?? 0` fallbacks deeper in the file only apply to individual fields *after* this gate has already confirmed real data exists, where a single malformed field reasonably degrades to 0 rather than failing the whole display.
  - `ClusterCapacity.tsx`'s own local `parseCpuMillis`/`parseMemoryBytes` (`?? 0`) are used for *capacity sums* (node `.status.allocatable`, pod container `.resources.requests`) — spec/config data, not live usage metrics, where a missing field legitimately means "0 additional reserved," not "unknown."
  - `PodDetail.tsx`'s equivalent local helpers are used the same way (declared requests/limits from the pod spec), same reasoning.
- **Evidence:** Read `k8sQuantity.ts` (confirmed `null`-returning contract intact, unmodified since Phase 3), `ClusterCapacity.tsx` (full `hasMetrics`/`cap` computation and all 9 render-site usages of `hasMetrics`), `MetricsDashboard.tsx`'s `!metrics` gate and surrounding ~60 lines, `useClusterUtilization.ts` in full.
- **Decision:** No code change. The roadmap's concern — "unknown" metric state getting silently collapsed into "0" — is the exact failure mode `hasMetrics`/`metricsAvailable`/the `!metrics` empty-state gate were already built to prevent, and they do, at every point a user would actually see a current-usage number. Forcing a change here would have violated "if already fixed: DO NOT MODIFY."
- **Files Changed:** None.
- **Tests:** None added — no behavior changed.
- **Before / After:** N/A — no change.
- **Regression Results:** N/A — no change.
- **Remaining Risk:** Low. A narrower, deeper edge case was noted but not pursued: if a metrics-server response *succeeds* overall (passing `MetricsDashboard`'s `!metrics` gate) but returns an *empty* time-series array for one specific pod/container, `currentCpu`/`currentMemory`'s `?? 0` would show "0" rather than "unknown" for that one data point. This is a narrow, low-probability case (metrics-server responses are machine-generated, not user input) judged out of proportion to pursue this phase given the primary, user-visible touchpoints are already correct; flagged as a candidate for a future phase if it proves to matter in practice.

## Phase 7 UI State Contracts Summary

| Operation | Loading | Success | Empty | Error | Timeout | Stale |
|---|---|---|---|---|---|---|
| Dashboard → Cluster Health (`ClusterHealthWidget`) | Neutral pulse, "Loading cluster health…" | Gauge + badge + breakdown | N/A (no cluster connected → `EmptyNoClusters`) | "Unable to load cluster health" (`role="alert"`), explicitly disclaims unhealthy | Folded into Error (Phase 1's 20s/configurable timeout surfaces as a query error) | N/A (not a cached-data concept here) |
| Fleet → cluster status (`FleetDashboard`) | Skeleton cards (pre-existing, unchanged) | Colored ring/badge per status | N/A (connect-cluster empty state, unchanged) | `unknown` status (slate, never green) when health can't be determined; `summaryUnavailable` tooltip when the `/summary` request itself failed | Folded into `unknown`/the per-cluster query's own error state | Amber clock icon + tooltip with cache age, when backend reports `stale: true` |
| Cluster picker reachability dot | N/A (pre-existing `unknown` gray dot while unresolved) | Green dot | N/A | Red dot (`unreachable`) | Folded into `unreachable` | Amber ring overlay past 60s since last check (new) |

## Regression Protection — Phases 1-6 verified intact

- Backend: `go test ./internal/... -race` → all packages pass (cached — zero backend files touched this phase).
- Frontend: `npx tsc --noEmit` clean. `npx vitest run src/lib/k8sQuantity.test.ts src/topology src/pages src/hooks src/components src/features` → 422/425 pass; the 3 failures (`ClusterPickerPage.test.tsx` ×2, `AddClusterDialog.test.tsx` ×1) are the same pre-existing, unrelated failures documented in every prior phase's execution record — unchanged count, unchanged tests.
- No changes to any timeout/cancellation mechanism (Phase 1), cluster lifecycle logic (Phase 2), data-correctness parsers (Phase 3, confirmed via UX-3's no-op outcome), startup/fleet backend logic (Phase 4), topology scoping (Phase 5), or Blast Radius backend logic (Phase 6) — this phase's changes are entirely frontend presentation-layer (`useFleetOverview`, `useHealthScore`, `FleetDashboard`, `ClusterHealthWidget`, `Header`, `ClusterPickerPage`) plus their tests.

## Phase 7 Acceptance Gate — Assessment

1. **Every Phase 7 finding FIXED or explicitly BLOCKED/UNVERIFIED.** → UX-2 FIXED. UX-3 ALREADY FIXED (verified, not modified). UX-1 PARTIALLY FIXED — one confirmed, representative, fully-tested instance fixed; the broader 154-page audit explicitly UNVERIFIED-this-phase, not silently assumed complete.
2. **No affected screen can remain in an infinite loading state.** → `ClusterHealthWidget`'s new loading state resolves the instant `healthScore.isLoading` flips (itself driven by Phase 1's existing timeout/cancellation mechanisms — no new timeout system introduced, per the explicit instruction).
3. **Errors are visible and actionable.** → `ClusterHealthWidget`'s error state names the operation and explicitly disclaims a false-unhealthy reading; Fleet's `summaryUnavailable` tooltip surfaces the underlying `errorMessage` when the backend provides one.
4. **Empty and error states are distinct.** → Verified both for `ClusterHealthWidget` (no-cluster empty state vs. fetch-failed error state are different branches with different UI) and confirmed already-correct for `MetricsDashboard`'s existing empty/error handling (UX-3 investigation).
5. **Cluster switching cannot produce stale cross-cluster UI.** → Not touched this phase (no finding in Phase 7's roadmap scope addresses cluster-switch correctness specifically); Phase 5's existing namespace/cluster-scoping contract is unmodified and was not re-verified here, since no Phase 7 finding depends on it.
6. **Removal lifecycle has a terminal success/failure state.** → Out of Phase 7's roadmap-assigned scope (see the Fleet-removal scope note above) — not fixed, not silently ignored.
7. **Health presentation follows the backend health contract.** → Directly addressed by UX-2: Fleet and Header now both derive status strictly from the backend's actual vocabulary (verified by reading the backend's status-producing code), with no invented frontend health logic.
8. **User actions have deterministic feedback.** → Not applicable to any Phase 7 finding — no mutation/action-feedback finding was in roadmap scope this phase.
9. **Refresh and navigation do not leave stale state.** → Not touched this phase — no roadmap finding addresses this; Phase 5's existing React Query query-key-based protections are unmodified.
10. **Regression tests cover every fixed finding.** → UX-1: 3 tests. UX-2: 3 tests (2 hook + 1 page-smoke). UX-3: N/A, no change made.
11. **Phases 1-6 remain intact.** → Verified above — full backend suite + targeted frontend sweep, zero new failures, zero backend files touched.
12. **No P0/P1 regression exists.** → None found; the one P0-adjacent risk discovered (Fleet's crash-on-unknown-status) was a *pre-existing* bug this phase fixed, not a regression introduced by it — confirmed via revert-and-reconfirm that the crash exists on the pre-Phase-7 code.
13. **No unrelated changes were introduced.** → Confirmed via the file list above: `useFleetOverview.ts`, `FleetDashboard.tsx`, `Header.tsx`, `ClusterPickerPage.tsx`, `useHealthScore.ts`, `ClusterHealthWidget.tsx`, plus their tests and the two pre-existing test-mock fidelity fixes required to exercise UX-2's Fleet test. No Fleet N+1, topology/Blast-Radius semantics, metrics architecture, observability, chaos testing, release infrastructure, kcli, WebSocket/CONTAM-1, or broad visual redesign.

**Phase 7 acceptance: PASS**, with UX-1 explicitly scoped to one representative, fully-verified fix rather than a full 154-page audit (judged disproportionate to this phase, consistent with the Phase 5/6 precedent for out-of-proportion verification), and six gate items (5, 6, 8, 9) explicitly N/A because no Phase 7 roadmap finding touches that surface — not fixed, not silently assumed, and not conflated with the three findings that were actually assigned.

---

PHASE 7 COMPLETE — STOPPED FOR APPROVAL

---

# Phase 8 — Observability: Execution Record

**Findings addressed:** OBS-1, OBS-2, OBS-3 (the roadmap's Phase 8 scope has no discrete finding IDs like Phases 1-6 — it is written as three bullet points; these IDs are this record's own labels for traceability, not pre-existing audit IDs — same convention as Phase 7's UX-1/2/3.)

**Scope note:** the user's initial Phase 8 instructions described Fleet N+1/scalability work, which does not match the roadmap's actual Phase 8 ("Observability"). Per this engagement's own rule (use only findings explicitly assigned to the current phase in the roadmap; stop rather than guess on contradiction), this was surfaced to the user directly via a clarifying question rather than silently resolved. The user chose to proceed with the roadmap's actual Phase 8 scope (Observability); the Fleet N+1 issue remains exactly where Phase 4 left it — documented, unassigned to a phase, not fixed this phase.

## Finding: OBS-3 — Request IDs and cluster IDs on hot-path log lines

- **Severity:** N/A
- **Status:** ALREADY FIXED — not modified, per Step 1's "if already fixed: DO NOT MODIFY."
- **Root Cause (none — verifying the audit's premise):** `internal/pkg/logger/logger.go`'s `RequestLog` already writes a structured JSON line per request with `request_id`, `user_id`, `cluster_id`, `method`, `path`, `status`, `duration_ms`. `internal/api/middleware/middleware.go`'s `RequestID` + `StructuredLog` middleware are registered globally (`cmd/server/main.go:1158,1162` — `router.Use(middleware.RequestID)` / `router.Use(middleware.StructuredLog)`), so every request through the router — not just the four hot paths named in the roadmap bullet (overview, topology, blast-radius, cluster lifecycle), all of them — already gets `request_id` (generated or propagated from `X-Request-ID`) and `cluster_id` (extracted from `mux.Vars(r)["clusterId"]`) logged, plus Prometheus `http_requests_total`/`http_request_duration_seconds` counters labeled by method/normalized-path/status.
- **Evidence:** Read `logger.go` and `middleware.go` in full; confirmed the global `router.Use(...)` wiring in `main.go`.
- **Decision:** No code change — the finding, as literally stated in the roadmap, is already satisfied by existing, correctly-wired infrastructure covering a broader surface (every route) than the roadmap's four named examples.
- **Files Changed:** None.
- **Tests:** None added — no behavior changed.
- **Before / After:** N/A.
- **Remaining Risk:** None identified for this finding specifically.

## Finding: OBS-1 — Structured logging/metrics around Phase 1's timeout boundaries

- **Severity:** P2
- **Status:** FIXED
- **Root Cause:** Every `context.DeadlineExceeded` detection site (10 found across `handler.go` ×5, `resources.go` ×2, `shell.go` ×1, `diff_handler.go` ×1, `kcli.go` ×1) maps the timeout to an HTTP status (503/504) and a human-readable message in the **response body only**. The generic `StructuredLog` middleware's log line records just the generic `http.StatusText(status)` (e.g. "Service Unavailable") as `error` — indistinguishable from any other non-timeout reason that also returns 503 (graph engine not ready, circuit breaker open, snapshot store unconfigured, etc.). No metric anywhere counted timeout occurrences specifically (existing metrics: generic `http_requests_total{status}`, which conflates all 503/504 causes). An operator could not answer "did a request time out, where, how often" from logs/metrics alone — exactly the roadmap's own framing of this gap. One site, `kcli.go:131`, was already fully instrumented (`metrics.KCLIExecTotal` with a `"timeout"` label, duration histogram, errors counter, audit log) — confirmed ALREADY FIXED for that one site specifically and left untouched; it served as the reference pattern for the fix below.
- **Evidence:** `grep -rn "DeadlineExceeded"` across `internal/api/rest/`, read each of the 10 sites' surrounding context and enclosing handler.
- **Decision:** Added one shared choke point, `respondTimeout` (`internal/api/rest/errors.go`), used at all 9 previously-uninstrumented sites (not a new timeout *mechanism* — Phase 1's existing `context.WithTimeout`/`AbortSignal.timeout()` boundaries are completely unchanged; this is purely additive observability on their existing failure path). `respondTimeout` logs a structured `slog` warning (`request_id`, `cluster_id`, `operation`, `path`) distinct from the generic per-request log line, increments a new Prometheus counter labeled by `operation`+`cluster_id`, then delegates to the existing `respondError`/`respondErrorWithCode` for the actual HTTP response — response status/body/behavior is byte-for-byte unchanged.
- **Change:**
  - `internal/pkg/metrics/metrics.go`: added `RequestTimeoutsTotal` (CounterVec, labels `operation`, `cluster_id`).
  - `internal/api/rest/errors.go`: added `respondTimeout(w, r, status, code, operation, clusterID, message)`.
  - `internal/api/rest/handler.go`: 5 sites (`GetTopology`, `GetTopologyV2`, `GetTopologyV2Traffic`, `GetResourceTopology`, `GetCriticality`) — each "Topology build timed out" branch now calls `respondTimeout` with its own handler name as `operation`.
  - `internal/api/rest/resources.go`: `respondK8sError` (shared by 6 callers: `ListResources` ×2 call sites, `GetResource`, `PatchResource`, `DeleteResource`, `ApplyManifest`, `GetServiceEndpoints`) gained `r *http.Request`/`clusterID`/`operation` parameters, used only for its timeout branch; all 6 call sites updated to pass the enclosing handler's name and `clusterID`.
  - `internal/api/rest/shell.go`: `PostShell`'s command-timeout branch.
  - `internal/api/rest/diff_handler.go`: `CreateTopologySnapshot`'s build-timeout branch.
- **Files Changed:** `internal/pkg/metrics/metrics.go`, `internal/api/rest/errors.go`, `internal/api/rest/handler.go`, `internal/api/rest/resources.go`, `internal/api/rest/shell.go`, `internal/api/rest/diff_handler.go`.
- **Timeout/Cancellation:** Unchanged — no new timeout system introduced; this instruments the existing Phase 1 `context.WithTimeout`/`AbortSignal.timeout()` boundaries at their existing failure-detection points.
- **Failure Semantics:** Identical response behavior to before (same status codes, same messages, same error codes); the only difference is a structured log line is now written and a metric incremented before the response is sent.
- **Tests:** `internal/api/rest/errors_test.go` (new) — 2 tests: `respondTimeout` increments `RequestTimeoutsTotal` for the given operation/cluster_id and preserves the plain-message response (status+body); and the structured-error-code variant (used by `respondK8sError`) does the same while preserving the error code in the response body.
- **Verified via revert-and-reconfirm:** Reverted `respondTimeout` to skip the log/metric lines → both new tests failed (`RequestTimeoutsTotal` unchanged, "before=0 after=0"), exactly as expected. Restored → both pass.
- **Before:** A timeout and any other 503/504-returning condition were indistinguishable in logs and metrics; no per-operation/per-cluster timeout count existed.
- **After:** Every timeout across the 9 instrumented sites produces a `slog.Warn("request timed out", request_id=..., cluster_id=..., operation=..., path=...)` line and increments `kubilitics_request_timeouts_total{operation,cluster_id}` — an operator can answer "did X time out, where, how often, for which cluster" from logs/metrics alone.
- **Regression Results:** Full backend suite (`go test ./... -race`) green, zero new failures, including all of `internal/api/rest` (104s, the package touched by every one of these changes).
- **Remaining Risk:** Low. The fix covers every `context.DeadlineExceeded` site found by `grep -rn "DeadlineExceeded" internal/api/rest/`; a timeout surfaced through a different error-wrapping pattern not matching that grep (none found) would not be covered. `kcli.go`'s pre-existing instrumentation was deliberately left as-is (already correct, not this finding's scope to touch).

## Finding: OBS-2 — Per-cluster health-check latency/failure counter

- **Severity:** P2
- **Status:** FIXED
- **Root Cause:** `internal/k8s/client.go`'s `updateHealth(err error)` is the single choke point every `TestConnection`/`GetClusterInfo`/`ListResources`/`GetResource`/`DeleteResource`/`PatchResource` call passes through on its way to updating `lastCheckedTime`/`lastSuccessTime`/`lastError` — the exact Phase 2 HEALTH-2 freshness fields the roadmap bullet names. No metric was fed by this data at all; an operator could see *that* a cluster's `LastCheckedAt`/`LastError` (via the `/api/v1/presence` snapshot) indicated a problem, but not *how often* checks were failing or *how long* they were taking, from Prometheus alone.
- **Evidence:** Traced `LastCheckedAt`/`LastSuccessAt`/`LastError` from `internal/cluster/presence/types.go` → `internal/cluster/discovery/manager.go`'s `ReachabilityStatus`/`Snapshot()` → `cmd/server/main.go`'s `SetReachabilityChecker` closure (confirmed this is a *read* of already-tracked state, not where checks execute) → `internal/k8s/client.go`'s `HealthStatus()`/`LastCheckedAt()` (the actual write side) → `updateHealth`, the single function that sets `lastCheckedTime` on every call. Mirrored the existing `circuit_breaker.go` pattern (`metrics.CircuitBreakerFailuresTotal.WithLabelValues(cb.clusterID).Inc()`) for labeling consistency.
- **Decision:** Fed the new metrics from inside `updateHealth` itself — the same data Phase 2's freshness fields already come from, not a second, independently-tracked signal — rather than adding a separate periodic health-check loop (no such loop exists as a single dedicated function; checks happen as a side effect of `TestConnection`/`GetClusterInfo`/every resource operation, and instrumenting the shared choke point covers all of them correctly).
- **Change:**
  - `internal/pkg/metrics/metrics.go`: added `ClusterHealthCheckDurationSeconds` (HistogramVec, label `cluster_id`) and `ClusterHealthCheckFailuresTotal` (CounterVec, label `cluster_id`).
  - `internal/k8s/client.go`: `updateHealth` signature changed to `updateHealth(err error, duration time.Duration)`; observes the duration histogram unconditionally and increments the failure counter on error, using `c.circuitBreaker.clusterID` (the same cluster-ID source `circuit_breaker.go` already uses) as the label. `TestConnection`/`GetClusterInfo` now measure `time.Since(start)` around their full check (including the rate-limiter wait) and pass it through.
  - `internal/k8s/resources.go`: `ListResources`/`GetResource`/`DeleteResource`/`PatchResource` (the other 4 `updateHealth` callers) updated identically — added `start := time.Now()`, passed `time.Since(start)` to the new signature.
- **Files Changed:** `internal/pkg/metrics/metrics.go`, `internal/k8s/client.go`, `internal/k8s/resources.go`.
- **Timeout/Cancellation:** Unchanged — no new timeout logic; duration is measured around the existing call, not used to enforce anything.
- **Failure Semantics:** Unchanged — `updateHealth`'s existing `lastError`/`lastCheckedTime`/`lastSuccessTime` behavior (and therefore `/api/v1/presence`'s `LastCheckedAt`/`LastSuccessAt`/`LastError`) is byte-for-byte identical; the metrics are a pure side-effect addition.
- **Tests:** `internal/k8s/client_health_metrics_test.go` (new) — 2 tests: a successful `TestConnection` against a fake clientset increases `ClusterHealthCheckDurationSeconds`'s sample count; a `TestConnection` against a clientset configured (via a `PrependReactor`) to fail increases `ClusterHealthCheckFailuresTotal{cluster_id}` by exactly 1.
- **Verified via revert-and-reconfirm:** Reverted `updateHealth` to its pre-fix body (no metrics) → both new tests failed ("before=0 after=0" for both the duration sample count and the failure counter), exactly as expected. Restored → both pass.
- **Before:** No visibility into per-cluster health-check latency or failure rate from Prometheus; only the raw `LastCheckedAt`/`LastError` timestamps/strings were available (and only via the `/api/v1/presence` API, not metrics).
- **After:** `kubilitics_cluster_health_check_duration_seconds{cluster_id}` and `kubilitics_cluster_health_check_failures_total{cluster_id}` are available for every cluster, fed by the same code path that already maintains HEALTH-2's freshness fields.
- **Regression Results:** Full backend suite (`go test ./... -race`) green, zero new failures, including `internal/k8s` (the package touched) and every consumer of `ListResources`/`GetResource`/`DeleteResource`/`PatchResource`/`TestConnection`/`GetClusterInfo` across the codebase.
- **Remaining Risk:** Low. `CreateResource`/`ListCRDInstances` do not call `updateHealth` at all (confirmed by reading both functions) and so are not instrumented — this is unchanged, pre-existing behavior (they never fed `LastCheckedAt` either), not a new gap introduced by this fix.

## Observability Contract (as established/verified this phase)

| Signal | Source | Labels | Fed by |
|---|---|---|---|
| `request_id`/`cluster_id` on every request log line | `middleware.StructuredLog` (global, `router.Use`) | n/a (per-line fields) | `mux.Vars(r)["clusterId"]`, `X-Request-ID` header or generated UUID — unchanged, pre-existing (OBS-3) |
| `kubilitics_http_requests_total` / `..._duration_seconds` | `middleware.StructuredLog` | `method`, `path` (route template), `status` | Every request — unchanged, pre-existing |
| `kubilitics_request_timeouts_total` | `respondTimeout` (new) | `operation`, `cluster_id` | Every `context.DeadlineExceeded` branch in `internal/api/rest` except the already-instrumented `kcli.go` site (OBS-1) |
| `kubilitics_cluster_health_check_duration_seconds` | `Client.updateHealth` (new) | `cluster_id` | Every `TestConnection`/`GetClusterInfo`/`ListResources`/`GetResource`/`DeleteResource`/`PatchResource` call — the same calls that update HEALTH-2's `LastCheckedAt` (OBS-2) |
| `kubilitics_cluster_health_check_failures_total` | `Client.updateHealth` (new) | `cluster_id` | Same as above, incremented only on error (OBS-2) |

## Regression Protection — Phases 1-7 verified intact

- Backend: `go build ./...` clean; `go vet ./...` clean; `go test ./... -race` → **all packages pass**, zero new failures, zero data races — including every package transitively touched (`internal/api/rest`, `internal/k8s`, plus everything that calls `ListResources`/`GetResource`/`DeleteResource`/`PatchResource`/`respondK8sError` indirectly, which the full-suite run exercises).
- Frontend: no files touched this phase (backend-only). `npx tsc --noEmit` clean.
- No changes to any timeout/cancellation *mechanism* (Phase 1 — only observability added at existing failure points), cluster lifecycle logic (Phase 2), data-correctness parsers (Phase 3), startup/fleet backend logic (Phase 4), topology scoping (Phase 5), Blast Radius backend logic (Phase 6), or frontend UX state machines (Phase 7).

## Phase 8 Acceptance Gate — Assessment

Gate: *"Given a synthetic failure in any of Phases 1-6's scope, an operator can identify the failing component and cluster from logs/metrics alone, without reading source code."*

1. **Every Phase 8 finding FIXED or explicitly BLOCKED/UNVERIFIED.** → OBS-1 FIXED. OBS-2 FIXED. OBS-3 ALREADY FIXED (verified, not modified).
2. **Timeout boundaries observable.** → `respondTimeout`'s structured log line + `kubilitics_request_timeouts_total{operation,cluster_id}` directly answer "did it time out, where (operation), how often" — proven via `TestRespondTimeout_*`.
3. **Per-cluster health-check latency/failure observable.** → `kubilitics_cluster_health_check_duration_seconds`/`..._failures_total{cluster_id}`, fed by the same path as HEALTH-2's freshness fields — proven via `TestTestConnection_RecordsHealthCheck*`.
4. **Request IDs and cluster IDs on hot-path log lines.** → Confirmed already true globally (OBS-3), not just the 4 named hot paths.
5. **Regression tests cover every fixed finding, verified via revert-and-reconfirm.** → OBS-1: 2 tests. OBS-2: 2 tests. Both pairs confirmed to fail against the pre-fix code and pass against the fix.
6. **Phases 1-7 remain intact.** → Verified above — full backend suite, zero new failures; frontend untouched.
7. **No unrelated changes introduced.** → Confirmed via the file list above: `metrics.go`, `errors.go`, `handler.go`, `resources.go` (×2 files: `internal/api/rest/resources.go` and `internal/k8s/resources.go`), `shell.go`, `diff_handler.go`, `client.go`, plus their tests. No Fleet N+1, topology/Blast-Radius semantics, metrics *architecture* redesign, chaos testing, release infrastructure, kcli, WebSocket/CONTAM-1, or UX changes.

**Phase 8 acceptance: PASS.**

---

PHASE 8 COMPLETE — STOPPED FOR APPROVAL

---

# Phase 9 — Regression / Failure Testing: Execution Record

**Scope (verbatim from the roadmap):** "Implement the specific missing tests enumerated in the audit's 'Test Coverage Gaps' section — one test (or test suite) per finding, covering: healthy clusters, unreachable clusters, slow clusters, auth/RBAC failures, metrics unavailable, API timeout, cluster removal/re-add, restart, large clusters, large topology/resource counts, `DeletedFinalStateUnknown` delete events, and namespace-scoped topology requests."

**Gate (verbatim):** "Every P0/P1 finding in the audit has at least one automated regression test that would fail on the original code and pass after the corresponding phase's fix."

**Method:** Read `docs/PRODUCTION-RELIABILITY-AUDIT.md`'s "Test Coverage Gaps" section (14 line items) in full. For each, searched the actual test suites produced by Phases 1-8 and classified: **ALREADY FIXED** (a qualifying test exists — grep-confirmed and, for a sample, read in full) vs. **CONFIRMED GAP** (no such test exists). Cross-checked each finding's severity against the Gate's P0/P1 requirement.

## Test Coverage Gap Audit — Classification

| Audit gap (verbatim, abbreviated) | Finding(s) | Severity | Status | Evidence |
|---|---|---|---|---|
| `LoadClustersFromRepo` wall-clock vs. cluster count | STARTUP-1 | P0 | ALREADY FIXED | `TestLoadClustersFromRepo_ConcurrentNotSequential` measures elapsed wall time for N clusters and asserts non-linear scaling; `_ConcurrencyIsBounded` measures actual max concurrency against the configured bound |
| `backendRequest` timeout rejection / exits loading on timeout | LOADING-1 | P0 | ALREADY FIXED | `client.test.ts` "LOADING-1: request timeout" describe block — 5+ tests |
| Exits loading on unmount | LOADING-2 | P1 | ALREADY FIXED | `resources.test.ts`: "forwards an AbortSignal to backendRequest when provided" |
| Hung apiserver for Overview fallback | LOADING-3 | P1 | ALREADY FIXED | `client_timeout_test.go`: `TestClient_WithTimeout_BoundsASlowOperation` (mechanism test — same `WithTimeout` helper the Overview fallback path uses) |
| `rest.Config.Timeout` is set | LOADING-4 | P2 | ALREADY FIXED | `client_timeout_test.go`: `TestClient_WithTimeout_AppliesConfiguredDeadline` |
| Resource type never completes informer sync | LOADING-5 | P2 | ALREADY FIXED | `informer_sync_test.go`: `TestInformerManager_WaitForSync_TimesOutIfNeverStarted` |
| Topology request reflects namespace selection | TOPOLOGY-1 | P0 | ALREADY FIXED | `useTopologyData.test.tsx` — 8 tests (Phase 5) |
| 8-30s-slow backend | TOPOLOGY-2 | P1 | ALREADY FIXED | `topology.test.ts` — explicit "TOPOLOGY-2" comment block reusing Phase 1's timeout mechanism |
| High-replica namespace node-count on V1 | TOPOLOGY-3 | P2 | **CONFIRMED GAP** (not fixed this phase — see Remaining Risk) | No test found; Phase 5 fixed the misleading comment only, not the underlying V1 behavior — P2, not required by the Gate |
| Topology build latency/call count bound, graceful Blast Radius degradation | BLASTRADIUS-1 | P1 | ALREADY FIXED | `resource_topology_engine_source_test.go` (bounds call count to zero additional live calls), `blast_radius_test.go` (lock-contention/graceful-degradation) |
| Seed >500 of a resource type | BLASTRADIUS-2 | P2 | ALREADY FIXED | `collector_k8s_test.go`: `TestCollectFromClient_PaginatesBeyondSinglePage` (1200 items), `_SafetyCapFlagsIncompleteResourceType` |
| `updatePodStatus`/`DeletedFinalStateUnknown`, `Counts.Pods == len(store.List())` under churn | COUNTS-1 | P0 | ALREADY FIXED | `overview_cache_pods_test.go` |
| Cross-widget memory-total agreement, malformed/scientific-notation input | METRICS-2 | P1 | **PARTIALLY FIXED THIS PHASE** — see Finding below | Malformed/garbage already covered; scientific-notation was genuinely missing — added this phase. Cross-widget: addressed structurally (see Finding), not via a new integration test |
| `Ki`/`Gi`/`Ti` input to the memory parser | METRICS-1 | P2 | ALREADY FIXED | `k8sQuantity.test.ts` |
| `Reachable` reflects real connectivity; staleness fields | HEALTH-1, HEALTH-2 | P0, P1 | ALREADY FIXED | `manager_test.go`, `client_timeout_test.go` (`TestClient_LastCheckedAt_AdvancesOnEveryAttempt`) |
| `SetupInformerHandlers` / `cluster_id` WS subscription path | CONTAM-1 | P1 | **FIXED THIS PHASE** — see Finding below | No test existed; added this phase |
| Removal confirmation dialog closes on failed delete | LIFECYCLE-2 | P2 | ALREADY FIXED | `page-smoke.test.tsx` |
| "Remote cluster unreachable during remove" simulation | LIFECYCLE-1 | (no severity listed — guarantee already held) | ALREADY FIXED | `cluster_service_removal_test.go`: `TestClusterService_RemoveCluster_NeverDialsRemoteCluster` |

**Summary:** 17 of 19 individual gap items were already closed by regression tests added during Phases 1-8 (each phase's own "add a regression test for every fixed finding" requirement had already substantially overlapped with this audit section). Of the 2 remaining gaps, both P1 findings required by the Gate (METRICS-2's scientific-notation sub-gap, CONTAM-1) were fixed this phase. The one remaining gap, TOPOLOGY-3, is P2 — not required by the Gate's literal "every P0/P1 finding" wording — and documented as a remaining risk rather than silently dropped.

## Finding: METRICS-2 — scientific-notation quantity parsing untested

- **Status:** FIXED (the scientific-notation sub-gap only; the "cross-widget agreement" sub-gap is addressed structurally, see Decision)
- **Root Cause:** Neither `parseK8sQuantityToBytes` nor `parseK8sCpuToMillicores` had a test proving scientific-notation input (e.g. `"1.5e9"`) is correctly rejected (returns `null`) rather than silently misparsed. Both parsers' regexes (`MEMORY_PATTERN`, the CPU numeric-part check) have no exponent group, so they already behaved correctly — this was a coverage gap, not a behavior bug.
- **Evidence:** Read both parser implementations in full; confirmed neither regex contains `[eE]`.
- **Decision:** Added the missing test cases directly. For the "cross-widget agreement" sub-gap: Phase 3's actual fix was to collapse ~10 independent parsers down to these two canonical functions, which every consumer (`ClusterCapacity.tsx`, `useClusterUtilization.ts`, `MetricsDashboard.tsx`, `PodDetail.tsx` — confirmed during Phase 7's UX-3 investigation) now delegates to. This makes cross-widget agreement a structural guarantee (same function, same input, same output) rather than an emergent property that needs a separate multi-widget integration test to verify — the 20 existing + 2 new unit tests on the canonical parser already provide stronger protection than a snapshot-style cross-widget test would. No new architecture introduced (per Phase 9's execution rules).
- **Change:** `src/lib/k8sQuantity.test.ts` — added `'returns null for scientific-notation input (not silently misparsed)'` to both the memory and CPU parser `describe` blocks.
- **Files Changed:** `src/lib/k8sQuantity.test.ts`.
- **Tests:** 2 new tests (memory: `'1.5e9'`, `'1E9'`, `'2e3Mi'` all → `null`; CPU: `'1.5e3'`, `'2E3m'` → `null`).
- **Verified via revert-and-reconfirm:** Temporarily widened `MEMORY_PATTERN` to accept an exponent group (simulating a hypothetical regression) → the new test failed with `expected 1500000000 to be null`, proving the test is sensitive to real behavior, not vacuous. Reverted the simulated regression → test passes again. (This is a coverage-gap test, not a bug fix — there was no original-vs-fixed code to compare; the revert-and-reconfirm instead proves the test *would* catch a future regression.)
- **Before:** Scientific-notation rejection was correct but unverified by any test.
- **After:** Explicitly locked in by 2 regression tests.
- **Regression Results:** `src/lib/k8sQuantity.test.ts` — 20/20 pass (18 pre-existing + 2 new).
- **Remaining Risk:** None identified for this specific gap.

## Finding: CONTAM-1 — no test exercises `SetupInformerHandlers`/cluster_id WS subscription path

- **Status:** FIXED (test coverage gap closed) — **CONTAM-1 itself remains unfixed and dormant**, exactly as documented in every prior phase; this is a deliberate, explicit scope boundary, not an oversight.
- **Root Cause:** No test existed for this code path at all (confirmed via `grep -rln "SetupInformerHandlers" --include="*_test.go"` — zero matches before this phase).
- **Evidence:** Read `internal/api/websocket/handler.go`'s `SetupInformerHandlers` (registers a handler per resource type that calls `h.hub.BroadcastResourceEvent("", "", eventType, rt, obj)` — `clusterID` and `namespace` hardcoded empty) and `hub.go`'s broadcast loop (`if msg.clusterID != "" && !client.AcceptsCluster(msg.clusterID) { continue }` — the per-cluster filter only engages when `clusterID` is non-empty).
- **Decision:** Per Phase 9's execution rules ("do not revisit completed findings," "do not introduce new architecture unless the finding requires it," "if a finding is already fixed: already fixed — do not modify" — and, symmetrically, if a finding was explicitly deferred, Phase 9 is not the phase that un-defers it), CONTAM-1's underlying fix (threading real `cluster_id` through the informer→broadcast pipeline) is explicitly **not** in this phase's scope — it remains exactly where Phase 2 left it: dormant, inert, P1-if-ever-activated. What Phase 9 *does* require is a test for the gap itself, which this phase added: a **characterization test** that documents and machine-checks the current (known, accepted-as-dormant) behavior, so that if CONTAM-1 is ever fixed in a future phase, this test's assertion will need to flip — a visible, intentional signal, not a silent gap.
- **Change:** `internal/api/websocket/informer_broadcast_test.go` (new) — registers a WebSocket client subscribed to exactly one cluster (`cluster-a`), broadcasts an event the same way `SetupInformerHandlers` actually does (`clusterID=""`), and asserts the scoped client still receives it — proving the filter never engages for informer-sourced events today.
- **Files Changed:** `internal/api/websocket/informer_broadcast_test.go`.
- **Tests:** 1 new test, `TestSetupInformerHandlers_BroadcastsWithEmptyClusterID`.
- **Verified via revert-and-reconfirm (inverted for a characterization test):** Since there is no "fix" to revert here (the test documents existing, unfixed behavior), verification instead proved the test is *not* vacuous: a companion check (not committed — run and discarded) called `BroadcastResourceEvent` with a real, non-empty, mismatched `clusterID` and confirmed the scoped client does **not** receive it in that case — proving `AcceptsCluster`'s filter genuinely works when given real data, and that the committed test is specifically detecting `SetupInformerHandlers`' failure to populate `clusterID`, not a broken filter.
- **Before:** Zero test coverage for this code path; the contamination gap was documented in prose only.
- **After:** The gap is machine-checked; a future fix to CONTAM-1 will cause this test to fail until its assertion is updated, which is the intended behavior.
- **Regression Results:** `internal/api/websocket` — all 15 tests (14 pre-existing + 1 new) pass.
- **Remaining Risk:** CONTAM-1 itself is unchanged — still dormant, still P1-if-activated. This phase only ensures the gap is now visible/tracked by the test suite rather than invisible.

## Remaining Risk — TOPOLOGY-3 (P2, not required by the Gate)

No test asserts the V1 topology endpoint's node-count behavior for high-replica namespaces (e.g., that it falls back to individual pod nodes, bounded by the existing `MAX_VISIBLE_NODES`/1000-node cap and ELK's 300-node layout-strategy switch — the "backstops" Phase 5's corrected comment describes). This finding is P2; the Gate requires coverage only for P0/P1 findings. Not fixed this phase — documented here rather than silently dropped, consistent with the "if something cannot be verified/is out of scope: say so explicitly" discipline used throughout this engagement. Candidate for a future phase.

## Regression Protection — Phases 1-8 verified intact

- Backend: `go build ./...` clean; `go test ./... -race` → all packages pass, zero new failures, zero data races (including the newly-touched `internal/api/websocket`).
- Frontend: `npx tsc --noEmit` clean. `npx vitest run src/lib/k8sQuantity.test.ts src/topology src/pages src/hooks src/components src/features` → 424/427 pass; the 3 failures (`ClusterPickerPage.test.tsx` ×2, `AddClusterDialog.test.tsx` ×1) are the same pre-existing, unrelated failures documented in every prior phase's execution record — count grew from 422→424 total (2 new scientific-notation tests), failure count unchanged.
- No changes to startup logic (Phase 4), timeout/cancellation mechanisms (Phase 1), cluster lifecycle (Phase 2), health correctness (Phase 2), metric *correctness* (Phase 3 — only test coverage added, no parser behavior changed), topology (Phase 5), Blast Radius (Phase 6), UX state handling (Phase 7), or observability (Phase 8) — this phase added tests only, plus the still-dormant CONTAM-1 characterization test which touches no production code path.

## Phase 9 Acceptance Gate — Assessment

Gate: *"Every P0/P1 finding in the audit has at least one automated regression test that would fail on the original code and pass after the corresponding phase's fix."*

1. **Every Phase 9 finding FIXED or explicitly BLOCKED/UNVERIFIED.** → All 19 individual gap items classified (table above): 17 ALREADY FIXED (verified, not modified), 2 FIXED this phase (METRICS-2's scientific-notation sub-gap, CONTAM-1's coverage gap), 1 explicitly documented as remaining risk (TOPOLOGY-3, P2, not Gate-required).
2. **Every P0/P1 finding has a regression test.** → Confirmed for all P0/P1 findings named in the audit's Test Coverage Gaps section: STARTUP-1, LOADING-1/2/3, TOPOLOGY-1/2, BLASTRADIUS-1, COUNTS-1, HEALTH-1/2, METRICS-2, CONTAM-1 — every one has at least one test, verified by reading the actual test file and (for the 2 new additions) revert-and-reconfirm.
3. **Regression tests cover every fixed finding.** → 3 new tests added this phase (2 METRICS-2, 1 CONTAM-1), all verified sensitive to real behavior (not vacuous).
4. **Phases 1-8 remain intact.** → Verified above — full backend suite + targeted frontend sweep, zero new failures.
5. **No P0/P1 regression exists.** → None found or introduced.
6. **No unrelated changes introduced.** → Confirmed: `k8sQuantity.test.ts`, `internal/api/websocket/informer_broadcast_test.go`. No opportunistic cleanup, no refactoring, no new architecture (the characterization-test pattern for CONTAM-1 was the minimum necessary to close the literal coverage gap without un-deferring the finding itself).

**Phase 9 acceptance: PASS**, with one explicitly-documented, Gate-exempt remaining gap (TOPOLOGY-3, P2).

---

PHASE 9 COMPLETE — STOPPED FOR APPROVAL

---

# Phase 10 — Release Gate: Execution Record

**Objective (verbatim from the roadmap):** Objective, evidence-based release criteria.

**This is a verification/gate phase, not new implementation work.** No findings are newly assigned to Phase 10; the roadmap instead specifies 5 criteria to verify against the current state of the repository after Phases 1-9. Per this phase's explicit scope boundary, no opportunistic fixes were made to any finding not already in scope (TOPOLOGY-3, Fleet N+1, CONTAM-1 production behavior, and others were left untouched, exactly as in prior phases).

## Criterion 1 — No P0/P1 finding remains open, OR is explicitly re-classified UNVERIFIED with documented reasoning and user sign-off

**Full P0/P1 inventory (19 total findings in the audit; P0/P1 subset below), cross-checked against every prior phase's execution record:**

| Finding | Severity | Status | Phase |
|---|---|---|---|
| STARTUP-1 | P0 | FIXED | 4 |
| LOADING-1 | P0 | FIXED | 1 |
| TOPOLOGY-1 | P0 | FIXED | 5 |
| COUNTS-1 | P0 | FIXED | 3 |
| HEALTH-1 | P0 | FIXED | 2 |
| LOADING-2 | P1 | FIXED | 1 |
| LOADING-3 | P1 | FIXED | 1 |
| TOPOLOGY-2 | P1 | FIXED | 1 (timeout) + 5 (namespace scoping reduces exposure) |
| BLASTRADIUS-1 | P1 | FIXED | 6 |
| METRICS-2 | P1 | FIXED | 3 (parser unification) + 9 (scientific-notation test gap closed) |
| HEALTH-2 | P1 | FIXED | 2 |
| **CONTAM-1** | **P1** | **OPEN — deliberately deferred, not fixed** | Deferred in 2, 7 (implicitly, out of scope), 9 (explicitly, test-coverage-gap-only) |

**Result: Criterion 1 is NOT satisfied.** CONTAM-1 is a confirmed, open P1 finding. It does not qualify for the criterion's "UNVERIFIED" escape clause — it is not unverified, it is precisely understood (the WebSocket resource/topology broadcast pipeline's `SetupInformerHandlers` always calls `BroadcastResourceEvent` with an empty `clusterID`, bypassing the Hub's per-cluster subscription filter entirely — see Phase 9's `TestSetupInformerHandlers_BroadcastsWithEmptyClusterID` for a machine-checked demonstration). It is dormant/inert today (the pipeline is not wired into any currently-reachable route, confirmed across Phases 2/7/9's investigations), but the audit itself rates it "P1 (dormant today; would be P0 the moment it's wired up without fixing the gap)."

Per this phase's explicit scope boundary ("Do NOT opportunistically fix... CONTAM-1 production behavior... unless Phase 10 explicitly assigns them" — it does not), this finding was not fixed in Phase 10. Per the roadmap's own Criterion 1 wording, proceeding past this gate requires either closing the finding or an explicit UNVERIFIED reclassification **with user sign-off**. This was surfaced directly to the user via a clarifying question (not assumed). **The user's decision: block the release gate rather than sign off on shipping with CONTAM-1 open.**

## Criterion 2 — All Phase 9 regression tests pass

**Result: PASS.** Re-ran fresh (not reusing a stale result):
- Backend: `go build ./...` clean; `go test ./... -race` → all packages pass, zero failures, zero races — including `internal/api/websocket` (Phase 9's new CONTAM-1 characterization test) and every other package touched across Phases 1-9.
- Frontend: `npx tsc --noEmit` clean; `npx vitest run src/lib/k8sQuantity.test.ts src/topology src/pages src/hooks src/components src/features` → 424/427 pass. The 3 failures (`ClusterPickerPage.test.tsx` ×2, `AddClusterDialog.test.tsx` ×1) are the same pre-existing, unrelated failures documented identically in every prior phase's execution record since Phase 5 — unchanged count, unchanged tests, confirmed still present and still unrelated to any phase's work.

## Criterion 3 — Phase 0/4 performance budgets pass on a kubeconfig with multiple deliberately-unreachable contexts

**Result: PASS at the mechanism/unit level (re-measured fresh); UNVERIFIED at the full live-infrastructure level (environment-limited, same reason as Phase 0's baseline).**

- Environment check (this session): `docker ps` → "Cannot connect to the Docker daemon" (not running). `kubectl config get-contexts` → exactly one context (`kind-nightshift-dev`), currently down — identical environment constraints to Phase 0's baseline. A true multi-cluster, full-process (Tauri → HTTP listener → real network) E2E measurement remains **UNVERIFIED** for the same documented reason as Phase 0 and every subsequent phase: no Docker, no live cluster, no persisted multi-cluster database available in this environment.
- What **was** re-measured fresh, through the real, unmodified production code (no code in this path has changed since Phase 4): `go test ./internal/service/... -run TestLoadClustersFromRepo -race -v`. `TestLoadClustersFromRepo_ConcurrencyIsBounded` — 25 simulated clusters, each failing their connection attempt (same `k8s.Client.TestConnection` call the real startup path uses) — measured max concurrent connections = 10 (the configured `loadClustersConcurrency` bound), total wall time 0.18s for all 25. This reconfirms Phase 4's structural claim (bounded, non-sequential fan-out) through the actual production code, not a re-assertion of the old number.
- No new performance claim is made here beyond what Phase 4 already measured and documented (~75ms listener-ready, independent of cluster count/availability) — this criterion's fresh re-run exists to confirm no drift since Phase 4, not to produce a new number.

## Criterion 4 — No known data-correctness issue (COUNTS-1, METRICS-1/2 class) remains unresolved

**Result: PASS.**
- COUNTS-1 (P0): fixed Phase 3 (tombstone unwrap + periodic self-heal reconciliation), locked in by `overview_cache_pods_test.go`, re-run clean this phase.
- METRICS-1 (P2): fixed Phase 3 (canonical `k8sQuantity.ts`/`resource.ParseQuantity` parsers replacing hardcoded-format parsers), locked in by `k8sQuantity.test.ts`.
- METRICS-2 (P1): fixed Phase 3 (parser unification — confirmed structurally guaranteeing cross-widget agreement during Phase 7's UX-3 investigation and Phase 9's METRICS-2 finding), scientific-notation test gap closed Phase 9.
- No other finding in the audit is classified as a data-correctness issue of this class.

## Criterion 5 — No infinite-loading path remains in: Dashboard load, resource list/detail load, Topology load, Blast Radius load, cluster add/remove

**Result: PASS**, each verified against its specific phase's fix:
- **Dashboard load:** Phase 1 (`backendRequest`'s `AbortSignal.timeout()` default, LOADING-1/2) + Phase 7 (`ClusterHealthWidget` now has an explicit LOADING/ERROR state distinct from a fabricated verdict — previously neither loading nor error was checked at all).
- **Resource list/detail load:** Phase 1's `backendRequest` timeout applies universally to every list/detail fetch; Phase 8 added timeout observability (not a new timeout mechanism) on these paths.
- **Topology load:** Phase 1 (TOPOLOGY-2's client/server timeout alignment + real cancellation) + Phase 5 (TOPOLOGY-1 namespace scoping, reducing the chance of ever hitting a slow/oversized build in the first place).
- **Blast Radius load:** Phase 6 (BLASTRADIUS-3's mutex fix — one cluster's cold start can no longer block another cluster's `/blast-radius` request indefinitely; `Status().Ready` gating prevents reading a not-yet-built graph as if it were complete).
- **Cluster add/remove:** Phase 2 (LIFECYCLE-2 — client-side timeout added to the removal flow, confirmation dialog closes on failure instead of hanging).

No new verification work was performed for this criterion beyond re-confirming each cited phase's tests still pass (see Criterion 2) — this criterion aggregates prior phases' already-established guarantees, consistent with "do not revisit completed findings unless required to prove regression."

## Regression Protection — Phases 1-9 verified intact

- Phase 1 (timeout/cancellation/bounded async): `client.test.ts`, `client_timeout_test.go` — pass.
- Phase 2 (startup/health/lifecycle): `manager_test.go`, `cluster_service_removal_test.go` — pass.
- Phase 3 (counts/CPU/memory correctness): `overview_cache_pods_test.go`, `k8sQuantity.test.ts` — pass.
- Phase 4 (listener startup/Fleet): `cluster_service_startup_test.go` — pass, re-measured fresh (Criterion 3).
- Phase 5 (topology namespace scoping): `useTopologyData.test.tsx` — pass.
- Phase 6 (Blast Radius reliability): `blast_radius_test.go`, `collector_k8s_test.go`, `resource_topology_engine_source_test.go` — pass.
- Phase 7 (UI state reliability): `useFleetOverview.test.ts`, `page-smoke.test.tsx`, `ClusterHealthWidget.test.tsx` — pass.
- Phase 8 (observability): `errors_test.go`, `client_health_metrics_test.go` — pass.
- Phase 9 (regression coverage): `informer_broadcast_test.go` + the 2 new `k8sQuantity.test.ts` cases — pass.

No regression introduced by this phase (no production code was changed — this phase was verification-only).

## Files Changed

None — this phase performed verification only, per its nature as a release gate rather than an implementation phase. No production code or tests were added or modified.

## Remaining Risks

- **CONTAM-1 (P1) remains open and dormant.** This is the blocking item (see Criterion 1). It does not currently affect any live traffic (the WebSocket resource/topology broadcast pipeline is not wired into any active route), but would become a real cross-cluster data leak the moment it is activated without first being fixed.
- **TOPOLOGY-3 (P2)**, carried over from Phase 9, remains without a dedicated regression test — not Gate-required (P2, not P0/P1), not blocking, but still open.
- **Full live-infrastructure E2E performance validation remains UNVERIFIED** in this environment (no Docker, no reachable cluster) — consistent with every prior phase's identical, documented limitation. The unit-level mechanism re-measurement (Criterion 3) is the strongest evidence available without live infrastructure.

## Phase 10 Acceptance Gate — Assessment

1. **Criterion 1 (no open P0/P1, or UNVERIFIED+sign-off):** **FAILED.** CONTAM-1 is open, confirmed (not unverified), and the user explicitly declined to sign off on shipping with it open — chose instead to block the gate.
2. **Criterion 2 (Phase 9 tests pass):** PASS.
3. **Criterion 3 (performance budget):** PASS at the unit/mechanism level (re-measured fresh); UNVERIFIED at the full E2E level (environment-limited).
4. **Criterion 4 (no data-correctness issue open):** PASS.
5. **Criterion 5 (no infinite-loading path):** PASS.

**Phase 10 acceptance: BLOCKED.** Four of five criteria pass; Criterion 1 fails on CONTAM-1, and the user chose to block rather than sign off. This blocks the release gate as designed — the gate functioned correctly by surfacing the finding rather than silently passing. Proceeding past this point requires either fixing CONTAM-1 in a future phase or a subsequent explicit sign-off decision.

---

PHASE 10 BLOCKED — STOPPED FOR REVIEW

---

# Phase 11 — WebSocket Isolation & Release Unblock: Execution Record

**Finding:** CONTAM-1 — WebSocket resource/topology broadcast pipeline is dead code and lacks real cluster scoping.

**Status:** FIXED, with the dormant/inert production state deliberately preserved (not activated). See `docs/PRODUCTION-HARDENING-ROADMAP.md` ("Phase 11 — WebSocket Isolation & Release Unblock") for the authorized scope this record implements against.

## Root Cause

Traced the complete lifecycle (connection → authentication → subscription registration → informer/event source → broadcast → Hub filtering → client delivery) before changing anything:

- **`cmd/server/main.go:1140`:** `wsHandler := websocket.NewHandler(ctx, wsHub, nil, cfg, repo) // informerMgr will be set per cluster` — `informerMgr` is permanently `nil`; the comment documents unfinished wiring. `SetupInformerHandlers()` is **never called anywhere in the repository** (confirmed via repo-wide grep) — if it ever were called with a nil `informerMgr`, it would panic immediately on `h.informerMgr.RegisterHandler(...)`. This confirms the pipeline is not merely unscoped but entirely unreachable from any live code path — a stronger form of "dormant" than Phase 9's investigation had directly exercised.
- **`internal/api/websocket/handler.go` (`SetupInformerHandlers`, pre-fix):** the one call site of `Hub.BroadcastResourceEvent` hardcoded `clusterID=""` — there was no mechanism anywhere for this function to know which cluster its `informerMgr` belonged to.
- **`internal/api/websocket/hub.go` (`Run()`'s broadcast case, pre-fix):** `if msg.clusterID != "" && !client.AcceptsCluster(msg.clusterID) { continue }` — an **empty** `clusterID` bypassed the per-cluster filter entirely (every connected client received it, scoped or not) — fail-open, not fail-closed.
- **`internal/api/websocket/client.go` (`AcceptsCluster`, unchanged):** `if len(c.clustersSubs) == 0 { return true }` — a client with no explicit subscription accepts everything. This is a documented, intentional feature (an unscoped client watching all clusters), not itself a defect — confirmed by reading `handleMessage`'s existing, already-working `{"type":"subscribe","clusters":[...]}` mechanism, which the frontend simply never invokes.

**Exact root cause (matches the audit verbatim):** "Cluster-scoping primitives (`clusterID` filter, `AcceptsCluster`) were built but the two wiring steps that would make them effective were never completed... and the one call site that exists hardcodes an empty cluster ID."

## Evidence / Reproduction

Pre-fix behavior was reproduced directly (not assumed) via the existing Phase 9 characterization test, re-run before any change this phase: `TestSetupInformerHandlers_BroadcastsWithEmptyClusterID` passed, demonstrating that a client scoped to `cluster-a` received an event broadcast with no cluster identity. This was the starting point for Phase 11's fix.

## Implementation Decision

The audit's own "Recommended Fix" was followed exactly: *"make `ServeWS` read `cluster_id` (or require a post-connect subscribe message) and call the client's subscription method; ensure every `BroadcastResourceEvent` call passes the real originating cluster ID."* The subscribe-message half already existed and works correctly (`Client.handleMessage`'s `"subscribe"` case) — nothing needed to change there. The two actually-missing pieces were fixed:

1. **Give `Handler` an authoritative cluster identity.** Each `Handler`/`InformerManager` pair is architecturally meant to be per-cluster (per the existing `informerMgr` constructor comment) — the identity was simply never threaded through. Added a `clusterID` field + `SetClusterID(id string)` setter to `Handler`, mirroring the exact pattern `internal/k8s.Client.SetClusterID` already uses elsewhere in this codebase (no new pattern invented).
2. **`SetupInformerHandlers` now passes `h.clusterID`** instead of `""` to `BroadcastResourceEvent`.
3. **`Hub.BroadcastResourceEvent` now fails closed on an empty `clusterID`** — returns a new sentinel error, `ErrMissingClusterID`, and does not enqueue the message at all, rather than silently broadcasting it unscoped. This is a stronger guarantee than filtering at delivery time: an identity-less resource event can now never reach *any* client, scoped or unscoped, because it is never placed on the broadcast channel in the first place. `BroadcastTopologyUpdate` (a separate, legitimately-always-unscoped message type — confirmed zero production callers, same as `BroadcastResourceEvent`'s pre-fix state) was deliberately left untouched; it was never in CONTAM-1's described scope and redesigning its semantics was not required to close this finding.

**Preserving the dormant state:** `cmd/server/main.go` was not modified. `SetupInformerHandlers()`/`SetClusterID()` are still never called from production code — the pipeline remains exactly as unreachable as before this fix. The fix makes the *code that would run if the pipeline were ever activated* correct; it does not activate it.

## Files Changed

- `internal/api/websocket/handler.go` — added `Handler.clusterID` field + `SetClusterID` setter; `SetupInformerHandlers` now passes `h.clusterID`.
- `internal/api/websocket/hub.go` — added `ErrMissingClusterID`; `BroadcastResourceEvent` now fails closed on empty `clusterID`.
- `internal/api/websocket/hub_test.go` — updated the pre-existing `TestHubBroadcastResourceEvent` (previously asserted `NoError` for an *empty*-clusterID broadcast — that was asserting the bug) to use a real cluster ID; added `TestHubBroadcastResourceEvent_EmptyClusterIDFailsClosed`.
- `internal/api/websocket/informer_broadcast_test.go` — replaced Phase 9's characterization test (which proved the gap existed) with `TestSetupInformerHandlers_BroadcastsWithRealClusterID`, which proves the fix through the real `k8s.InformerManager` → `SetupInformerHandlers` → `Hub` → `Client` path end to end, exactly as Phase 9's test comment predicted would need to happen ("this test's final assertion should flip... a visible, intentional signal, not a silent gap").
- `internal/api/websocket/contam1_isolation_test.go` (new) — the 7 isolation tests (Test 8, race safety, is `-race` applied to all of the above, not a separate test).

No other files were changed. `cmd/server/main.go`, `internal/k8s/informer.go`, `internal/api/websocket/client.go`, and the frontend were not modified.

## Tests Added (8 required cases)

| # | Test | File |
|---|---|---|
| 1 | Same-cluster delivery | `TestCONTAM1_SameClusterDelivery` (`contam1_isolation_test.go`) + `TestSetupInformerHandlers_BroadcastsWithRealClusterID` (`informer_broadcast_test.go`, via the real publisher path) |
| 2 | Cross-cluster isolation (A→B) | `TestCONTAM1_CrossClusterIsolation_AtoB` |
| 3 | Reverse isolation (B→A) | `TestCONTAM1_CrossClusterIsolation_BtoA` (independent hub/client pair, not a relabeled Test 2) |
| 4 | Multiple subscribers | `TestCONTAM1_MultipleSubscribers_SameCluster` (2 cluster-a clients + 1 cluster-b client present simultaneously) |
| 5 | Missing cluster identity fails closed | `TestCONTAM1_MissingClusterIdentity_FailsClosed` + `TestHubBroadcastResourceEvent_EmptyClusterIDFailsClosed` |
| 6 | Concurrent clusters | `TestCONTAM1_ConcurrentClusters_RemainIsolated` (20 cluster-a + 20 cluster-b clients, 40 concurrent broadcasts) |
| 7 | Subscribe/unsubscribe lifecycle | `TestCONTAM1_RemovedSubscriber_ReceivesNoSubsequentEvents` |
| 8 | Race safety | All of the above run under `go test -race` |

Per the "test actual behavior, not implementation trivia" instruction: every isolation test asserts on message **delivery** (does `client.send` receive something or not) via a shared `drainOrTimeout` helper, never on an intermediate field like `clusterID == "cluster-a"` in isolation — the critical assertion throughout is "cluster A's event cannot be observed by cluster B's subscriber," proven by attempting to read from the actual per-client delivery channel.

## Test Evidence

All 8 new/updated tests pass:
```
--- PASS: TestCONTAM1_SameClusterDelivery (0.01s)
--- PASS: TestCONTAM1_CrossClusterIsolation_AtoB (0.16s)
--- PASS: TestCONTAM1_CrossClusterIsolation_BtoA (0.16s)
--- PASS: TestCONTAM1_MultipleSubscribers_SameCluster (0.16s)
--- PASS: TestCONTAM1_MissingClusterIdentity_FailsClosed (0.31s)
--- PASS: TestCONTAM1_ConcurrentClusters_RemainIsolated (0.07s)
--- PASS: TestCONTAM1_RemovedSubscriber_ReceivesNoSubsequentEvents (0.07s)
--- PASS: TestHubBroadcastResourceEvent (0.00s)
--- PASS: TestHubBroadcastResourceEvent_EmptyClusterIDFailsClosed (0.00s)
--- PASS: TestSetupInformerHandlers_BroadcastsWithRealClusterID (0.27s)
```

**Verified via revert-and-reconfirm:** reverted both production changes (the `BroadcastResourceEvent` fail-closed check, and `SetupInformerHandlers`'s `h.clusterID` usage back to `""`) and re-ran the full suite. Exactly 3 tests failed — `TestCONTAM1_MissingClusterIdentity_FailsClosed`, `TestHubBroadcastResourceEvent_EmptyClusterIDFailsClosed`, and `TestSetupInformerHandlers_BroadcastsWithRealClusterID` — precisely the tests whose assertions depend on the fix. The other isolation tests (2, 3, 4, 6, 7) passed even pre-fix, because they call `Hub.BroadcastResourceEvent` directly with a real, non-empty `clusterID` and are exercising the Hub's filter logic, which was already correct for non-empty identities — the bug was specifically that the one production call site (`SetupInformerHandlers`) never supplied one. This is expected and consistent with the root cause: the defect was at the publisher boundary, not in the Hub's core filtering logic. Restored the fix; all tests pass again (confirmed identical output to the pre-revert run, cached).

## Race-Test Result

`go test ./internal/api/websocket/... -race -v`: **PASS, zero races detected**, across all 25 tests in the package (10 new/updated + 15 pre-existing).

## Backend Regression Result

`go build ./...`: clean. `go vet ./...`: clean. `go test ./... -race`: **all packages pass**, zero failures, zero races — full repository, not just the touched package.

## Frontend Regression Result

No frontend files were touched this phase (per strict scope — CONTAM-1 is backend-only: `ServeWS`/`Hub`/`Client`/`SetupInformerHandlers`). `npx tsc --noEmit`: clean (re-confirmed, unchanged from Phase 10).

## Phase 1-10 Regression Status

- **Phase 1** (timeout/cancellation/bounded async): unaffected — no files in this area touched; full suite re-run clean.
- **Phase 2** (startup/health/cluster lifecycle): unaffected — `internal/cluster/discovery`, `internal/service` untouched; tests pass.
- **Phase 3** (counts/CPU/memory correctness): unaffected.
- **Phase 4** (listener startup/Fleet): unaffected.
- **Phase 5** (topology namespace scoping): unaffected.
- **Phase 6** (Blast Radius reliability): unaffected.
- **Phase 7** (UI state reliability): unaffected (frontend untouched).
- **Phase 8** (observability): unaffected — `internal/pkg/metrics`, `internal/api/rest/errors.go` untouched.
- **Phase 9** (regression coverage): the one Phase 9 test directly about CONTAM-1 (`TestSetupInformerHandlers_BroadcastsWithEmptyClusterID`) was intentionally superseded by `TestSetupInformerHandlers_BroadcastsWithRealClusterID` in the same file — this is the exact, predicted "flip" Phase 9's own test comment called for, not an unrelated regression. All other Phase 9 tests (`k8sQuantity.test.ts` scientific-notation cases) are frontend and untouched.

## Remaining Risks

- The WebSocket resource/topology broadcast pipeline remains dormant/inert in production, exactly as before this fix (by design, per Phase 11's explicit "do not activate" constraint). If a future phase wires `SetupInformerHandlers`/`SetClusterID` into `main.go`'s per-cluster startup path, this fix's correctness is what makes that safe to do — but actually doing so (and the accompanying `ServeWS`/frontend subscribe-flow completion) remains unimplemented and out of this phase's scope.
- `BroadcastTopologyUpdate` remains unscoped by design (always delivered to all clients) and was not modified — it was outside CONTAM-1's described scope (confirmed zero production callers, same dormant status as `BroadcastResourceEvent` was pre-fix). If this function is ever activated, its own scoping (or lack thereof) should be evaluated separately on its own merits.
- No live multi-cluster WebSocket integration test was run (would require real infrastructure); all 8 isolation tests use deterministic, in-process `Hub`/`Client` construction — consistent with the instruction to avoid dependence on AWS/EKS/GKE/VPN/credentials.

## Phase 10 Status

CONTAM-1 is fixed, all 8 isolation tests pass, `go test -race` is clean, and the full backend regression suite (plus the untouched frontend) remains green — the evidence Phase 10's Criterion 1 required is now present.

**CONTAM-1 FIXED — PENDING PHASE 10 RELEASE-GATE REVALIDATION.** Phase 10 itself has not been re-run in this phase (explicitly out of scope — "do not declare the overall release unblocked yet... Phase 10 Release Gate must be revalidated separately").

---

PHASE 11 COMPLETE — STOPPED FOR APPROVAL

---

## Addendum — VALID-02 (post-Phase-11, Production Validation Mode)

Phase 11 was approved and the Release Gate passed (Phase 10 revalidation). Production Validation Mode (Phase 12) then live-reproduced and fixed a new finding outside the original roadmap's phase structure; recorded here for continuity with this execution log, full detail in `docs/VALID-02-INVESTIGATION.md`.

**Finding:** `GET /api/v1/clusters/{id}/summary` hung ~63s for a stored-but-unreachable cluster. Root cause: `resolveClusterID` performed its own legacy, ~30s-bounded reconnect attempt (`GetCluster`→`tryReconnectCluster`) immediately followed by `getClientFromRequest`'s independent, ~3s-bounded reconnect attempt (`GetOrReconnectClient`) — two sequential, uncoordinated attempts against the same cluster on one request.

**Fix (Candidate B, as investigated and approved):** `resolveClusterID` (`internal/api/rest/handler.go`) no longer calls `GetCluster`. It now resolves cluster identity (by ID, Context, or Name) via `ListClusters` alone — a call already fixed by VALID-01 to never block on any cluster's reconnect. `GetOrReconnectClient` (via `getClientFromRequest`) remains the sole reconnect authority on this path. `GetCluster` itself is unmodified and still used, unchanged, by its ~17 other call sites (shell, kcli, port-forward, etc.).

**Files changed:** `internal/api/rest/handler.go` (`resolveClusterID` only). `internal/api/rest/valid02_test.go` (new, 6 tests).

**Tests:** 6 new tests — no-reconnect-on-resolve, no-duplicate-reconnect on the full summary path, healthy-cluster unaffected, request-supplied-kubeconfig path unaffected, concurrent cross-cluster isolation, cancellation propagation. Revert-and-reconfirm performed on the two core tests: PRE-FIX FAIL (2.00s / 904ms, both exceeding their thresholds), POST-FIX PASS.

**Live validation:** Fresh-process first-request reproduction: **2.949s**, down from the original 63.021s live reproduction (~21x). Healthy cluster and Fleet confirmed fast and correct both sequentially and concurrently with the unreachable cluster's request.

**Regression:** `go build ./...`, `go vet ./...` clean. `go test ./... -race -count=1` — all packages pass. CONTAM-1 (7 tests) and VALID-01 (11 tests) explicitly re-confirmed passing by name.

**Remaining uncertainty:** the exact low-level reason `GetOrReconnectClient`'s 3s bound stretched to 33s when chained immediately after `resolveClusterID`'s old reconnect attempt (investigation §8) remains unexplained at the OS/transport level — moot for this fix, since removing the duplicate attempt eliminates the back-to-back pattern that triggered it, but flagged for anyone revisiting this area.

**VALID-02 ACCEPTED — IMPLEMENTATION COMPLETE.**
