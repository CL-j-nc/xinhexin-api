-- Fix broken foreign keys in CRM tables (Misaligned reference to vehicle_insurance_master)
DROP TABLE IF EXISTS vehicle_crm_contacts;
DROP TABLE IF EXISTS vehicle_crm_timeline;
DROP TABLE IF EXISTS vehicle_crm_interactions;
DROP TABLE IF EXISTS vehicle_crm_flags;
CREATE TABLE IF NOT EXISTS vehicle_crm_contacts (
    contact_id TEXT PRIMARY KEY,
    vehicle_policy_uid TEXT NOT NULL,
    role_type TEXT NOT NULL,
    name TEXT NOT NULL,
    id_type TEXT,
    id_no TEXT,
    phone TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (vehicle_policy_uid) REFERENCES vehicle_crm_profile(vehicle_policy_uid)
);
CREATE TABLE IF NOT EXISTS vehicle_crm_timeline (
    timeline_id TEXT PRIMARY KEY,
    vehicle_policy_uid TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_desc TEXT NOT NULL,
    event_time TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (vehicle_policy_uid) REFERENCES vehicle_crm_profile(vehicle_policy_uid)
);
CREATE TABLE IF NOT EXISTS vehicle_crm_interactions (
    interaction_id TEXT PRIMARY KEY,
    vehicle_policy_uid TEXT NOT NULL,
    contact_method TEXT NOT NULL,
    topic TEXT NOT NULL,
    result TEXT,
    follow_up_status TEXT DEFAULT '待跟进',
    interaction_time TEXT NOT NULL,
    operator_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (vehicle_policy_uid) REFERENCES vehicle_crm_profile(vehicle_policy_uid)
);
CREATE TABLE IF NOT EXISTS vehicle_crm_flags (
    flag_id TEXT PRIMARY KEY,
    vehicle_policy_uid TEXT NOT NULL,
    flag_type TEXT NOT NULL CHECK (
        flag_type IN ('VIP客户', '高风险', '欺诈嫌疑', '优质客户', '续保重点', '投诉敏感')
    ),
    flag_note TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT NOT NULL,
    revoked_at TEXT,
    revoked_by TEXT,
    FOREIGN KEY (vehicle_policy_uid) REFERENCES vehicle_crm_profile(vehicle_policy_uid)
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_policy ON vehicle_crm_contacts(vehicle_policy_uid);
CREATE INDEX IF NOT EXISTS idx_crm_timeline_policy ON vehicle_crm_timeline(vehicle_policy_uid);
CREATE INDEX IF NOT EXISTS idx_crm_timeline_time ON vehicle_crm_timeline(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_policy ON vehicle_crm_interactions(vehicle_policy_uid);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_time ON vehicle_crm_interactions(interaction_time DESC);
CREATE INDEX IF NOT EXISTS idx_crm_flags_policy ON vehicle_crm_flags(vehicle_policy_uid);
CREATE INDEX IF NOT EXISTS idx_crm_flags_active ON vehicle_crm_flags(is_active);