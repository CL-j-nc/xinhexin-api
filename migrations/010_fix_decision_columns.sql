-- 010_fix_decision_columns.sql
-- Fix: underwriting_manual_decision table missing columns
-- Root cause: 006 used CREATE TABLE IF NOT EXISTS but table already existed from earlier migration
-- Core time fields
ALTER TABLE underwriting_manual_decision
ADD COLUMN policy_effective_date TEXT;
ALTER TABLE underwriting_manual_decision
ADD COLUMN policy_expiry_date TEXT;
-- Risk assessment fields  
ALTER TABLE underwriting_manual_decision
ADD COLUMN underwriting_risk_level TEXT;
ALTER TABLE underwriting_manual_decision
ADD COLUMN underwriting_risk_reason TEXT;
ALTER TABLE underwriting_manual_decision
ADD COLUMN underwriting_risk_acceptance TEXT;
-- Usage judgment fields
ALTER TABLE underwriting_manual_decision
ADD COLUMN usage_authenticity_judgment TEXT;
ALTER TABLE underwriting_manual_decision
ADD COLUMN usage_verification_basis TEXT;
-- Loss history fields
ALTER TABLE underwriting_manual_decision
ADD COLUMN loss_history_estimation TEXT;
ALTER TABLE underwriting_manual_decision
ADD COLUMN loss_history_basis TEXT;
ALTER TABLE underwriting_manual_decision
ADD COLUMN ncd_assumption TEXT;
-- Premium/coverage adjustment fields
ALTER TABLE underwriting_manual_decision
ADD COLUMN premium_adjustment_reason TEXT;
ALTER TABLE underwriting_manual_decision
ADD COLUMN coverage_adjustment_flag INTEGER;
ALTER TABLE underwriting_manual_decision
ADD COLUMN coverage_adjustment_detail TEXT;
-- Special exception fields
ALTER TABLE underwriting_manual_decision
ADD COLUMN special_exception_flag INTEGER;
ALTER TABLE underwriting_manual_decision
ADD COLUMN special_exception_description TEXT;