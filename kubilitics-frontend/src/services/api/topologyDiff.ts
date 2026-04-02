/**
 * API client for topology diff endpoints.
 * POST /api/v1/clusters/{id}/topology/snapshot — create a snapshot
 * GET /api/v1/clusters/{id}/topology/diff?from=DATE&to=DATE — diff two snapshots
 */
import { backendRequest } from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SnapshotNode {
  id: string;
  name: string;
  kind: string;
  namespace: string;
  health?: string;
}

export interface SnapshotEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface EdgeChange {
  source: string;
  target: string;
  type: string;
  old_weight: number;
  new_weight: number;
}

export interface DiffSummary {
  nodes_added: number;
  nodes_removed: number;
  edges_added: number;
  edges_removed: number;
  edges_changed: number;
  new_spofs: number;
  removed_spofs: number;
  /** Human-readable summary, e.g. "5 new dependencies added, 2 SPOFs introduced" */
  natural_language: string;
}

export interface TopologyDiff {
  from_snapshot: string;
  to_snapshot: string;
  added_nodes: SnapshotNode[];
  removed_nodes: SnapshotNode[];
  added_edges: SnapshotEdge[];
  removed_edges: SnapshotEdge[];
  changed_edges: EdgeChange[];
  summary: DiffSummary;
}

export interface SnapshotResponse {
  id: string;
  created_at: string;
  node_count: number;
  edge_count: number;
}

// ─── API Functions ───────────────────────────────────────────────────────────

/**
 * POST /api/v1/clusters/{clusterId}/topology/snapshot
 * Creates a new topology snapshot for the cluster.
 */
export async function createTopologySnapshot(
  baseUrl: string,
  clusterId: string,
): Promise<SnapshotResponse> {
  const path = `clusters/${encodeURIComponent(clusterId)}/topology/snapshot`;
  return backendRequest<SnapshotResponse>(baseUrl, path, { method: 'POST' });
}

/**
 * GET /api/v1/clusters/{clusterId}/topology/diff?from={from}&to={to}
 * Returns the diff between two topology snapshots.
 */
export async function getTopologyDiff(
  baseUrl: string,
  clusterId: string,
  fromDate: string,
  toDate: string,
): Promise<TopologyDiff> {
  const search = new URLSearchParams();
  search.set('from', fromDate);
  search.set('to', toDate);
  const path = `clusters/${encodeURIComponent(clusterId)}/topology/diff?${search.toString()}`;

  const result = await backendRequest<TopologyDiff>(baseUrl, path);

  // Defensive: normalize nil slices from Go backend
  result.added_nodes = result.added_nodes ?? [];
  result.removed_nodes = result.removed_nodes ?? [];
  result.added_edges = result.added_edges ?? [];
  result.removed_edges = result.removed_edges ?? [];
  result.changed_edges = result.changed_edges ?? [];

  return result;
}
