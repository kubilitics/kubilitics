/**
 * React Query mutation hook for generating cluster resilience reports.
 * Uses a mutation (not query) because report generation is an on-demand action
 * triggered by the user, not auto-fetched data.
 */
import { useMutation } from '@tanstack/react-query';
import { generateResilienceReport, type ResilienceReport } from '@/services/api/reports';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

export interface UseResilienceReportReturn {
  /** Trigger report generation */
  generate: (format?: 'json' | 'pdf') => void;
  /** The generated report, if available */
  data: ResilienceReport | undefined;
  /** True while report is being generated */
  isLoading: boolean;
  /** Error from the last generation attempt */
  error: Error | null;
  /** Reset the mutation state */
  reset: () => void;
}

export function useResilienceReport(clusterId: string | undefined): UseResilienceReportReturn {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);

  const mutation = useMutation<ResilienceReport, Error, 'json' | 'pdf'>({
    mutationFn: (format: 'json' | 'pdf') => {
      if (!clusterId) {
        return Promise.reject(new Error('No cluster selected'));
      }
      return generateResilienceReport(effectiveBaseUrl, clusterId, format);
    },
  });

  return {
    generate: (format: 'json' | 'pdf' = 'json') => mutation.mutate(format),
    data: mutation.data,
    isLoading: mutation.isPending,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
