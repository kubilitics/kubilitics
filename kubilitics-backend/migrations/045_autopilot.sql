-- Auto-Pilot configuration per cluster per rule
CREATE TABLE IF NOT EXISTS autopilot_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_id TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'audit',  -- 'auto', 'approval', 'audit'
    enabled INTEGER NOT NULL DEFAULT 1,
    namespace_includes TEXT DEFAULT '',   -- comma-separated, empty = all
    namespace_excludes TEXT DEFAULT 'kube-system,kube-public,kube-node-lease',
    cooldown_minutes INTEGER NOT NULL DEFAULT 60,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cluster_id, rule_id)
);

-- Auto-Pilot action audit trail
CREATE TABLE IF NOT EXISTS autopilot_actions (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_namespace TEXT NOT NULL,
    target_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'applied', 'blocked', 'dismissed', 'failed', 'rolled_back'
    severity TEXT NOT NULL DEFAULT 'medium',
    description TEXT DEFAULT '',
    before_state TEXT DEFAULT '{}',  -- JSON
    after_state TEXT DEFAULT '{}',   -- JSON
    simulation_result TEXT DEFAULT '{}',  -- JSON
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    applied_at TIMESTAMP,
    applied_by TEXT DEFAULT '',
    rollback_state TEXT DEFAULT '{}'  -- JSON
);

CREATE INDEX IF NOT EXISTS idx_autopilot_actions_cluster ON autopilot_actions(cluster_id, status);
CREATE INDEX IF NOT EXISTS idx_autopilot_actions_time ON autopilot_actions(created_at);
