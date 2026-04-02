/**
 * API client for cluster health and risk ranking endpoints (Operational Intelligence Platform).
 */
import { backendRequest } from './client';

/* ─── Health Report Types ─────────────────────────────────────────────────── */

export interface ComponentScore {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

export interface NamespaceHealth {
  namespace: string;
  score: number;
  level: string;
  components: ComponentScore[];
  workload_count: number;
}

export interface HealthReport {
  cluster_id: string;
  score: number;
  level: string;
  components: ComponentScore[];
  namespaces: NamespaceHealth[];
}

/* ─── Risk Ranking Types ──────────────────────────────────────────────────── */

export interface NamespaceRisk {
  namespace: string;
  risk_score: number;
  level: string;
  spof_count: number;
  avg_blast_radius: number;
  cross_ns_dependencies: number;
  workload_count: number;
  top_risks: string[];
}

export interface RiskRanking {
  cluster_id: string;
  namespaces: NamespaceRisk[];
  generated_at: string;
}

/* ─── API Functions ───────────────────────────────────────────────────────── */

/**
 * GET /api/v1/clusters/{clusterId}/health
 * Returns the operational health report for a cluster.
 */
export async function getClusterHealth(
  baseUrl: string,
  clusterId: string,
): Promise<HealthReport> {
  const path = `clusters/${encodeURIComponent(clusterId)}/health`;
  const result = await backendRequest<HealthReport>(baseUrl, path);
  // Defensive: normalize nil slices from Go backend.
  result.components = result.components ?? [];
  result.namespaces = result.namespaces ?? [];
  for (const ns of result.namespaces) {
    ns.components = ns.components ?? [];
  }
  return result;
}

/**
 * GET /api/v1/clusters/{clusterId}/risk-ranking
 * Returns namespace risk rankings for a cluster.
 */
export async function getRiskRanking(
  baseUrl: string,
  clusterId: string,
): Promise<RiskRanking> {
  const path = `clusters/${encodeURIComponent(clusterId)}/risk-ranking`;
  const result = await backendRequest<RiskRanking>(baseUrl, path);
  // Defensive: normalize nil slices from Go backend.
  result.namespaces = result.namespaces ?? [];
  for (const ns of result.namespaces) {
    ns.top_risks = ns.top_risks ?? [];
  }
  return result;
}
