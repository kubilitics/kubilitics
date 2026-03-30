-- Persistent metrics history for time-series charts.
-- Stores per-pod CPU/memory/network collected every 30s.
-- Auto-cleaned: rows older than 7 days are purged by the backend.

CREATE TABLE IF NOT EXISTS metrics_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id TEXT NOT NULL,
    namespace TEXT NOT NULL,
    pod_name TEXT NOT NULL,
    timestamp INTEGER NOT NULL,       -- Unix epoch seconds
    cpu_milli REAL NOT NULL DEFAULT 0, -- CPU in millicores
    memory_mib REAL NOT NULL DEFAULT 0, -- Memory in MiB
    network_rx INTEGER NOT NULL DEFAULT 0, -- bytes received (cumulative)
    network_tx INTEGER NOT NULL DEFAULT 0  -- bytes transmitted (cumulative)
);

-- Index for querying a specific pod's history within a time range
CREATE INDEX IF NOT EXISTS idx_metrics_history_pod_ts
    ON metrics_history (cluster_id, namespace, pod_name, timestamp);

-- Index for cleanup of old data
CREATE INDEX IF NOT EXISTS idx_metrics_history_ts
    ON metrics_history (timestamp);
