-- Ensure the vehicle exists. 
-- Note: 'current_status' is correct.
INSERT
    OR REPLACE INTO vehicle_crm_profile (
        vehicle_policy_uid,
        plate,
        vin,
        engine_no,
        brand,
        model,
        energy_type,
        current_status,
        created_at,
        updated_at
    )
VALUES (
        'VUID_001',
        '皖SC3545',
        'LZZ7CLXB0KC269048',
        '190517706997',
        '汕德卡牌224256V324HEIH',
        '半挂牵引车',
        'FUEL',
        '正常',
        datetime('now'),
        datetime('now')
    );
-- Ensure the Company owner exists.
-- Schema uses 'id_card' not 'id_no'. No 'contact_id'.
INSERT INTO vehicle_crm_contacts (
        vehicle_policy_uid,
        role_type,
        name,
        id_card,
        phone,
        created_at
    )
VALUES (
        'VUID_001',
        '车主',
        '涡阳县锦钊运输有限公司',
        '91341621697385384J(1-1)',
        '13856856738',
        datetime('now')
    );
-- Insert Liang Yunzheng as a Driver (or similar role if '驾驶员' is not allowed by CHECK constraint).
-- Schema check constraint: role_type IN ('车主', '投保人', '被保险人', '紧急联系人')
-- '驾驶员' is NOT in the check constraint!
-- I should usage '被保险人' (Insured) or '紧急联系人' (Emergency Contact) or strictly what the user asked.
-- The user said "inplug". Maybe just put him as "紧急联系人" (Emergency Contact) or "投保人" (Proposer) if he is the operator.
-- Or I can try to insert '驾驶员' and see if it fails (it will fail due to CHECK).
-- I will use '紧急联系人' (Emergency Contact) for Liang Yunzheng as it's the safest "other" role, 
-- or '被保险人' if he is the insured. The company is likely the owner/applicant.
-- Let's use '紧急联系人' (Emergency Contact) for now, or just '车主' if he is a co-owner? No, company is owner.
-- I'll use '紧急联系人'.
INSERT INTO vehicle_crm_contacts (
        vehicle_policy_uid,
        role_type,
        name,
        id_card,
        phone,
        created_at
    )
VALUES (
        'VUID_001',
        '紧急联系人',
        '梁云政',
        '341200198001010000',
        '13900000000',
        datetime('now')
    );