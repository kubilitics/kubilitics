/**
 * Hook for fetching cluster-wide SPOF (Single Point of Failure) inventory.
 * Follows the same pattern as useBlastRadius: useActiveClusterId + backendConfigStore + react-query.
 */
import { useQuery } from '@tanstack/react-query';
import { getSPOFInventory } from '@/services/api/spof';
import type { SPOFInventory } from '@/services/api/spof';
import { useActiveClusterId } from './useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

export interface UseSPOFInventoryFilters {
  namespace?: string;
  kind?: string;
  severity?: string;
}

export interface UseSPOFInventoryReturn {
  data: SPOFInventory | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useSPOFInventory(
  filters?: UseSPOFInventoryFilters,
): UseSPOFInventoryReturn {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const enabled = !!clusterId && isBackendConfigured;

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<SPOFInventory, Error>({
    queryKey: ['spof-inventory', clusterId, filters?.namespace, filters?.kind, filters?.severity],
    queryFn: () => getSPOFInventory(effectiveBaseUrl, clusterId!, filters),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  return {
    data,
    isLoading,
    isFetching,
    error: error ?? null,
    refetch,
  };
}
