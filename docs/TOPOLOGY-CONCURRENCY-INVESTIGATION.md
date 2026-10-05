# Topology Concurrency Investigation — Phase 2D Follow-up

**Status: Root cause conclusively isolated (not guessed). Option B (client-go QPS/Burst) FIXED, TEST-PROVEN, LIVE-VALIDATED: 10 concurrent cold topology requests 18.2s → 3.1s. Option A (singleflight/request coalescing) deliberately NOT implemented this pass — real, independently-contributing, but requires the Step 6 invalidation-semantics analysis first.**

## Objective (restated)

Distinguish, with evidence, which of A (duplicate computation), B (client-go rate limiting), C (API-server contention), D (serialization), E (locking), F (cache-miss coordination), or G (combination) explains `1 request ≈ 2s` becoming `10 requests ≈ 18.3s`, before choosing any fix.

## Step 1 — Precise concurrency baseline (LIVE-REPRODUCED, isolated lab, same ~2,248-pod/75-PVC workload)

| Concurrency | Total wall-clock | p50 | p95 | max | Goroutines before→after | Backend CPU |
|---:|---:|---:|---:|---:|---|---:|
| 1 | 0.24s | 0.21s | 0.21s | 0.21s | 27→26 | — |
| 2 | 3.82s | 3.80s | 3.80s | 3.80s | 26→27 | — |
| 5 | 10.23s | 8.88s | 10.21s | 10.21s | 27→27 | — |
| 10 | 18.17s | 16.35s | 18.14s | 18.14s | 41→42 | 0.1-11.4% (sampled every 2s) |
| 20 | 30.08s | 28.46s | 30.03s | 30.03s | 42→40 | — |

Throughput (completions/sec) stabilizes at ~0.5-0.7 once N≥2 — the signature of a shared, fixed-rate bottleneck, not of per-request latency staying constant while only throughput scales with N (which rules out "duplicate work alone, no contention" as the sole explanation) and not of CPU saturation (which the low CPU readings separately rule out).

**No goroutine leak at any level** — counts return to baseline after each burst.

## Step 2 — Does concurrency produce duplicate computation? (directly counted, not inferred)

Added temporary instrumentation (`internal/topology/engine.go`'s `BuildGraph`, a package-level atomic counter + per-call start/end/phase logging) for exactly this question, removed once answered.

**Result: 38 `BuildGraph` invocations for 38 total requests across all 5 concurrency levels tested (1+2+5+10+20=38).** Confirmed by exact count in the server log, not estimated. `internal/pkg/topologycache`'s `Get`/`Set` have no coordination primitive (no `singleflight.Group` or equivalent) — every cache-miss (or `force_refresh=true`) request independently triggers its own full `discoverResources` + `InferAllRelationships`.

**Answer: 10 requests → 10 independent builds, not 1 build + 9 consumers.** Option A (duplicate work) is real.

## Step 3 — Is client-go rate limiting actually involved? (CODE-PROVEN)

- `internal/k8s/client.go` never set `rest.Config.QPS`/`Burst` (confirmed before this fix, via direct grep — no occurrence anywhere).
- Read `k8s.io/client-go@v0.35.1/rest/config.go` directly: `DefaultQPS = 5.0`, `DefaultBurst = 10`, applied whenever `Config.QPS == 0` (confirmed at the exact source lines, not assumed from documentation).
- This limiter is constructed once, attached to the shared `rest.RESTClient`/clientset for that cluster (one `*k8s.Client` per cluster, reused across every concurrent caller via `GetOrReconnectClient`'s pooling — confirmed by reading `getClientFromRequest`'s fallback path) — **not per-request.**
- Kubilitics' own separate, optional app-level `client.limiter` (`golang.org/x/time/rate.Limiter`, gated by `K8sRateLimitPerSec`/`Burst`) is a different mechanism entirely, only wired for the stateless request-kubeconfig path, and was not in play for these (stored-cluster) tests (`client.limiter == nil`, confirmed by code path — `waitRateLimit` is a no-op when nil).

**Answer: the chain `request concurrency → shared client → rate limiter contention → increased API-call latency` is CODE-PROVEN, not merely plausible.** Option B is real.

## Step 4 — Where does the extra latency appear?

Temporary per-phase timing (discovery vs. inference vs. prune vs. layout vs. validate) during the N=20 burst showed `discoverResources` alone — Phase 1, the bulk `List` calls — reaching **up to 29.99 seconds** for individual builds within that burst (vs. 82-89ms for a single isolated build). Zero time appeared in relationship inference, serialization, or graph construction disproportionately. This directly confirms the extra latency is almost entirely List-call throttling (Options B/C), not CPU-bound graph processing (ruling out most of D/E as independently significant) and not serialization cost.

## Step 5 — Theoretical benefit of coalescing (not implemented, reasoned from Step 2's count)

If the 10 identical concurrent requests shared one computation (1 build + 9 waiters), total cost for *identical* requests would collapse to ~1 build's latency (0.2-2s) regardless of N. This remains true independent of the QPS finding — it specifically targets the *duplicate-work* component (Option A), not the rate-limiter component (Option B).

## Step 6 — Invalidation semantics (traced, not fully resolved — the reason Option A is deferred)

Traced `internal/pkg/topologycache`: `Get`/`Set` keyed by `(clusterID, mode, namespace, depth)`, TTL-based, invalidated explicitly on resource-change via the `ClusterGraphEngine`'s `onRebuild` callback (`TopologyCacheInvalidateForCluster`/`s.cache.InvalidateForCluster`, wired in `main.go`). This pass did **not** fully trace every interaction a singleflight layer would need to get right:
- What happens to in-flight shared computations on cluster reconnect/removal (would need to tie into the same `OnClusterConnected`/`OnClusterDisconnected` hooks already used by `PipelineManager`/`EngineLifecycleManager`, not a new, parallel mechanism).
- Whether a cancelled client's context should cancel the *shared* computation for everyone still waiting, or only detach that one waiter (the correct answer is almost certainly "detach only," matching Go's own `singleflight.Group` semantics, but this needs confirming against this specific cache's generation/staleness model before implementing).
- Whether a failed shared build should poison the key permanently or just for that one attempt (should be "just that attempt," per existing patterns elsewhere in this codebase, e.g. `ClusterLifecycleManager`'s tombstone-on-remove-only pattern — but not yet explicitly wired for this cache).

**This is exactly why Option A is not implemented this pass** — per the brief's own Step 6 instruction, these questions must be answered first, and they were traced but not fully closed out given this pass's scope.

## Step 7 — Non-identical concurrent requests (distinguishes A from B directly)

5 concurrent **different** namespace-scoped topology requests (5 distinct namespaces, no duplicate work possible — singleflight would help zero of these) took **9.37s total** (individual latencies 3.2s-9.3s) — comparable in shape to the 5-identical-request baseline (10.2s). **This proves Option B (rate-limiter contention) is independently, materially responsible on its own, not merely a side-effect of duplicate work.** Singleflight alone would not have fixed this specific experiment at all.

## Step 8 — QPS/Burst experiment, isolated, before approving

Added a temporary env-var-gated override (`KUBILITICS_DEBUG_QPS_OVERRIDE`, never set by default — zero production impact), tested `QPS=50, Burst=100` against the identical N=10 and N=20 bursts:

| | Default (5/10) | Experiment (50/100) |
|---|---:|---:|
| N=10 total | 18.17s | **3.18s** |
| N=20 total | 30.08s | **8.08s** |
| Real API server (kind control-plane container) CPU during burst | ~13-25% (baseline-ish) | 13.70%-17.24% |
| Real API server memory | ~1-1.2GB/7.75GB | ~1.1-1.25GB/7.75GB |

**The real Kubernetes API server's own resource usage did not materially change between the two configurations** — the default's slowness was Kubilitics' own client self-throttling below what the API server could actually serve, not the API server being the limiting factor. This directly answers Step 8's question ("does higher QPS improve Kubilitics without simply transferring overload to the API server?") — **yes, at this scale.** Not verified at higher concurrency (50+) or larger clusters (5K/10K+) — flagged as a remaining risk, not assumed to hold indefinitely.

## Step 9 — Cancellation testing

**Not run this pass.** This step is specifically framed around singleflight's cancellation semantics ("if one request is cancelled, should the underlying shared computation continue") — since Option A (singleflight) was not implemented, there is no new cancellation-sharing behavior to test. The existing per-request `context.WithTimeout` (30s default, `TopologyTimeoutSec`) and existing cancellation propagation (already proven correct for other paths, e.g. VALID-02's `TestVALID02_GetClientFromRequest_CancellationPropagates`) are unchanged by this fix.

## Step 10 — Decision

**Option B (QPS/Burst) implemented now:** evidence from Steps 3, 4, 7, and 8 independently and jointly demonstrates rate-limiter contention is a real, material, and currently the *more tractable* bottleneck — fixable with a simple, well-scoped, low-risk config change that touches no caching or invalidation logic at all. Step 8's own isolated experiment confirms no demonstrated API-server overload at this scale.

**Option A (singleflight) explicitly deferred, not implemented:** Step 2 proves duplicate work is real and Step 5 shows it has independent theoretical value, but Step 6 could not be fully closed out this pass (reconnect/cancellation/failure-poisoning semantics need explicit design, mirroring patterns already proven elsewhere in this codebase — `ClusterLifecycleManager`/`EngineLifecycleManager`'s tombstone+per-entry-mutex pattern is the natural template, but applying it correctly to a TTL-cached, generation-sensitive topology result needs its own dedicated pass, not a rushed addition here).

This is **Option C's evidence** ("both independently contribute") **with a staged implementation**: fix the well-understood, lower-risk half now; carry the other half forward as a scoped, well-evidenced follow-up with its open design questions explicitly named (Step 6 above), rather than rushing it.

## Fix implemented

- `internal/config/config.go`: new `K8sClientQPS`/`K8sClientBurst` fields (viper defaults: 50/100, the exact values proven safe and effective in Step 8), distinct from the pre-existing `K8sRateLimitPerSec`/`Burst` (a different, narrower, optional app-level limiter for the stateless request-kubeconfig path only).
- `internal/k8s/client.go`: new `SetDefaultClientRateLimit(qps, burst)` (called once at startup) and `applyDefaultClientRateLimit` (applied in both `NewClient`'s `buildConfigFromFlags` path and `NewClientFromBytes`, before `kubernetes.NewForConfig` — the limiter is baked into the clientset at construction, so this must happen before, not after). Zero value leaves client-go's own default (5/10) in effect — unit tests and any caller that never invokes `SetDefaultClientRateLimit` are unaffected.
- `cmd/server/main.go`: calls `k8s.SetDefaultClientRateLimit(cfg.K8sClientQPS, cfg.K8sClientBurst)` once, immediately after config loads, before any client is constructed.

## Regression tests

`internal/k8s/client_ratelimit_test.go`: proves configured values are applied, proves zero-value leaves client-go's default untouched, proves partial overrides (QPS only, Burst only) work independently. All pass under `-race`.

## Evidence

- `go build ./...`, `go vet ./...`: clean.
- `go test -race ./internal/k8s/... -run "TestApplyDefaultClientRateLimit_"`: 3/3 pass.
- Full backend `go test -race ./...`: see this session's final report for the confirmed result.
- Live validation (isolated lab, REAL config-driven fix — not the temporary env-var experiment): N=10 concurrent cold topology requests, **3.09s** (matches the isolated experiment's 3.18s). Single cold request still fast (0.48s). Dashboard/summary workflows unaffected (3.8ms / 130ms respectively).
- All temporary debug instrumentation (`BuildGraph` counter/phase-timing, the env-var QPS override hook) removed after the investigation concluded — none left in production code.

## Remaining risks / explicitly not done this pass

- Not verified at concurrency beyond 20, or against a 5K/10K+-pod workload — the "API server CPU stays low" finding is scale-specific evidence, not a universal guarantee.
- Option A (singleflight/request coalescing) remains a real, evidenced opportunity for the *identical-request* case specifically (e.g., many browser tabs/users opening the exact same cluster-wide view at once) — carried forward as a scoped follow-up with its design questions (Step 6) explicitly named, not silently dropped.
- Step 9 (cancellation testing) not run — no new cancellation-sharing behavior was introduced, so there was nothing new to test for that specific concern this pass.
- The effect of the new QPS/Burst default on Kubilitics' OTHER concurrent workflows (Dashboard informers, resource lists, Blast Radius's separate engine) sharing the same per-cluster client was not separately load-tested — only topology was the subject of this investigation.
