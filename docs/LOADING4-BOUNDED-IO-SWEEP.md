# LOADING-4 — Broader Bounded-I/O Sweep (Phase B)

**Status: Classification matrix complete. One genuine gap found and fixed (discoveryMgr.Refresh), test-proven, `-race` clean. No new P0/P1. The constraint against a blanket `rest.Config.Timeout` (established in the prior PipelineManager investigation) remains correctly un-implemented.**

## Objective (restated)

Not "put a timeout everywhere" — ensure every finite one-shot Kubernetes operation has an appropriate bounded context, without breaking long-lived watches/informers, which share the same underlying `*http.Client` and would have their streaming responses silently terminated by a blanket `rest.Config.Timeout` (client-go v0.35.1, confirmed via source in the prior investigation).

## Method

Enumerated every `context.Background()` (27 sites) and `context.TODO()` (zero sites — none exist in this codebase) call site across `internal/` and `cmd/`, excluding test files, and classified each.

## Classification matrix

| Site | Category | Status |
|---|---|---|
| `internal/k8s/secret_loader.go:53` | 1 (finite one-shot) | Already bounded (`WithTimeout`) |
| `internal/simulation/engine.go:79` | 4 (background) | Already bounded (`SimulationTimeout`) |
| `internal/addon/notifications/notifier.go:54` | 1 | Already bounded (10s) |
| `internal/events/log_collector.go:85` | 1 | Already bounded (25s) |
| `internal/service/scanner_service.go:107` | 4 | Already bounded (10m, intentional long scan) |
| `internal/events/manager.go` (sizing) | 1 | **Fixed in the prior PipelineManager pass** (15s) |
| `internal/api/rest/handler.go` (buildClusterSummary) | 1/2 | **Fixed this pass** (20s, Phase A) |
| `cmd/server/main.go:165` | 1 | Already bounded (3s) |
| `cmd/server/main.go:1322` (shutdown) | 5 (intentional) | Correct — graceful-shutdown deadline, not a request |
| `internal/service/cluster_service.go:373,402` (reconnect) | 4 | Already bounded (`backgroundReconnectBudget`, `reconnectTimeout`) — explicitly documented "intentionally fire-and-forget" |
| `internal/service/cluster_service.go:385,392,397,415` | 1 (DB only) | Repo/SQLite calls, not Kubernetes — out of LOADING-4's scope, local and fast |
| `internal/service/cluster_service.go:1199,1218` (`lifecycle.EnsureActive`) | 3/5 (intentional long-lived) | Correct — governs informer lifetime, cancelled via `Stop`/TTL, not a one-shot call |
| `internal/api/rest/blast_radius.go:160` (`graphEngineMgr.EnsureActive`) | 3/5 | Correct — same reasoning, governs `ClusterGraphEngine`'s informer-factory lifetime |
| `internal/events/pipeline.go:156` (`p.ctx`) | 3/5 | Correct — governs the whole per-cluster pipeline's lifetime, cancelled via `Stop()` |
| `internal/events/pipeline.go:232` (`bgCtx`, batch flush during Stop) | 1 (local DB only) | Not Kubernetes; a local SQLite write during shutdown — out of scope |
| `internal/api/rest/portforward.go:93,204` | 3/5 (intentional long-lived) | Session lifetime tied to the WebSocket/port-forward connection — cancellation ownership traced to the connection's own close path; not independently re-verified this pass (see Remaining Risks) |
| `internal/addon/lifecycle/controller.go:125` | 4 (fallback) | `ctx = context.Background()` only when `c.runCtx` is nil; used for a DB read (`GetCluster`) then Helm client construction — low risk, not fixed this pass (narrow fallback path, not the common path) |
| `internal/service/addon_service_impl.go:1012` (`runRollout`) | 4 (background, explicitly "fire-and-forget so HTTP request end doesn't cancel it") | Each per-cluster `ExecuteUpgrade` call inherits this unbounded ctx; Helm itself typically enforces its own `--timeout` (default 5m) for the underlying operation, but this was not independently verified this pass — flagged, not fixed (see Remaining Risks; addon/rollout subsystem is a different surface than this pass's scope) |
| `cmd/server/main.go:221` (`a.repo.List`) | 1 (DB only) | Local SQLite read, not Kubernetes |
| `cmd/server/main.go:275` (server root ctx) | 5 (intentional) | The application's own process lifetime — correct by design |
| `cmd/server/main.go:655` (`clusterService.GetCluster`) | 1 (DB only) | Persisted-metadata lookup, not a live K8s call |
| `cmd/server/main.go:776,791,815` (`discoveryMgr.Refresh`) | **1/2 — genuine gap** | **Fixed this pass** |
| `cmd/server/restore.go:60` | 4 (startup, DB) | Backup/restore operation at startup, not Kubernetes — out of scope |
| `internal/api/rest/oidc.go:29`, `saml.go:35` | 4 (startup, one-shot provider construction) | Not Kubernetes; out of scope |
| `internal/pkg/tracing/tracing.go:47,52,93` | 4/5 (exporter setup/shutdown) | Not Kubernetes; out of scope |

## The genuine gap: `discoveryMgr.Refresh(context.Background())`

Three call sites (`cmd/server/main.go:776, 791, 815`) passed a bare `context.Background()` to `Manager.Refresh`, which sequentially calls `Enumerate(ctx)` on every registered `DiscoverySource`. `KubernetesSecretSource` (registered only when running in-cluster — the Helm hub/agent deployment mode, via `k8srest.InClusterConfig()` succeeding) performs a real `Secrets().List(ctx, ...)` call against that in-cluster API server. A hung in-cluster API server could therefore block:
- **Backend startup** (`main.go:776` runs synchronously before the HTTP server starts accepting connections) — the most severe instance, could delay the entire backend from becoming ready indefinitely in that deployment mode.
- One `AddCluster`/`RemoveCluster`/reconnect HTTP response (`OnClusterMutation` callback, `main.go:791`).
- The 60s periodic defensive-refresh ticker goroutine (`main.go:815`) — lower severity, delays future ticks but doesn't block any request handler directly.

`Manager.Refresh`'s own loop already isolates one broken (erroring) source from the others ("do NOT abort — one broken source should not blank out others" — existing comment, existing behavior) — the gap was specifically a **hang**, not an error, which the existing design had no bound against at all. Desktop-mode deployments (no in-cluster config) never register `KubernetesSecretSource` and were never exposed to this; the Helm/agent deployment mode is the affected one.

**Severity: P2.** Contained (delays startup/one mutation/one tick in a specific deployment mode), not a shared-lock cross-cluster poisoning pattern, no data corruption or security exposure. Fixed directly per the brief's P2 authorization.

### Fix

`cmd/server/main.go`: new `const discoveryRefreshTimeout = 15 * time.Second` and a `refreshDiscoveryBounded(discoveryMgr)` helper wrapping every call site with `context.WithTimeout`. 15s chosen consistent with the sibling `ListClusters(refreshCtx)` call immediately preceding the ticker's own `Refresh` call (which was already bounded at 30s; 15s for the lighter enumeration-only operation).

### Tests added

`internal/cluster/discovery/manager_bounded_refresh_test.go` — since `refreshDiscoveryBounded` itself lives in `package main` and isn't practically unit-testable there, the fix is verified at the level that is: `Manager.Refresh`'s own behavior when a source hangs.
- **`TestManager_Refresh_HangingSourceIsBoundedByCallerContext`**: a hand-written `hangingSource` (blocks in `Enumerate` on `ctx.Done()`, returns `ctx.Err()` — a real implementation, not a `k8stesting` reactor, so no fake-clientset context-visibility limitation applies here) placed BEFORE a healthy source. With a 200ms caller timeout, `Refresh` returns `nil` (per-source errors, including a timed-out hang, don't abort the whole call — existing behavior intact) within ~200ms, not an unbounded hang, and the healthy source listed after the hanging one is still enumerated and present in the snapshot.
- **`TestManager_Refresh_ConcurrentCallsWithHangingSource_RaceFree`**: 5 concurrent `Refresh` calls against a hanging source, each independently bounded, none deadlock — run under `-race`.

Both pass, 3/3 repeated runs, clean under `-race`.

## Side-finding: kubeconfig-sync lifecycle (traced per instructions, not fixed)

Per instruction, traced only enough to determine materiality. The previously-flagged observation (kubeconfig-sync auto-discovered clusters never call `OnClusterConnected`, so their events pipeline never starts via that path) was already fully documented in `docs/PIPELINEMANAGER-LOCK-IO-INVESTIGATION.md` §11. Re-confirmed this does **not** materially affect Phase A or Phase B: `buildClusterSummary` resolves its client directly via `getClientFromRequest`/`clusterService`, entirely independent of the events `PipelineManager`; `discoveryMgr.Refresh` is independent of both. Not a P0/P1 (no fleet-wide poisoning, no data loss — only a missing startup trigger for one background subsystem on one registration pathway). Remains a separate, lower-priority follow-up, not fixed here.

## Evidence

- `go build ./...`, `go vet ./...`: clean.
- `go test -race ./internal/cluster/discovery/... -run "TestManager_Refresh_"`: pass, 3/3.
- Full backend `go test -race ./...`: 52 packages, all `ok`, zero `FAIL` (run after both Phase A and Phase B changes together).
- Named regressions re-run explicitly: VALID-01/02/04, CONTAM-1, Hybrid Informer Lifecycle, EngineLifecycleManager/Blast Radius, Fleet N+1, PipelineManager lock/I/O — all pass (see final report for the full list with test counts).
- Live validation (isolated lab): backend startup with the fix in place completed normally (~2s to responsive), `/api/v1/presence` returned 200 promptly, cluster auto-registration via kubeconfig sync worked unchanged. The specific in-cluster `KubernetesSecretSource` hang scenario could not be live-tested in this desktop-mode lab (that source is only registered when `k8srest.InClusterConfig()` succeeds, which requires actually running inside a Kubernetes pod) — the deterministic `hangingSource` unit test is the authoritative evidence for that mechanism, consistent with the same honest-limitation pattern used for the PipelineManager fix's live validation.

## Remaining risks / explicitly not fixed this pass

- `internal/api/rest/portforward.go`'s long-lived session contexts: cancellation ownership traced only at the code-reading level (tied to the WebSocket/port-forward connection's own close path), not independently re-verified with a dedicated test this pass.
- `addon_service_impl.go`'s `runRollout`/`ExecuteUpgrade` chain: relies on Helm's own internal timeout for the underlying per-cluster operation; not independently verified. A hung per-cluster Helm upgrade would block that rollout's remaining clusters (sequential canary/remainder waves) — a real but different-subsystem instance of the "one bad cluster" principle, out of this pass's scope.
- `internal/addon/lifecycle/controller.go:125`'s narrow `context.Background()` fallback: low risk, not fixed.
- No blanket `rest.Config.Timeout` was introduced anywhere — the established constraint remains correctly honored.
