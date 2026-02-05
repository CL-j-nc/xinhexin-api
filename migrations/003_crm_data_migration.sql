-- 数据迁移脚本：从现有申请数据生成 CRM 档案

-- 此脚本示例展示如何从 application 表中提取数据并生成 CRM 档案
-- 实际部署时需根据现有数据结构调整

-- 1. 从已完成的申请中提取车辆信息，创建 CRM 档案
INSERT INTO vehicle_crm_profile (crm_profile_id, plate, vin, current_status, last_contact_time, created_at)
SELECT 
  lower(hex(randomblob(16))) as crm_profile_id,
  json_extract(data, '$.vehicle.plate') as plate,
  json_extract(data, '$.vehicle.vin') as vin,
  'ACTIVE' as current_status,
  policy_issued_at as last_contact_time,
  applied_at as created_at
FROM application
WHERE status = 'COMPLETED'
  AND json_extract(data, '$.vehicle.plate') IS NOT NULL
  AND json_extract(data, '$.vehicle.vin') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_crm_profile vcp
    WHERE vcp.plate = json_extract(data, '$.vehicle.plate')
       OR vcp.vin = json_extract(data, '$.vehicle.vin')
  );

-- 2. 提取关系人信息（车主、投保人、被保险人）
-- 车主
INSERT INTO vehicle_crm_contacts (contact_id, crm_profile_id, role_type, name, id_type, id_no, phone, created_at)
SELECT 
  lower(hex(randomblob(16))) as contact_id,
  vcp.crm_profile_id,
  '车主' as role_type,
  json_extract(a.data, '$.owner.name') as name,
  json_extract(a.data, '$.owner.idType') as id_type,
  json_extract(a.data, '$.owner.idCard') as id_no,
  json_extract(a.data, '$.owner.mobile') as phone,
  a.applied_at as created_at
FROM application a
JOIN vehicle_crm_profile vcp 
  ON vcp.plate = json_extract(a.data, '$.vehicle.plate')
WHERE json_extract(a.data, '$.owner.name') IS NOT NULL;

-- 投保人
INSERT INTO vehicle_crm_contacts (contact_id, crm_profile_id, role_type, name, id_type, id_no, phone, created_at)
SELECT 
  lower(hex(randomblob(16))) as contact_id,
  vcp.crm_profile_id,
  '投保人' as role_type,
  json_extract(a.data, '$.proposer.name') as name,
  json_extract(a.data, '$.proposer.idType') as id_type,
  json_extract(a.data, '$.proposer.idCard') as id_no,
  json_extract(a.data, '$.proposer.mobile') as phone,
  a.applied_at as created_at
FROM application a
JOIN vehicle_crm_profile vcp 
  ON vcp.plate = json_extract(a.data, '$.vehicle.plate')
WHERE json_extract(a.data, '$.proposer.name') IS NOT NULL;

-- 被保险人
INSERT INTO vehicle_crm_contacts (contact_id, crm_profile_id, role_type, name, id_type, id_no, phone, created_at)
SELECT 
  lower(hex(randomblob(16))) as contact_id,
  vcp.crm_profile_id,
  '被保险人' as role_type,
  json_extract(a.data, '$.insured.name') as name,
  json_extract(a.data, '$.insured.idType') as id_type,
  json_extract(a.data, '$.insured.idCard') as id_no,
  json_extract(a.data, '$.insured.mobile') as phone,
  a.applied_at as created_at
FROM application a
JOIN vehicle_crm_profile vcp 
  ON vcp.plate = json_extract(a.data, '$.vehicle.plate')
WHERE json_extract(a.data, '$.insured.name') IS NOT NULL;

-- 3. 从申请流程生成时间轴
INSERT INTO vehicle_crm_timeline (timeline_id, crm_profile_id, event_type, event_desc, event_time, ref_application_no, created_at)
SELECT 
  lower(hex(randomblob(16))) as timeline_id,
  vcp.crm_profile_id,
  '投保申请' as event_type,
  '客户提交投保申请' as event_desc,
  a.applied_at as event_time,
  a.application_no as ref_application_no,
  a.applied_at as created_at
FROM application a
JOIN vehicle_crm_profile vcp 
  ON vcp.plate = json_extract(a.data, '$.vehicle.plate')
WHERE a.applied_at IS NOT NULL;

-- 核保通过
INSERT INTO vehicle_crm_timeline (timeline_id, crm_profile_id, event_type, event_desc, event_time, ref_application_no, created_at)
SELECT 
  lower(hex(randomblob(16))) as timeline_id,
  vcp.crm_profile_id,
  '核保通过' as event_type,
  '核保通过，生成保单号 ' || a.policy_no as event_desc,
  a.approved_at as event_time,
  a.application_no as ref_application_no,
  a.approved_at as created_at
FROM application a
JOIN vehicle_crm_profile vcp 
  ON vcp.plate = json_extract(a.data, '$.vehicle.plate')
WHERE a.approved_at IS NOT NULL;

-- 支付完成
INSERT INTO vehicle_crm_timeline (timeline_id, crm_profile_id, event_type, event_desc, event_time, ref_application_no, created_at)
SELECT 
  lower(hex(randomblob(16))) as timeline_id,
  vcp.crm_profile_id,
  '支付完成' as event_type,
  '客户完成保费支付' as event_desc,
  a.paid_at as event_time,
  a.application_no as ref_application_no,
  a.paid_at as created_at
FROM application a
JOIN vehicle_crm_profile vcp 
  ON vcp.plate = json_extract(a.data, '$.vehicle.plate')
WHERE a.paid_at IS NOT NULL;

-- 保单出单
INSERT INTO vehicle_crm_timeline (timeline_id, crm_profile_id, event_type, event_desc, event_time, ref_application_no, created_at)
SELECT 
  lower(hex(randomblob(16))) as timeline_id,
  vcp.crm_profile_id,
  '保单出单' as event_type,
  '保单正式生效' as event_desc,
  a.policy_issued_at as event_time,
  a.application_no as ref_application_no,
  a.policy_issued_at as created_at
FROM application a
JOIN vehicle_crm_profile vcp 
  ON vcp.plate = json_extract(a.data, '$.vehicle.plate')
WHERE a.policy_issued_at IS NOT NULL AND a.status = 'COMPLETED';
