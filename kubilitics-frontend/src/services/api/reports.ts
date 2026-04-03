/**
 * API client for cluster resilience report endpoints.
 */
import { backendRequest } from './client';

/**
 * ResilienceReport is the full cluster resilience report structure
 * returned by the backend.
 */
export interface ResilienceReport {
  cluster_id: string;
  cluster_name: string;
  generated_at: string;
  format: string;

  executive_summary: ExecutiveSummary;
  spof_inventory: SPOFSection;
  risk_ranking: RiskSection;
  blast_radius_map: BlastSection;
  topology_drift: DriftSection;
  recommendations: Recommendation[];
}

export interface ExecutiveSummary {
  health_score: number;
  health_level: string;
  total_workloads: number;
  total_spofs: number;
  critical_spofs: number;
  namespaces_at_risk: number;
  top_risk: string;
}

export interface SPOFSection {
  items: SPOFEntry[];
}

export interface SPOFEntry {
  name: string;
  kind: string;
  namespace: string;
  blast_radius: number;
  reason: string;
  remediation: string;
}

export interface RiskSection {
  namespaces: RiskEntry[];
}

export interface RiskEntry {
  namespace: string;
  risk_score: number;
  level: string;
  spof_count: number;
}

export interface BlastSection {
  top_resources: BlastEntry[];
}

export interface BlastEntry {
  name: string;
  kind: string;
  namespace: string;
  score: number;
  level: string;
  affected_count: number;
}

export interface DriftSection {
  period: string;
  nodes_added: number;
  nodes_removed: number;
  edges_added: number;
  edges_removed: number;
  new_spofs: number;
  summary: string;
}

export interface Recommendation {
  priority: string;
  title: string;
  description: string;
  impact: string;
}

/**
 * POST /api/v1/clusters/{clusterId}/reports/resilience
 * Generates a full cluster resilience report.
 */
export async function generateResilienceReport(
  baseUrl: string,
  clusterId: string,
  format: 'json' | 'pdf' = 'json',
): Promise<ResilienceReport> {
  const path = `clusters/${encodeURIComponent(clusterId)}/reports/resilience?format=${format}`;
  const result = await backendRequest<ResilienceReport>(baseUrl, path, {
    method: 'POST',
  });
  // Defensive: normalize nil slices from Go backend
  result.spof_inventory.items = result.spof_inventory.items ?? [];
  result.risk_ranking.namespaces = result.risk_ranking.namespaces ?? [];
  result.blast_radius_map.top_resources = result.blast_radius_map.top_resources ?? [];
  result.recommendations = result.recommendations ?? [];
  return result;
}
