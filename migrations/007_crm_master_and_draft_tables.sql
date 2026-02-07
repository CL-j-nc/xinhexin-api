-- Ensure CRM core master table exists for /api/crm/vehicles* routes
CREATE TABLE IF NOT EXISTS vehicle_insurance_master (
  vehicle_policy_uid TEXT PRIMARY KEY,
  vehicle_plate_no TEXT NOT NULL,
  vehicle_vin TEXT NOT NULL,
  vehicle_model TEXT,
  policyholder_name TEXT,
  insured_name TEXT,
  underwriting_status TEXT DEFAULT 'IMPORTED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicle_insurance_master_plate
  ON vehicle_insurance_master(vehicle_plate_no);
CREATE INDEX IF NOT EXISTS idx_vehicle_insurance_master_vin
  ON vehicle_insurance_master(vehicle_vin);

-- Ensure cloud draft table exists for salesman auto-save
CREATE TABLE IF NOT EXISTS proposal_form_draft (
  draft_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proposal_form_draft_updated_at
  ON proposal_form_draft(updated_at);
