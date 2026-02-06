-- 002_complete_schema.sql
-- 完整的承保系统数据库架构
-- ==================== 投保申请表 ====================
-- 存储从salesman提交的投保申请
-- DROP TABLE IF EXISTS application;
CREATE TABLE IF NOT EXISTS application (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_no TEXT UNIQUE NOT NULL,
  -- 申请单号 APP-xxx
  request_id TEXT,
  -- 请求ID REQ-xxx
  -- 基本信息
  energy_type TEXT CHECK(energy_type IN ('FUEL', 'NEV')),
  -- 车辆信息 (JSON)
  vehicle_data TEXT NOT NULL,
  -- 人员信息 (JSON)
  owner_data TEXT NOT NULL,
  proposer_data TEXT,
  insured_data TEXT,
  -- 险种信息 (JSON Array)
  coverages_data TEXT NOT NULL,
  -- 状态流转
  status TEXT DEFAULT 'APPLIED' CHECK(
    status IN (
      'APPLIED',
      -- 已投保
      'UNDERWRITING',
      -- 核保中
      'APPROVED',
      -- 核保通过
      'REJECTED',
      -- 核保打回
      'PAID',
      -- 已缴费
      'ISSUED' -- 已承保
    )
  ),
  reject_reason TEXT,
  -- 时间戳
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  underwriting_at DATETIME,
  approved_at DATETIME,
  rejected_at DATETIME,
  paid_at DATETIME,
  issued_at DATETIME,
  -- 核保人员
  underwriter_id TEXT,
  -- 关联保单
  policy_no TEXT,
  -- 验证码 (客户端查询用)
  verify_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_application_status ON application(status);
CREATE INDEX IF NOT EXISTS idx_application_no ON application(application_no);
-- ==================== 保单表 ====================
-- 承保成功后生成的正式保单
CREATE TABLE IF NOT EXISTS policy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_no TEXT UNIQUE NOT NULL,
  -- 保单号
  application_no TEXT NOT NULL,
  -- 关联申请单
  -- 保单基本信息
  energy_type TEXT,
  effective_date DATE NOT NULL,
  -- 生效日期
  expiry_date DATE NOT NULL,
  -- 到期日期
  -- 车辆信息
  plate TEXT NOT NULL,
  vin TEXT NOT NULL,
  brand TEXT,
  vehicle_type TEXT,
  -- 车主信息
  owner_name TEXT NOT NULL,
  owner_id_card TEXT NOT NULL,
  owner_phone TEXT,
  -- 险种详情 (JSON)
  coverages_data TEXT NOT NULL,
  total_premium REAL,
  -- 总保费
  -- 保单状态
  status TEXT DEFAULT 'ACTIVE' CHECK(
    status IN (
      'ACTIVE',
      -- 有效
      'SUSPENDED',
      -- 中止
      'LAPSED',
      -- 失效
      'CANCELLED',
      -- 退保
      'EXPIRED' -- 到期
    )
  ),
  -- 时间戳
  issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  suspended_at DATETIME,
  lapsed_at DATETIME,
  FOREIGN KEY (application_no) REFERENCES application(application_no)
);
CREATE INDEX IF NOT EXISTS idx_policy_no ON policy(policy_no);
CREATE INDEX IF NOT EXISTS idx_policy_plate ON policy(plate);
CREATE INDEX IF NOT EXISTS idx_policy_owner ON policy(owner_name, owner_id_card);
CREATE INDEX IF NOT EXISTS idx_policy_status ON policy(status);
-- ==================== 批改保全表 ====================
-- 保单生效后的变更记录
CREATE TABLE IF NOT EXISTS endorsement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endorsement_no TEXT UNIQUE NOT NULL,
  -- 批改单号
  policy_no TEXT NOT NULL,
  -- 关联保单
  -- 批改类型
  type TEXT CHECK(
    type IN (
      'INFO_CHANGE',
      -- 信息变更
      'COVERAGE_ADD',
      -- 加保
      'COVERAGE_REMOVE',
      -- 减保
      'BENEFICIARY',
      -- 受益人变更
      'SUSPEND',
      -- 中止
      'RESUME',
      -- 复效
      'CANCEL' -- 退保
    )
  ),
  -- 变更内容 (JSON)
  change_data TEXT,
  -- 状态
  status TEXT DEFAULT 'PENDING' CHECK(
    status IN (
      'PENDING',
      -- 待审核
      'APPROVED',
      -- 已通过
      'REJECTED',
      -- 已拒绝
      'COMPLETED' -- 已完成
    )
  ),
  -- 费用调整
  premium_adjustment REAL DEFAULT 0,
  -- 时间戳
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME,
  -- 处理人员
  processor_id TEXT,
  FOREIGN KEY (policy_no) REFERENCES policy(policy_no)
);
CREATE INDEX IF NOT EXISTS idx_endorsement_policy ON endorsement(policy_no);
-- ==================== CRM 车辆档案表 ====================
CREATE TABLE IF NOT EXISTS vehicle_crm_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_policy_uid TEXT UNIQUE NOT NULL,
  -- 车辆唯一标识
  -- 车辆基本信息
  plate TEXT NOT NULL,
  vin TEXT NOT NULL,
  engine_no TEXT,
  brand TEXT,
  model TEXT,
  vehicle_type TEXT,
  use_nature TEXT,
  energy_type TEXT CHECK(energy_type IN ('FUEL', 'NEV')),
  -- 登记信息
  register_date DATE,
  issue_date DATE,
  curb_weight TEXT,
  approved_load TEXT,
  seats INTEGER,
  -- CRM 状态
  current_status TEXT DEFAULT '正常',
  -- 最近保单信息
  last_policy_no TEXT,
  last_policy_expiry DATE,
  -- 元数据
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  usage_count INTEGER DEFAULT 0,
  is_favorite BOOLEAN DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_crm_vehicle_plate ON vehicle_crm_profile(plate);
CREATE INDEX IF NOT EXISTS idx_crm_vehicle_vin ON vehicle_crm_profile(vin);
-- ==================== CRM 客户联系人表 ====================
CREATE TABLE IF NOT EXISTS vehicle_crm_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_policy_uid TEXT NOT NULL,
  -- 关联车辆
  -- 角色类型
  role_type TEXT CHECK(role_type IN ('车主', '投保人', '被保险人', '紧急联系人')),
  -- 联系人信息
  name TEXT NOT NULL,
  id_type TEXT DEFAULT '居民身份证',
  id_card TEXT,
  phone TEXT,
  address TEXT,
  -- 是否主要联系人
  is_primary BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_policy_uid) REFERENCES vehicle_crm_profile(vehicle_policy_uid)
);
CREATE INDEX IF NOT EXISTS idx_crm_contact_vehicle ON vehicle_crm_contacts(vehicle_policy_uid);
-- ==================== CRM 续保提醒表 ====================
CREATE TABLE IF NOT EXISTS renewal_reminder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_policy_uid TEXT NOT NULL,
  policy_no TEXT NOT NULL,
  -- 到期信息
  expiry_date DATE NOT NULL,
  reminder_date DATE NOT NULL,
  -- 提醒日期 (到期前30天)
  -- 提醒状态
  status TEXT DEFAULT 'PENDING' CHECK(
    status IN (
      'PENDING',
      -- 待提醒
      'SENT',
      -- 已发送
      'RENEWED',
      -- 已续保
      'EXPIRED' -- 已过期
    )
  ),
  -- 联系方式
  contact_phone TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME,
  FOREIGN KEY (vehicle_policy_uid) REFERENCES vehicle_crm_profile(vehicle_policy_uid)
);
CREATE INDEX IF NOT EXISTS idx_renewal_date ON renewal_reminder(reminder_date);
CREATE INDEX IF NOT EXISTS idx_renewal_status ON renewal_reminder(status);
-- ==================== 查询日志表 ====================
-- 记录客户/业务员查询保单的历史
CREATE TABLE IF NOT EXISTS query_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 查询信息
  query_type TEXT CHECK(query_type IN ('POLICY', 'APPLICATION', 'CRM')),
  query_key TEXT NOT NULL,
  -- 查询的关键字
  query_reason TEXT,
  -- 查询原因
  -- 查询来源
  source TEXT CHECK(
    source IN ('SALESMAN', 'CLIENT', 'SERVICE', 'ADMIN')
  ),
  operator_id TEXT,
  -- 查询结果
  result_count INTEGER DEFAULT 0,
  queried_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_query_log_time ON query_log(queried_at);