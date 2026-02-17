/**
 * Fetches cluster list from Kubilitics backend (GET /api/v1/clusters).
 * Enabled only when backend is configured. Per TASKS A3.2.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getClusters } from '@/services/backendApiClient';

export function useClustersFromBackend() {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  return useQuery({
    queryKey: ['backend', 'clusters', backendBaseUrl],
    queryFn: () => getClusters(backendBaseUrl),
    enabled: isConfigured,
    staleTime: 30_000,
  });
}
