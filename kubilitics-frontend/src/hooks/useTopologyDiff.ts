/**
 * Hooks for topology diff feature.
 * useTopologyDiff — fetches a diff between two topology snapshots.
 * useCreateSnapshot — creates a new topology snapshot (mutation).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  getTopologyDiff,
  createTopologySnapshot,
  type TopologyDiff,
  type SnapshotResponse,
} from '@/services/api/topologyDiff';

// ─── useTopologyDiff ────────────────────────────────────────────────────────

export interface UseTopologyDiffOptions {
  clusterId: string | null;
  fromDate: string;
  toDate: string;
  enabled?: boolean;
}

export interface UseTopologyDiffReturn {
  data: TopologyDiff | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useTopologyDiff({
  clusterId,
  fromDate,
  toDate,
  enabled = true,
}: UseTopologyDiffOptions): UseTopologyDiffReturn {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  const canFetch = enabled && isBackendConfigured && !!clusterId && !!fromDate && !!toDate;

  const { data, isLoading, error, refetch } = useQuery<TopologyDiff, Error>({
    queryKey: ['topology-diff', clusterId, fromDate, toDate],
    queryFn: () => getTopologyDiff(effectiveBaseUrl, clusterId!, fromDate, toDate),
    enabled: canFetch,
    staleTime: 60_000,
    retry: 1,
  });

  return {
    data,
    loading: isLoading,
    error: error ?? null,
    refetch,
  };
}

// ─── useCreateSnapshot ──────────────────────────────────────────────────────

export interface UseCreateSnapshotOptions {
  clusterId: string | null;
}

export interface UseCreateSnapshotReturn {
  createSnapshot: () => void;
  data: SnapshotResponse | undefined;
  loading: boolean;
  error: Error | null;
}

export function useCreateSnapshot({
  clusterId,
}: UseCreateSnapshotOptions): UseCreateSnapshotReturn {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const queryClient = useQueryClient();

  const mutation = useMutation<SnapshotResponse, Error>({
    mutationFn: () => createTopologySnapshot(effectiveBaseUrl, clusterId!),
    onSuccess: () => {
      // Invalidate diff queries so the next comparison picks up the new snapshot
      queryClient.invalidateQueries({ queryKey: ['topology-diff', clusterId] });
    },
  });

  return {
    createSnapshot: () => {
      if (clusterId) mutation.mutate();
    },
    data: mutation.data ?? undefined,
    loading: mutation.isPending,
    error: mutation.error ?? null,
  };
}
