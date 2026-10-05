# FLEET-N1 — Fleet Overview N+1 Request Elimination

**Status: FIXED, TEST-PROVEN, LIVE-REPRODUCED. A second, related correctness bug was discovered and fixed during live verification before this was marked done — see §4.**

Tracked previously as "Fleet N+1" in `docs/ENTERPRISE-SCALE-RELIABILITY-REPORT.md` §10, quantified at ~21.6s cold vs ~1.8s aggregate at 50 synthetic clusters. This document is the implementation record for closing it (Phase I-A of the Phase I enterprise hardening brief).

---

## 1. Investigation

Traced the exact path: `ClusterPickerPage`/`FleetDashboard` → `useFleetOverview.ts` → `getClusters` (1 call) + `useQueries` over `getClusterSummary` per cluster (N parallel calls) → backend `GetClusters`/`GetClusterSummary` handlers → `clusterService.ListClusters`/`GetClusterSummary` → Kubernetes API.

**Key finding:** the backend already had a dedicated aggregate endpoint, `GET /api/v1/fleet/overview` (`internal/api/rest/fleet.go`), doing exactly this fan-out server-side via `errgroup` — the frontend simply never adopted it. Checked why: its response DTO (`FleetClusterInfo`) was missing several fields `useFleetOverview.ts` actually needs — `context`, `provider`, `version`, `serviceCount`, `lastConnected`, `healthReason`, and critically `reachable`/`stale`/`staleAsOf`/`errorMessage` (the HEALTH-1/HEALTH-2 fields that guarantee the UI never fabricates a healthy state). Using the endpoint as-is would have been a silent functionality loss, which the brief explicitly warned against.

## 2. Design

Extended `FleetClusterInfo` additively (new fields only, all from data the handler already had in scope — `models.Cluster` and `models.ClusterSummary`, both already fetched) rather than inventing a second response shape. Rewired `useFleetOverview.ts` to call the single `GET /fleet/overview` endpoint instead of `GET /clusters` + N×`GET /clusters/{id}/summary`.

**Not changed:** `GetFleetOverview`'s own server-side `errgroup` fan-out across clusters (still unbounded — one goroutine per cluster, no concurrency cap). This is a related but separate concern belonging to Phase I-B (`buildClusterSummary`/concurrency-bounding investigation), not scope-creeped into this fix. Flagged here for that phase.

## 3. Files changed

- `kubilitics-backend/internal/api/rest/fleet.go` — `FleetClusterInfo` extended with 11 new fields; `GetFleetOverview` now populates them from the `models.Cluster`/`models.ClusterSummary` data it already fetches.
- `kubilitics-backend/internal/api/rest/fleet_test.go` (new) — 4 tests: full field propagation, unreachable-cluster isolation, empty-fleet handling, single-request-serves-N-clusters.
- `kubilitics-frontend/src/services/api/types.ts` — new `BackendFleetClusterInfo`/`BackendFleetOverview` types.
- `kubilitics-frontend/src/services/api/clusters.ts` — new `getFleetOverview()` function.
- `kubilitics-frontend/src/services/backendApiClient.ts` — re-exports the new function/types (existing barrel-file pattern).
- `kubilitics-frontend/src/hooks/useFleetOverview.ts` — rewired from `useQuery` + `useQueries` (1+N) to a single `useQuery` calling `getFleetOverview`; `mergeCluster` rewritten for the new response shape.
- `kubilitics-frontend/src/hooks/useFleetOverview.test.ts` — rewritten (10 tests: the 8 pre-existing status/aggregation tests ported to the new mock shape, plus 2 new FLEET-N1-specific tests: single-request-regardless-of-count, unreachable-cluster-isolation).

## 4. A second bug found during live verification (fixed before declaring done)

Live-testing against the isolated lab cluster (still running from the VALID-06 increment) surfaced a real discrepancy: `GET /fleet/overview` reported the lab cluster as `"reachable": false` even though it had just successfully returned live counts (416 pods, 43 deployments, etc. — manifestly reachable).

**Root cause:** `clusterService.GetClusterSummary` (`internal/service/cluster_service.go:706`) — the service method `GetFleetOverview` calls — never set `Reachable`, `Stale`, `StaleAsOf`, or `ErrorMessage` on its returned `*models.ClusterSummary` at all. They silently stayed at Go's zero-values, meaning `Reachable` was `false` on every call, success or failure. This went undetected because `GetFleetOverview`'s *previous* code just didn't expose `Reachable` in its response — my own fix was the first thing to actually surface it to the frontend, and would have shipped a regression (every cluster permanently showing "unreachable" in Fleet, worse than the old per-cluster `/summary` endpoint, which uses a separate, correct implementation — `buildClusterSummary` in `internal/api/rest/handler.go:965` — that does set these fields via its resilient-cache wrapper).

**Fixed:** `clusterService.GetClusterSummary` now sets `Reachable: true` on its success path — reaching that line means every K8s call it made succeeded enough to compute real counts.

**Regression test:** `TestGetClusterSummary_SuccessfulCallReportsReachableTrue` (`internal/service/cluster_service_fleet_timeout_test.go`) — revert-and-reconfirmed (fails with `Reachable:false` in the exact pre-fix way when reverted).

**Separate, lower-severity, NOT-fixed-in-this-pass finding:** `clusterService.GetClusterSummary`'s health-status computation (`computeClusterHealthStatus`, pod-failure-ratio thresholds) and `buildClusterSummary`'s own health computation are two independent implementations that can disagree on the *same* cluster at the *same* moment (observed live: one reported `"degraded"`, the other `"unhealthy"`, for the same 90%-Pending-pod lab cluster). Both are defensible, neither is wrong, but having two divergent "cluster health" computations in the same codebase is itself a real architectural risk worth its own investigation — flagged for a future increment, not fixed here, since unifying health-threshold logic is a larger, more invasive change than this fix's scope justified making without separate evidence-gathering and approval.

## 5. Regression tests

**Backend** (`internal/api/rest/fleet_test.go`, 4 tests):
1. `TestGetFleetOverview_ReturnsFullFieldsNeededByFrontend_NoSecondRequestRequired` — every new field (context/provider/version/reachable/stale/staleAsOf/healthReason/lastConnected) survives the handler.
2. `TestGetFleetOverview_UnreachableClusterIsolated_HealthyClustersUnaffected` — one broken cluster doesn't corrupt or hide two healthy ones in the same response; broken cluster correctly flagged `Reachable: false`, `SummaryUnavailable: true`, non-empty `ErrorMessage`, never `HealthStatus: "healthy"`.
3. `TestGetFleetOverview_NoClusters_ReturnsEmptyNotNull` — zero-cluster edge case.
4. `TestGetFleetOverview_SingleRequestServesArbitraryClusterCount` — 25 synthetic clusters served correctly by one handler invocation.

**Backend** (`internal/service/cluster_service_fleet_timeout_test.go`, 1 new test):
5. `TestGetClusterSummary_SuccessfulCallReportsReachableTrue` — the §4 bug's regression guard.

**Frontend** (`src/hooks/useFleetOverview.test.ts`, 10 tests, rewritten):
6-13. The 8 pre-existing status-mapping/aggregation tests, ported to the new single-response mock shape (all still pass, same assertions).
14. `FLEET-N1: issues exactly ONE backend request regardless of cluster count (was 1 + N)` — 30 synthetic clusters, asserts `getFleetOverview` called exactly once.
15. `FLEET-N1: an unreachable cluster does not corrupt or hide healthy clusters in the same response` — client-side mirror of the backend isolation test.
16. `FLEET-N1: propagates reachable/stale/staleAsOf for HEALTH-1/HEALTH-2 correctness` — the new fields reach the hook's output correctly.

**Revert-and-reconfirm, both fixes:**
- `fleet.go`: manually reverted `FleetClusterInfo` to its original 6-field shape → all 4 `fleet_test.go` tests fail to *compile*, referencing exactly the fields the fix adds. Restored, all pass.
- `cluster_service.go`: manually reverted the `Reachable: true` line → `TestGetClusterSummary_SuccessfulCallReportsReachableTrue` fails with `Reachable:false` in its output exactly as the pre-fix bug produced live. Restored, passes.
- `useFleetOverview.ts`: manually stubbed out the `useQuery`/`getFleetOverview` call → 8 of 10 tests fail (the 2 that don't are the "empty"/"not configured" cases, correctly unaffected by a data fetch never happening). Restored, all 10 pass.

## 6. Post-fix validation

- `go build ./...`, `go vet ./...` — clean.
- `go test ./... -race -count=1` — **every package `ok`**, including `internal/api/rest` and `internal/service` (the two touched).
- `npx tsc --noEmit -p .` — clean.
- `npx eslint` on all touched files — clean.
- `npx vitest run` (full suite) — 928 passed, same 3 pre-existing unrelated failures (`ClusterPickerPage.test.tsx` ×2, `AddClusterDialog.test.tsx` ×1), confirmed unchanged.

## 7. Live reproduction

Against the still-running isolated lab (`kubilitics-phase-e` cluster, real `~/.kube/config`/`kind-nightshift-dev` independently re-verified untouched throughout):

- **Before the §4 bug was caught:** `GET /fleet/overview` → `"reachable": false` for a cluster that had just returned live, correct counts. Would have been a shipped regression.
- **After:** `GET /fleet/overview` → `"reachable": true`, `"healthStatus": "unhealthy"` (accurately reflecting 377/416 Pending pods — a real, honest signal from the lab's own synthetic workload design, not a bug).
- **Browser, end-to-end:** navigated to `/fleet`, confirmed via request interception that exactly **one** `GET /fleet/overview` call serves the page (plus some unrelated app-shell calls from other hooks — `GET /clusters` ×3, one `/summary` — pre-existing, not part of `useFleetOverview` and out of this fix's scope). Fleet Dashboard rendered correctly: "1 Total Clusters, 1 Total Nodes, 416 Total Pods, 43 Total Deploys, 1 Failed," cluster card showing Nodes 1 / Pods 416 / Deployments 43 / Services 48 — all matching `kubectl` ground truth.
- The original 21.6s-vs-1.8s, 50-synthetic-cluster measurement was **not re-run** this increment (would require rebuilding a 50-cluster environment — significant time cost for a number already well-quantified in the prior session). The architectural fix (1 request instead of 1+N, confirmed via the 25/30-cluster unit tests and the live single-cluster check) is the evidence this increment adds; the prior session's 21.6s/1.8s figures stand as the original problem's scale characterization.

## 8. Acceptance (§4 of the Phase I brief)

- [x] One aggregate request where appropriate — confirmed live and by unit test.
- [x] No accidental N requests — `TestGetFleetOverview_SingleRequestServesArbitraryClusterCount` (backend) + `issues exactly ONE backend request` (frontend).
- [x] Healthy clusters remain visible when another cluster is unreachable — isolation tests, both layers.
- [x] Cluster-level errors remain isolated — same tests; `SummaryUnavailable`/`ErrorMessage` correctly scoped per-cluster.
- [x] Cancellation works — inherited from React Query's existing per-query-key lifecycle (single query now, same mechanism as before).
- [x] Repeated navigation doesn't create request storms — single `useQuery` with `staleTime`/`refetchInterval`, same polling discipline as before, now against one endpoint instead of N+1.
- [ ] Before/after request-count/latency re-measurement at the original 50-cluster scale — **not re-run** this increment (§7); architectural fix confirmed, scale re-validation deferred.

## 9. Remaining risks

- `GetFleetOverview`'s own server-side fan-out across clusters is still unbounded (one goroutine per cluster via `errgroup`, no concurrency cap) — belongs to Phase I-B, not fixed here.
- The two-divergent-health-computation issue (§4) is documented but not unified — a real, if secondary, correctness/consistency risk worth its own future investigation.
- The 50-cluster scale re-measurement is outstanding (§7/§8).
