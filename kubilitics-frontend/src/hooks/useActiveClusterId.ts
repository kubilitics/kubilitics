/**
 * Single source of truth for the active cluster ID used in every backend API path.
 *
 * Resolution order:
 *   1. `useClusterStore.activeCluster.id` — the validated, live cluster object set
 *      by `useRestoreClusterFromBackend` after reconciling against the backend's
 *      cluster list. This is the trusted source.
 *   2. `useBackendConfigStore.currentClusterId` — the localStorage-persisted ID.
 *      Only used as a hint during the very first render before restore completes;
 *      may be stale if the underlying cluster was deleted/renamed externally.
 *
 * `setActiveCluster` in clusterStore syncs both stores on every write, so in
 * steady state the two always agree. This hook simply picks the safer source.
 *
 * Demo clusters (`__demo__*`) are excluded because they never hit the backend.
 */
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';

export function useActiveClusterId(): string | null {
  const activeClusterId = useClusterStore((s) => s.activeCluster?.id);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);

  if (activeClusterId && !activeClusterId.startsWith('__demo__')) {
    return activeClusterId;
  }
  return currentClusterId ?? null;
}
