# Kubilitics — Enterprise Scale & Reliability Report

**Status: Backend profiling (original session) + real browser/frontend profiling (Phase H, this update) both complete with real measurements, up to ~2,000 pods. Headlamp comparison, failure/degradation testing (Phase 7), WebSocket-specific testing, and 5K+ tiers remain undone — see §21 for the explicit remaining scope.**

**Phase H found one new P1 (VALID-05), now fixed, tested, and live-reproduced** — see §19. All other content in this report remains measurement/diagnosis only; no other production code was changed.

---

## 1. Executive Summary

A real customer observation reported severe degradation (topology not loading, false dashboard values, backend unreachability, long startup) at approximately 2,000 Pods / 300 Deployments. This report reproduces that object count against a genuinely isolated lab environment and measures actual backend behavior.

**Headline finding:** the backend, measured in isolation, handles 2,000+ real Pod API objects (plus 300 Deployments/Services/ConfigMaps/Secrets and realistic ownership relationships) **fast and without resource strain** — Dashboard summary in 1.4s, full-cluster topology (4,148 nodes/15,382 edges, 6.9MB payload) in 2.1s cold / 50-100ms warm, resource lists correctly capped/paginated, concurrent multi-endpoint requests completing in under 500ms total, and goroutine/heap growth bounded and small across repeated and concurrent load. **This does not match the severity of the reported customer failure**, which strongly suggests the dominant bottleneck lives downstream of the backend's own query/serialization layer — most likely in frontend graph construction/rendering, or in characteristics of the real customer's cluster this synthetic reproduction does not capture (denser relationship graphs, real running-pod metrics load, WebSocket event volume, or a different code path than the ones measured here).

This is a **diagnosis report, not a fix**. Per explicit instruction, no production code was changed based on these findings. The next step is sharper frontend profiling and/or obtaining more detail about the actual customer cluster's shape, not backend optimization.

---

## 2. Original 2K/300 Failure Reproduction

### 2.1 Environment

A dedicated, fully isolated lab was built specifically to avoid two real incidents encountered during earlier attempts:

- **Incident 1:** an initial reproduction on the shared `nightshift-dev` cluster accidentally polluted the real cluster's state (300 synthetic Deployments / ~1,615 synthetic Pods), which was then also visible to a live, running Kubilitics desktop app connected to the same cluster via the same `~/.kube/config` — discovered only after the fact. Fully cleaned up and confirmed restored (verified via `kubectl`) before continuing.
- **Incident 2 (methodology lesson, not a mistake needing cleanup):** a "fresh" backend instance silently failed to bind its port (already held by the real desktop app) and exited; subsequent requests were actually served by the real app's own backend process without that being obvious at the time. This was caught via `lsof`/`ps` before drawing conclusions from those measurements, and prompted building the isolated lab described below.

**The isolated lab**, built in response to both incidents:

- A **separate kind cluster** (`kubilitics-scale-lab`), created with `kind create cluster --config ... --kubeconfig /tmp/kubilitics-lab/kubeconfig.yaml` — a dedicated, non-default kubeconfig file, never touching `~/.kube/config`.
- Kubelet `maxPods` raised to 4000 via a `KubeletConfiguration` patch in the kind cluster config (the default 110-pod-per-node cap would otherwise artificially throttle real scheduling well below the target tier).
- A **dedicated Kubilitics backend process**, launched with `KUBECONFIG=/tmp/kubilitics-lab/kubeconfig.yaml` and `KUBILITICS_PORT=8199` (confirmed via code inspection that the backend honors the `KUBECONFIG` env var) — guaranteeing zero interaction with the real cluster, the real backend, or the real desktop app for the remainder of this work.
- Host capacity check performed first: 16GB total physical RAM, Docker Desktop allocated 7.7GB (not changed — would have required a Docker restart, disrupting the real environment), 4 CPUs. The real `nightshift-dev` cluster uses ~3GB of that pool, leaving real but limited headroom for the lab cluster.

### 2.2 Workload generator and methodology

A Python generator (`/tmp/kubilitics-lab/gen_workload.py`, not committed to the repo — ephemeral lab tooling) produces realistic, multi-resource manifests per tier: Deployments with varying replica counts, each with an associated Service, ConfigMap, and Secret, spread across 10 namespaces — not a flat list of identical Pods.

**Honest methodology note on real vs. synthetic resource consumption:** running 2,000+ real scheduled containers was not safely achievable on this host (even lightweight containers have real per-pod kubelet/cgroup overhead, and 16GB total RAM with Docker already committed leaves insufficient headroom for thousands of real running pods alongside the existing environment). Instead, ~85% of generated pods use a `nodeSelector` that matches no real node, causing them to exist as **full, real Kubernetes API objects** (fully List-able, Watch-able, serializable — exactly what stresses the code paths under test) while never actually being scheduled or consuming container-runtime resources; the remaining ~15% have no such restriction and schedule/run for real, providing a sample of genuine running-pod behavior. This is recorded as **REAL (API-object-weight) + PARTIAL-REAL (container-weight)**, not purely SYNTHETIC — the distinction matters because API-server/etcd/informer/List-call cost (the layer most relevant to Kubilitics' own backend) is identical whether a pod is actually running or just Pending.

### 2.3 Achieved Tier L workload

| Metric | Target | Achieved |
|---|---:|---:|
| Deployments | 300 | 300 |
| Pods (total object count) | ~2,000 | **2,084** |
| Pods actually Running | — | 244 |
| Pods Pending (full API objects, unscheduled) | — | 1,832 |
| Namespaces | 10 | 10 |
| Services / ConfigMaps / Secrets | 300 each | 300 each |

Apply time for all 300 Deployments (1,200 total top-level objects): 14s. Full pod-object population (via the Deployment→ReplicaSet controller chain) stabilized at 2,084 objects within approximately 2 minutes of the apply completing.

---

## 3. Root-Cause Tree (as far as measured)

```
2,084 Pod objects / 300 Deployments
        │
        ▼
Backend: ListClusters/summary/topology/resource-list — ALL MEASURED FAST
        │  (1.4s summary, 2.1s cold topology, 50-100ms warm,
        │   bounded goroutines/heap, no contention under
        │   concurrent multi-endpoint load)
        ▼
??? — NOT YET ISOLATED
        │
        ▼
Reported customer symptom: topology not loading, false dashboard
values, backend unreachable, long startup
```

**The causal chain could not be completed this session.** The backend side is measured and ruled out as the dominant cause at this object count, in this synthetic reproduction. The frontend side (graph construction, Cytoscape/ELK layout, React state, browser memory) was only partially exercised (see §7) due to a UI-automation obstacle, not a confirmed absence of a frontend bottleneck. **Do not read "backend is fast" as "the problem is solved" or "the problem is the frontend" — only as "the backend, measured in isolation, does not explain the reported severity."**

---

## 4. Backend Profiling

All measurements below are LIVE-REPRODUCED against the isolated lab backend (PID holding `KUBECONFIG=/tmp/kubilitics-lab/kubeconfig.yaml`, port 8199), using the real Prometheus Go-runtime metrics already exposed at `/metrics` (`go_goroutines`, `go_memstats_heap_alloc_bytes`) — no code changes were needed to obtain these; they were already instrumented.

| Measurement | Result | Evidence |
|---|---:|---|
| Baseline goroutines (cluster connected, before any page-equivalent request) | 486 | LIVE-REPRODUCED |
| Baseline heap | 118.7 MB | LIVE-REPRODUCED |
| Baseline RSS | 210 MB | LIVE-REPRODUCED |
| `GET /summary`, cold, first call | **1.376s**, correct counts (2,084 pods, 303 deployments) | LIVE-REPRODUCED |
| `GET /topology` (full cluster), cold | **2.122s**, 4,148 nodes / 15,382 edges, 6.9 MB payload | LIVE-REPRODUCED |
| Goroutines after topology | 489 (+3) | LIVE-REPRODUCED |
| Heap after topology | 123.0 MB (+4.3MB) | LIVE-REPRODUCED |
| RSS after topology | 276 MB (+66MB) | LIVE-REPRODUCED |
| 5× repeated full-topology fetch | 52-97ms each (cache-warm) | LIVE-REPRODUCED |
| Goroutines after 5 repeats | 487 (flat) | LIVE-REPRODUCED |
| RSS after 5 repeats | 301 MB (+25MB over 5 calls — modest, not alarming) | LIVE-REPRODUCED |
| 5 concurrent requests (topology + summary + 2 resource lists + metrics-summary) | **446ms total wall time** for all 5 | LIVE-REPRODUCED |
| Full cluster-wide pod list, no namespace filter | 166ms, **correctly capped at 100 items** (379KB) — confirms server-side list limiting already exists | LIVE-REPRODUCED |

**No evidence of unbounded goroutine growth, unbounded memory growth, request serialization/blocking under concurrency, or missing pagination was found in this tier.** This directly contradicts a naive "the backend can't handle 2K pods" hypothesis — it can, comfortably, in this synthetic reproduction.

---

## 5. Kubernetes API Analysis

Not independently profiled via `kube-apiserver` metrics/audit logs this session (no Prometheus/apiserver-metrics scraping was set up in the lab — scoped out, see §19). Indirect evidence: apply of 1,200 top-level objects completed in 14s with no throttling errors observed in `kubectl` output; the Deployment→ReplicaSet→Pod controller chain populated all 2,084 pod objects within ~2 minutes without controller-manager errors. No `client-side throttling` warnings were observed in the lab backend's logs during the measurements in §4 (contrast with the earlier, real-`nightshift-dev`-cluster testing in prior continuations of this engagement, where such throttling warnings *were* observed under different, more concurrent conditions — worth future investigation, not resolved here).

---

## 6. Cache/Informer Analysis

Not independently profiled via heap-dump or pprof this session (pprof is not currently wired into the backend's HTTP server, and adding it would itself be a production code change, explicitly out of scope for this phase). The Go-runtime metrics in §4 (goroutines, heap) are the only cache/informer-adjacent signal gathered — and they show healthy, bounded behavior at this tier. A real pprof-based heap/goroutine profile at this and larger tiers is recommended as a concrete next step (see §19).

---

## 7. Frontend Profiling (Phase H — complete for the tiers tested)

The navigation blocker that stopped the original frontend attempt (§7 as it previously read) is now root-caused, not worked around blindly: see **VALID-05** (`docs/VALID-05-INVESTIGATION.md`), a newly discovered, code-proven **P1** — the Cluster Picker's click-to-connect path always retries with a hardcoded `~/.kube/config` fallback, because the wire type behind `/api/v1/presence` (`presence.RegisteredCluster`) has no `kubeconfig_path` field at all. This blocks connecting to *any* cluster registered via a non-default `KUBECONFIG`, which includes the isolated lab by its own required design. Per the mission's explicit stop-on-new-P0/P1 rule, this was documented and reported, not fixed, before continuing.

**How measurement continued without a production code change:** the lab backend process alone (not the real backend, not any shared state) was launched with a sandboxed `HOME=/tmp/kubilitics-lab/fakehome` whose only content is `.kube/config` = a copy of the lab's own kubeconfig. This makes the existing, unmodified `~/.kube/config` fallback resolve correctly for the lab cluster specifically, without ever touching the real `$HOME` or `~/.kube/config` (independently verified: `echo $HOME` and `kubectl config current-context` in the actual session shell throughout were confirmed to still show the real user and `kind-nightshift-dev`). This is a test-environment accommodation, not a product fix, and does not change VALID-05's status.

**Methodology:** real Chromium via Playwright, frontend dev server on :5199, all `localhost:8190` HTTP calls transparently proxied to the isolated lab backend on :8199 (request interception + manual re-fetch + `route.fulfill`). Journey driven through the product's own existing UI: Cluster Picker → "Paste KubeConfig" tab (an existing, shipped flow, not a workaround) → page reload → click the now-registered cluster card → Dashboard → Topology, switching to **Cluster** view mode via its documented keyboard shortcut (`2`, from `useTopologyKeyboard`'s `onViewMode`) and to **Full Graph** depth via the depth selector, to exercise the worst case.

**What was obtained, LIVE-REPRODUCED, at ~1,971 pods / 294 deployments (closely matching the original 2,084/300 backend tier):**

| Measurement | Result |
|---|---:|
| Click cluster card → URL changes to `/dashboard` | 41ms |
| URL change → "Cluster Health" visible (useful render) | 485ms |
| URL change → network-idle (bounded 3s wait; did not fully idle — see caveat below) | 3,490ms |
| Topology nav → canvas/data visible | 3,475ms |
| JS heap after Dashboard + Topology | 91.7 MB |
| DOM node count on Topology page | 1,018 |
| Long-task total (PerformanceObserver, `longtask` entries) | 391ms |
| Total HTTP requests across the full journey | 85 |
| Total HTTP bytes transferred across the full journey | 28.6 MB |
| Console errors | 25 — **all** `WebSocket ... ERR_CONNECTION_REFUSED` against `localhost:8190` (see harness-limitation caveat below), not application errors |

**Dashboard correctness, compared against ground truth:** "9 active pods" / "1,971" (varied by tier, see §18) shown in the sidebar pod count and Cluster Capacity widget matched `kubectl get pods -A` exactly at every tier tested. No false healthy/zero/empty states were observed at any tier.

**Critical, positive finding on Topology at scale:** at Cluster view + Full Graph depth with ~1,971 pods / ~3,600 total resources, the UI **did not** attempt to render thousands of pod-level nodes. It rendered **17 top-level nodes** (one per namespace + the control-plane node) and explicitly displayed **"3,576 resources hidden"** with a namespace-scope indicator ("1/15 namespaces") — an honest, visible progressive-disclosure boundary, not a silent drop or a freeze. This is the live, empirical confirmation that the `MAX_VISIBLE_NODES` cap and the namespace-collapsed Cluster-view default (`kubilitics-frontend/src/topology/hooks/useTopologyData.ts:33-58`, `TopologyPage.tsx:127-135`) are working as designed at this scale. Reaching the dangerous "render everything" regime would require a user to deliberately expand many/all of the 15 namespace nodes at once — a much rarer interaction than simply opening Topology, which measurably lowers (but does not eliminate — see §19) the real-world likelihood of hitting a frontend freeze through this specific page at this specific scale.

**Scale-matrix data (Dashboard + Topology network payload), captured across baseline → ~591 → ~1,105 → ~1,971 pods before a later re-run reset the depth/view-mode methodology (see note):**

| Pods (approx) | Topology payload (cluster-view, pre-depth-fix) | Fetch time | Dashboard useful-render | JS heap after Dashboard |
|---:|---:|---:|---:|---:|
| 9 (baseline) | 8.3 KB | 2.2s | 376ms | 60.3 MB |
| 591 | 250 KB | 2.35s | 503ms | 86.4 MB |
| 1,105 | 398 KB | 2.32s | 404ms | 76.6 MB |
| 1,971 | 656 KB | 3.7s | 594ms | 91.7 MB |

Payload size scales roughly linearly with pod count (as expected — no pagination on this endpoint, consistent with §10's Fleet N+1 finding that unpaginated fan-out is a recurring pattern in this codebase). Fetch time grows more slowly until ~1,971 pods, where it jumps disproportionately (2.3s→3.7s against a payload increase of only ~1.6x) — a single data point, not yet enough to claim a complexity class, but a candidate super-linear signal worth re-testing at 5K+ before concluding anything.

**Honest methodology caveats (do not over-read the numbers above):**
1. The "network-idle" settle-time measurements are bounded-timeout heuristics (3-8s caps), not true content-ready signals — background polling/WebSocket traffic means the page rarely goes fully idle, so these numbers should be read as "did not settle within N seconds," not as precise render-complete times. "Useful render" (a real content heading appearing) is the more trustworthy of the two.
2. **The Playwright harness's request-interception proxy only covers HTTP, not WebSocket (`ws://`).** All 25 console errors on every run are `WebSocket connection ... ERR_CONNECTION_REFUSED` against the un-proxied default port — a harness limitation, not a reproduced product defect. This means **Phase 5's real-time dashboard update behavior and Phase 7's WS disconnect/reconnect testing are still UNVERIFIED** — not because the product failed, but because this harness cannot yet test them. The "Reconnecting..." toast visible in the Topology screenshot is a direct, correctly-functioning symptom of this proxy gap, not a bug.
3. The 4-tier payload/heap table above and the single detailed Cluster/Full-Graph measurement at ~1,971 pods come from two separate harness runs (the first used Cluster view at default Overview depth; a methodology bug was caught and fixed — the depth selector was not actually being pushed to "Full Graph" — before the second, corrected run). The corrected run was only re-executed at the ~1,971-pod tier before this write-up, for time reasons; the 500/1,000-pod corrected-depth runs were not repeated. This is flagged rather than hidden.
4. JS heap figures are single-sample `performance.memory.usedJSHeapSize` reads, not forced-GC-then-measure — browser GC timing adds noise (visible in the non-monotonic 86.4MB→76.6MB→91.7MB sequence above).

---

## 8. Topology Profiling

Backend-side: see §4 (graph construction completed server-side in 2.1s cold / sub-100ms warm for 4,148 nodes / 15,382 edges). Browser-side: **now LIVE-REPRODUCED** (§7) — at ~1,971 pods, Cluster-view Full-Graph depth renders 17 top-level nodes (namespace-collapsed, by design) in ~3.5s nav-to-visible, DOM capped near 1,018 nodes (consistent with the 1,000-node `MAX_VISIBLE_NODES` guard), 391ms of main-thread long-tasks, no crash, no freeze. Drilling into all 15 namespaces simultaneously (the actual worst case the `MAX_VISIBLE_NODES`/ELK-grid guards were built for) was **not** exercised this session — UNVERIFIED, candidate next step (§19).

---

## 9. Memory Analysis

Backend: see §4 — bounded, modest growth (RSS 210MB→301MB across the full measurement sequence; heap 118.7MB→123.0MB). Frontend/browser: LIVE-REPRODUCED (§7) — JS heap 60.3MB→91.7MB across baseline→~1,971 pods (noisy single-sample measurement, see caveat 4 above), no indication of a leak within a single session (no repeated-navigation soak test was run — see §19).

---

## 10. Fleet N+1 Analysis — FIXED (Phase I-A, FLEET-N1)

Originally quantified at 21.6s vs. 1.8s at 50 synthetic clusters (`docs/PRODUCTION-VALIDATION-REPORT.md` §17.2). **Now fixed** — full record in `docs/FLEET-N1-IMPLEMENTATION.md`. Summary: the backend already had a server-side aggregate endpoint (`GET /fleet/overview`) that the frontend never adopted, because its response was missing fields (`reachable`/`stale`/`errorMessage` especially — the HEALTH-1/HEALTH-2 correctness fields) the frontend needed. Extended the existing DTO additively and rewired `useFleetOverview.ts` from 1+N requests to 1. Live verification caught and fixed a second, real bug before shipping: `clusterService.GetClusterSummary` never set `Reachable` at all (always false), which would have made every cluster show "unreachable" in Fleet regardless of true state — a regression worse than the pre-fix behavior. Both fixes are test-proven (15 new/rewritten tests across backend+frontend, revert-and-reconfirmed) and live-reproduced against the isolated lab. The original 50-cluster timing was not re-measured this increment (architectural fix confirmed via unit tests at N=25/30 and a live single-cluster check instead — see the implementation doc §7 for why).

---

## 10a. Phase I-B — buildClusterSummary Fan-Out Hardening

Full record in `docs/FLEET-PERFORMANCE-IMPLEMENTATION.md`. Traced the complete downstream fan-out and found it was worse than previously characterized: `buildClusterSummary` (the *separate*, richer implementation backing the per-cluster `/summary` HTTP endpoint — distinct from the simpler `clusterService.GetClusterSummary` that Fleet calls) fires **30 fully unbounded concurrent K8s List calls per invocation**, every one of which **silently discarded its own error**. Combined with `GetFleetOverview`'s own unbounded per-cluster fan-out (§10), worst-case concurrent K8s calls had no ceiling in either dimension.

**Fixed:** both fan-out layers now bounded via `errgroup.SetLimit()` (10 concurrent resource-list calls per cluster-summary; 10 concurrent cluster-summaries per fleet request) — an evidence-informed starting point, explicitly not empirically tuned at real 50-100-cluster scale (that measurement remains outstanding, see below). Per-call failures are now tracked and surfaced via `HealthReason` instead of silently reported as a false "0" count. 5 new regression tests (bounded fan-out, mixed-failure-ratio isolation, one-slow-cluster-doesn't-multiply-latency, concurrent-request safety under `-race`), full backend `-race` suite green, live-reproduced against the isolated lab with before/after evidence (one-slow-cluster scenario: ~2s unbounded → ~100ms bounded).

**Investigated but not fixed:** discovered a **third** independent cluster-health computation (not just the two found in Phase I-A) — `computeClusterHealthStatus` (Fleet's path), `computeClusterHealth`/`healthscore.Score()` (the richer `/summary` path), and an unconfirmed third source on the Dashboard. Live-reproduced the same cluster reporting `"unhealthy"` via Fleet and `"degraded"` via `/summary` simultaneously — a real, plausible contributor to "dashboards showing inconsistent values," independent of scale. Unifying this is a materially larger change than this phase's scope and needs its own dedicated investigation; documented precisely, not fixed.

**Explicitly not attempted this phase** (see the implementation doc §9 for the full accounting): Fleet-concurrent-with-Dashboard/Topology interaction; reconnect/removal-during-aggregation races; P50/P95/P99 as formal statistics (raw sample ranges only); genuinely independent 50-100+ real API servers (vs. the shared-API-server methodology used, see below).

**Relationship to the original 2K-pod customer symptom:** ruled out as the primary cause, with reasoning, not merely assumed — Fleet aggregation cost scales with registered-cluster *count*, not any single cluster's pod count, and the original report describes a single cluster's symptoms.

---

## 10b. Phase I-B Follow-up — Real Multi-Cluster Measurement Surfaces a Major New Finding

Full record in `docs/FLEET-PERFORMANCE-IMPLEMENTATION.md` §10. To get real (not mocked) multi-cluster evidence without the infeasible cost of dozens of independent kind control planes, the isolated lab cluster's kubeconfig was cloned 25 times (distinct cluster/context names, same real API server) and registered as 25 additional backend entries — 26 real, distinct, backend-registered clusters total, all genuinely exercising client-go/HTTP mechanics, not mocks. Explicitly documented what this methodology does and doesn't prove: it isolates the backend's own per-cluster-registration resource cost accurately; it does not measure true network-latency diversity or independent-API-server throttling, which remains UNVERIFIED.

**An operational incident occurred and is disclosed in full in the implementation doc §10.1:** a launch command omitted the explicit `KUBECONFIG` override, causing the lab backend to briefly auto-register the real `kind-nightshift-dev` cluster into its own disposable, isolated database via the default `~/.kube/config` fallback. Caught within the same turn, before any measurement was taken against it. Verified harmless (registration is read-only by code; the real cluster's pod/namespace/deployment counts were independently re-checked immediately after and matched the established baseline exactly) and corrected before continuing.

**Major finding:** goroutine count scales **linearly at ~297 goroutines per registered cluster** (measured: N=1→297, N=10→2,950, N=26→~7,750 — a striking match to 297×N), with RSS scaling similarly (~20-25MB marginal per cluster). **Root cause, CODE-PROVEN:** `OverviewCache.StartClusterCache` starts a full `SharedInformer`-per-resource-kind set for every registered cluster, called **eagerly on registration/connection** (confirmed at all 7 call sites in `cluster_service.go` — `AddCluster`, startup load, reconnect, etc.) — never lazily on first view. This cost is continuous and standing, independent of whether a registered cluster is ever actually viewed in Dashboard, Topology, or Fleet. Linear extrapolation (stated as extrapolation, not measured fact): 100 clusters ≈ 29,700 goroutines / ~2.2GB RSS; 500 clusters ≈ 148,500 goroutines / ~11GB RSS, likely exhausting a typical desktop deployment on cluster registration alone.

**This is arguably the single most consequential, actionable finding of the entire Phase I-A/I-B effort** — bigger than Fleet's own request-handling fan-out (now bounded) because it's an always-on cost unrelated to any specific request pattern. **Not fixed** — redesigning informer lifecycle to start lazily (with TTL-based teardown for unviewed clusters) is a substantially larger architectural change than anything else fixed in Phase I-A/I-B, and needs its own dedicated investigation and explicit approval. Flagged as the top priority for the next increment of this engagement.

**Relationship to the original 2K-pod customer symptom:** orthogonal to the original single-cluster framing (informer count scales with registered-*cluster* count, not one cluster's pod count) — but identifies a second, independent, real way the backend's resources could be exhausted (registering many clusters) that the original investigation never tested, because it was scoped around one cluster's internal scale.

---

## 10c. Informer Lifecycle Investigation & Implementation — FIXED

Full records in `docs/INFORMER-LIFECYCLE-INVESTIGATION.md` (analysis + recommendation) and `docs/INFORMER-LIFECYCLE-IMPLEMENTATION.md` (the build). A dedicated, code-level investigation into whether the ~297-goroutines-per-cluster finding (§10b) warranted moving from the eager "register → start all informers → run forever" model to a lazy, on-demand one — **approved and implemented** as a follow-up increment.

**Investigation findings:** the informer count is **27**, not 26 as initially approximated; **20 of those 27 (74%) have no Dashboard/real-time consumer at all**. The highest-impact single call site was `LoadClustersFromRepo` (backend startup) — every persisted, reachable cluster from *any* previous session got its full informer set restarted on every backend launch. A grounded Headlamp source comparison (real code read, not assumed) found real precedent for on-demand cluster-resource lifecycle (its `k8cache` package creates per-context clientsets on demand with explicit cleanup), though Headlamp's own design is itself a hybrid, not the "zero watches" extreme.

**Implemented:** a new `ClusterLifecycleManager` (`internal/service/cluster_lifecycle.go`) mediates every informer start/stop. Registration, backend startup, and background reconnect no longer start informers — only the first real consumer call (`GetInformerManager`/`GetOverview`/`Subscribe`, the exact choke points every feature already goes through) triggers lazy activation; a single centralized sweep goroutine (not one ticker per cluster) stops idle clusters after a configurable TTL (default 10 min).

**Both mandatory race surfaces proven under `go test -race`**, deterministically (channel barriers and direct method calls, not sleep-based timing): 100 concurrent activations for one cluster produce exactly one informer generation; a request holding a live `Store` reference survives a concurrent TTL-triggered stop without panicking, and a subsequent activation always gets a fresh generation, never a stale one. The correctness mechanism is structural (one mutex held for the entire start-or-stop operation per cluster), not probabilistic.

**Live-measured, not just unit-tested**, against the isolated lab: a registered-but-never-viewed cluster now costs **197 goroutines** (pure backend baseline) instead of the ~297+ the eager model cost; first activation (a real Dashboard overview request) brings it to **480** (+283, matching the investigation's prediction); removal correctly returns it to **195**. Full register→activate→remove→re-register→re-activate cycle reproduced live with correct data at every step (pod/deployment counts matched ground truth throughout).

**Two real regressions were found and fixed during implementation** (both caught by the pre-existing VALID-01/VALID-04 regression tests exactly as intended): a test-mock fidelity gap (`mockClusterRepo.Update` didn't match real SQLite's no-op-on-deleted-row semantics, fixed in the test, not production code) and a genuine design tension in the new `Reconnected()` path that would have silently changed an already-tested return-value contract for the reconnect-races-removal scenario (fixed by deferring to the existing, already-correct VALID-01 rollback mechanism instead of adding a competing guard). A separate, pre-existing, low-severity data race inside `k8s.InformerManager` itself (`im.stores`, unsynchronized) was also discovered via this work's own test-writing — confirmed unreachable by any production call site (all already gate on `HasSynced()` first) and left unfixed, flagged for a future dedicated fix.

**Not done this pass, honestly flagged:** a multi-cluster (N=10+) before/after comparison under the new architecture (the single-cluster delta is solid, live evidence of the mechanism; a "50 registered, 2 active" number remains uncollected); feature-scoped (sub-cluster) activation, which could shrink the active footprint further; confirmation of whether Topology depends on this layer at all (still unconfirmed); failure-injection testing (panic/partial-failure during startup).

---

## 10d. ClusterGraphEngine (Blast Radius) Eager-Start — FIXED

Full record in `docs/INFORMER-LIFECYCLE-IMPLEMENTATION.md` ("Verification Pass" section). A second, independent eager-informer system was found during a verification pass over the already-shipped §10c work: `internal/graph/engine.go`'s `ClusterGraphEngine` (Blast Radius's own ~15-informer-type system, also opportunistically reused by Topology v2 and Fleet X-Ray) was started unconditionally for every reachable registered cluster ~5s after backend boot — live-measured at ~169 extra goroutines/cluster, regardless of whether anyone ever opened Blast Radius. A second, compounding defect: the eager goroutine wrote into the same map `rest.Handler` served requests from with no shared lock — an unsynchronized concurrent map read/write (a Go runtime fatal crash, not a recoverable panic). **Fixed** with a new `graph.EngineLifecycleManager` mirroring `ClusterLifecycleManager`'s proven per-entry-mutex/tombstone/centralized-sweep pattern. Race-tested, live-reproduced before (298→467 goroutines crossing the old 5s trigger) and after (flat at 298-299 through the same window; lazy activation on first real use reproduces the same ~168-goroutine cost at the *right* trigger instead).

## 10e. N=26 Goroutine Anomaly — Investigated, RESOLVED as Measurement/Shared-API-Server Artifact

Full record in `docs/ENGINE-LIFECYCLE-SOAK-INVESTIGATION.md`. A live N=26 test of the combined §10c/§10d lifecycle managers showed non-monotonic goroutine counts after idle-TTL sweeps (693 then 732), flagged as a potential new P1. A deterministic, fake-clientset, zero-real-network control (register→activate→sweep→re-sweep→remove, 3x repeated, `-race`-clean) converged to the exact pre-activation baseline every single time — ruling out a real leak in the lifecycle code itself. A denser live re-sample (24 points over 2 minutes against the real shared lab API server) showed a noisy but genuinely converging trend settling into a stable 481-490 band — the original 2-point check had simply caught ordinary noise mid-descent. **Not a leak.** A real, separate, smaller regression (the Blast Radius singleflight client-resolution coalescing had been silently dropped by the §10d refactor) was caught by this investigation's own full-suite `-race` rerun and fixed in the same pass.

## 10f. PipelineManager Global-Lock + Unbounded K8s I/O — FIXED (New P1)

Full record in `docs/PIPELINEMANAGER-LOCK-IO-INVESTIGATION.md`. While tracing LOADING-4, found `events.PipelineManager.StartCluster` held the ENTIRE manager's single mutex while calling `DetectClusterSize` against an unbounded `context.Background()` — a slow/unreachable cluster at connect/reconnect time could freeze `StartCluster`/`StopCluster`/`Health` for every OTHER registered cluster's event pipeline indefinitely. The same "one bad cluster poisons the fleet" class of bug already fixed for `ListClusters` (VALID-01) and `ClusterGraphEngine` (§10d), found in a third subsystem. **Fixed:** sizing now happens entirely outside the lock, bounded by a 15s timeout; the lock is held only for the fast, local, in-memory pipeline-map update. 4 new tests (including a typed-client cancellation-propagation proof — a `k8stesting.PrependReactor` cannot observe the caller's context at all, confirmed via client-go source), `-race` clean, live-validated.

## 10g. buildClusterSummary Unbounded ctx + LOADING-4 Broader Sweep — ONE GAP FIXED

Full records in `docs/BUILDCLUSTERSUMMARY-FANOUT-INVESTIGATION.md` and `docs/LOADING4-BOUNDED-IO-SWEEP.md`. §10a's bounded-concurrency fix (`errgroup.SetLimit`) was re-verified correct; a new, previously-undocumented gap was found and fixed: every one of `buildClusterSummary`'s ~26 List calls shared `ctx = r.Context()` with no internal deadline anywhere in the chain (`resilient.WrapClusterHandler` adds none either) — a genuinely hung resource-type call could block the whole summary forever, leaking a goroutine per poll for that cluster. Fixed with a dedicated 20s internal timeout. A systematic classification of all 27 `context.Background()` sites in the backend (Categories 1-5 per finite-one-shot/user-driven/long-lived-watch/background/intentional) found one more genuine gap — `discoveryMgr.Refresh`, unbounded at 3 call sites including the synchronous backend-startup path, exposed only in the Helm in-cluster deployment mode (`KubernetesSecretSource`) — fixed with a 15s bound. No blanket `rest.Config.Timeout` was introduced anywhere; the constraint against it (confirmed unsafe for shared watch/informer connections via client-go source) remains correctly honored.

## 10h. Topology Scale Campaign: PVC N+1, Concurrency Contention, and VALID-07 (V2 Force Refresh) — ALL FIXED

Full records in `docs/TOPOLOGY-SCALE-INVESTIGATION.md`, `docs/TOPOLOGY-CONCURRENCY-INVESTIGATION.md`, `docs/ENTERPRISE-PERFORMANCE-CAMPAIGN.md`. Three findings during the 2K-scale topology campaign:

1. **V1 topology's `inferStorageRelationships`** re-fetched each PVC/PV individually via live Get whenever a field was empty — but an unbound PVC legitimately has an empty `volumeName` forever, so this fired on every Pending PVC, every request, throttled by client-go's default limiter. 75 PVCs: the entire 16-19s V1 topology latency. **Fixed** — discovery now keeps data already fetched in bulk instead of discarding it. Live: 18.9s → 0.15-2.17s.
2. **Concurrent requests against one cluster degraded severely** (10 concurrent cold topology requests: 18.2s) — proven (not assumed) to be client-go's default `QPS=5`/`Burst=10` limiter, shared per-cluster-client across every concurrent caller, via a rigorous 13-step investigation (baseline matrix, direct build-count instrumentation, non-identical-request control, isolated QPS experiment before any production change). **Fixed** — raised to QPS=50/Burst=100 by default. Live: 18.2s → 3.1s, with the real API server's own CPU staying under 20% throughout, confirming this isn't simply shifting load it can't absorb (at this scale). Singleflight/request-coalescing remains explicitly **deferred (P2, documented)** — real, evidenced, but its cache-invalidation/cancellation semantics were traced, not fully resolved.
3. **VALID-07 (new P1, found and fixed):** `GetTopologyV2` — the actual default frontend Topology view — silently ignored `force_refresh=true` entirely; two consecutive forced requests returned byte-identical cached data. Directly overlaps the original customer complaint ("refresh repeatedly, nothing improves"), bounded by the 30s cache TTL (hence P1, not P0). **Fixed** — V2 now honors `force_refresh` matching V1's already-correct semantics. Live: two forced calls went from 31ms-then-23ms (both cached) to ~340ms-then-338ms (both genuine rebuilds). A same-class gap in two sibling handlers (`GetTopologyV2Traffic`, `GetCriticality`) was found but deliberately left unfixed this pass — explicitly flagged, not silently discovered-and-ignored.

A dense-namespace stress addition (1,200 pods, high fan-in/fan-out in one namespace) found no further density-specific bottleneck at this scale. All three fixes: regression-tested with explicit revert-and-reconfirm cycles, full backend `-race` suite green (52/52 packages), live-validated against the isolated lab, real environment re-verified untouched throughout every experiment.

## 10i. Phase 2F/2G — Cross-Cluster Isolation & Failure Resilience (GO for 5K, risks disclosed)

Full record in `docs/ENTERPRISE-PERFORMANCE-CAMPAIGN.md` "Phase 2F/2G" section. Live-tested (not assumed) against the isolated lab, with the explicit, disclosed methodology limitation that only one real API server was available (two logical cluster registrations against it, not two independent control planes):

- **Cache isolation:** PROVEN — one cluster's force-refresh does not invalidate or alter another's cached result (byte-identical before/after, confirmed via `cmp`).
- **Reconnect isolation:** PROVEN — reconnecting one cluster has zero measurable effect on another's latency.
- **Dead-cluster containment:** PROVEN — an unreachable cluster degrades to a bounded 404/disconnected state; the healthy cluster and Fleet overview remain fully functional throughout.
- **Slow/loaded-cluster isolation:** PASS WITH RISK — lightweight requests on cluster A were completely unaffected (1.5-13ms) while cluster B was under heavy self-inflicted concurrent load; A's own heavy (topology rebuild) request was ~1.5-2x slower during that window. Most plausibly explained by one shared real API server receiving ~230+ simultaneous requests (not a Kubilitics-side lock — confirmed by A's lightweight calls staying fast, and by the per-cluster QPS/Burst limiter being per-client-instance, not shared), but this lab's single-API-server limitation means it cannot be fully disambiguated from a genuine code-level coupling.
- **Short-window resource convergence:** PROVEN for 2 minutes post-load — goroutines and RSS both trended downward, no monotonic growth. A full 15-30 minute soak was not run.
- **Failure/timeout/partial-failure containment:** not independently re-tested against topology this pass; cited from already-proven evidence (buildClusterSummary, PipelineManager, VALID-04) rather than re-derived.

**5K GO/NO-GO: GO**, with the above gaps explicitly carried forward (not hidden) rather than resolved: the single-API-server ambiguity, the short soak window, and the absence of real network-latency injection testing. None constitute a known, confirmed defect — they are verification-depth gaps, distinguished explicitly from proven risks throughout this report's own evidence-classification convention.

## 10j. 5K-Pod Campaign — CONDITIONAL GO for 10K

Full record in `docs/ENTERPRISE-PERFORMANCE-CAMPAIGN.md` "PHASE 5K" section. Workload: 4,910 pods / 32 namespaces / 537 deployments / 482 services / 815 configmaps / 776 secrets / 140 PVCs / 75 ingresses, across 3 profiles (balanced, namespace-dense, relationship-dense). Backend, dashboard, resource lists, and topology all GREEN (Dashboard 17ms, cluster topology 0.72s cold/28ms warm, V1 topology correctly capped at 5,000 nodes with `isComplete=false` honestly reported). VALID-07's force-refresh fix re-confirmed holding at 5K scale.

**One surprising result, investigated per this report's own "do not explain away" discipline:** 10/20 concurrent forced topology rebuilds took 11.2s/23.5s (worse than 2K's post-fix 3.1s). Direct attribution test — a single raw `kubectl get pods -A` (zero Kubilitics code) took 2.87s at this scale, and 10 concurrent raw `kubectl` calls took 21.0s, nearly matching Kubilitics' own number — proved the dominant cause is this lab's single-node real API server capacity, not a Kubilitics regression (RSS/goroutines both confirmed to converge immediately after, ruling out a leak as an alternative explanation). Classified YELLOW, not P1: degraded but bounded, predictable, and correctly attributed rather than assumed.

**Explicitly not done this pass:** browser/frontend measurement (UNVERIFIED, no tooling), a full 30-60 minute soak (only 2 minutes run), Headlamp/Lens/Aptakube comparison (not started). **10K decision: CONDITIONAL GO** — no blocking P0/P1, but the concurrent-load attribution should be re-confirmed (not assumed) at 10K rather than carried forward as settled, since a larger workload could surface a genuine Kubilitics-side issue underneath the infrastructure-capacity noise currently dominating the signal.

## 11. Startup Analysis

Lab backend listener readiness: 56.8ms cold (matches STARTUP-1's expected behavior — listener binds without waiting for cluster connectivity). First `/summary` call against the full 2,084-pod cluster: 1.376s. Not separately measured: time-to-first-meaningful-frontend-paint, which depends on the unresolved §7 gap.

---

## 12. Lifecycle/Soak Analysis

**Not performed this session** — scoped out (100-iteration reconnect/switch/navigate soak tests, §15 of the originating mission brief, require substantially more session time than was available alongside building and safely tearing down the isolated lab itself). VALID-04's own regression suite (prior continuation) already covers repeated-reconnect lifecycle correctness at the unit-test level, which is related but not the same as a full soak test under this report's specific 2K-pod load.

---

## 13. Degraded-Mode / Chaos Testing

**Not performed this session** — explicitly scoped out. No deliberate API-latency injection, WebSocket disconnect, or partial-failure testing was done against the lab environment.

---

## 14. Headlamp Architectural Comparison

**Not performed this session.** This requires a dedicated, careful reading of the upstream Headlamp repository and its documented large-cluster engineering work (ResourceMap optimization, incremental WebSocket updates, graph simplification, etc.), cross-referenced against Kubilitics' own architecture — a substantial research effort in its own right, deserving its own focused pass rather than a rushed afterthought appended to this report. Deferred to `docs/HEADLAMP-SCALE-ENGINEERING-ANALYSIS.md`, not created this session.

---

## 15. Changes Implemented

**None.** Per explicit instruction: "For now, don't make another production-code change based on the 2K/300 observation." Confirmed via `git status` — zero production files modified by this phase.

---

## 16. Tests Added

**None** (no code changes were made to test).

---

## 17. Before/After Measurements

Not applicable — no changes were made. §4 contains the full "before" (current-state) measurement set.

---

## 18. Scale Matrix (actual, not projected)

| Tier | Target | Status | Evidence |
|---|---|---|---|
| S (100 pods) | Not run | UNVERIFIED | — |
| M (500 pods) | **Run** (591 actual) | **PASS, backend + frontend** | §4, §7, LIVE-REPRODUCED |
| ~1,000 pods | **Run** (1,105 actual) | **PASS, backend + frontend** | §4, §7, LIVE-REPRODUCED |
| **L (2,000 pods)** | **Run** (1,971 actual) | **PASS, backend + frontend** | §4, §7, LIVE-REPRODUCED |
| XL (5,000 pods) | Not run | UNVERIFIED | Host resource ceiling not yet tested at this tier |
| XXL (10,000 pods) | Not run | UNVERIFIED | Host resource ceiling not yet tested at this tier |
| Enterprise (20,000+) | Not run | UNVERIFIED | Likely requires infrastructure beyond this host's 16GB/4-CPU capacity even with the API-object-weight technique, given API-server/etcd's own scaling characteristics were not stress-tested |

---

## 19. VALID-05 — Found, Fixed, Regression-Tested, Live-Reproduced

Found during Phase H harness setup, not during deliberate security/correctness review — see full writeup in `docs/VALID-05-INVESTIGATION.md`. Summary: the Cluster Picker could not connect to any cluster registered via a non-default `KUBECONFIG` path, because `presence.RegisteredCluster` (the DTO behind `/api/v1/presence`, which the picker actually reads) had no `kubeconfig_path` field, so the click-to-connect flow always retried with a hardcoded `~/.kube/config` and 400'd. This affected real users with custom or merged `KUBECONFIG` setups — directly contradicting the product's own target persona (architects managing 100+ clusters).

**Now fixed.** Smallest-safe-fix, exactly as the data already existed elsewhere in the system (traced the full REGISTER→PERSIST→LOAD→LIST→PICKER→CONNECT lifecycle first, per instruction, before writing any code): 4 backend files, additive-only, zero frontend changes needed (the frontend was already correctly written to consume the field — it just never received a value). Full detail, file-by-file diff rationale, and the complete regression-test list are in `docs/VALID-05-INVESTIGATION.md` §8.

- **Tests:** 5 new/extended Go tests, revert-and-reconfirmed (manual revert, not `git checkout`, since the touched files had pre-existing unrelated uncommitted work that must not be discarded — confirmed the reverted state fails to compile on exactly the fields this fix adds).
- **Full regression:** `go build ./...` clean, `go vet ./...` clean, `go test ./... -race -count=1` — every package `ok`. VALID-02/VALID-04 regression suites explicitly re-run and passing.
- **Live reproduction:** a fresh, genuinely isolated kind cluster registered via a real non-default `KUBECONFIG` (no sandboxed-`HOME` workaround this time) connected on the first real-browser click — `POST /api/v1/clusters` now returns 201 (was 400), navigation reaches `/dashboard` with correct data. Real `~/.kube/config`/`kind-nightshift-dev` independently re-verified untouched throughout.

---

## 19a. Phase E (Namespace Drill-Down) — Found and Fixed a New P1: VALID-06

Phase E's objective was the worst-case namespace drill-down the prior session flagged as the single most important untested lead. A dedicated isolated lab cluster was built with a deliberately dense, single-namespace workload (`dense-ns`: 402 pods, 545 total resources — 41 Deployments, 5 StatefulSets, 2 DaemonSets, 3 Jobs, 5 CronJobs, Services/ConfigMaps/Secrets/ServiceAccounts/Ingress/RBAC per workload — Shape C, "dense production-like," not a flat identical-replica benchmark), alongside the cluster's pre-existing `default` namespace.

Attempting the actual drill-down (Topology → Namespace Filter → select `dense-ns`) surfaced a new, code-proven **P1**: **there was no working UI path in Topology to navigate into any namespace other than `default`** (or one incidentally cross-referenced from it). In short: the namespace picker's list was derived from the currently-loaded (already namespace-scoped) graph data rather than a real, unscoped namespace enumeration, and neither Cluster-view node clicks, topology search, nor the dedicated Namespaces resource page provided a working alternate route.

**This was a strong, independent candidate explanation for the original customer complaint**, orthogonal to scale: it reproduced identically on a 10-pod cluster where workloads live outside `default`, which is the normal case for a real enterprise cluster.

Per the explicit stop-on-new-P0/P1 rule, Phase E's scale matrix was paused while this was investigated and fixed. **Now fixed, test-proven, and live-reproduced** — see `docs/VALID-06-IMPLEMENTATION.md` for the full record. Summary: `useTopologyData.ts` now fetches the namespace list independently (reusing the existing `listResources("namespaces")` call the dedicated Namespaces page already relies on, explicitly `clusterId`-scoped rather than coupled to global active-cluster state), instead of deriving it from the currently-loaded graph. 2 frontend files changed, 6 new regression tests (14/14 passing in the file), full frontend suite green aside from the same 3 pre-existing unrelated failures, live pre/post evidence against the same isolated lab: the namespace popover went from showing only `default` to showing all 6 real namespaces, and selecting `dense-ns` correctly rendered its 94 resources with zero contamination from `default`.

Phase E's planned scale matrix (E2 ~1,000 / E3 ~2,000 / E4 ~3,000 / E5 ~5,000 tiers, Shape A/B/C variation, p50/p95/p99 capture) is now unblocked but **was not resumed in this increment** — this update focused on fixing VALID-06 per the explicit instruction to not resume the broader scale matrix until it was fixed and verified. The isolated lab and `dense-ns` workload remain available, not torn down, for the next increment.

---

## 20. Remaining Scope — Explicitly Not Done This Session

The following remain genuinely outstanding, listed honestly rather than implied as done:

1. **Namespace-drill-down stress test** — Phase H confirmed the Cluster/Full-Graph *default* view is well-behaved (namespace-collapsed, "3,576 resources hidden" shown honestly) at ~2,000 pods, but did **not** test the actual worst case the `MAX_VISIBLE_NODES`/ELK-grid guards exist for: a user expanding many/all namespace nodes simultaneously. This is the single most valuable next browser-side test.
2. **WebSocket-specific testing** (Phase 5 real-time dashboard updates, Phase 7 WS disconnect/reconnect) — blocked by a harness limitation (the Playwright proxy only covers HTTP), not attempted with a working WS proxy.
3. **Headlamp architectural study** (`docs/HEADLAMP-SCALE-ENGINEERING-ANALYSIS.md`) — not started.
4. **5K / 10K / 20K+ tiers** — not run; host resource ceiling for even the hybrid real/API-object-weight technique not yet established above ~2,000.
5. **Kubernetes API server-side metrics** (apiserver request latency/rate, etcd size/latency) — not scraped or analyzed.
6. **Backend pprof-based heap/CPU profiling** — not wired in (would itself be a production code change).
7. **Lifecycle/soak testing** (100× reconnect/switch/navigate cycles, or repeated Dashboard↔Topology navigation to check for a frontend memory leak across many navigations — §7's heap numbers are single-session, single-sample, not a soak test) — not run.
8. **Phase 7's full failure/degradation test suite** (slow API, failed request, API-server unavailability, request cancellation, browser refresh mid-load, rapid view switching, rapid cluster switching, backend restart during active session) — not run.
9. ~~VALID-05 fix~~ — **done** (§19). Removed from outstanding list.
10. **Fleet N+1 fix** — explicitly not attempted, per instruction, despite being quantified as P1 in a prior continuation.
11. **500/1,000-pod tiers re-measured with the corrected Cluster+Full-Graph-depth methodology** — only the ~1,971-pod tier was re-run after the depth-selector methodology bug was caught (§7, caveat 3); the lower tiers' Full-Graph numbers are UNVERIFIED (only their Overview-depth numbers exist).
12. **Architecture design phase** — cannot responsibly begin until items 1-2 above are closed; designing a topology re-architecture without full worst-case frontend evidence would be exactly the "optimization by assumption" the mission brief explicitly warns against.
13. **Performance regression gates / CI integration** — not started. Candidate *proposed* thresholds from what was actually measured (none yet enforced, none yet validated against a known-bad case): Dashboard useful-render < 1s up to ~2,000 pods (measured 594ms worst case); topology nav-to-visible < 5s at the same tier (measured 3.5s); JS heap growth < 50MB per Dashboard+Topology cycle (measured ~31MB, 60.3MB→91.7MB, noisy). These are observations from passing runs only, not derived from a known-failing case, and should not be treated as validated gates.
14. **`docs/PERFORMANCE-ARCHITECTURE.md`, `docs/PERFORMANCE-BENCHMARKS.md`, `docs/PERFORMANCE-REGRESSION-GATES.md`** — not created.

---

## 21. Final Acceptance Matrix

| Area | Workload | Result | Evidence | Remaining limitation |
|---|---|---|---|---|
| Backend Dashboard/summary | 2,084 pods, 300 deployments | PASS (1.38s cold) | LIVE-REPRODUCED | None identified at this tier |
| Backend Topology | 2,084 pods → 4,148 nodes/15,382 edges | PASS (2.1s cold, <100ms warm) | LIVE-REPRODUCED | Larger tiers (5K+) unverified |
| Backend resource lists | 2,084 pods | PASS (already capped/paginated) | LIVE-REPRODUCED | — |
| Backend concurrency | 5 simultaneous requests | PASS (446ms total) | LIVE-REPRODUCED | — |
| Backend memory/goroutines | Repeated + concurrent load | PASS (bounded growth) | LIVE-REPRODUCED | No pprof-level heap profile |
| Frontend Dashboard rendering, ~2K pods | 1,971 pods | **PASS** (594ms useful-render, correct data) | LIVE-REPRODUCED | Settle-time heuristic noisy (caveat 1, §7) |
| Frontend Topology rendering, ~2K pods, default view | 1,971 pods, Cluster+Full-Graph | **PASS** (3.5s nav-to-visible, no freeze, honest "3,576 hidden" disclosure) | LIVE-REPRODUCED | Worst-case (all-namespaces-expanded) not tested |
| Cytoscape/ELK layout cost in isolation | — | **UNVERIFIED** | Not separately instrumented (measured as part of total nav-to-visible only) | — |
| WebSocket real-time update behavior | — | **UNVERIFIED** | Harness proxy gap (§7 caveat 2) | — |
| 5K/10K/20K tiers | — | **UNVERIFIED** | Not attempted this session | Host capacity for real tiers above ~2K not yet established |
| Fleet N+1 | 50 synthetic clusters | **KNOWN, QUANTIFIED, NOT FIXED** | Prior continuation, cited not reproduced | P1, explicitly deferred |
| Cluster Picker connect flow (non-default KUBECONFIG) | — | **PASS (fixed)** | VALID-05, LIVE-REPRODUCED | Regression-tested, no known remaining risk |
| Headlamp comparison | — | **NOT STARTED** | — | — |

**Conclusion:** the backend is not the demonstrated bottleneck at the reported 2K/300 scale. The frontend's default Dashboard and Topology rendering paths are also not the demonstrated bottleneck at this scale — both render correct data quickly, and the Topology page's progressive-disclosure guards (namespace-collapsed Cluster view, `MAX_VISIBLE_NODES` cap) visibly work as designed rather than freezing. VALID-05, which independently blocked a realistic class of real users from connecting to their cluster at all regardless of scale, is now fixed and live-reproduced. **The actual cause of the originally reported customer failure remains unproven.** The most promising unexplored leads are: (1) the namespace-drill-down worst case never tested this session, (2) WebSocket/real-time update behavior, entirely untested due to a harness gap, and (3) the possibility that the real customer's cluster has a denser relationship graph (more cross-namespace edges, more distinct resource kinds) than this session's synthetic reproduction, which was optimized for object *count* rather than relationship *density*.

## 22. 10K Campaign — P1 Found, Root-Caused, and Remediated: Resource-List Pagination N+1

Full detail in `docs/RESOURCE-LIST-PAGINATION-N1-INVESTIGATION.md` and
`docs/ENTERPRISE-PERFORMANCE-CAMPAIGN.md` §PHASE 10K. Summary for this report's
running scorecard:

**Finding**: at 10,792 pods, `GET /clusters/{id}/resources/{kind}` (the
highest-traffic resource-list endpoint — every resource list page, hover-prefetch,
cluster-watcher background poll) converted and sorted the *entire* informer-cached
collection on every request regardless of the requested `limit`. At N=20
concurrency this produced 63–80% request failure rates (vs. zero failures for the
equivalent raw-kubectl concurrency control at the same N) and up to 759x more
latency than necessary — a genuine Kubilitics-side CPU/GC-bound scaling defect, not
inherited lab-infrastructure pressure.

**Root cause**: `ListFromCacheWithPagination`/`ListFromCache`
(`internal/k8s/informer.go`) ran `runtime.DefaultUnstructuredConverter.ToUnstructured`
(reflection-heavy) and a full sort over every cached object before applying
offset/limit — an O(total-cluster-size) cost on every request, independent of page
size. Confirmed systemic across the resource-list architecture (affects all
registered resource kinds, 3 independent call sites), not isolated to Pods.

**Fix**: typed-object fast path for the 3 most common sort keys (`name` — the
default, `namespace`, `creationTimestamp`) — filter+sort on `metav1.Object`
accessors (no conversion), convert only the returned page. The 7
exotic/computed-field sort keys are unchanged (same cost as before, not regressed).

**Evidence**: `go test -race ./...` — 0 failures, 0 data races, full backend. 12 new
regression tests (exact-ordering match against independently-computed expected
order, first/later/empty page, concurrent no-race, cluster isolation, exotic-key
slow-path preserved). All named Phase-8 regression suites (VALID-02/04/07,
CONTAM-1, Hybrid Informer Lifecycle, EngineLifecycleManager/Blast Radius, Fleet
N+1, PipelineManager, topology scale/concurrency, buildClusterSummary) green.

**Status**: **FIXED, LIVE-REPRODUCED, REGRESSION-TESTED.** 759x latency / 337x CPU
improvement at `limit=100`×N=20; concurrent-request failures eliminated (63–80% →
0%) at both `limit=100` and `limit=5000`. Remaining limitation: the GC-pressure
explanation for the pre-fix concurrency amplification is strongly evidenced
(heap-delta data, single-request-cost arithmetic) but not independently proven via
a live GC trace captured mid-burst, due to a lab-tooling mechanical failure, not a
backend defect.
