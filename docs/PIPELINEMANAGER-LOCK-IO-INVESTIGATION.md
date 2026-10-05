# PipelineManager Global-Lock-Held-During-Unbounded-I/O — P1 Investigation & Fix

**Status: FIXED, TEST-PROVEN (7 regression tests, `-race` clean), LIVE-VALIDATED (healthy path) against the isolated lab.**

## 1. Exact root cause

`PipelineManager.StartCluster` (`internal/events/manager.go`), called from the `OnClusterConnected` lifecycle hook on every cluster add *and* reconnect, held `m.mu` — one `sync.RWMutex` shared by the **entire** `PipelineManager`, guarding every cluster's pipeline — while calling `DetectClusterSize(context.Background(), clientset)`, which performs up to two live, cluster-wide `Pods("").List(...)` calls with no timeout of any kind. A slow or unreachable API server at exactly the moment one cluster was connected or reconnected could hang that call forever while holding the lock, freezing `StartCluster`/`StopCluster`/`Health` (pipeline status reads) for every *other* registered cluster — the same "one bad cluster poisons unrelated clusters" class of bug already fixed for `ListClusters` (VALID-01) and `ClusterGraphEngine` (BLASTRADIUS-3).

## 2. Files and functions changed

- `internal/events/manager.go`:
  - `StartCluster`: cluster-size detection now runs entirely **before** acquiring `m.mu` and is wrapped in `context.WithTimeout(context.Background(), clusterSizingTimeout)`. The critical section under `m.mu` now contains only fast, local, in-memory operations (installing the already-built pipeline into the map, wiring metrics/notifier/chain-cache references, calling `pipeline.Start`, which is confirmed non-blocking against the network — see §4). A fast-path `RLock` check (already-running cluster) avoids paying the sizing cost at all when possible. A new re-check under the write lock handles the case where a concurrent `StartCluster` for the *same* cluster won the race while this call was sizing — the loser calls `pipeline.Stop()` on its own (never-started, so cheap and safe) pipeline instead of leaking it or silently overwriting the winner's.
  - New `var clusterSizingTimeout = 15 * time.Second` (package-level `var`, not `const`, so tests can shrink it without a real 15s wait).
- `internal/events/manager_lock_io_test.go` (new): 4 test functions covering the brief's 7 required scenarios (see §6).

No other production files were changed for this fix.

## 3. Before/after concurrency behavior

**Before:**
```
StartCluster(clusterID)
  └─ m.mu.Lock()
       └─ DetectClusterSize(context.Background(), clientset)   // unbounded, holds m.mu
       └─ install pipeline, m.mu.Unlock() (deferred)
```
Any other cluster's `StartCluster`/`StopCluster`/`Health` blocks for as long as the slow cluster's sizing call takes — unbounded.

**After:**
```
StartCluster(clusterID)
  ├─ Discovery().ServerVersion()        // outside lock, unchanged, bounds only THIS cluster's own call
  ├─ RLock fast-path check (already running?)
  ├─ DetectClusterSize(ctx-with-15s-timeout, clientset)   // outside m.mu entirely
  ├─ build pipeline, apply tuning       // local, outside m.mu
  └─ m.mu.Lock()
       ├─ re-check: did a concurrent call for the SAME cluster already win?
       ├─ install pipeline / wire references / pipeline.Start (confirmed non-blocking)
       └─ m.mu.Unlock()
```
No cluster's sizing call can ever hold `m.mu` for longer than the time needed to install an already-built pipeline into a map — independent of how slow or hung the K8s API server is.

## 4. Why `pipeline.Start` is safe to keep inside the lock

Traced `Pipeline.Start` → `Collector.Start` (`internal/events/collector.go`): it constructs a `SharedInformerFactory`, registers handlers, calls `factory.Start(c.stopCh)` (async — spawns reflector goroutines, returns immediately), and waits for cache sync in its own `go func(){...}` (also non-blocking). `pipeline.Stop()` on a pipeline that was constructed but never `Start`-ed (the race-loser case) is also safe: `stopCh` is initialized in `NewPipeline`'s constructor, `p.cancel` is nil-checked before use, and the batch-flush path handles empty/nil state — confirmed by reading `Pipeline.Stop` and `NewPipeline` directly, not assumed.

## 5. Timeout chosen and rationale

15 seconds. The brief's own guidance ("10-15s unless the existing codebase provides a stronger established value") and no sibling background-goroutine timeout in this codebase exceeds `log_collector.go`'s 25s for a comparable one-shot operation; 15s sits inside that established range for what is, in the common case, a single cheap `List(Limit:1)` call. A timed-out sizing attempt reuses `DetectClusterSize`'s **existing** error path ("any List error → default to `small`" — unchanged code, confirmed by reading `cluster_sizing.go`) rather than inventing new fallback behavior, satisfying the brief's explicit constraint.

## 6. Tests added (all 7 required scenarios, in 4 test functions)

`internal/events/manager_lock_io_test.go`:

- **`TestStartCluster_SlowClusterDoesNotBlockOtherClusters`** — Tests 1, 3, 4 combined: while cluster A is blocked inside sizing (via `blockingPodsClientset`, see below), a different cluster's `StartCluster` completes within 3s, an unrelated cluster's `StopCluster` completes within 3s, and `Health()` (a pipeline-status read) completes within 3s — all while A is still blocked. A is then unblocked and confirmed to complete successfully (not leaked).
- **`TestStartCluster_SizingTimeoutIsEnforcedAndPropagatesCancellation`** — Tests 2, 6: with `clusterSizingTimeout` shrunk to 200ms and a sizing call that is *never* unblocked, `StartCluster` must still return within ~2s (not hang forever) with no error (safe degradation), and the blocked `List` call's observed `ctx.Err()` must be exactly `context.DeadlineExceeded` — proving the context is genuinely propagated and cancelled, not merely that the test's own assertion happened to pass.
- **`TestStartCluster_HealthyClusterBehaviorUnchanged`** — Test 5: a normal fake client produces the same successful, idempotent, visible-in-`Health()` behavior as before this fix.
- **`TestStartCluster_ConcurrentAcrossAndWithinClusters_RaceFree`** — Test 7: 10 clusters × 5 concurrent `StartCluster` callers each (50 goroutines total) produce exactly one pipeline per cluster, no races, no deadlocks, run under `-race`.

**`blockingPodsClientset`** (new test-only type): wraps a real fake `Clientset` and overrides `CoreV1().Pods(ns).List` directly to block on an `unblock` channel or the caller's `ctx.Done()`, whichever comes first. This is deliberately **not** a `k8stesting.PrependReactor` — client-go v0.35.1's `testing.Action` interface has no way to observe the caller's context (confirmed by reading `k8s.io/client-go/testing/actions.go`'s `Action` interface, which exposes only `GetNamespace`/`GetVerb`/`GetResource`/etc., never a context), so a reactor-based block can structurally never prove real cancellation propagation — only a typed-client override can.

All 4 tests pass, 5/5 repeated runs, clean under `go test -race`.

## 7. Pre-fix failure evidence

Not separately captured as a standalone "red" run on the original code (the fix and tests were developed together, per the smallest-safe-change discipline), but the mechanism of the original defect is CODE-PROVEN by direct inspection (§1) rather than inferred, and the new test suite would deterministically fail against the original code: `TestStartCluster_SlowClusterDoesNotBlockOtherClusters`'s fast-cluster assertion would time out after 3s, and `TestStartCluster_SizingTimeoutIsEnforcedAndPropagatesCancellation` would hang past its 5s outer timeout, against the pre-fix `StartCluster`.

## 8. Post-fix evidence

- `go build ./...`, `go vet ./...`: clean.
- `go test -race ./internal/events/... -run "TestStartCluster_"`: 4/4 pass, repeated 5x (`-count=5`), deterministic.
- Full backend `go test -race ./...`: 52 packages, all `ok`, zero `FAIL`.
- Named regression suites explicitly re-run (not merely assumed covered):
  - VALID-01 (`TestListClusters_*`, 11 tests): PASS.
  - VALID-02 (`TestVALID02_*`, 6 tests): PASS.
  - VALID-03 (`TestAuthHandler_ForgotPassword_*`/`ResetPassword_*` + the full `TestAuthHandler_*` suite, 19+ tests): PASS.
  - VALID-04 (`TestVALID04_*`, 6 tests): PASS.
  - VALID-05/06 (`TestClusterRepoAdapter_*`, cluster-discovery suite, 21 tests): PASS.
  - CONTAM-1 (`TestCONTAM1_*`, 7 tests): PASS.
  - Hybrid Informer Lifecycle (`TestClusterLifecycleManager_*`, `TestCombinedLifecycle_N26_*`): PASS.
  - EngineLifecycleManager / Blast Radius (`TestGetOrStartGraphEngine_*`, full `internal/graph` suite): PASS.
  - Fleet N+1 (`internal/api/rest/fleet_test.go` suite): PASS (included in the full-suite run).

## 9. Sibling anti-pattern audit

Per the brief's instruction to search for the pattern — "shared/global mutex held while performing potentially blocking external I/O" — across `internal/events`, cluster lifecycle hooks, REST handlers, topology, graph engine, overview/informer lifecycle, fleet aggregation, port-forward, shell/WebSocket, reconnect paths, and background schedulers:

- Swept every file in the backend containing a `.Lock()`/`.RLock()` call (41 files) for co-occurrence with Kubernetes/HTTP/exec/clientcmd-style calls within the same critical section (both explicit-unlock and `defer`-unlock styles).
- `service.ClusterLifecycleManager` and `graph.EngineLifecycleManager` (the two systems this engagement already built) were re-confirmed correct by design: both use **one mutex per cluster entry**, never a single manager-wide lock, for exactly this reason — already covered by their own extensive race-surface test suites.
- `internal/addon/lifecycle/health_monitor.go`: one near-hit — `evaluateFromLister` holds a lock while calling `m.podStore.List()`. Traced and confirmed this reads from a local **informer cache** (`cache.Store`), not a live network call — no hang risk, not a sibling instance.
- `internal/cluster/discovery/manager.go` / `manual_source.go` (explicitly named in the brief's focus list): confirmed via direct inspection that no K8s/HTTP call of any kind exists anywhere in either file, inside or outside a lock — purely in-memory discovery bookkeeping. Not a sibling instance.
- `internal/scanner/engine.go`, `internal/intelligence/reports/scheduler.go`, `internal/autopilot/scheduler.go`, `internal/autopilot/mem_repository.go`, `internal/auth/oidc/provider.go`, `internal/auth/saml/provider.go`: swept for the same co-occurrence pattern — none found.

**No other sibling instance of this exact failure mode (shared/global lock + unbounded external I/O) was found.** Per the brief's explicit instruction not to expand into an unlimited audit, the sweep stopped here rather than re-deriving every lock in the codebase from first principles.

## 10. Sibling issues deliberately left unfixed, and why

- `clientset.Discovery().ServerVersion()` in `StartCluster` (already outside `m.mu`, unchanged by this fix): also unbounded. Left alone because it is a *different*, lower-severity failure mode — a hang there only blocks the one goroutine calling `StartCluster` for that specific cluster, never another cluster's operations (no shared lock involved) — and is out of this fix's explicitly scoped acceptance criteria.
- The LOADING-4 constraint confirmed during the prior investigation (do not set a global `rest.Config.Timeout` — would silently terminate long-lived informer/watch connections, since `client-go` v0.35.1's `Request.Watch` reuses the same shared `*http.Client` whose `.Timeout` field governs the entire streaming response) remains correctly un-implemented. No global timeout workaround was introduced anywhere in this fix.

## 11. Live validation (isolated lab `kubilitics-phase-e`, binary `kubilitics-backend-v4` built from this exact working tree)

Real environment (`kind-nightshift-dev`, `~/.kube/config`) re-verified untouched before, during, and after — 20 pods, correct context, throughout.

| Scenario | Result |
|---|---|
| Healthy cluster registration (`POST /clusters`) | 201, pipeline started, visible in `/system/events-health` within 1s |
| `/system/events-health` while a second healthy cluster registers | consistently <5ms latency, 200 OK |
| Unreachable-API-server cluster registration (`10.255.255.1`, non-routable) | Returns in 5.0s, `status: "disconnected"` — bounded by the pre-existing (unrelated to this fix) connection-test timeout; confirmed this path never reaches `StartCluster` at all, since `OnClusterConnected` only fires after a *successful* connect |
| Reconnect (healthy cluster) | 1.43s, pipeline count correct, `status: healthy` |
| Disconnect/removal (healthy cluster) | 0.018s, pipeline count dropped correctly, goroutines settled to 42 (no leak) |

**Honest limitation:** I did not engineer a live scenario where a cluster passes its initial connectivity check but then hangs specifically inside `DetectClusterSize`'s `Pods("").List` call — doing so safely against a real API server would require infrastructure manipulation (e.g. iptables-level packet dropping mid-connection) beyond what this lab setup can do without risk, and the deterministic `blockingPodsClientset` unit test already gives authoritative, repeatable, `-race`-clean proof of exactly this mechanism (§6). The live validation above instead confirms the fix changed nothing about the healthy-path, reconnect, and disconnect behaviors, which is what §3 ("preserve existing behavior") requires.

Side-finding noticed during live validation, not part of this fix's scope: clusters picked up by the background kubeconfig-sync auto-discovery watcher do **not** call `OnClusterConnected` (confirmed: no `notifyClusterConnected`/`OnClusterConnected` call site exists anywhere in `cmd/server/main.go`), so their events pipeline does not start via that path — only the explicit `AddCluster`/`ReconnectCluster` REST handlers do. This independently explains the previously-unexplained registration-pathway goroutine discrepancy flagged as an open item in `docs/ENGINE-LIFECYCLE-SOAK-INVESTIGATION.md` §19. Documented here for continuity; not fixed, as it is outside this fix's scope.

## 12. Remaining risks

- The 15s sizing timeout is not empirically tuned against a real large cluster's pod-count List latency — chosen from codebase convention, not measured.
- `Discovery().ServerVersion()`'s own lack of a bound (§10) remains a latent, lower-severity gap.
- The kubeconfig-sync-vs-explicit-AddCluster events-pipeline-startup asymmetry (§11 side-finding) is unresolved.

## 13. P1 acceptance criteria — final status

- [x] No Kubernetes/network I/O occurs while holding `PipelineManager.m.mu`
- [x] `DetectClusterSize` has a bounded context
- [x] A hung cluster cannot block unrelated cluster event pipelines
- [x] Stop/read operations remain responsive during another cluster's sizing
- [x] Timeout/cancellation is proven by tests
- [x] Concurrent lifecycle operations are race-free
- [x] Existing tuning behavior remains correct
- [x] No global `rest.Config.Timeout` workaround was introduced
- [x] Relevant existing regression suites remain green
- [x] `go build ./...` passes
- [x] `go vet ./...` passes
- [x] `go test ./... -race -count=1` passes
- [x] Isolated live validation passes (healthy/reconnect/disconnect path; the specific mid-sizing-hang scenario is unit-tested, not live-tested — see §11's honest limitation)
- [x] No real cluster or real kubeconfig was modified
- [x] No unrelated P0/P1 issue was silently changed
- [x] Documentation reflects the final implementation and evidence

**P1 is MET.** This is not a declaration of overall production readiness — only that this specific, previously-STOP-flagged finding is now fixed, tested, and evidenced.
