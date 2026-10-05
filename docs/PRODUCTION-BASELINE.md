# Kubilitics Production Baseline — Phase 0

**Companion to:** `docs/PRODUCTION-RELIABILITY-AUDIT.md`, `docs/PRODUCTION-HARDENING-ROADMAP.md`
**Date:** 2026-10-02
**Scope:** Phase 0 only — baseline reproduction and measurement of the audit's 5 confirmed P0 findings. No production code was modified. Two throwaway measurement harnesses were added, run, and then deleted (see "Reproduction Method" per finding) — the working tree is unchanged from before this phase.

---

# Executive Summary

All 5 P0 findings from the audit (STARTUP-1, LOADING-1, TOPOLOGY-1, COUNTS-1, HEALTH-1) were re-verified against the current working tree: **no drift — all 5 still exist exactly as audited.** Three were additionally reproduced empirically, through the real unmodified production code, with measured numbers:

- **STARTUP-1**: measured. A hanging (unroutable-host) cluster costs exactly 8.000s; 3 sequential clusters cost 24.005s total — confirms N×8s linear scaling through the real `client.TestConnection` + the real `loadStartupTimeout` constant.
- **COUNTS-1**: measured. A `cache.DeletedFinalStateUnknown`-wrapped pod delete, run through the real unmodified `updatePodStatus`, leaves the pod counter un-decremented (stuck at 2 instead of dropping to 1).
- **LOADING-1**: measured. `backendRequest`, called with a fetch that never settles, is still pending after 3000ms with no timeout, no abort, no rejection.
- **TOPOLOGY-1**: confirmed via direct source re-inspection (no live cluster available to drive an end-to-end network capture) — `useTopologyData`'s only caller never passes a `namespace` to `useClusterTopology`, and `selectedNamespaces` is used exclusively for post-fetch client-side filtering (`filterByNamespace`), with no code path anywhere converting it into the backend's `namespace` query parameter.
- **HEALTH-1**: confirmed via direct source re-inspection — `Manager.Snapshot()` sets `Reachable: true` as a hardcoded literal, not a computed value; there is no live-reproduction needed beyond reading the literal, since there is no conditional branch to exercise.

No regressions were introduced: all pre-existing tests in the affected backend and frontend packages still pass.

---

# Environment

- Working directory: `/Users/koti/myFuture/Kubernetes/kubilitics` (git branch `main`, clean except this audit's own doc additions).
- Go: `go1.26.2 darwin/arm64`.
- Frontend: vitest `v2.1.9` (project-pinned; `npx vitest` outside the frontend directory resolved a different global version and was corrected to run from `kubilitics-frontend/`).
- Docker daemon: **not running** — `docker ps` failed with "Cannot connect to the Docker daemon."
- Kubernetes: one kubeconfig context, `kind-nightshift-dev`, pointing at `https://127.0.0.1:53958` — currently **down** (kind cluster not started; connection refused).
- No other live or reachable Kubernetes cluster was available in this environment.
- No persisted cluster database was found under `kubilitics-backend/data/` (only `addon-catalog/`) — this appears to be a fresh/unseeded local state, not a multi-cluster production database.

**Implication for measurement scope:** this environment cannot reproduce a true multi-cluster (N > 1 real clusters) startup scenario end-to-end, and cannot run the actual Tauri desktop app or a live backend+frontend+real-cluster integration flow (no Docker, no cluster). Where this limited what could be measured, it is marked UNVERIFIED below with the specific reason, per the audit's anti-hallucination rules. Where the real production code could still be exercised directly (unit-level, against the actual functions named in the audit), it was — these measurements are real, not estimated.

---

# Startup Baseline

- **Application startup duration (full Tauri → usable UI):** UNVERIFIED — reason: Tauri desktop shell files are currently deleted/untracked in the working tree (confirmed via `git status` at session start), and no Docker/cluster is available to drive a realistic multi-cluster scenario end-to-end. Cannot launch the actual desktop app in this environment.
- **Backend readiness time (process start → HTTP listener bound), isolated to the `LoadClustersFromRepo` cost specifically:** MEASURED at the unit level (see "P0 Reproduction Evidence" below) — confirms the sequential N×8s structure directly through production code, without needing the full process to boot.
- **Time until frontend becomes usable:** UNVERIFIED — reason: requires a running backend + frontend dev server + real cluster; out of scope for a safe Phase 0 unit-level reproduction in this environment.

# Cluster Discovery Baseline

- **Behavior with the one available (currently unreachable) context:** `kubectl config get-contexts` returns exactly one context, `kind-nightshift-dev`; `kubectl cluster-info` fails immediately with `connection refused` (not a hang) because the target port simply has nothing listening — this is a fast-fail case, not a slow/hanging one.
- **Discovery/enumeration (`discovery.Manager`) behavior:** not independently re-measured this phase beyond the audit's static code trace (`kubeconfig_source.go`'s `Enumerate` parses YAML only, no network dial) — this claim does not depend on cluster availability to verify, and was already re-confirmed via source re-read in Step 2 below.

# Loading/Timeout Baseline

- **`backendRequest` behavior against a backend that never responds:** MEASURED — see LOADING-1 reproduction below.
- **Behavior with a reachable backend:** not separately re-measured this phase (the existing 43 passing tests in `client.test.ts` already cover the happy path and were re-run clean — see "Tests Run").

# Topology Baseline

- **Topology request duration against a real cluster:** UNVERIFIED — reason: no reachable cluster available in this environment to drive an end-to-end topology build and time it.
- **Topology request scope (does namespace selection reach the backend?):** CONFIRMED via source re-inspection (see TOPOLOGY-1 below) — this is a structural/wiring question answerable from code alone, independent of cluster availability.

# Resource Count Baseline

- **Pod count source/value against a real cluster:** UNVERIFIED (no live cluster) for the "36 nodes / 7,720 pods"-shaped end-to-end symptom specifically.
- **Pod counter update path and `DeletedFinalStateUnknown` handling:** MEASURED at the unit level against the real, unmodified `updatePodStatus` — see COUNTS-1 below. This isolates and proves the mechanism without needing a live cluster to trigger a real relist.

# Health Baseline

- **`Reachable` field source and computation:** CONFIRMED via source re-inspection — `internal/cluster/discovery/manager.go:94-102`, `Reachable: true` is a hardcoded literal inside the `Snapshot()` struct literal, not the result of any function call or conditional. No live reproduction is needed or possible to "disprove" a hardcoded constant — reading the line is the complete proof.

---

# P0 Reproduction Evidence

### STARTUP-1
- **Finding:** Sequential, 8s-per-cluster synchronous connect loop blocks HTTP server bind.
- **Reproduction method:** A temporary Go test file (`internal/service/zzbaseline_repro_test.go`, deleted after this measurement) called the real, unmodified `k8s.NewClient(...)` and `client.TestConnection(ctx)` — the exact functions `LoadClustersFromRepo` calls — against (a) the real but currently-down `kind-nightshift-dev` context, and (b) a synthetic kubeconfig pointing at an unroutable IP (`10.255.255.1:6443`), run 3 times sequentially with the real `8 * time.Second` timeout value, mirroring `LoadClustersFromRepo`'s for-loop exactly.
- **Evidence (measured output):**
  ```
  MEASURED real_down_context elapsed=2.037584ms err=...dial tcp 127.0.0.1:53958: connect: connection refused
  MEASURED iteration=0 elapsed=8.000493s    err=...context deadline exceeded
  MEASURED iteration=1 elapsed=8.001283167s err=...context deadline exceeded
  MEASURED iteration=2 elapsed=8.00083575s  err=...context deadline exceeded
  MEASURED total_sequential_3_clusters elapsed=24.005102916s
  ```
- **Expected (per audit):** N unreachable/hanging clusters cost N×8s because the loop is sequential, not parallel.
- **Actual:** Exactly reproduced — 3 clusters cost 24.005s (3 × ~8.0003s), not ~8s (which is what a parallel/fan-out implementation would cost). The "connection refused" case (2ms) confirms the audit's nuance that not every unreachable cluster costs 8s — only ones that hang/time out (unroutable, firewalled, VPN-dependent) do; a cluster that actively refuses the connection fails fast. This matches the audit's framing exactly.
- **Confidence:** CONFIRMED (measured, through real production code, not estimated).

### LOADING-1
- **Finding:** Shared frontend fetch wrapper (`backendRequest`) has no timeout or abort signal.
- **Reproduction method:** A temporary vitest file (`src/services/api/zzbaseline_repro.test.ts`, deleted after this measurement) imported the real, unmodified `backendRequest` from `client.ts`, mocked `global.fetch` to return a promise that never resolves or rejects (simulating a hung backend handler), and raced the call against a 3-second wall-clock wait.
- **Evidence (measured output):**
  ```
  MEASURED after_3000ms_wait settled=false (expected true if a client timeout exists; BUG if still false)
  CONFIRMED LOADING-1: backendRequest promise is still pending after 3s with a permanently-hung fetch — no client-side timeout exists.
  ```
- **Expected (per audit):** No timeout exists in `backendRequest`, so the promise never settles.
- **Actual:** Exactly reproduced — `settled` remained `false` after 3000ms.
- **Confidence:** CONFIRMED (measured, through real production code).

### TOPOLOGY-1
- **Finding:** Namespace selection never reaches the backend; every topology view triggers a full cluster-wide build.
- **Reproduction method:** Direct re-inspection of the current source (no live cluster available for an end-to-end network capture): `src/topology/hooks/useTopologyData.ts:168` — its only caller passes `{ clusterId, depth, enabled }` to `useClusterTopology`, with no `namespace` field. Separately, `useTopologyData.ts`'s `selectedNamespaces` parameter (a `Set<string>`) is consumed exclusively by the local `filterByNamespace`/`filterTopology` client-side logic (confirmed by grepping all its usages in the same file) — there is no code path anywhere in `useTopologyData.ts` or `TopologyPage.tsx` that converts a selected namespace into the singular `namespace` string `useClusterTopology`/`getTopology` accepts.
- **Expected (per audit):** The backend `namespace` filter parameter is never populated by the UI's namespace selection.
- **Actual:** Confirmed unchanged from the audit — the wiring gap is structural (a parameter that's simply never passed), not a conditional bug, so re-reading the source is a complete proof; a live network capture would add no further certainty here (it would just show the same `namespace: undefined`/empty query param on every request, which the code already guarantees).
- **Confidence:** CONFIRMED (static, but the claim is structural/absolute — not probabilistic — so static confirmation is as strong as a live capture would be).

### COUNTS-1
- **Finding:** Live pod counter drifts upward permanently via unhandled `cache.DeletedFinalStateUnknown`.
- **Reproduction method:** A temporary Go test (same file as STARTUP-1's, deleted after this measurement) directly exercised the real, unmodified `OverviewCache.updatePodStatus` method (same package, unexported-field access): added 3 pods, deleted one cleanly (direct `*corev1.Pod` delete event — the happy path), then added a 3rd pod and deleted it via a `cache.DeletedFinalStateUnknown{Key: ..., Obj: ...}`-wrapped event (the real client-go shape for a delete inferred from a relist).
- **Evidence (measured output):**
  ```
  MEASURED after_ADDED Counts.Pods=1 (expected 1)
  MEASURED after_clean_add_then_delete Counts.Pods=1 (expected 1, pod-a only)
  MEASURED after_ADDED_pod-c Counts.Pods=2 (expected 2)
  MEASURED after_DeletedFinalStateUnknown_delete Counts.Pods=2 (expected 1 if correctly decremented; BUG if still 2)
  CONFIRMED COUNTS-1: pod counter did not decrement on DeletedFinalStateUnknown delete — permanent drift reproduced
  ```
- **Expected (per audit):** A `DeletedFinalStateUnknown`-wrapped delete fails the `obj.(*corev1.Pod)` type assertion and returns before decrementing.
- **Actual:** Exactly reproduced — the counter stayed at 2 instead of dropping to 1. The clean-delete case (happy path) correctly dropped 2→1, isolating the bug specifically to the wrapped-delete case, exactly as the audit described.
- **Confidence:** CONFIRMED (measured, through real production code, isolates the exact mechanism).

### HEALTH-1
- **Finding:** Presence layer hardcodes `Reachable: true` for every registered cluster, unconditionally.
- **Reproduction method:** Direct source re-inspection (no live cluster needed — the claim is about a literal constant, not a runtime-dependent branch): `internal/cluster/discovery/manager.go:94-102`, inside `Manager.Snapshot()`'s `reg = append(reg, presence.RegisteredCluster{..., Reachable: true, ...})`.
- **Expected (per audit):** `Reachable` is a hardcoded literal with no connectivity check anywhere in its computation.
- **Actual:** Confirmed unchanged — the literal is still exactly `Reachable: true`, with no surrounding conditional, function call, or health-state lookup of any kind in the entire function.
- **Confidence:** CONFIRMED (reading a hardcoded literal is a complete proof; there is no "live" version of this reproduction that would be more conclusive).

---

# Measurements

| Metric | Value | Method |
|---|---|---|
| Per-cluster connect cost, hanging/unroutable host | 8.000493s, 8.001283s, 8.000836s (3 runs) | Measured, real `client.TestConnection` + real 8s timeout constant |
| Per-cluster connect cost, actively-refused host | 2.037584ms | Measured, real `client.TestConnection` against the down `kind-nightshift-dev` context |
| 3-cluster sequential total (hanging hosts) | 24.005103s | Measured — confirms linear N×8s scaling, not parallel |
| `backendRequest` pending time against a permanently-hung fetch | still pending at 3000ms (test capped wait at 3s) | Measured |
| Pod counter value after clean add+delete (happy path) | 1 → 1 (correct) | Measured |
| Pod counter value after `DeletedFinalStateUnknown` delete | 2 → 2 (should be 1) | Measured — bug isolated |

All other numeric claims in the audit (30s topology server timeout, 8s topology client timeout, 500-item pagination limit, 15s HTTP server timeouts, 1000-node render cap) remain **configured values read from source**, not independently re-measured against a live workload this phase — no live cluster was available to drive them. They are unchanged from the audit and were spot-checked by re-reading the same source lines where directly relevant to the 5 P0s (see "P0 Reproduction Evidence" above).

---

# Unverified Items

- **Full Tauri desktop startup time end-to-end** — Tauri shell files are currently deleted/untracked; cannot launch the actual app.
- **Frontend-usable-time end-to-end** — requires a running backend + dev server + real cluster; not attempted this phase.
- **Topology request duration/scope against a real large cluster** — no reachable cluster available; TOPOLOGY-1's wiring gap was confirmed structurally instead (sufficient, since the gap is absolute, not load-dependent).
- **The literal reported "36 nodes / 7,720 pods" and "32588369311109.9 GiB / 0% used" values** — not reproduced exactly in this or the prior audit pass; the underlying mechanisms (COUNTS-1, METRICS-2) are confirmed, but the exact historical magnitudes were never claimed to be reproducible without the original cluster state that produced them.
- **STARTUP-1 at realistic enterprise scale (dozens of stale clusters)** — only reproduced with N=3 synthetic unroutable hosts in this environment; the linear-scaling conclusion (N×8s) is mathematically and empirically supported by the 3-sample measurement, but a 50+ cluster run was not performed (no need — the per-unit cost and sequential structure are both directly confirmed, and the loop contains no unexplained nonlinearity).
- **FLEET-1's and BLASTRADIUS-3's UNVERIFIED caveats from the audit** — out of this phase's stated focus (STARTUP-1, LOADING-1, TOPOLOGY-1, COUNTS-1, HEALTH-1); not investigated further here.

---

# Baseline Acceptance

**Phase 0 gate (per roadmap): "Major failures reproducible or clearly marked UNVERIFIED."**

**MET.** All 5 P0 findings were re-verified against the current working tree with zero drift. 3 of 5 (STARTUP-1, LOADING-1, COUNTS-1) were reproduced with real measurements through the actual unmodified production code. The remaining 2 (TOPOLOGY-1, HEALTH-1) are structural/absolute claims (a dropped parameter, a hardcoded literal) for which static source re-confirmation is a complete proof — no live reproduction would add certainty. Every item that could not be measured in this environment (no Docker, no reachable cluster, deleted Tauri shell) is explicitly listed under "Unverified Items" with its specific reason, per the audit's anti-hallucination rules — nothing was estimated or fabricated.

---

# Tests Run

- `go test ./internal/service/...` — **ok** (includes the temporary STARTUP-1/COUNTS-1 repro tests, pre-deletion; all pre-existing tests in the package also passed).
- `go test ./internal/cluster/...` — **ok** (`discovery`: ok, `identity`: ok, `presence`: no test files — pre-existing gap, not introduced this phase).
- `npx vitest run src/services/api/client.test.ts` (frontend) — **43 passed** (pre-existing suite, re-run clean after the temporary LOADING-1 repro test was added and then removed).
- `npx vitest run src/hooks/useClusterPresence.test.ts` (frontend) — **1 passed** (pre-existing; does not currently assert `Reachable` freshness/correctness specifically — consistent with the audit's HEALTH-1/HEALTH-2 test-coverage-gap note).
- No test file exists yet for `useClusterTopology` or `useTopologyData` — confirms the audit's TOPOLOGY-1 test-coverage-gap note; none was added this phase (Phase 0 is measurement, not remediation or test authoring — that is Phase 9's scope).

**Files changed by this phase:** none remain. Two temporary, non-committed reproduction files were created, run, and deleted:
- `kubilitics-backend/internal/service/zzbaseline_repro_test.go` (created → measured → deleted)
- `kubilitics-frontend/src/services/api/zzbaseline_repro.test.ts` (created → measured → deleted)

`docs/PRODUCTION-BASELINE.md` (this file) is the only net-new artifact from Phase 0.

---

# Recommended Next Phase

**Phase 1 — Reliability Foundation**, per the roadmap, since it closes the largest number of findings (LOADING-1, LOADING-2, LOADING-3, LOADING-4, LOADING-5, STARTUP-1's timeout half, TOPOLOGY-2, LIFECYCLE-2) for the least architectural change, and both of this phase's two fully-measured P0s with a clear fix path (STARTUP-1, LOADING-1) fall inside it.

**Awaiting explicit approval before starting Phase 1 or any other phase.**
