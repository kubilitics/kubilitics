# VALID-06 — Topology Has No Working UI Path to Navigate Into Any Namespace Other Than "default"

**Status: FIXED, TEST-PROVEN, LIVE-REPRODUCED (pre- and post-fix). See `docs/VALID-06-IMPLEMENTATION.md` for the full implementation record.**

**Severity: P1** — blocks the primary, everyday interaction this entire Phase E effort was commissioned to test (namespace drill-down) for any cluster where the resources a user actually cares about are not in the `default` namespace and are not incidentally cross-referenced from it. This is not an edge case: `default` is rarely where real production workloads live in a properly namespaced enterprise cluster.

---

## 1. How it was found

While building the Phase E harness to drill into a deliberately dense, single-namespace workload (`dense-ns`, 402 pods / 545 total resources, in a cluster that also has a `default` namespace), the obvious approach — navigate to Topology, open the Namespace Filter, select `dense-ns` — failed. Two independent causes were found and ruled out in order before reaching the real one:

1. **First suspected cause (test-harness bug, confirmed and fixed):** driving the namespace switch via `page.goto('/topology?ns=dense-ns')` is a full page reload. `clusterPresenceStore` has no `persist` middleware (confirmed by reading `src/stores/clusterPresenceStore.ts` — no `persist()` wrapper, unlike other Zustand stores in this codebase), so a hard reload drops the active-cluster selection entirely, and `TopologyPage.tsx`'s own "reset filters when cluster changes" `useEffect` (triggered when `clusterId` re-resolves from scratch) clobbers the URL-supplied `ns` param back to `default`. Confirmed via screenshot: the namespace chip stayed on "default" throughout. **Fixed in the test harness** by driving the real in-page Namespace Filter popover (client-side state change) instead of a URL reload.
2. **The real, product-level cause (this finding):** once routed through the actual popover UI, `dense-ns` simply **does not appear in the list** — the "User Namespaces" section shows only `default`.

## 2. Root cause (CODE-PROVEN)

`kubilitics-frontend/src/topology/hooks/useTopologyData.ts:220-228`:

```ts
// Extract ALL namespaces from unfiltered graph (for the namespace picker)
const allNamespaces = useMemo<string[]>(() => {
  if (!graph?.nodes) return [];
  const nsSet = new Set<string>();
  for (const n of graph.nodes) {
    if (n.namespace) nsSet.add(n.namespace);
  }
  return Array.from(nsSet).sort();
}, [graph]);
```

Despite the comment claiming this extracts namespaces from the "unfiltered" graph, `graph` here is the **already-namespace-scoped** result of `useClusterTopology` (lines 213-218), which — per the file's own earlier comment block (lines ~208-211) — passes a single `backendNamespace` to the backend whenever exactly one namespace is selected. Since `TopologyPage.tsx:181` resets `selectedNamespaces` to `Set(["default"])` on every cluster change, and that's also the initial state, `graph` on first load (and after any reset) contains **only `default`-namespace nodes** (plus whatever those nodes happen to cross-reference). `allNamespaces` — the data source for the picker's "User Namespaces" list — is therefore a subset of what's already loaded, not the cluster's actual full namespace list, even though the UI (a filter/picker control, labeled to imply full namespace enumeration) strongly implies otherwise.

This is compounded by two further, independently-confirmed dead ends:
- **Cluster view provides no drill-down-into-a-specific-namespace action.** `TopologyCanvas.tsx:544-551`: single-click (`onNodeClick`) only selects a node for the detail panel; double-click (`onNodeDoubleClick`) calls `onNodeExpand`, which (`TopologyPage.tsx:286-288`) only does `setDepth(prev => min(prev+1, 3))` — a *global* depth increase across all namespaces, not a namespace-specific scope change. Clicking a namespace box in Cluster view does not scope into it.
- **`TopologyDetailPanel.tsx`** has no "View in Namespace mode" / "Drill into this namespace" action when a Namespace-kind node is selected (confirmed via grep — no such action exists).
- **Topology's own in-page search (`useTopologySearch`) is scoped to already-loaded nodes** (`useTopologySearch.ts:17-30`, filters over the `nodes` parameter passed in from the page, which is the same already-namespace-scoped `topology?.nodes`) — it cannot find or jump to a resource in an unloaded namespace.
- **The dedicated Namespaces resource-list page (`src/pages/Namespaces.tsx:562-565`) offers "View Details" / "View Resources" (pods list) / "Download YAML" — no "View Topology" action.**

**Net effect: there is no UI path anywhere in the product, starting from a cold Topology page, that lets a user navigate to a specific namespace's resource graph unless that namespace happens to already be `default` or is incidentally cross-referenced from whatever is currently loaded.**

## 3. Exact reproduction

1. Have a cluster with at least two namespaces, where the namespace of interest (e.g., `dense-ns`, holding real production-scale workloads) is not `default` and has no resources that reference anything in `default`.
2. Open Topology. Lands on Namespace view, scoped to `default`.
3. Open the Namespace Filter popover (the chip showing "default", top toolbar).
4. **Observed:** "User Namespaces" section lists only `default`. `dense-ns` is absent, with no indication that it exists, no search/filter-by-name option in the popover itself, and no error or truncation message explaining why.
5. Switching to Cluster view shows `dense-ns` as a namespace-level box (confirmed in the prior Enterprise Scale session) — but clicking or double-clicking it does not scope Topology into that namespace; it only changes the global depth level.

## 4. Why existing phases didn't catch it

Every prior Topology measurement in this engagement (original Enterprise Scale report, Phase H) used synthetic workloads spread across 10 near-identically-named namespaces (`lab-ns-1`..`lab-ns-10`) that were all populated *before* the first Topology visit and exercised primarily through Cluster view (which does show all namespace boxes, just without a working drill-down). Phase E is the first test to use a single, deliberately isolated dense namespace and to specifically attempt the Namespace-view drill-down path — which is exactly the interaction the original customer complaint ("topology never loading," implicitly for *their* namespace, not necessarily `default`) would most plausibly exercise.

## 5. Customer impact

Any user whose cluster's interesting/large workloads live outside `default` — i.e., nearly every real enterprise Kubernetes cluster, where `default` is conventionally left mostly empty — opens Topology, sees an empty or near-empty `default`-scoped graph, opens the namespace filter expecting to find and select their actual namespace, and finds **only `default` listed**, with no visible way to proceed. This plausibly explains a meaningful share of "topology never loading" / "topology is empty or useless" style complaints independent of cluster scale — a 10-pod cluster with workloads in `production` instead of `default` would hit this identically to a 2,000-pod one.

## 6. Candidate fix (NOT implemented — for approval)

The namespace *list* needs its own, unscoped source of truth, independent of the currently-loaded (possibly narrowly-scoped) graph. The backend already has this data — namespace listing is a basic, cheap, already-implemented capability elsewhere in the product (`src/pages/Namespaces.tsx` clearly gets a full namespace list from somewhere; `Dashboard`'s Cluster Capacity widget shows total namespace count). The smallest-safe-fix is almost certainly: have `useTopologyData` (or `TopologyPage`) fetch the full namespace list from that existing, already-available, unscoped source — not derive it from the currently-fetched, possibly-single-namespace-scoped `graph.nodes` — and use that for the picker's "User Namespaces"/"System Namespaces" lists, while leaving the actual topology data-fetching scoping logic (`backendNamespace`) untouched. This needs a precise trace of where `src/pages/Namespaces.tsx` and the Dashboard's namespace count actually source their data from, which was not done in this session (stopped per the audit-path rule before pursuing implementation).

**Implemented** — see `docs/VALID-06-IMPLEMENTATION.md`. The fix matched this candidate exactly: `useTopologyData` now fetches the namespace list independently via the same `listResources("namespaces")` call `src/pages/Namespaces.tsx` already uses, explicitly `clusterId`-scoped (not the implicit global store `useK8sResourceList` would have used — a subtlety caught during implementation, see the implementation doc §2).

## 7. Scope of Phase E given this finding

Per the explicit stop rule ("STOP the current audit path... do not continue unrelated investigation"), the remainder of Phase E's originally planned scale matrix (E2/E3/E4/E5 tiers, Shape A/B/C variations, p50/p95/p99 capture) was **not** attempted in the session that found this. It would not have produced trustworthy evidence about namespace-scoped drill-down behavior at scale while the only entry point into that view was broken for any non-`default` namespace. **Now that VALID-06 is fixed, Phase E's scale matrix is unblocked** — see `docs/ENTERPRISE-SCALE-RELIABILITY-REPORT.md` for current status.
