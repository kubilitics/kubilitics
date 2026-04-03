/**
 * API client for the pre-apply blast radius preview endpoint.
 */
import { backendRequest } from './client';

// --- Types ---

export interface PreviewResourceRef {
  name: string;
  kind: string;
  namespace: string;
}

export interface PreviewAffectedResource {
  name: string;
  kind: string;
  namespace: string;
  impact: 'created' | 'modified' | 'deleted';
  blast_score: number;
}

export interface PreviewRemediation {
  type: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface PreviewResult {
  affected_resources: PreviewAffectedResource[];
  total_affected: number;
  blast_radius_score: number;
  blast_radius_level: 'critical' | 'high' | 'medium' | 'low';
  health_score_before: number;
  health_score_after: number;
  health_score_delta: number;
  new_spofs: PreviewResourceRef[];
  removed_spofs: PreviewResourceRef[];
  warnings: string[];
  remediations: PreviewRemediation[];
}

export interface PreviewRequest {
  manifest_yaml: string;
  dry_run?: boolean;
}

// --- API call ---

/**
 * POST /api/v1/clusters/{clusterId}/blast-radius/preview
 * Analyses a YAML manifest against the current cluster graph and returns
 * the predicted blast radius impact.
 */
export async function previewBlastRadius(
  baseUrl: string,
  clusterId: string,
  manifestYaml: string,
): Promise<PreviewResult> {
  const path = `clusters/${encodeURIComponent(clusterId)}/blast-radius/preview`;
  const body: PreviewRequest = {
    manifest_yaml: manifestYaml,
    dry_run: true,
  };
  const result = await backendRequest<PreviewResult>(baseUrl, path, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  // Defensive: normalize null arrays to empty arrays (Go nil -> JSON null).
  result.affected_resources = result.affected_resources ?? [];
  result.new_spofs = result.new_spofs ?? [];
  result.removed_spofs = result.removed_spofs ?? [];
  result.warnings = result.warnings ?? [];
  result.remediations = result.remediations ?? [];

  return result;
}
