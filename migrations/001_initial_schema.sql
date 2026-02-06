CREATE TABLE IF NOT EXISTS application (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_no TEXT UNIQUE,
  data TEXT,
  status TEXT,
  applied_at TEXT,
  underwriting_at TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  paid_at TEXT,
  policy_issued_at TEXT,
  policy_no TEXT,
  verify_code TEXT
);