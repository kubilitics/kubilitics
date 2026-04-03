/**
 * React Query mutation hook for the pre-apply blast radius preview API.
 * Uses a mutation (not a query) because the analysis is triggered on-demand
 * with user-supplied manifest YAML, not cached or auto-fetched.
 */
import { useMutation } from '@tanstack/react-query';
import { previewBlastRadius } from '@/services/api/preview';
import type { PreviewResult } from '@/services/api/preview';
import { useActiveClusterId } from './useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

export interface UsePreApplyBlastRadiusReturn {
  /** Trigger the analysis with the given manifest YAML. */
  analyze: (manifestYaml: string) => void;
  /** The preview result, available after a successful analysis. */
  data: PreviewResult | undefined;
  /** Whether the analysis is currently in progress. */
  isLoading: boolean;
  /** Error from the most recent analysis attempt. */
  error: Error | null;
  /** Reset the mutation state (clear results). */
  reset: () => void;
}

export function usePreApplyBlastRadius(): UsePreApplyBlastRadiusReturn {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const mutation = useMutation<PreviewResult, Error, string>({
    mutationFn: (manifestYaml: string) => {
      if (!clusterId) {
        return Promise.reject(new Error('No active cluster selected'));
      }
      return previewBlastRadius(effectiveBaseUrl, clusterId, manifestYaml);
    },
  });

  return {
    analyze: mutation.mutate,
    data: mutation.data,
    isLoading: mutation.isPending,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
