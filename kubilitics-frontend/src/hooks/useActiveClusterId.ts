/**
 * Single source of truth for the active cluster ID used by backend-scoped features
 * (metrics, events, topology, logs, etc.).
 *
 * For backend API calls we must only send an ID the backend knows. When isDemo is true,
 * the cluster store has mock IDs (e.g. prod-us-east) that the backend does not have,
 * so we return only currentClusterId (set when user connects). When not in demo mode,
 * clusters are from the backend so their ids are valid.
 */
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';

export function useActiveClusterId(): string | null {
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const clusters = useClusterStore((s) => s.clusters);
  const isDemo = useClusterStore((s) => s.isDemo);

  if (isDemo) {
    return currentClusterId ?? null;
  }
  return currentClusterId ?? activeCluster?.id ?? clusters?.[0]?.id ?? null;
}
