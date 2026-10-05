/**
 * Hook for fetching cluster-wide topology from backend
 * Uses react-query for caching and error handling
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getTopology } from '@/services/backendApiClient';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import type { TopologyGraph } from '@/topology/graph';

export interface UseClusterTopologyOptions {
  clusterId?: string | null;
  namespace?: string | null;
  depth?: number;
  enabled?: boolean;
}

export interface UseClusterTopologyResult {
  graph: TopologyGraph | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetches cluster-wide topology from backend API.
 * Same pattern as useResourceTopology: enable when isBackendConfigured and clusterId are set.
 */
export function useClusterTopology({
  clusterId,
  namespace,
  depth,
  enabled = true,
}: UseClusterTopologyOptions): UseClusterTopologyResult {
  const queryClient = useQueryClient();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const namespaceParam =
    namespace && namespace !== 'all' ? namespace : undefined;

  const queryEnabled =
    enabled &&
    !!clusterId &&
    isBackendConfigured;

  const {
    data: graph,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<TopologyGraph, Error>({
    // Task 8.1: queryKey per PRD Section 12.3 — depth included so each level is cached separately
    queryKey: ['topology', clusterId, namespaceParam, depth ?? 0],
    queryFn: async () => {
      if (!clusterId) {
        throw new Error('Cluster not selected');
      }

      // TOPOLOGY-2 (docs/PRODUCTION-RELIABILITY-AUDIT.md): the previous 8s
      // Promise.race timeout was SHORTER than the backend's own topology build
      // budget (topology_timeout_sec, default 30s in kubilitics-backend/internal/
      // config/config.go) and didn't actually cancel the in-flight fetch when it
      // fired — the backend kept building the graph after the UI had already
      // given up, and the next attempt could never succeed on any cluster whose
      // build legitimately takes 8-30s. CLIENT_TOPOLOGY_TIMEOUT_MS must stay
      // above the backend's configured ceiling (with margin for network latency);
      // it's enforced inside backendRequest via a real AbortController, so giving
      // up client-side now actually stops the backend request too.
      const CLIENT_TOPOLOGY_TIMEOUT_MS = 35_000;

      const result = await getTopology(
        effectiveBaseUrl,
        clusterId,
        { namespace: namespaceParam, depth },
        { timeoutMs: CLIENT_TOPOLOGY_TIMEOUT_MS }
      );

      if (!result) {
        throw new Error('Empty response from topology API');
      }
      if (!Array.isArray(result.nodes)) {
        throw new Error('Invalid response: nodes is not an array');
      }
      if (!Array.isArray(result.edges)) {
        throw new Error('Invalid response: edges is not an array');
      }

      return result;
    },
    enabled: queryEnabled,
    // Removed refetchInterval - rely on global defaults (refetchOnWindowFocus/reconnect)
    staleTime: 60_000,       // Increased from 10s to 60s - allow stale data
    retry: 1,                // Only retry once — fail fast, show error state
    retryDelay: 2_000,       // 2s before retry
  });

  const queryKey = ['topology', clusterId, namespaceParam, depth ?? 0];

  return {
    graph,
    isLoading,
    isFetching,
    error: error || null,
    refetch: () => {
      // Invalidate cache first so react-query ignores staleTime and
      // makes a real network request. Without this, refetch() on
      // "fresh" data (within 60s staleTime) is a no-op.
      queryClient.invalidateQueries({ queryKey });
    },
  };
}
