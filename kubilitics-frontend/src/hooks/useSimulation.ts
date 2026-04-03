/**
 * React Query hooks for the What-If Simulation Engine.
 *
 * - useRunSimulation() — mutation hook for running simulations
 * - useScenarioTypes(clusterId) — query hook for available scenario types
 *
 * Follows the same pattern as useBlastRadius / useProjects.
 */
import { useQuery, useMutation } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  runSimulation,
  getScenarioTypes,
  type SimulationRequest,
  type SimulationResult,
  type ScenarioType,
} from '@/services/api/simulation';

/**
 * Mutation hook for running a what-if simulation.
 * Usage:
 *   const { mutateAsync, isPending } = useRunSimulation();
 *   const result = await mutateAsync({ clusterId, request });
 */
export function useRunSimulation() {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);

  return useMutation<
    SimulationResult,
    Error,
    { clusterId: string; request: SimulationRequest }
  >({
    mutationFn: ({ clusterId, request }) =>
      runSimulation(backendBaseUrl, clusterId, request),
  });
}

/**
 * Query hook for fetching available scenario types.
 * Returns the list of scenario types (node_failure, az_failure, etc.)
 * with their labels, descriptions, and required fields.
 */
export function useScenarioTypes(clusterId: string | null) {
  const stored = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(stored);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  return useQuery<ScenarioType[], Error>({
    queryKey: ['simulation', 'scenario-types', clusterId],
    queryFn: () => getScenarioTypes(backendBaseUrl, clusterId!),
    enabled: isConfigured && !!clusterId,
    staleTime: 5 * 60_000, // scenario types rarely change
  });
}
