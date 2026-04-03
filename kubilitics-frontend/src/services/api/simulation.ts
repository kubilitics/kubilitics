/**
 * API client for What-If Simulation Engine endpoints.
 *
 * POST /api/v1/clusters/{clusterId}/simulation/run
 * POST /api/v1/clusters/{clusterId}/simulation/validate
 * GET  /api/v1/clusters/{clusterId}/simulation/scenarios
 */
import { backendRequest } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Scenario {
  type: 'node_failure' | 'az_failure' | 'scale_down' | 'resource_delete' | 'namespace_delete' | 'manifest_apply';
  target_key?: string;
  namespace?: string;
  node_name?: string;
  az_label?: string;
  replicas?: number;
  manifest_yaml?: string;
}

export interface SimulationRequest {
  scenarios: Scenario[];
}

export interface NodeInfo {
  key: string;
  kind: string;
  namespace: string;
  name: string;
  health_score: number;
  status: string;
}

export interface NodeDiff {
  key: string;
  kind: string;
  namespace: string;
  name: string;
  score_before: number;
  score_after: number;
  status_before: string;
  status_after: string;
}

export interface EdgeInfo {
  source: string;
  target: string;
  relationship: string;
}

export interface SPOFEntry {
  key: string;
  kind: string;
  namespace: string;
  name: string;
  reason: string;
}

export interface SimulationResult {
  health_before: number;
  health_after: number;
  spofs_before: number;
  spofs_after: number;
  new_spofs: SPOFEntry[];
  resolved_spofs: SPOFEntry[];
  removed_nodes: NodeInfo[];
  modified_nodes: NodeDiff[];
  added_nodes: NodeInfo[];
  lost_edges: EdgeInfo[];
  affected_services: number;
  summary: string;
}

export interface ScenarioType {
  type: string;
  label: string;
  description: string;
  required_fields: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── API Functions ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/clusters/{clusterId}/simulation/run
 * Runs a what-if simulation against the cluster graph.
 */
export async function runSimulation(
  baseUrl: string,
  clusterId: string,
  request: SimulationRequest,
): Promise<SimulationResult> {
  const path = `clusters/${encodeURIComponent(clusterId)}/simulation/run`;
  const result = await backendRequest<SimulationResult>(baseUrl, path, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  // Defensive: normalize nil slices from Go backend
  result.new_spofs = result.new_spofs ?? [];
  result.resolved_spofs = result.resolved_spofs ?? [];
  result.removed_nodes = result.removed_nodes ?? [];
  result.modified_nodes = result.modified_nodes ?? [];
  result.added_nodes = result.added_nodes ?? [];
  result.lost_edges = result.lost_edges ?? [];
  return result;
}

/**
 * POST /api/v1/clusters/{clusterId}/simulation/validate
 * Validates scenarios before running.
 */
export async function validateSimulation(
  baseUrl: string,
  clusterId: string,
  request: SimulationRequest,
): Promise<ValidationResult> {
  const path = `clusters/${encodeURIComponent(clusterId)}/simulation/validate`;
  return backendRequest<ValidationResult>(baseUrl, path, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * GET /api/v1/clusters/{clusterId}/simulation/scenarios
 * Returns available scenario types with their required fields.
 */
export async function getScenarioTypes(
  baseUrl: string,
  clusterId: string,
): Promise<ScenarioType[]> {
  const path = `clusters/${encodeURIComponent(clusterId)}/simulation/scenarios`;
  const result = await backendRequest<ScenarioType[]>(baseUrl, path);
  return result ?? [];
}
