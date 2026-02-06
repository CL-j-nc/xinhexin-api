-- CRM 系统数据库表（符合 newcore-CRM 规范）
-- 所有表直接外键关联 vehicle_insurance_master.vehicle_policy_uid

-- 1. 车辆 CRM 总览表
CREATE TABLE IF NOT EXISTS vehicle_crm_profile (
  vehicle_policy_uid TEXT PRIMARY KEY,
  current_status TEXT DEFAULT 'ACTIVE',
  last_contact_time TEXT,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 注意：vehicle_policy_uid 直接来自 vehicle_insurance_master
-- 不使用单独的 crm_profile_id

-- 2. 车辆关系人表
CREATE TABLE IF NOT EXISTS vehicle_crm_contacts (
  contact_id TEXT PRIMARY KEY,
  vehicle_policy_uid TEXT NOT NULL,
  role_type TEXT NOT NULL,  -- 车主/投保人/被保险人
  name TEXT NOT NULL,
  id_type TEXT,
  id_no TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vehicle_policy_uid) REFERENCES vehicle_insurance_master(vehicle_policy_uid)
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_policy ON vehicle_crm_contacts(vehicle_policy_uid);

-- 3. CRM 时间轴表 (承保/服务事件)
CREATE TABLE IF NOT EXISTS vehicle_crm_timeline (
  timeline_id TEXT PRIMARY KEY,
  vehicle_policy_uid TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 投保申请/核保通过/支付/出单/续保提醒等
  event_desc TEXT NOT NULL,
  event_time TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vehicle_policy_uid) REFERENCES vehicle_insurance_master(vehicle_policy_uid)
);

CREATE INDEX IF NOT EXISTS idx_crm_timeline_policy ON vehicle_crm_timeline(vehicle_policy_uid);
CREATE INDEX IF NOT EXISTS idx_crm_timeline_time ON vehicle_crm_timeline(event_time DESC);

-- 4. 客服沟通记录表
CREATE TABLE IF NOT EXISTS vehicle_crm_interactions (
  interaction_id TEXT PRIMARY KEY,
  vehicle_policy_uid TEXT NOT NULL,
  contact_method TEXT NOT NULL, -- 电话/微信/App/面访
  topic TEXT NOT NULL,          -- 续保咨询/理赔咨询/投诉等（必填）
  result TEXT,                  -- 沟通结果
  follow_up_status TEXT DEFAULT '待跟进',  -- 待跟进/已完成/无需跟进
  interaction_time TEXT NOT NULL,
  operator_name TEXT NOT NULL,  -- 客服人员
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vehicle_policy_uid) REFERENCES vehicle_insurance_master(vehicle_policy_uid)
);

CREATE INDEX IF NOT EXISTS idx_crm_interactions_policy ON vehicle_crm_interactions(vehicle_policy_uid);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_time ON vehicle_crm_interactions(interaction_time DESC);

-- 5. 信任/风险标记表
CREATE TABLE IF NOT EXISTS vehicle_crm_flags (
  flag_id TEXT PRIMARY KEY,
  vehicle_policy_uid TEXT NOT NULL,
  flag_type TEXT NOT NULL CHECK (flag_type IN ('VIP客户', '高风险', '欺诈嫌疑', '优质客户', '续保重点', '投诉敏感')),
  flag_note TEXT,
  is_active INTEGER DEFAULT 1,  -- 1=有效, 0=已撤销
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  FOREIGN KEY (vehicle_policy_uid) REFERENCES vehicle_insurance_master(vehicle_policy_uid)
);

CREATE INDEX IF NOT EXISTS idx_crm_flags_policy ON vehicle_crm_flags(vehicle_policy_uid);
CREATE INDEX IF NOT EXISTS idx_crm_flags_active ON vehicle_crm_flags(is_active);
