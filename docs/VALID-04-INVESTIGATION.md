# VALID-04 — Repeated reconnect on an in-cluster-sourced cluster does not rebuild the overview cache against the new client

**Status: FIXED, TESTED, REGRESSION-VALIDATED. See §13 for the implementation record, including an important correction to the original severity/mechanism characterization (§13.1).**

## 1. Finding

Each call to `ReconnectCluster` for a cluster with `Source == "in-cluster"` starts a brand-new per-cluster overview cache (an `InformerManager` with watches across ~10+ resource types, plus a background pod-count-reconciliation ticker goroutine) **without stopping the previous one first**. The old `InformerManager`'s map entry is silently overwritten, and its own goroutines — and the orphaned ticker's `stopCh` reference — are permanently lost, with no way left to ever stop them. Each repeated reconnect leaks another full cache's worth of goroutines.

## 2. Severity

**P1 — resource leak capable of materially affecting production**, explicitly named in this review's own stop-condition list. This is discovered as the first item of the requested ticker/goroutine-lifecycle audit (item 1 of the requested sequence).

## 3. Exact reproduction

Call `POST /clusters/{clusterId}/reconnect` repeatedly against a cluster registered with `source: "in-cluster"` (i.e., Kubilitics' own in-cluster self-registration — the deployment mode its own Helm chart, just validated in the prior consolidation work, uses by default when run inside the cluster it manages).

TEST-PROVEN via a temporary, deleted-after-use unit test (`internal/service/valid04_investigation_test.go`, same methodology as VALID-01's `TestListClusters_NoGoroutineLeak`): 10 consecutive `ReconnectCluster` calls against the same in-cluster-sourced test cluster ID, with a fake client factory.

```
goroutines before=2 after=219 (after 10 repeated reconnects)
```

Approximately 21.7 goroutines leaked per reconnect call — consistent with one full `InformerManager` (watches across Pod, Deployment, Service, ReplicaSet, DaemonSet, StatefulSet, Event, and other handler-registered types — confirmed ~10 `RegisterHandler` calls in `internal/service/overview_cache.go`) plus its own reflector/processor goroutines per watch, each repeated reconnect leaking a complete new set.

## 4. Customer impact

Any user who clicks "Reconnect" on an in-cluster-registered cluster — a normal, legitimate, RBAC-gated (Operator role) UI action, not an edge case or attack — accumulates an unbounded number of live Kubernetes API watch connections and goroutines in the backend process over time. Left running, this will eventually exhaust file descriptors, memory, and/or the API server's own watch-connection limits, degrading or crashing the backend. Because Kubilitics' own Helm chart deploys it in-cluster by default, this is the **primary, not a rare, deployment configuration** — any operator who clicks Reconnect a handful of times while troubleshooting a flaky cluster connection would trigger this.

## 5. Evidence

`internal/service/cluster_service.go`:

- **Kubeconfig-source branch** (`ReconnectCluster`, success path, ~line 1077): explicitly calls `s.overviewCache.StopClusterCache(id)` **before** `StartClusterCache`, with a comment acknowledging the need: `// Success: replace client and restart overview cache.`
- **In-cluster-source branch** (`ReconnectCluster`, ~line 1009, via `applyAndStoreClient`, ~line 957-973): calls `s.overviewCache.StartClusterCache(ctx, c.ID, client)` (line 971) **unconditionally**, with no preceding `StopClusterCache` call anywhere in this branch or in `applyAndStoreClient` itself.
- `internal/service/overview_cache.go`'s `StartClusterCache` (line 56) unconditionally writes `c.informers[clusterID] = im` and starts `go c.runPodCountReconciliation(clusterID, stopCh)` on a **fresh** `stopCh`, overwriting any prior entries in `c.informers[clusterID]`/`c.stopChs[clusterID]` without closing or stopping them first. `StopClusterCache` (line 217) does correctly call `im.Stop()` and `close(stopCh)` — but only when it is actually called, which the in-cluster branch never does.
- `applyAndStoreClient` is also the function `tryReconnectCluster`'s in-cluster branch calls (the pre-VALID-01/02 legacy reconnect path, now only reachable via `GetCluster`'s reconnect-on-miss fallback) — meaning this same leak is reachable through more than one call path, not only the explicit "Reconnect" button, though the explicit button is the clearest, most repeatable trigger.

## 6. Exact code path

```
POST /clusters/{clusterId}/reconnect
  → Handler.ReconnectCluster (internal/api/rest/handler.go:890)
      → clusterService.ReconnectCluster(ctx, id) (internal/service/cluster_service.go:993)
          → c.Source == "in-cluster":
              → buildClientForCluster(c)
              → applyAndStoreClient(ctx, c, client)   ← no StopClusterCache call anywhere above this
                  → s.clients[c.ID] = client
                  → overviewCache.StartClusterCache(ctx, c.ID, client)
                      → c.informers[clusterID] = im        ← OVERWRITES prior entry, old im.Stop() never called
                      → c.stopChs[clusterID] = stopCh       ← OVERWRITES prior entry, old stopCh never closed
                      → go c.runPodCountReconciliation(...)  ← new goroutine; the PREVIOUS one is now orphaned,
                                                                 blocked forever in its select on a stopCh
                                                                 nothing can ever close again
```

## 7. Root cause

An asymmetry between `ReconnectCluster`'s two source branches: the kubeconfig branch was written with explicit stop-before-restart discipline (and says so in its own comment); the in-cluster branch — and the shared `applyAndStoreClient` helper it (and the legacy `tryReconnectCluster`) calls — was not. `StartClusterCache`/`overview_cache.go` itself has no internal guard against being called twice for the same `clusterID` without an intervening `StopClusterCache` — it trusts callers to do that, and one of the two callers doesn't.

## 8. Why previous phases did not catch it

No phase in this entire engagement (Phase 0-11, VALID-01, VALID-02, VALID-03) examined `ReconnectCluster`'s in-cluster branch specifically, or the overview-cache start/stop pairing across repeated reconnects. VALID-01's own goroutine-leak test (`TestListClusters_NoGoroutineLeak`) exercises `ListClusters`'s *background* reconnect path (`kickBackgroundReconnect` → `GetOrReconnectClient`), which — for an already-unreachable cluster with no live client — never reaches `StartClusterCache` at all (the client never successfully connects), so that test's fixture never exercised the *successful, repeated* in-cluster reconnect path this finding is in. This finding surfaced only because this continuation's explicit, dedicated ticker/goroutine-lifecycle audit (item 1 of 6 in the requested sequence) specifically asked to verify "no duplicate ticker starts on repeated lifecycle operations" for every ticker in the codebase — new scope relative to everything before it.

## 9. Candidate fixes (not implemented — for review only)

1. **Smallest, most direct fix:** add `s.overviewCache.StopClusterCache(c.ID)` immediately before the `s.overviewCache.StartClusterCache(...)` call inside `applyAndStoreClient`, mirroring the kubeconfig branch's existing, already-correct discipline exactly. This is a one-line addition, touches no call-site signatures, and makes both branches symmetric.
2. **More defensive, slightly larger:** make `StartClusterCache` itself idempotent — have it check for and stop any pre-existing `c.informers[clusterID]`/`c.stopChs[clusterID]` entry before installing a new one, so correctness doesn't depend on every caller remembering to stop first. This would also retroactively protect the kubeconfig branch's own explicit call (defense-in-depth) and any future caller. Slightly larger surface, touches shared code used by both branches.

Candidate 2 is likely the more robust long-term fix (matches the instructions' own "no duplicate ticker starts on repeated lifecycle operations" framing as a property `StartClusterCache` itself should guarantee), but candidate 1 is the smaller, more surgical change consistent with this engagement's "smallest safe fix" discipline throughout. Recommending candidate 1 as the minimal fix, with candidate 2 noted as a stronger alternative, pending approval.

## 10. Required regression tests (not written — pending approval to implement)

1. A test proving repeated `ReconnectCluster` calls on an in-cluster-sourced cluster do **not** grow goroutine count beyond a small, bounded margin — must be proven to fail against current code (already empirically demonstrated above), then pass after the fix.
2. A test proving the *kubeconfig*-source branch's existing correct behavior is unchanged by the fix (regression guard — this finding must not touch that already-correct path).
3. A test proving the informer cache itself (`GetInformerManager`) correctly reflects only the latest reconnect's data after repeated reconnects, not a stale reference to an old, stopped informer.
4. Full `go test ./... -race -count=1` remains green.

## 11. Acceptance criteria (for a future, approved fix)

- Repeated `ReconnectCluster` calls on an in-cluster-sourced cluster do not leak goroutines (bounded growth only, matching VALID-01's own `TestListClusters_NoGoroutineLeak` methodology/threshold).
- The kubeconfig-source branch's existing, already-correct stop-before-start behavior is unchanged.
- A regression test proves the fix and is proven to fail against the pre-fix code.
- Full backend regression (`go build`, `go vet`, `go test ./... -race -count=1`) remains green.

## 12. Status (at discovery)

STOPPED FOR REVIEW at discovery time. Approved for implementation; see §13 — including a significant, important correction to the original mechanism/severity characterization, found during implementation verification.

## 13. Implementation Record

### 13.1 Critical correction to the original diagnosis

Before implementing, the remediation instructions required verifying the lifecycle in code rather than assuming the original investigation's diagnosis was complete. On doing so, a methodology flaw in the original investigation's test was found: it sampled `runtime.NumGoroutine()` **once, at the very end**, after all 10 reconnects, and divided the total growth (2 → 219) by the call count to characterize it as "~22 goroutines leaked per reconnect" — implying unbounded, linear growth with reconnect count.

Re-measuring with **intermediate sampling after each reconnect** (both with and without the fix, confirmed via temporary revert-and-reconfirm) showed a materially different pattern:

```
Pre-fix (no Stop-before-Start):  before=2, after each reconnect = [222 222 222 222 219 219 219 219 219 219]
Post-fix (with Stop-before-Start): before=2, after each reconnect = [222 222 222 222 222 222 222 222 222 222]
```

**Goroutine count goes flat after the very first successful reconnect, both before and after the fix.** The reason: `OverviewCache.StartClusterCache` already has its own idempotency guard (`if _, exists := c.informers[clusterID]; exists { return nil }`) that was already preventing a second informer manager from being created — and therefore already preventing unbounded goroutine growth — on every call before this fix existed. The ~220 goroutines are the one-time, legitimate cost of a single successful `InformerManager` start (watches across ~10 resource types, each with its own reflector/processor/workqueue goroutines), not a per-call leak.

**The real bug, confirmed by a different, correctness-focused test** (`TestVALID04_Reconnect_ReplacesInformerManager`, proven to fail pre-fix and pass post-fix via revert-and-reconfirm): because `StartClusterCache`'s guard no-ops when a cache already exists, a cluster reconnected while already connected got a **brand-new client stored in `s.clients[id]`**, but the **old `InformerManager` kept running, silently, against the old, now-abandoned client** — the cache never rebuilt to match the new connection. This is a **cache-staleness/correctness bug**, not an unbounded resource-exhaustion bug.

**Severity revised from P1 to P2.** The original P1 classification assumed unbounded goroutine/resource growth capable of exhausting the backend process over repeated reconnects — this is not what the corrected evidence shows. The actual bug (stale cache silently serving data via an abandoned client connection after a user-initiated reconnect) is a real, legitimate reliability/correctness issue — a user's troubleshooting action silently fails to do what it claims — but it does not threaten process stability or resource exhaustion the way the original framing suggested. The fix is still implemented in full, since the corrected bug is real and worth fixing, and because the fix is small, safe, and brings the in-cluster branch into symmetry with the already-correct kubeconfig branch.

This correction is recorded in full, per this engagement's standing discipline of never silently revising a finding's severity without documenting why.

### 13.2 Decision

The investigation's candidate 1 (smallest safe fix: stop-before-start) was implemented, in the shared `applyAndStoreClient` helper rather than only at the `ReconnectCluster` in-cluster call site — because code inspection during implementation (per the explicit instruction not to assume the proposed fix's scope without verifying) found `applyAndStoreClient` is called from **three** sites, not one: `ReconnectCluster`'s in-cluster branch, and `tryReconnectCluster`'s **both** branches (in-cluster and kubeconfig-fallback). Fixing the shared helper once covers all three uniformly and is still the smallest-footprint change — one function, one call added.

### 13.3 Exact code change

`internal/service/cluster_service.go`, `applyAndStoreClient`: added `s.overviewCache.StopClusterCache(c.ID)` immediately before the existing `s.overviewCache.StartClusterCache(ctx, c.ID, client)` call — placed **after** `TestConnection` has already succeeded and the new client has been stored in `s.clients`, so a *failed* reconnect attempt never tears down a still-working cache. `StopClusterCache` is confirmed safe to call unconditionally (no-op when no cache is running for the given cluster ID, per its own existing `if im, exists := c.informers[clusterID]; exists { ... }` guard).

### 13.4 Lifecycle behavior before/after

```
BEFORE (in-cluster branch via applyAndStoreClient):
  ReconnectCluster → applyAndStoreClient → s.clients[id] = NEW client
                                          → StartClusterCache → cache already exists → no-op
                                          → OLD InformerManager keeps running against OLD client (STALE)

AFTER:
  ReconnectCluster → applyAndStoreClient → s.clients[id] = NEW client
                                          → StopClusterCache(id) → stops OLD InformerManager + ticker
                                          → StartClusterCache → fresh InformerManager against NEW client
```

The kubeconfig branch's pre-existing, already-correct behavior (`ReconnectCluster`, success path, line ~1093) is unchanged — confirmed both branches now follow the identical Stop-then-Start pattern (§13.9).

### 13.5 Files changed

- `internal/service/cluster_service.go` — `applyAndStoreClient` only.
- `internal/service/cluster_service_valid04_test.go` — new, 6 tests.

### 13.6 Tests added

1. **`TestVALID04_Reconnect_ReplacesInformerManager`** — the primary correctness test. Asserts the `InformerManager` instance pointer differs between two consecutive successful reconnects (proven to fail pre-fix — same instance kept — and pass post-fix, via revert-and-reconfirm).
2. **`TestVALID04_RepeatedReconnect_GoroutinesBounded`** — a bounded-invariant check (not an exact count, per instruction): goroutine count after 9 additional reconnects must stay within a small margin of the count after just 1, not grow roughly linearly.
3. **`TestVALID04_Reconnect_RemainsFunctional`** — reconnect still reports `status: "connected"`, a live client is retrievable, and a running `InformerManager` exists afterward.
4. **`TestVALID04_FourConsecutiveReconnects_NoDuplicateGeneration`** — 4 consecutive reconnects, asserting the `InformerManager` pointer changes every time (no stale generation survives) and no panic occurs.
5. **`TestVALID04_ReconnectRacesRemove_NoResurrectionNoStaleCache`** — a reconnect in flight racing a concurrent `RemoveCluster`: no panic, the cluster is not resurrected, and no cache is left running for the removed cluster ID afterward. (A local test-fixture bug was found and fixed during this test's development: the temporary mock repo's `Delete` was a no-op that never actually cleared the cluster, which would have made this test vacuous — fixed to actually remove the cluster, and given a mutex since the test exercises it concurrently.)
6. **`TestVALID04_ConcurrentReconnects_NoPanic`** — 5 concurrent `ReconnectCluster` calls for the same cluster: no panic (checked via `recover`), `-race` clean, exactly one `InformerManager` active afterward. Documents, in its own comment, the narrow pre-existing staleness race window from §13.10 rather than silently claiming full concurrent-reconnect safety.

### 13.7 Pre-fix evidence (PRE-FIX: FAIL)

```
TestVALID04_Reconnect_ReplacesInformerManager:
  second reconnect kept the same InformerManager instance — the cache did not
  rebuild against the new client (the VALID-04 regression)
--- FAIL

TestVALID04_FourConsecutiveReconnects_NoDuplicateGeneration:
  reconnect 1: InformerManager identical to the previous reconnect's — cache
  did not rebuild
--- FAIL
```

### 13.8 Post-fix evidence (POST-FIX: PASS)

All 6 tests pass, including under `-race`:

```
--- PASS: TestVALID04_Reconnect_ReplacesInformerManager
--- PASS: TestVALID04_RepeatedReconnect_GoroutinesBounded
--- PASS: TestVALID04_Reconnect_RemainsFunctional
--- PASS: TestVALID04_FourConsecutiveReconnects_NoDuplicateGeneration
--- PASS: TestVALID04_ReconnectRacesRemove_NoResurrectionNoStaleCache
--- PASS: TestVALID04_ConcurrentReconnects_NoPanic
PASS
```

### 13.9 Both cache sources verified symmetric

`grep -n "StopClusterCache" internal/service/cluster_service.go` confirms exactly two production call sites now follow the Stop-then-Start pattern: the fix inside `applyAndStoreClient` (covering the in-cluster branch and both `tryReconnectCluster` branches) and the kubeconfig branch's own pre-existing call in `ReconnectCluster`. Both are structurally identical: stop after `TestConnection` succeeds and the client is stored, immediately before starting the replacement cache.

### 13.10 Concurrent reconnects (Section 13 of the remediation instructions)

Investigated, not redesigned, per the explicit instruction not to introduce a broad synchronization redesign without evidence of real-world impact. `applyAndStoreClient`'s Stop-then-Start pair is not atomic across a single lock (two separate `c.mu.Lock()` acquisitions inside `StopClusterCache`/`StartClusterCache`). A narrow interleaving of two concurrent reconnects for the same cluster ID can, in principle, leave the cache associated with a different client instance than `s.clients[id]` currently points to — the same category of staleness this fix addresses for the sequential case, in a race-dependent form. This is **not new** (the kubeconfig branch's identical pattern has always had the same property) and **not a crash/leak/duplicate-generation bug** — `StartClusterCache`'s existing guard prevents two cache generations from ever being simultaneously active. `TestVALID04_ConcurrentReconnects_NoPanic` proves the "no panic, no race" floor (5 concurrent reconnects, `-race` clean, exactly one `InformerManager` active afterward). The narrow staleness edge case is documented here as a remaining risk (§13.13), not fixed — fixing it would require either a per-cluster mutex/singleflight around the whole Stop-Start-TestConnection sequence (a larger change than this finding's scope) or accepting the existing kubeconfig branch's equally-narrow exposure as a pre-existing, lower-priority item.

### 13.11 Race/build/vet results

- `go build ./...` — clean.
- `go vet ./...` — clean.
- `go test ./internal/service/... -run TestVALID04 -race -v` — all 6 pass.
- `go test ./... -race -count=1` — **all packages pass**, zero failures, zero races, full repository (fresh run after the fix).

### 13.12 Live validation

**Partial — in-cluster-source path UNVERIFIED, kubeconfig-source path LIVE-REPRODUCED.** This environment's Kubilitics backend runs on the development machine against `kind-nightshift-dev` via a `kubeconfig`-sourced registration, not an actual in-cluster deployment (the same container-registry-access limitation encountered during the prior Helm live-install validation prevents running Kubilitics itself inside the cluster to exercise a genuine `source: "in-cluster"` registration). Per instruction, this is reported honestly as `LIVE VALIDATION — UNVERIFIED` for the in-cluster-source path specifically, not silently converted to PASS.

What **was** live-tested (the kubeconfig-source path, unaffected by this fix but valuable as a regression check): 5 consecutive `POST /clusters/{id}/reconnect` calls against the real registered cluster — latency consistent at ~0.835s each (no growth, no degradation) — cluster remained reachable and correct afterward (`node_count: 1`, `pod_count: 20`, matching `kubectl` ground truth), topology still rendered correctly (21 nodes/39 edges, matching the previously-established baseline), and backend process RSS stayed stable (~100MB) throughout.

### 13.13 Remaining risks

- The narrow concurrent-reconnect staleness race documented in §13.10 — pre-existing, not newly introduced, not a crash/leak, not fixed in this change.
- True in-cluster-source live validation (§13.12) remains unverified in this environment due to container-registry access limitations, not a known or suspected defect.
- `tryReconnectCluster`'s kubeconfig-fallback branch (one of the three `applyAndStoreClient` call sites fixed by this change) was not separately live-tested beyond the unit-test coverage in §13.6 — it shares the exact same code path as the now-tested in-cluster branch, so the fix is CODE-PROVEN correct for it, not separately LIVE-REPRODUCED.

### 13.14 VALID-04 acceptance status

All applicable criteria from the remediation instructions' §14 are met: old cache stopped before replacement (lifecycle), no duplicate cache generation remains active, repeated reconnect remains stable and the cluster remains usable, remove/reconnect does not resurrect stale state, regression tests fail pre-fix and pass post-fix, race tests pass, `go build`/`go vet`/`go test ./... -race` all pass, and live evidence was gathered where the environment allows (kubeconfig-source path) with the in-cluster-source gap honestly reported as UNVERIFIED rather than asserted.

**VALID-04 — FIXED**, with the severity correction in §13.1 recorded as a first-class part of this record, not hidden.
