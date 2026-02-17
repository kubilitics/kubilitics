/**
 * Task 8.4: Real-time topology updates via WebSocket
 * When backend broadcasts resource_update or topology_update, invalidate topology query
 * so useClusterTopology refetches and the graph updates without full page refresh.
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBackendWebSocket } from './useBackendWebSocket';
import { toast } from 'sonner';

export interface UseTopologyLiveUpdatesOptions {
  clusterId: string | null | undefined;
  enabled?: boolean;
}

/**
 * Subscribes to backend WebSocket; on resource_update or topology_update
 * invalidates ['topology', clusterId, ...] so topology refetches.
 */
export function useTopologyLiveUpdates({
  clusterId,
  enabled = true,
}: UseTopologyLiveUpdatesOptions) {
  const queryClient = useQueryClient();

  const onMessage = useCallback(
    (data: { type?: string; event?: string; resource?: Record<string, unknown> }) => {
      if (!clusterId) return;
      const type = data.type;
      const event = data.event;

      if (type === 'resource_update' && event) {
        queryClient.invalidateQueries({ queryKey: ['topology', clusterId] });
        const label = event === 'added' ? 'New resource added' : event === 'modified' ? 'Resource updated' : 'Resource deleted';
        toast.info(label);
      } else if (type === 'topology_update') {
        queryClient.invalidateQueries({ queryKey: ['topology', clusterId] });
        toast.info('Topology updated');
      }
    },
    [clusterId, queryClient]
  );

  useBackendWebSocket({
    clusterId: clusterId ?? null,
    onMessage,
    enabled: enabled && !!clusterId,
  });
}
