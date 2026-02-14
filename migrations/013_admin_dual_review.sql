-- Migration 013: 管理员双人复核字段
-- 目的: Level 3 高风险操作（代支付/代退保）需要双人复核
-- 依据: docs/admin-power-model.md

-- 添加复核人字段
ALTER TABLE admin_operation_log ADD COLUMN reviewer_id TEXT;

-- 添加复核时间字段
ALTER TABLE admin_operation_log ADD COLUMN reviewed_at TEXT;

-- 添加授权凭证URL字段（书面授权扫描件）
ALTER TABLE admin_operation_log ADD COLUMN authorization_url TEXT;

-- 索引: 待复核操作
CREATE INDEX IF NOT EXISTS idx_aol_pending_review ON admin_operation_log(power_type, reviewer_id);
