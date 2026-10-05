/**
 * useTopologyData — Bridges the existing useClusterTopology hook to v2 TopologyResponse format.
 *
 * Provides progressive disclosure via depth levels:
 * - L0 (Overview): Namespaces, Nodes, top-level workloads, Services, Ingress (~10-20 nodes)
 * - L1 (Workloads): + ReplicaSets, Endpoints, PVCs, ServiceAccounts
 * - L2 (Configuration): + ConfigMaps, Secrets, PVs, RBAC resources
 * - L3 (Full Graph): Everything — no filtering
 *
 * Plus existing filtering layers:
 * 1. View mode filtering (Cluster/Namespace/Workload/Resource/RBAC)
 * 2. Namespace selection (filter to specific namespaces)
 * 3. Client-side node cap (MAX_VISIBLE_NODES) to prevent UI freeze
 *
 * Also extracts the full namespace list from the unfiltered data
 * so the namespace picker always has the complete set.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useClusterTopology } from "@/hooks/useClusterTopology";
import { listResources } from "@/services/backendApiClient";
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from "@/stores/backendConfigStore";
import { transformGraph } from "../utils/transformGraph";
import type { TopologyResponse, TopologyNode, TopologyEdge, ViewMode } from "../types/topology";

/** Depth levels for progressive disclosure */
export type DepthLevel = 0 | 1 | 2 | 3;

export const DEPTH_LABELS: Record<DepthLevel, { label: string; description: string }> = {
  0: { label: "Overview", description: "Top-level resources" },
  1: { label: "Workloads", description: "Workload internals" },
  2: { label: "Configuration", description: "Config & RBAC" },
  3: { label: "Full Graph", description: "All resources" },
};

/**
 * Maximum nodes rendered on the canvas before truncation kicks in.
 *
 * TOPOLOGY-3 (docs/PRODUCTION-RELIABILITY-AUDIT.md): this comment previously
 * claimed "backend pod aggregation (>3 pods collapse to 1 node) keeps real
 * node counts well below this limit." That aggregation exists only in the
 * separate V2 topology engine (internal/topology/v2/builder/pod_aggregation.go,
 * used by the Blast Radius tab) — the V1 engine this page actually calls
 * (internal/topology/engine.go, via useClusterTopology/getTopology) has no
 * pod aggregation at all. Porting it would require extending V1's
 * TopologyNode schema (it has no Category/Group/Layer/Extra fields V2's
 * aggregation needs) — a larger, riskier change than this fix calls for, and
 * explicitly left optional by the roadmap ("port... OR migrate... and
 * correct the misleading comment either way").
 *
 * The real backstops for a high-pod-count namespace/cluster are: (1)
 * TOPOLOGY-1's namespace-scoping fix, which now bounds backend discovery to
 * the selected namespace instead of the whole cluster for the common
 * single-namespace case, and (2) this MAX_VISIBLE_NODES truncation itself —
 * ELK's hybrid layout switches to a fast category-grid layout above 300
 * nodes and this cap hard-truncates the rendered set above 1000, so a
 * namespace with many replicas still won't freeze the UI, it will just show
 * a truncated/capped view (see the wasTruncated/totalBeforeCap metadata this
 * hook already returns).
 */
export const MAX_VISIBLE_NODES = 1000;

export interface UseTopologyDataParams {
  clusterId: string | null;
  viewMode?: ViewMode;
  depth?: DepthLevel;
  selectedNamespaces?: Set<string>;
  selectedKinds?: Set<string>;
  hiddenEdgeCategories?: Set<string>;
  resource?: string;
  enabled?: boolean;
}

/** Kinds visible per view mode */
const VIEW_MODE_KINDS: Record<ViewMode, string[] | null> = {
  namespace: null, // Show all namespace-scoped + connected cluster-scoped (smart filter below)
  cluster: [
    "Node", "Namespace", "PersistentVolume", "StorageClass",
    "IngressClass", "PriorityClass", "RuntimeClass",
    "MutatingWebhookConfiguration", "ValidatingWebhookConfiguration",
    "ResourceQuota", "LimitRange",
  ],
  rbac: [
    "ServiceAccount", "Role", "ClusterRole",
    "RoleBinding", "ClusterRoleBinding",
    "Namespace",
  ],
  traffic: [
    "Service", "Ingress", "Pod", "Endpoints", "EndpointSlice",
    "Node", "Namespace",
  ],
  resource: null, // Resource view (per-resource detail tab) — show all via BFS
};

/** Category-based filtering as fallback */
const VIEW_MODE_CATEGORIES: Record<ViewMode, string[] | null> = {
  namespace: null,
  cluster: ["scheduling", "storage"],
  rbac: ["security"],
  traffic: ["networking"],
  resource: null,
};

function filterByViewMode(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  viewMode: ViewMode
): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const allowedKinds = VIEW_MODE_KINDS[viewMode];
  const allowedCategories = VIEW_MODE_CATEGORIES[viewMode];

  if (!allowedKinds && !allowedCategories) {
    return { nodes, edges };
  }

  const filteredNodes = nodes.filter((n) => {
    if (allowedKinds && allowedKinds.includes(n.kind)) return true;
    if (allowedCategories && allowedCategories.includes(n.category)) return true;
    return false;
  });

  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  return { nodes: filteredNodes, edges: filteredEdges };
}

/**
 * Smart namespace filter — two-pass algorithm:
 * Pass 1: Keep all namespace-scoped resources in selected namespaces
 * Pass 2: Keep cluster-scoped resources ONLY if they have an edge to a Pass 1 node
 * This prevents dumping all ClusterRoles into namespace view while keeping
 * Nodes/PVs that are actually connected to namespace resources.
 */
function filterByNamespaces(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  selectedNamespaces: Set<string>
): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  if (selectedNamespaces.size === 0) return { nodes, edges };

  // Pass 1: Keep namespace-scoped resources in selected namespaces
  const namespacedNodeIds = new Set<string>();
  const namespacedNodes: TopologyNode[] = [];
  const clusterScopedNodes: TopologyNode[] = [];

  for (const n of nodes) {
    if (n.namespace) {
      if (selectedNamespaces.has(n.namespace)) {
        namespacedNodes.push(n);
        namespacedNodeIds.add(n.id);
      }
    } else {
      clusterScopedNodes.push(n);
    }
  }

  // Pass 2: Keep cluster-scoped nodes ONLY if they have an edge to a namespace-scoped node
  const connectedClusterNodeIds = new Set<string>();
  for (const e of edges) {
    if (namespacedNodeIds.has(e.source) && !namespacedNodeIds.has(e.target)) {
      connectedClusterNodeIds.add(e.target);
    }
    if (namespacedNodeIds.has(e.target) && !namespacedNodeIds.has(e.source)) {
      connectedClusterNodeIds.add(e.source);
    }
  }

  const connectedClusterNodes = clusterScopedNodes.filter((n) => connectedClusterNodeIds.has(n.id));
  const finalNodes = [...namespacedNodes, ...connectedClusterNodes];
  const finalNodeIds = new Set(finalNodes.map((n) => n.id));
  const finalEdges = edges.filter(
    (e) => finalNodeIds.has(e.source) && finalNodeIds.has(e.target)
  );

  return { nodes: finalNodes, edges: finalEdges };
}

export function useTopologyData({
  clusterId,
  viewMode = "namespace",
  depth = 0,
  selectedNamespaces = new Set(),
  selectedKinds = new Set(),
  hiddenEdgeCategories = new Set(),
  resource = "",
  enabled = true,
}: UseTopologyDataParams) {
  // View modes where namespace filtering makes sense.
  // Cluster and RBAC show cluster-scoped resources (no namespace) so filtering would exclude everything.
  const NS_FILTERABLE_VIEWS = new Set<ViewMode>(["namespace", "traffic"]);

  // TOPOLOGY-1 (docs/PRODUCTION-RELIABILITY-AUDIT.md): the namespace selector
  // was cosmetic — selectedNamespaces was only ever applied as a client-side
  // filter AFTER an unscoped, full-cluster backend fetch, so every topology
  // load cost the same regardless of what the user picked (a code comment
  // elsewhere in this file literally warns "Empty set = All Namespaces = 735
  // resources = system freeze" — that's what happened on every load).
  // useClusterTopology/getTopology already support a single `namespace`
  // backend filter (wired in Phase 1 for TOPOLOGY-2's timeout fix); the
  // backend's TopologyFilters.Namespace is a single string (internal/models/
  // topology.go), not a multi-value filter, so real backend scoping is only
  // possible when exactly one namespace is selected. For 0 (all) or 2+
  // (multi-select) namespaces, the backend fetch remains unscoped and
  // filterByNamespaces (below) continues to do the filtering client-side,
  // exactly as before — not a regression for those cases, and matching the
  // roadmap's scope ("thread the selected namespace," not "add multi-
  // namespace backend support").
  const backendNamespace =
    NS_FILTERABLE_VIEWS.has(viewMode) && selectedNamespaces.size === 1
      ? Array.from(selectedNamespaces)[0]
      : undefined;

  const { graph, isLoading, isFetching, error, refetch } = useClusterTopology({
    clusterId,
    namespace: backendNamespace,
    depth,
    enabled: enabled && !!clusterId,
  });

  // VALID-06 (docs/VALID-06-INVESTIGATION.md): allNamespaces previously
  // derived from `graph.nodes` — the CURRENTLY LOADED, already
  // namespace-scoped topology data. That makes the namespace picker a
  // function of what's already selected, not of what actually exists in
  // the cluster: a namespace the user hasn't picked yet (and that isn't
  // incidentally cross-referenced from whatever IS loaded) could never
  // appear in its own picker, with no error or indication why. Fixed by
  // fetching the real namespace list independently, reusing the exact same
  // `listResources` call the dedicated Namespaces page already uses (not a
  // new discovery mechanism) — scoped only by the explicit `clusterId`
  // param this hook already takes (mirroring useClusterTopology's own
  // pattern exactly, below), NOT the implicit global active-cluster store
  // that useK8sResourceList/usePaginatedResourceList read internally. That
  // distinction matters here specifically: unlike every other caller of
  // those hooks (which always render for "the" active cluster), this hook's
  // whole contract is "operate on the clusterId you were explicitly given,"
  // so staying consistent with useClusterTopology's explicit-param pattern
  // is what actually guarantees no cross-cluster namespace-list leakage.
  // Namespace objects are small and bounded in count even on huge clusters
  // (unlike Pods), so this stays cheap — not the "load the whole cluster
  // graph" shortcut this fix must avoid.
  const backendBaseUrlRaw = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBackendBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrlRaw);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const namespaceListQuery = useQuery({
    queryKey: ["topology-namespaces", clusterId],
    queryFn: async ({ signal }) => {
      if (!clusterId) return { items: [] };
      return listResources(effectiveBackendBaseUrl, clusterId, "namespaces", { signal });
    },
    enabled: enabled && !!clusterId && isBackendConfigured,
    staleTime: 60_000,
  });
  const allNamespaces = useMemo<string[]>(() => {
    const items = namespaceListQuery.data?.items ?? [];
    const names = items
      .map((item) => (item as { metadata?: { name?: string } }).metadata?.name)
      .filter((n): n is string => !!n);
    return Array.from(new Set(names)).sort();
  }, [namespaceListQuery.data]);

  // Stable keys for Set dependencies so React's useMemo comparison
  // always detects changes. Set objects are compared by reference.
  const namespacesKey = Array.from(selectedNamespaces).sort().join(",");
  const kindsKey = Array.from(selectedKinds).sort().join(",");
  const edgeCategoriesKey = Array.from(hiddenEdgeCategories).sort().join(",");

  // Extract ALL unique kinds from unfiltered graph (for the kind picker)
  const allKinds = useMemo<string[]>(() => {
    if (!graph?.nodes) return [];
    const kindSet = new Set<string>();
    for (const n of graph.nodes) {
      if (n.kind) kindSet.add(n.kind);
    }
    return Array.from(kindSet).sort();
  }, [graph]);

  // Extract ALL unique edge relationship categories (for the edge filter)
  const allEdgeCategories = useMemo<string[]>(() => {
    if (!graph?.edges) return [];
    const catSet = new Set<string>();
    for (const e of graph.edges) {
      if (e.relationshipCategory) catSet.add(e.relationshipCategory);
    }
    return Array.from(catSet).sort();
  }, [graph]);

  // Transform to v2 format and apply all filters
  const result = useMemo<{ response: TopologyResponse; wasTruncated: boolean; totalBeforeCap: number; totalUnfiltered: number } | null>(() => {
    if (!graph) return null;
    let response;
    try {
      response = transformGraph(graph, clusterId ?? undefined);
    } catch (err) {
      console.error('transformGraph failed:', err);
      return null;
    }
    const totalUnfiltered = response.nodes.length;

    // Layer 0: Progressive disclosure — depth filtering is now handled by the backend.
    // The backend returns only the nodes/edges for the requested depth level.

    // Layer 1: View mode filtering
    const afterViewMode = filterByViewMode(response.nodes, response.edges, viewMode);

    // Layer 2: Namespace filtering — only for namespace-aware views
    const effectiveNs = NS_FILTERABLE_VIEWS.has(viewMode) ? selectedNamespaces : new Set<string>();
    const afterNamespace = filterByNamespaces(
      afterViewMode.nodes,
      afterViewMode.edges,
      effectiveNs
    );

    // Layer 3: Kind filtering — when selectedKinds is non-empty, only show those kinds
    let afterKindNodes = afterNamespace.nodes;
    let afterKindEdges = afterNamespace.edges;
    if (selectedKinds.size > 0) {
      afterKindNodes = afterKindNodes.filter((n) => selectedKinds.has(n.kind));
      const keptKindIds = new Set(afterKindNodes.map((n) => n.id));
      afterKindEdges = afterKindEdges.filter(
        (e) => keptKindIds.has(e.source) && keptKindIds.has(e.target)
      );
    }

    // Layer 4: Edge category filtering — hide edges of hidden categories (nodes stay)
    let afterEdgeFilter = afterKindEdges;
    if (hiddenEdgeCategories.size > 0) {
      afterEdgeFilter = afterKindEdges.filter(
        (e) => !hiddenEdgeCategories.has(e.relationshipCategory)
      );
    }

    // Layer 5: Client-side node cap — prevent UI freeze from too many nodes.
    // Truncate AFTER all filtering so the cap applies to the visible set.
    let finalNodes = afterKindNodes;
    let finalEdges = afterEdgeFilter;
    let wasTruncated = false;
    const totalBeforeCap = finalNodes.length;

    if (finalNodes.length > MAX_VISIBLE_NODES) {
      wasTruncated = true;
      // Keep the first MAX_VISIBLE_NODES nodes (they come in a stable order from
      // the backend). Then prune edges to only those connecting kept nodes.
      finalNodes = finalNodes.slice(0, MAX_VISIBLE_NODES);
      const keptIds = new Set(finalNodes.map((n) => n.id));
      finalEdges = finalEdges.filter(
        (e) => keptIds.has(e.source) && keptIds.has(e.target)
      );
    }

    response.nodes = finalNodes;
    response.edges = finalEdges;
    response.metadata.resourceCount = finalNodes.length;
    response.metadata.edgeCount = finalEdges.length;
    response.metadata.mode = viewMode;

    if (selectedNamespaces.size === 1) {
      response.metadata.namespace = Array.from(selectedNamespaces)[0];
    }
    if (resource) response.metadata.focusResource = resource;

    return { response, wasTruncated, totalBeforeCap, totalUnfiltered };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, viewMode, depth, namespacesKey, kindsKey, edgeCategoriesKey, resource]);

  const topology = result?.response ?? null;
  const truncated = result?.wasTruncated ?? false;
  const truncatedTotal = result?.totalBeforeCap ?? 0;
  const totalUnfiltered = result?.totalUnfiltered ?? 0;

  return {
    topology,
    allNamespaces,
    /** VALID-06: surfaced so the namespace filter can show a useful error
     * instead of silently appearing empty when enumeration itself fails. */
    allNamespacesError: namespaceListQuery.isError,
    allNamespacesLoading: namespaceListQuery.isLoading,
    allKinds,
    allEdgeCategories,
    isLoading,
    isFetching,
    isError: !!error,
    error,
    refetch,
    /** true when the node count exceeded MAX_VISIBLE_NODES and was capped */
    truncated,
    /** total node count before truncation (for the warning banner) */
    truncatedTotal,
    /** total node count before any filtering (depth, view mode, etc.) — for "X of Y" display */
    totalUnfiltered,
  };
}
