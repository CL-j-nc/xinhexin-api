-- 数据迁移脚本：从现有申请数据生成 CRM 档案
-- 已适配现有表结构 (vehicle_policy_uid 为关联主键)
-- 1. 从已完成的申请中提取车辆信息，创建 CRM 档案
INSERT INTO vehicle_crm_profile (
    vehicle_policy_uid,
    plate,
    vin,
    current_status,
    created_at,
    updated_at
  )
SELECT lower(hex(randomblob(16))) as vehicle_policy_uid,
  json_extract(data, '$.vehicle.plate') as plate,
  json_extract(data, '$.vehicle.vin') as vin,
  '正常' as current_status,
  applied_at as created_at,
  applied_at as updated_at
FROM application
WHERE status = 'ISSUED' -- 适配 application 表的状态
  AND json_extract(data, '$.vehicle.plate') IS NOT NULL
  AND json_extract(data, '$.vehicle.vin') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM vehicle_crm_profile vcp
    WHERE vcp.plate = json_extract(data, '$.vehicle.plate')
      OR vcp.vin = json_extract(data, '$.vehicle.vin')
  );
-- 2. 提取关系人信息（由于表结构不同，这里仅插入主要联系人）
INSERT INTO vehicle_crm_contacts (
    vehicle_policy_uid,
    role_type,
    name,
    id_card,
    phone,
    created_at
  )
SELECT vcp.vehicle_policy_uid,
  '车主' as role_type,
  json_extract(a.data, '$.owner.name') as name,
  json_extract(a.data, '$.owner.idCard') as id_card,
  json_extract(a.data, '$.owner.mobile') as phone,
  a.applied_at as created_at
FROM application a
  JOIN vehicle_crm_profile vcp ON vcp.plate = json_extract(a.data, '$.vehicle.plate')
WHERE json_extract(a.data, '$.owner.name') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM vehicle_crm_contacts vcc
    WHERE vcc.vehicle_policy_uid = vcp.vehicle_policy_uid
      AND vcc.name = json_extract(a.data, '$.owner.name')
  );
-- 3. 从申请流程生成时间轴 (vehicle_crm_timeline 使用 vehicle_policy_uid)
INSERT INTO vehicle_crm_timeline (
    timeline_id,
    vehicle_policy_uid,
    event_type,
    event_desc,
    event_time,
    created_at
  )
SELECT lower(hex(randomblob(16))) as timeline_id,
  vcp.vehicle_policy_uid,
  '投保申请' as event_type,
  '客户提交投保申请' as event_desc,
  a.applied_at as event_time,
  a.applied_at as created_at
FROM application a
  JOIN vehicle_crm_profile vcp ON vcp.plate = json_extract(a.data, '$.vehicle.plate')
WHERE a.applied_at IS NOT NULL;