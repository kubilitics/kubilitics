/**
 * Fetches cluster summary from GET /api/v1/clusters/{clusterId}/summary.
 * Used by Dashboard for Quick Stats (namespace_count, node_count, etc.).
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getClusterSummary } from '@/services/backendApiClient';

export function useClusterSummary(clusterId: string | undefined) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  return useQuery({
    queryKey: ['backend', 'clusterSummary', backendBaseUrl, clusterId],
    queryFn: () => getClusterSummary(backendBaseUrl, clusterId!),
    enabled: isConfigured && !!clusterId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
