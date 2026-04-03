/**
 * API client for report schedule CRUD (T12).
 */
import { backendRequest } from './client';

// ── Types ────────────────────────────────────────────────────────

export interface ReportSchedule {
  id: string;
  cluster_id: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  format: string;
  webhook_url: string;
  webhook_type: 'slack' | 'teams' | 'generic';
  next_run: string;
  last_run?: string;
  last_status?: 'success' | 'failed';
  created_at: string;
  enabled: boolean;
}

export interface CreateScheduleRequest {
  frequency: string;
  webhook_url: string;
  webhook_type: string;
  enabled: boolean;
}

export interface UpdateScheduleRequest {
  frequency?: string;
  webhook_url?: string;
  webhook_type?: string;
  enabled?: boolean;
}

// ── API Functions ────────────────────────────────────────────────

/**
 * GET /api/v1/clusters/{clusterId}/reports/schedules
 */
export async function listSchedules(
  baseUrl: string,
  clusterId: string,
): Promise<ReportSchedule[]> {
  const path = `clusters/${encodeURIComponent(clusterId)}/reports/schedules`;
  return backendRequest<ReportSchedule[]>(baseUrl, path);
}

/**
 * GET /api/v1/clusters/{clusterId}/reports/schedules/{scheduleId}
 */
export async function getSchedule(
  baseUrl: string,
  clusterId: string,
  scheduleId: string,
): Promise<ReportSchedule> {
  const path = `clusters/${encodeURIComponent(clusterId)}/reports/schedules/${encodeURIComponent(scheduleId)}`;
  return backendRequest<ReportSchedule>(baseUrl, path);
}

/**
 * POST /api/v1/clusters/{clusterId}/reports/schedules
 */
export async function createSchedule(
  baseUrl: string,
  clusterId: string,
  data: CreateScheduleRequest,
): Promise<ReportSchedule> {
  const path = `clusters/${encodeURIComponent(clusterId)}/reports/schedules`;
  return backendRequest<ReportSchedule>(baseUrl, path, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * PUT /api/v1/clusters/{clusterId}/reports/schedules/{scheduleId}
 */
export async function updateSchedule(
  baseUrl: string,
  clusterId: string,
  scheduleId: string,
  data: UpdateScheduleRequest,
): Promise<ReportSchedule> {
  const path = `clusters/${encodeURIComponent(clusterId)}/reports/schedules/${encodeURIComponent(scheduleId)}`;
  return backendRequest<ReportSchedule>(baseUrl, path, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * DELETE /api/v1/clusters/{clusterId}/reports/schedules/{scheduleId}
 */
export async function deleteSchedule(
  baseUrl: string,
  clusterId: string,
  scheduleId: string,
): Promise<void> {
  const path = `clusters/${encodeURIComponent(clusterId)}/reports/schedules/${encodeURIComponent(scheduleId)}`;
  await backendRequest<void>(baseUrl, path, {
    method: 'DELETE',
  });
}

/**
 * POST /api/v1/clusters/{clusterId}/reports/schedules/{scheduleId}/run
 */
export async function runScheduleNow(
  baseUrl: string,
  clusterId: string,
  scheduleId: string,
): Promise<{ message: string; schedule_id: string; cluster_id: string }> {
  const path = `clusters/${encodeURIComponent(clusterId)}/reports/schedules/${encodeURIComponent(scheduleId)}/run`;
  return backendRequest<{ message: string; schedule_id: string; cluster_id: string }>(baseUrl, path, {
    method: 'POST',
  });
}
