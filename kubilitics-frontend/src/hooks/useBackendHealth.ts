/**
 * Backend health check. When backend is configured, optionally verify reachability.
 * Per A3.5: support error states and recovery (backend unreachable).
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getHealth } from '@/services/backendApiClient';

export function useBackendHealth(options?: { refetchInterval?: number; enabled?: boolean }) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  return useQuery({
    queryKey: ['backend', 'health', backendBaseUrl],
    queryFn: () => getHealth(backendBaseUrl),
    enabled: isConfigured() && (options?.enabled !== false),
    refetchInterval: options?.refetchInterval ?? false,
    retry: 1,
    staleTime: 30_000,
  });
}
