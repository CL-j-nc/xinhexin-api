-- 003_service_center_schema.sql
-- 团体客户服务系统扩展数据表

-- ==================== 报案表 ====================
-- 接收客户报案信息
CREATE TABLE IF NOT EXISTS claim_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_no TEXT UNIQUE NOT NULL,                -- 报案编号 RPT-xxx
  policy_no TEXT NOT NULL,                       -- 关联保单号
  
  -- 报案类型
  claim_type TEXT NOT NULL CHECK(claim_type IN (
    'LIFE',           -- 人寿
    'MEDICAL',        -- 医疗
    'ACCIDENT',       -- 意外
    'OTHER'           -- 其他
  )),
  
  -- 事故信息
  accident_date DATE NOT NULL,                   -- 事故日期
  accident_location TEXT,                        -- 事故地点
  accident_description TEXT NOT NULL,            -- 事故描述
  
  -- 被保险人确认
  insured_name TEXT NOT NULL,                    -- 被保险人姓名
  insured_id_card TEXT NOT NULL,                 -- 被保险人证件号
  insured_phone TEXT,                            -- 联系电话
  
  -- 报案人信息
  reporter_name TEXT NOT NULL,                   -- 报案人姓名
  reporter_phone TEXT NOT NULL,                  -- 报案人电话
  reporter_relation TEXT,                        -- 与被保险人关系
  
  -- 状态流转
  status TEXT DEFAULT 'draft' CHECK(status IN (
    'draft',          -- 草稿
    'submitted',      -- 已提交
    'under_review',   -- 审核中
    'accepted',       -- 已受理
    'rejected'        -- 已拒绝
  )),
  reject_reason TEXT,                            -- 拒绝原因
  
  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME,
  reviewed_at DATETIME,
  
  -- 审核人员
  reviewer_id TEXT,
  
  FOREIGN KEY (policy_no) REFERENCES policy(policy_no)
);

CREATE INDEX idx_claim_report_no ON claim_report(report_no);
CREATE INDEX idx_claim_report_policy ON claim_report(policy_no);
CREATE INDEX idx_claim_report_status ON claim_report(status);

-- ==================== 理赔表 ====================
-- 理赔案件处理记录
CREATE TABLE IF NOT EXISTS claim (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_no TEXT UNIQUE NOT NULL,                 -- 理赔编号 CLM-xxx
  report_no TEXT NOT NULL,                       -- 关联报案编号
  policy_no TEXT NOT NULL,                       -- 关联保单号
  
  -- 理赔金额
  claim_amount REAL,                             -- 申请金额
  approved_amount REAL,                          -- 批准金额
  
  -- 状态流转
  status TEXT DEFAULT 'reported' CHECK(status IN (
    'reported',           -- 已报案
    'materials_required', -- 需补材料
    'reviewing',          -- 审核中
    'approved',           -- 已批准
    'denied',             -- 已拒绝
    'closed'              -- 已结案
  )),
  decision_reason TEXT,                          -- 决定原因（模板化）
  
  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  materials_requested_at DATETIME,
  review_started_at DATETIME,
  decided_at DATETIME,
  closed_at DATETIME,
  
  -- 处理人员
  handler_id TEXT,
  
  FOREIGN KEY (report_no) REFERENCES claim_report(report_no),
  FOREIGN KEY (policy_no) REFERENCES policy(policy_no)
);

CREATE INDEX idx_claim_no ON claim(claim_no);
CREATE INDEX idx_claim_report ON claim(report_no);
CREATE INDEX idx_claim_status ON claim(status);

-- ==================== 理赔材料表 ====================
-- 记录理赔所需材料及状态
CREATE TABLE IF NOT EXISTS claim_document (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_no TEXT NOT NULL,                        -- 关联理赔编号
  
  -- 材料信息
  doc_type TEXT NOT NULL CHECK(doc_type IN (
    'ID_CARD',        -- 身份证
    'POLICY_COPY',    -- 保单复印件
    'MEDICAL_RECORD', -- 病历
    'HOSPITAL_BILL',  -- 医疗费用单
    'DEATH_CERT',     -- 死亡证明
    'ACCIDENT_REPORT',-- 事故证明
    'BANK_INFO',      -- 银行信息
    'OTHER'           -- 其他
  )),
  doc_name TEXT NOT NULL,                        -- 材料名称
  is_required BOOLEAN DEFAULT 1,                 -- 是否必需
  
  -- 状态
  status TEXT DEFAULT 'pending' CHECK(status IN (
    'pending',        -- 待提交
    'submitted',      -- 已提交
    'approved',       -- 已通过
    'rejected'        -- 被拒绝
  )),
  reject_reason TEXT,
  
  -- 时间戳
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME,
  reviewed_at DATETIME,
  
  FOREIGN KEY (claim_no) REFERENCES claim(claim_no)
);

CREATE INDEX idx_claim_doc_claim ON claim_document(claim_no);

-- ==================== 文档中心表 ====================
-- 系统权威性声明和制度文档
CREATE TABLE IF NOT EXISTS document_center (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT UNIQUE NOT NULL,                   -- 文档ID
  
  -- 文档分类
  category TEXT NOT NULL CHECK(category IN (
    'AUTHORITY',      -- 平台权威性声明
    'TERMS',          -- 服务条款
    'PRIVACY',        -- 隐私政策
    'CLAIM_GUIDE',    -- 理赔说明
    'RISK_NOTICE',    -- 风险提示
    'REGULATION',     -- 监管披露
    'OTHER'           -- 其他
  )),
  
  -- 文档内容
  title TEXT NOT NULL,                           -- 标题
  content TEXT NOT NULL,                         -- 内容（Markdown格式）
  summary TEXT,                                  -- 摘要
  
  -- 版本控制
  version TEXT DEFAULT '1.0',                    -- 版本号
  is_active BOOLEAN DEFAULT 1,                   -- 是否生效
  
  -- 排序
  sort_order INTEGER DEFAULT 0,                  -- 显示顺序
  
  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME
);

CREATE INDEX idx_doc_category ON document_center(category);
CREATE INDEX idx_doc_active ON document_center(is_active);

-- ==================== 客服会话表 ====================
-- AI客服会话记录
CREATE TABLE IF NOT EXISTS customer_service_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,               -- 会话ID
  
  -- 客户信息
  customer_id TEXT,                              -- 客户标识（可选）
  customer_name TEXT,                            -- 客户姓名
  customer_phone TEXT,                           -- 客户电话
  
  -- 会话状态
  status TEXT DEFAULT 'active' CHECK(status IN (
    'active',         -- 进行中
    'escalated',      -- 已升级人工
    'closed'          -- 已结束
  )),
  
  -- 升级信息
  escalation_reason TEXT,                        -- 升级原因
  escalated_at DATETIME,                         -- 升级时间
  
  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_message_at DATETIME,
  closed_at DATETIME
);

CREATE INDEX idx_cs_session_id ON customer_service_session(session_id);
CREATE INDEX idx_cs_session_status ON customer_service_session(status);

-- ==================== 客服消息表 ====================
-- 客服对话消息记录
CREATE TABLE IF NOT EXISTS customer_service_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,                      -- 关联会话ID
  
  -- 消息内容
  role TEXT NOT NULL CHECK(role IN (
    'customer',       -- 客户消息
    'assistant',      -- AI回复
    'system'          -- 系统消息
  )),
  content TEXT NOT NULL,                         -- 消息内容
  
  -- AI置信度
  confidence REAL,                               -- AI回复置信度 (0-1)
  
  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (session_id) REFERENCES customer_service_session(session_id)
);

CREATE INDEX idx_cs_message_session ON customer_service_message(session_id);

-- ==================== FAQ知识库表 ====================
-- 常见问题解答知识库
CREATE TABLE IF NOT EXISTS faq_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- 分类
  category TEXT NOT NULL CHECK(category IN (
    'POLICY',         -- 保单相关
    'CLAIM',          -- 理赔相关
    'REPORT',         -- 报案相关
    'PAYMENT',        -- 缴费相关
    'GENERAL'         -- 通用问题
  )),
  
  -- 问答内容
  question TEXT NOT NULL,                        -- 问题
  answer TEXT NOT NULL,                          -- 回答（模板化）
  keywords TEXT,                                 -- 关键词（逗号分隔）
  
  -- 使用统计
  hit_count INTEGER DEFAULT 0,                   -- 命中次数
  
  -- 状态
  is_active BOOLEAN DEFAULT 1,                   -- 是否启用
  
  -- 排序
  priority INTEGER DEFAULT 0,                    -- 优先级
  
  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_faq_category ON faq_knowledge(category);
CREATE INDEX idx_faq_active ON faq_knowledge(is_active);

-- ==================== 审计日志表 ====================
-- 系统操作审计记录
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- 操作信息
  action TEXT NOT NULL,                          -- 操作类型
  target_type TEXT,                              -- 目标类型 (policy/claim/report等)
  target_id TEXT,                                -- 目标ID
  
  -- 操作者
  operator_type TEXT CHECK(operator_type IN (
    'SYSTEM',         -- 系统
    'AI',             -- AI客服
    'STAFF',          -- 工作人员
    'CUSTOMER'        -- 客户
  )),
  operator_id TEXT,                              -- 操作者ID
  
  -- 详情
  details TEXT,                                  -- 操作详情（JSON）
  ip_address TEXT,                               -- IP地址
  
  -- 时间戳
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_target ON audit_log(target_type, target_id);
CREATE INDEX idx_audit_time ON audit_log(created_at);

-- ==================== 初始化权威性文档 ====================
INSERT INTO document_center (doc_id, category, title, content, version, is_active, sort_order, published_at) VALUES
('DOC-AUTHORITY-001', 'AUTHORITY', '平台权威性声明', 
'# SHIE人寿服务平台权威性声明

本平台为SHIE人寿保险股份有限公司官方授权的数字化服务平台。

## 服务范围
- 保单信息查询
- 理赔报案服务
- 理赔进度查询
- 在线客户服务

## 法律效力
通过本平台提交的申请与纸质申请具有同等法律效力。

## 信息安全
本平台采用银行级加密技术保护您的个人信息安全。

---
*发布日期: 2026年1月*', '1.0', 1, 1, CURRENT_TIMESTAMP),

('DOC-TERMS-001', 'TERMS', '服务条款', 
'# SHIE人寿在线服务条款

## 1. 服务内容
本服务提供保单查询、理赔报案、进度查询等功能。

## 2. 用户责任
用户应确保提交信息的真实性和准确性。

## 3. 免责声明
本平台展示的信息仅供参考，最终以保单合同为准。

## 4. 争议解决
如有争议，双方应友好协商解决。

---
*最后更新: 2026年1月*', '1.0', 1, 2, CURRENT_TIMESTAMP),

('DOC-PRIVACY-001', 'PRIVACY', '隐私政策',
'# SHIE人寿隐私政策

## 信息收集
我们收集您的基本身份信息用于保单服务。

## 信息使用
您的信息仅用于保险业务办理，不会用于其他目的。

## 信息保护
我们采取严格的安全措施保护您的个人信息。

## 信息共享
未经您的同意，我们不会向第三方共享您的信息。

---
*最后更新: 2026年1月*', '1.0', 1, 3, CURRENT_TIMESTAMP),

('DOC-CLAIM-001', 'CLAIM_GUIDE', '理赔指南',
'# SHIE人寿理赔指南

## 报案流程
1. 事故发生后及时报案
2. 填写报案信息
3. 等待案件受理

## 所需材料
- 身份证复印件
- 保单复印件
- 相关证明材料

## 理赔时效
- 一般案件：30个工作日内
- 复杂案件：60个工作日内

## 温馨提示
请如实填写报案信息，材料齐全可加快理赔进度。

---
*最后更新: 2026年1月*', '1.0', 1, 4, CURRENT_TIMESTAMP),

('DOC-RISK-001', 'RISK_NOTICE', '风险提示',
'# 重要风险提示

## 保险产品风险
保险产品不等同于银行存款，存在一定风险。

## 投保须知
请仔细阅读保险条款，了解保障范围和责任免除。

## 理赔须知
理赔需符合保险合同约定的条件。

## 退保风险
提前退保可能产生损失。

---
*本提示为法定风险揭示，请认真阅读*', '1.0', 1, 5, CURRENT_TIMESTAMP);

-- ==================== 初始化FAQ知识库 ====================
INSERT INTO faq_knowledge (category, question, answer, keywords, priority) VALUES
('POLICY', '如何查询我的保单信息？', 
'您可以通过以下方式查询保单信息：
1. 在保单服务中心输入保单号查询
2. 输入您的身份证号码查询
3. 联系在线客服协助查询

查询时请准备好您的保单号或证件号码。', 
'保单,查询,信息', 10),

('CLAIM', '理赔需要准备哪些材料？',
'理赔所需材料根据险种不同有所差异，一般包括：
1. 身份证复印件
2. 保单复印件
3. 相关证明材料（如病历、发票等）

具体材料要求请在报案后查看材料清单。',
'理赔,材料,准备,证明', 10),

('REPORT', '发生事故后如何报案？',
'报案流程如下：
1. 进入"报案中心"
2. 选择报案类型
3. 填写事故信息
4. 确认被保险人信息
5. 提交报案

报案后您将获得报案编号，请妥善保存。',
'报案,事故,流程', 10),

('CLAIM', '理赔需要多长时间？',
'理赔时效说明：
- 一般案件：材料齐全后30个工作日内
- 复杂案件：可能需要60个工作日

您可以在"理赔进度"页面查询当前状态。
如需加快进度，请确保提交的材料完整准确。',
'理赔,时间,多久,进度', 9),

('PAYMENT', '如何缴纳续期保费？',
'续期保费缴纳方式：
1. 银行代扣（请确保账户余额充足）
2. 在线支付
3. 银行转账

缴费截止日期前请完成缴费，避免保单失效。',
'缴费,续期,保费,支付', 8),

('GENERAL', '如何联系人工客服？',
'如需人工客服协助，您可以：
1. 在对话中说"转人工"
2. 拨打客服热线：400-xxx-xxxx
3. 前往就近的服务网点

人工客服工作时间：工作日 9:00-18:00',
'人工,客服,联系,电话', 10);
