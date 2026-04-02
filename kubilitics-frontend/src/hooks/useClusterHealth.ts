/**
 * Hooks for fetching cluster health report and risk ranking.
 * Uses the same pattern as useBlastRadius: react-query + backend config store.
 */
import { useQuery } from '@tanstack/react-query';
import { useActiveClusterId } from './useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getClusterHealth, getRiskRanking } from '@/services/api/clusterHealth';
import type { HealthReport, RiskRanking } from '@/services/api/clusterHealth';

export interface UseClusterHealthReturn {
  data: HealthReport | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch the operational health report for the active cluster.
 * Returns { data, isLoading, isFetching, error, refetch }.
 */
export function useClusterHealth(clusterId?: string | null): UseClusterHealthReturn {
  const activeClusterId = useActiveClusterId();
  const resolvedId = clusterId ?? activeClusterId;
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const enabled = !!resolvedId && isBackendConfigured;

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<HealthReport, Error>({
    queryKey: ['cluster-health', resolvedId],
    queryFn: () => getClusterHealth(effectiveBaseUrl, resolvedId!),
    enabled,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 1_000,
  });

  return {
    data,
    isLoading,
    isFetching,
    error: error ?? null,
    refetch,
  };
}

export interface UseRiskRankingReturn {
  data: RiskRanking | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch the namespace risk ranking for the active cluster.
 * Returns { data, isLoading, isFetching, error, refetch }.
 */
export function useRiskRanking(clusterId?: string | null): UseRiskRankingReturn {
  const activeClusterId = useActiveClusterId();
  const resolvedId = clusterId ?? activeClusterId;
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const enabled = !!resolvedId && isBackendConfigured;

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<RiskRanking, Error>({
    queryKey: ['risk-ranking', resolvedId],
    queryFn: () => getRiskRanking(effectiveBaseUrl, resolvedId!),
    enabled,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 1_000,
  });

  return {
    data,
    isLoading,
    isFetching,
    error: error ?? null,
    refetch,
  };
}
