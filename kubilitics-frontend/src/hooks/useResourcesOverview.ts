import { useMemo } from 'react';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { useK8sResourceList } from './useKubernetes';

export function useResourcesOverview() {
    const { activeCluster } = useClusterStore();
    const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
    const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
    const clusterId = currentClusterId ?? undefined;

    const fallbackEnabled = !!(activeCluster || clusterId);

    const quotas = useK8sResourceList('resourcequotas', undefined, { enabled: fallbackEnabled });
    const limits = useK8sResourceList('limitranges', undefined, { enabled: fallbackEnabled });

    const data = useMemo(() => {
        const items: any[] = [];

        (quotas.data?.items ?? []).forEach((q: any) => {
            items.push({
                kind: 'ResourceQuota',
                name: q.metadata.name,
                namespace: q.metadata.namespace,
                status: 'Active',
            });
        });

        (limits.data?.items ?? []).forEach((l: any) => {
            items.push({
                kind: 'LimitRange',
                name: l.metadata.name,
                namespace: l.metadata.namespace,
                status: 'Active',
            });
        });

        return {
            pulse: {
                total: items.length,
                healthy: items.length,
                warning: 0,
                critical: 0,
                optimal_percent: 100,
            },
            resources: items,
        };
    }, [quotas.data, limits.data]);

    return { data, isLoading: quotas.isLoading || limits.isLoading };
}
