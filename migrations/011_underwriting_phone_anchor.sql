-- Migration 011: 以手机号为业务锚点的核保增强
-- 目的: 持久化验证码和二维码到数据库，支持按手机号查询核保历史

-- 1. 为 underwriting_manual_decision 表添加新字段
ALTER TABLE underwriting_manual_decision ADD COLUMN auth_code TEXT;
ALTER TABLE underwriting_manual_decision ADD COLUMN qr_url TEXT;
ALTER TABLE underwriting_manual_decision ADD COLUMN owner_mobile TEXT;

-- 2. 创建手机号索引，支持按手机号快速查询
CREATE INDEX IF NOT EXISTS idx_umd_owner_mobile ON underwriting_manual_decision(owner_mobile);

-- 3. 创建核保确认时间索引，支持历史记录排序
CREATE INDEX IF NOT EXISTS idx_umd_confirmed_at ON underwriting_manual_decision(underwriting_confirmed_at);
