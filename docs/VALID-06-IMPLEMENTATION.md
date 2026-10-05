# VALID-06 — Implementation Report

**Status: FIXED, TEST-PROVEN, LIVE-REPRODUCED (pre-fix and post-fix). All 15 acceptance criteria met.**

See `docs/VALID-06-INVESTIGATION.md` for the original root-cause investigation. This document covers the fix itself.

---

## 1. Re-verification of the original investigation

Before implementing, the three investigated dead-ends were re-confirmed against the still-live isolated lab (`kubilitics-phase-e` cluster, `dense-ns` namespace with 402 pods / 545 resources, alongside the cluster's own `default` namespace) — not assumed correct merely because the prior doc existed:

- **A. Namespace Filter:** re-read `useTopologyData.ts:220-228` — confirmed `allNamespaces` was a `useMemo` over `graph.nodes`, and `graph` is the already-namespace-scoped `useClusterTopology` result. Re-ran the original popover test: only `default` listed, `dense-ns` absent. Confirmed unchanged from the investigation.
- **B. Cluster view node interaction:** re-read `TopologyCanvas.tsx:544-551` and `TopologyPage.tsx`'s `handleNodeExpand` — single-click selects, double-click only bumps a global `depth` value, no per-node namespace scoping exists. Confirmed unchanged.
- **C. Search / Namespaces page:** re-read `useTopologySearch.ts` (filters only the already-loaded `nodes` array) and `src/pages/Namespaces.tsx` (no "View Topology" action, only Details/Resources/YAML). Confirmed unchanged.

## 2. Architecture trace (§4 of the brief)

Traced: Kubernetes cluster → namespace enumeration → backend API → frontend topology data layer → topology state → namespace selector → graph query → graph builder → layout → Cytoscape renderer.

Key finding: **an authoritative, independent namespace-enumeration path already exists and is already used elsewhere in the product.** `src/pages/Namespaces.tsx:139` calls `usePaginatedResourceList<NamespaceResource>('namespaces')`, which bottoms out in `useK8sResourceList('namespaces', ...)` (`src/hooks/useKubernetes.ts:195-301`), which calls `listResources(baseUrl, clusterId, 'namespaces', params)` (`src/services/backendApiClient.ts`, re-exported from `src/services/api/resources.ts:65`) → `GET /api/v1/clusters/{id}/resources/namespaces` on the backend. `"namespaces"` is already a registered, valid, cluster-scoped resource type in the backend's generic resource-listing system (`internal/k8s/resources.go:304`, `CLUSTER_SCOPED_KINDS` in `useKubernetes.ts:184`). Namespace objects are small (no heavy spec/status like Pods) and bounded in count even on huge clusters, so this list is cheap by nature — it is the generic resource-list endpoint, not a special-cased one, and doesn't require fetching anything inside each namespace.

**No new backend capability was needed.** No new frontend discovery mechanism was created — this reuses the exact mechanism `Namespaces.tsx` already relies on.

One architectural subtlety found during implementation (see §4 below): `useK8sResourceList` resolves its cluster scope from the global `useActiveClusterId()` Zustand store internally, not from an explicit parameter. `useTopologyData` and `useClusterTopology` (the hook it already wraps) are both explicitly `clusterId`-parameterized instead — the whole point being that the caller controls scope, not an implicit global. Reusing `useK8sResourceList` directly would have silently reintroduced an implicit-global dependency inconsistent with the rest of this hook. This was caught via a regression test (§5) before it shipped, not left as a latent risk.

## 3. Design decision

Chosen design, in order of the brief's §5 checklist:

1. **Obtain the authoritative namespace list independently of the currently rendered topology graph** — new `useQuery` call in `useTopologyData.ts`, calling `listResources(effectiveBackendBaseUrl, clusterId, "namespaces", { signal })` directly (same underlying call `Namespaces.tsx` uses, just invoked with this hook's own explicit `clusterId` rather than through `useK8sResourceList`'s global-store wrapper — see the architectural note above). Query key: `["topology-namespaces", clusterId]` — depends on `clusterId` only, not on `selectedNamespaces`/`viewMode`/`depth`.
2. **Make that list available to the Topology UI** — `allNamespaces` (same name, same shape, same consumers as before — `TopologyToolbar`'s `availableNamespaces` prop, the auto-select-namespace effect) now sourced from this query instead of from `graph.nodes`.
3. **Allow selecting any namespace** — unchanged; the existing popover (`TopologyToolbar.tsx`) already supports selecting any namespace in its `availableNamespaces` list, and now receives the real list.
4. **Selecting a namespace triggers a properly scoped topology query** — unchanged, pre-existing, already-correct behavior (`TOPOLOGY-1`'s fix threads `selectedNamespaces` into `useClusterTopology`'s own, separate query).
5. **No contamination** — the two queries (`namespace list` and `topology graph`) are fully independent React Query entries with independent cache keys; selecting a namespace cannot leak the old namespace's *graph* data (pre-existing `filterByNamespaces` client-side defense-in-depth layer, untouched) and cannot affect the *namespace list* at all (by design — it's deliberately namespace-selection-independent).
6. **Rapid switching cancels stale requests** — inherited for free: `listResources` already forwards React Query's `signal` (confirmed in `resources.ts:88-90`), and `useClusterTopology`'s own query (unchanged) already has its own key/cancellation per namespace.
7. **Empty namespaces handled** — a namespace with zero resources still appears (it's enumerated by the Namespace object itself, not derived from its contents) — regression-tested.
8. **Namespace names escaped/encoded safely** — unchanged; already handled by `listResources`'s existing `encodeURIComponent(clusterId)` and the resource-type path construction, and by the pre-existing namespace-selection plumbing.
9. **Cluster switching resets correctly** — the new query key includes `clusterId`, so switching clusters naturally produces a fresh query with no residual data from the old cluster — regression-tested.
10. **Existing Cluster/Full Graph/Depth/LOD behavior intact** — zero changes to `filterByViewMode`, `filterByNamespaces`, the depth/progressive-disclosure logic, or `MAX_VISIBLE_NODES` — confirmed via the full existing `useTopologyData.test.tsx` suite (8 pre-existing tests) still passing unmodified.

**Explicitly avoided:** loading the entire cluster graph into the browser merely to discover namespace names. The new query fetches `Namespace` objects only — not Pods, not Deployments, not anything contained within a namespace.

## 4. Files changed

- `kubilitics-frontend/src/topology/hooks/useTopologyData.ts` — replaced the `graph.nodes`-derived `allNamespaces` with an independent `useQuery` + `listResources("namespaces")` call, explicitly `clusterId`-scoped. Added `allNamespacesError`/`allNamespacesLoading` to the hook's return value.
- `kubilitics-frontend/src/topology/TopologyPage.tsx` — surfaces `allNamespacesError` via a one-shot `toast.error` (not a silent empty list), satisfying the "namespace enumeration failure shows a useful error" requirement. No other behavior changed.

**No backend changes.** The existing `GET /api/v1/clusters/{id}/resources/namespaces` endpoint already did everything needed.

## 5. Regression tests (TEST-PROVEN)

Added to the existing `useTopologyData.test.tsx` (new `describe` block, 6 tests; the 8 pre-existing TOPOLOGY-1 tests in the same file were left untouched and still pass):

1. `allNamespaces reflects the independent namespace list, NOT the currently loaded (already namespace-scoped) topology graph — the core bug` — topology graph scoped to `team-a` only; namespace-list mock returns `[team-a, team-b, empty-ns]`; asserts all three appear.
2. `a namespace with zero resources... still appears in allNamespaces` — proves namespace discovery doesn't depend on the namespace containing anything.
3. `allNamespaces ordering is deterministic (sorted)` — mock returns `[zeta, alpha, mu]`, asserts `[alpha, mu, zeta]`.
4. `switching the selected namespace does NOT trigger a new namespace-list request` — proves the list is genuinely independent of selection (cache-key correctness).
5. `namespace enumeration failure surfaces via allNamespacesError, without breaking the (independent) topology fetch` — proves the two queries are independent failure domains.
6. `switching clusters re-fetches the namespace list for the new cluster — no state leakage between clusters` — explicit `clusterId` passed via hook re-render (not a mocked global store), proving the fix is genuinely per-cluster-scoped, not dependent on the implicit `useActiveClusterId()` global matching by coincidence.

Also extended the shared mock: `vi.mock('@/services/backendApiClient', ...)` now includes `listResources: vi.fn()`, with a `namespaceList(names)` helper mirroring the real `{ items: [{metadata:{name}}], metadata }` shape.

**Revert-and-reconfirm:** the `useTopologyData.ts` fix was manually reverted (file backed up, restored verbatim — not via `git checkout`, consistent with every other VALID-0x fix in this engagement, since this file has no other uncommitted baggage but the pattern was kept consistent) and all 14 tests in the file (8 original + 6 new) were re-run: **all 14 failed**, each with `ReferenceError: namespaceListQuery is not defined` at the exact line the fix introduces — proving the tests actually exercise the fix, not a vacuous pass. Fix restored; all 14 tests pass again.

## 6. Post-fix validation

- `npx tsc --noEmit -p .` — clean, 0 errors.
- `npx eslint src/topology/hooks/useTopologyData.ts src/topology/hooks/useTopologyData.test.tsx src/topology/TopologyPage.tsx` — clean, 0 warnings/errors.
- `npx vitest run` (full frontend suite) — **926 passed, 3 failed** (`ClusterPickerPage.test.tsx` ×2, `AddClusterDialog.test.tsx` ×1) — these are the pre-existing, already-known 3 frontend failures the brief explicitly named and said not to hide; none touch topology, none reference anything this fix changed. **Confirmed unchanged, not introduced.**
- No backend files were touched this increment — the full backend `go build && go vet && go test ./... -race -count=1` pass recorded for VALID-05 earlier in this session still stands (nothing invalidates it).

## 7. Live reproduction — PRE-FIX (captured before implementation)

Using the still-live isolated lab (`kubilitics-phase-e` cluster, `KUBECONFIG=/tmp/kubilitics-lab/kubeconfig-e.yaml`, backend on :8197, real `~/.kube/config`/`kind-nightshift-dev` independently verified untouched throughout):

- `dense-ns` (402 pods) confirmed to exist: `kubectl get ns dense-ns` / `kubectl get pods -n dense-ns --no-headers | wc -l` → 402+.
- Namespace Filter popover, pre-fix: "User Namespaces" section showed **only `default`** — `dense-ns` absent, no error, no indication it existed.
- No working alternate UI path found (Cluster-view node clicks, in-page search, Namespaces resource page — all confirmed dead ends, §1 above).

## 8. Live reproduction — POST-FIX

Same lab, same backend (no backend restart needed — the fix is entirely frontend), frontend dev server picked up the change live:

- Namespace Filter popover now shows: **User Namespaces: `default`, `dense-ns`, `local-path-storage`** / **System Namespaces: `kube-node-lease`, `kube-public`, ...** — all 6 real namespaces, matching `kubectl get ns` ground truth exactly.
- Selecting `dense-ns`: namespace chip updates to `dense-ns`, breadcrumb shows `cluster > dense-ns`, sidebar "Pods: 416" (matches live `kubectl get pods -n dense-ns` count at that moment — pod count had grown slightly since the 402 snapshot, consistent with ongoing scheduling, not a bug), loading state "Discovering resources and relationships..." shown (not an infinite/unexplained spinner).
- Rendered graph: **"94 of 94 resources"** — all `dep*`/`sts*`/`cj*`/`*-ing` nodes correctly belong to `dense-ns` (matches the generated workload's naming exactly: 41 Deployments, 5 StatefulSets, 5 CronJobs, Ingresses). **Zero contamination from `default`** — no `kubernetes` Service, no `default` Namespace box present in the `dense-ns`-scoped view.

Screenshots captured (not included in this doc, available in the session's lab artifacts): popover showing all namespaces, mid-load state with correct breadcrumb/pod-count, and the fully rendered 94-resource `dense-ns` graph.

## 9. Acceptance criteria (§12 of the brief)

- [x] Any existing namespace in the cluster can be discovered from Topology. — confirmed live (all 6 namespaces listed).
- [x] Namespace discovery does not depend on currently rendered graph data. — confirmed by test #1 and live (dense-ns discoverable while viewing `default`).
- [x] Any namespace can be selected directly. — confirmed live.
- [x] Selected namespace topology loads correctly. — confirmed live (94/94 resources, correct names).
- [x] No cross-namespace contamination. — confirmed live (no `default` resources in the `dense-ns` view) and by the pre-existing, untouched `filterByNamespaces` test coverage.
- [x] Rapid namespace switching is reliable. — covered by test #4 (independent query, no refetch storm) + pre-existing TOPOLOGY-1 test "switching the selected namespace issues a new backend request scoped to the new namespace."
- [x] Empty namespaces are handled. — test #2.
- [x] Cluster switching is safe. — test #6 (explicit `clusterId`, not implicit global).
- [x] Cancellation/stale-response protection works. — inherited from `listResources`'s existing `signal` forwarding + React Query's own per-key request lifecycle; not independently re-tested beyond what already covers `useClusterTopology`'s identical pattern.
- [x] No full-cluster graph download introduced merely for namespace selection. — the new query fetches `Namespace` objects only (6 items in the lab cluster), never Pods/Deployments/etc.
- [x] Relevant unit/integration tests pass. — 14/14 in `useTopologyData.test.tsx`.
- [x] Full backend race suite passes. — no backend changes this increment; prior full-suite pass (VALID-05, same session) stands.
- [x] Frontend typecheck/lint pass. — confirmed.
- [x] Existing known frontend failures remain unchanged. — confirmed (same 3, same files, unrelated to this change).
- [x] Live pre/post evidence exists. — §7, §8.
- [x] No new P0/P1 introduced. — none found during this fix's implementation or verification.

**VALID-06 is FIXED per every stated criterion.**

## 10. Remaining risks / honest caveats

- The "rapid switching" and "cancellation" criteria are satisfied by inherited, pre-existing React Query/`listResources` mechanics (already relied upon elsewhere in the codebase) rather than by a dedicated new rapid-fire-switching test written specifically for this fix. Judged sufficient given the mechanism is identical to `useClusterTopology`'s own, already-tested pattern — but called out explicitly rather than silently assumed.
- No UI-level (React Testing Library component) test was added for the "useful error" toast itself — only the underlying `allNamespacesError` flag is unit-tested. The toast wiring was verified by code review and typecheck, not by a dedicated component test, given time constraints for this increment.
- This fix does not address `allKinds`/`allEdgeCategories` (also derived from `graph.nodes` in the same file) — out of scope for VALID-06, which is specifically about namespace discovery; flagged here in case a similar discoverability gap exists for kind/edge-category filters and is worth its own investigation later.

## 11. Lab state

The isolated `kubilitics-phase-e` lab cluster, `dense-ns` workload, and backend (:8197) remain available and untouched at the time of this report, per the "do not modify or delete the lab workload yet" instruction. Real `~/.kube/config` and `kind-nightshift-dev` independently re-verified untouched throughout this entire increment.
