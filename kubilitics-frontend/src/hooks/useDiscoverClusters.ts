/**
 * Fetches discovered clusters from Kubilitics backend (GET /api/v1/clusters/discover).
 * These are contexts in kubeconfig that are not yet registered.
 */
import { useQuery } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { discoverClusters } from '@/services/backendApiClient';

export function useDiscoverClusters() {
    const stored = useBackendConfigStore((s) => s.backendBaseUrl);
    const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
    const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

    return useQuery({
        queryKey: ['backend', 'clusters', 'discover', backendBaseUrl],
        queryFn: () => discoverClusters(backendBaseUrl),
        enabled: isConfigured,
        staleTime: 60_000, // Discovery is more expensive, check less often
    });
}
