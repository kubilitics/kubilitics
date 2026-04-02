/**
 * API client for SPOF (Single Point of Failure) inventory endpoints.
 */
import { backendRequest } from './client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Remediation {
  type: string;
  description: string;
  priority: string;
}

export interface SPOFItem {
  name: string;
  kind: string;
  namespace: string;
  reason: string;
  reason_code: string;
  blast_radius_score: number;
  blast_radius_level: string;
  dependent_count: number;
  remediations: Remediation[];
}

export interface SPOFInventory {
  cluster_id: string;
  total_spofs: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  items: SPOFItem[];
  generated_at: string;
}

// ── API Functions ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/clusters/{clusterId}/spofs
 * Returns SPOF inventory for the cluster with optional filters.
 */
export async function getSPOFInventory(
  baseUrl: string,
  clusterId: string,
  filters?: {
    namespace?: string;
    kind?: string;
    severity?: string;
  },
): Promise<SPOFInventory> {
  const params = new URLSearchParams();
  if (filters?.namespace) params.set('namespace', filters.namespace);
  if (filters?.kind) params.set('kind', filters.kind);
  if (filters?.severity) params.set('severity', filters.severity);

  const query = params.toString();
  const path = `clusters/${encodeURIComponent(clusterId)}/spofs${query ? `?${query}` : ''}`;
  const result = await backendRequest<SPOFInventory>(baseUrl, path);

  // Defensive: normalize nil slices from Go backend
  result.items = result.items ?? [];
  for (const item of result.items) {
    item.remediations = item.remediations ?? [];
  }

  return result;
}
