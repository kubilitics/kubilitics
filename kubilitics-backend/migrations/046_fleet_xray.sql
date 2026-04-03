-- Fleet health history for structural drift tracking
CREATE TABLE IF NOT EXISTS fleet_health_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    health_score REAL NOT NULL DEFAULT 0,
    spof_count INTEGER NOT NULL DEFAULT 0,
    pdb_coverage REAL NOT NULL DEFAULT 0,
    hpa_coverage REAL NOT NULL DEFAULT 0,
    netpol_coverage REAL NOT NULL DEFAULT 0,
    critical_count INTEGER NOT NULL DEFAULT 0,
    total_workloads INTEGER NOT NULL DEFAULT 0,
    metrics_json TEXT DEFAULT '{}'  -- additional metrics
);

CREATE INDEX IF NOT EXISTS idx_fleet_health_cluster_time ON fleet_health_history(cluster_id, timestamp);

-- Golden template definitions
CREATE TABLE IF NOT EXISTS golden_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    requirements TEXT NOT NULL DEFAULT '{}',  -- JSON: min_health_score, max_spofs, min_pdb_coverage, etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT DEFAULT ''
);
