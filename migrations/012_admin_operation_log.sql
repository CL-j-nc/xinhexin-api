-- Migration 012: 管理员操作审计日志表
-- 目的: 记录管理员代行权操作（代完成认证等），支持审计追溯
-- 依据: docs/admin-power-model.md 管理员权能三层模型

CREATE TABLE IF NOT EXISTS admin_operation_log (
    id TEXT PRIMARY KEY,                    -- 'AOL-' + nanoid
    operator_id TEXT NOT NULL,              -- 操作人ID
    operator_role TEXT NOT NULL,            -- 'L1' | 'L2' | 'L3'
    power_type TEXT NOT NULL,               -- 'CORRECTION' | 'GUARANTEE' | 'SUBSTITUTION'
    action TEXT NOT NULL,                   -- 'COMPLETE_AUTH' | 'RESEND_AUTH' 等
    target_type TEXT NOT NULL,              -- 'PROPOSAL' | 'CLAIM' | 'POLICY'
    target_id TEXT NOT NULL,                -- 业务对象ID
    verification_method TEXT,               -- 'PHONE' | 'VIDEO' | 'IN_PERSON' (代认证时必填)
    reason TEXT NOT NULL,                   -- 操作理由
    before_state TEXT,                      -- JSON: 操作前状态快照
    after_state TEXT,                       -- JSON: 操作后状态快照
    created_at TEXT DEFAULT (datetime('now'))
);

-- 索引: 按操作人查询
CREATE INDEX IF NOT EXISTS idx_aol_operator ON admin_operation_log(operator_id);

-- 索引: 按业务对象查询
CREATE INDEX IF NOT EXISTS idx_aol_target ON admin_operation_log(target_type, target_id);

-- 索引: 按操作类型查询
CREATE INDEX IF NOT EXISTS idx_aol_action ON admin_operation_log(power_type, action);

-- 索引: 按时间范围查询
CREATE INDEX IF NOT EXISTS idx_aol_created_at ON admin_operation_log(created_at);
