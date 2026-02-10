CREATE TABLE IF NOT EXISTS system_logs (
    log_id TEXT PRIMARY KEY,
    trace_id TEXT,
    level TEXT,
    -- 'INFO', 'WARN', 'ERROR', 'DEBUG'
    category TEXT,
    -- 'PROPOSAL_SUBMIT', 'UNDERWRITING', 'API', etc.
    message TEXT,
    payload TEXT,
    -- JSON structured data
    client_ip TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON system_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_category ON system_logs(category);
CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON system_logs(trace_id);