/**
 * React Query hooks for report schedule CRUD (T12).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
} from '@/services/api/schedules';
import type {
  ReportSchedule,
  CreateScheduleRequest,
  UpdateScheduleRequest,
} from '@/services/api/schedules';
import { useActiveClusterId } from './useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

const QUERY_KEY = 'report-schedules';

/**
 * List all report schedules for the active cluster.
 */
export function useReportSchedules() {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());

  return useQuery<ReportSchedule[], Error>({
    queryKey: [QUERY_KEY, clusterId],
    queryFn: () => listSchedules(effectiveBaseUrl, clusterId!),
    enabled: !!clusterId && isBackendConfigured,
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * Create a new report schedule.
 */
export function useCreateSchedule() {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const queryClient = useQueryClient();

  return useMutation<ReportSchedule, Error, CreateScheduleRequest>({
    mutationFn: (data) => createSchedule(effectiveBaseUrl, clusterId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, clusterId] });
    },
  });
}

/**
 * Update an existing report schedule.
 */
export function useUpdateSchedule() {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const queryClient = useQueryClient();

  return useMutation<
    ReportSchedule,
    Error,
    { scheduleId: string; data: UpdateScheduleRequest }
  >({
    mutationFn: ({ scheduleId, data }) =>
      updateSchedule(effectiveBaseUrl, clusterId!, scheduleId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, clusterId] });
    },
  });
}

/**
 * Delete a report schedule.
 */
export function useDeleteSchedule() {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (scheduleId) =>
      deleteSchedule(effectiveBaseUrl, clusterId!, scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, clusterId] });
    },
  });
}

/**
 * Trigger an immediate run of a schedule.
 */
export function useRunScheduleNow() {
  const clusterId = useActiveClusterId();
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const effectiveBaseUrl = getEffectiveBackendBaseUrl(backendBaseUrl);
  const queryClient = useQueryClient();

  return useMutation<
    { message: string; schedule_id: string; cluster_id: string },
    Error,
    string
  >({
    mutationFn: (scheduleId) =>
      runScheduleNow(effectiveBaseUrl, clusterId!, scheduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, clusterId] });
    },
  });
}
