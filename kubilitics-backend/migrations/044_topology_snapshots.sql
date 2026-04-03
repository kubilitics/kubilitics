-- 044_topology_snapshots.sql: Persistent storage for topology diff snapshots.
-- Replaces the in-memory snapshot store so data survives backend restarts.

CREATE TABLE IF NOT EXISTS topology_snapshots (
    id            TEXT PRIMARY KEY,
    cluster_id    TEXT NOT NULL,
    namespace     TEXT NOT NULL DEFAULT '',
    nodes_json    TEXT NOT NULL,
    edges_json    TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_cluster_ns_time
    ON topology_snapshots(cluster_id, namespace, created_at);
