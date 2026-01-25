-- 投保单承保状态与时间字段补齐

ALTER TABLE application ADD COLUMN status TEXT NOT NULL DEFAULT 'APPLIED';

ALTER TABLE application ADD COLUMN applied_at TEXT;
ALTER TABLE application ADD COLUMN underwriting_at TEXT;
ALTER TABLE application ADD COLUMN approved_at TEXT;
ALTER TABLE application ADD COLUMN rejected_at TEXT;
ALTER TABLE application ADD COLUMN paid_at TEXT;
ALTER TABLE application ADD COLUMN policy_issued_at TEXT;

ALTER TABLE application ADD COLUMN policy_no TEXT;
ALTER TABLE application ADD COLUMN verify_code TEXT;
