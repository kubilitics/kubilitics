-- 044_topology_snapshots.sql: Persistent storage for the intelligence
-- diff engine's topology snapshots. Separate table from the legacy
-- `topology_snapshots` in migration 001 (which has an incompatible
-- schema used by the topology export feature). Do NOT merge the two —
-- they serve different subsystems.

CREATE TABLE IF NOT EXISTS topology_diff_snapshots (
    id            TEXT PRIMARY KEY,
    cluster_id    TEXT NOT NULL,
    namespace     TEXT NOT NULL DEFAULT '',
    nodes_json    TEXT NOT NULL,
    edges_json    TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_diff_snapshots_cluster_ns_time
    ON topology_diff_snapshots(cluster_id, namespace, created_at);
