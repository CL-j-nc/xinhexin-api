-- 009_underwriting_enhancement.sql
-- Add columns for Payment QR Code and Adjusted Coverage Snapshot
ALTER TABLE underwriting_manual_decision
ADD COLUMN payment_qr_code TEXT;
ALTER TABLE underwriting_manual_decision
ADD COLUMN adjusted_coverage_data TEXT;