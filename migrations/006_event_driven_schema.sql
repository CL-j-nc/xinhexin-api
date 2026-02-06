-- Migration 006: Event Driven Schema Enforcement
-- Enforce strict schema for Event-Driven Underwriting as per Final Delivery Document
-- 1. Update PROPOSAL Table
-- Check if columns exist (SQLite doesn't support IF NOT EXISTS for columns in standard way easily, 
-- but we can re-create or alter. Since this is "Final Version", we'll ensure structure matches).
-- We assume `proposal` exists from `001_initial_schema.sql` or `005`.
-- We need: application_submitted_at, underwriting_received_at, underwriting_confirmed_at.
ALTER TABLE proposal
ADD COLUMN application_submitted_at TEXT;
ALTER TABLE proposal
ADD COLUMN underwriting_received_at TEXT;
ALTER TABLE proposal
ADD COLUMN underwriting_confirmed_at TEXT;
-- 2. Create/Recreate COVERAGE_PROPOSED
-- Drop if exists to ensure clean slate for "Final Delivery" if it was malformed, 
-- OR strictly create if not exists. Let's start fresh for specific tables if they are new or redefined.
-- DROP TABLE IF EXISTS coverage_proposed;
CREATE TABLE IF NOT EXISTS coverage_proposed (
    coverage_id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    coverage_code TEXT,
    coverage_name TEXT,
    sum_insured REAL,
    policy_effective_date TEXT,
    -- Customer selected / Underwriter editable
    FOREIGN KEY (proposal_id) REFERENCES proposal(proposal_id)
);
-- 3. Create/Recreate UNDERWRITING_MANUAL_DECISION
-- DROP TABLE IF EXISTS underwriting_manual_decision;
CREATE TABLE IF NOT EXISTS underwriting_manual_decision (
    decision_id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    final_premium REAL NOT NULL,
    policy_effective_date TEXT,
    policy_expiry_date TEXT,
    underwriter_name TEXT NOT NULL,
    underwriter_id TEXT NOT NULL,
    underwriting_confirmed_at TEXT NOT NULL,
    -- We include extra judgment fields from previous logic if needed, but the Core Fields above are mandatory.
    -- Adding previously used fields for completeness:
    underwriting_risk_level TEXT,
    underwriting_risk_reason TEXT,
    underwriting_risk_acceptance TEXT,
    usage_authenticity_judgment TEXT,
    usage_verification_basis TEXT,
    loss_history_estimation TEXT,
    loss_history_basis TEXT,
    ncd_assumption TEXT,
    premium_adjustment_reason TEXT,
    coverage_adjustment_flag INTEGER,
    coverage_adjustment_detail TEXT,
    special_exception_flag INTEGER,
    special_exception_description TEXT,
    FOREIGN KEY (proposal_id) REFERENCES proposal(proposal_id)
);
-- 4. Create/Recreate POLICY
-- DROP TABLE IF EXISTS policy;
CREATE TABLE IF NOT EXISTS policy (
    policy_id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    policy_issue_date TEXT NOT NULL,
    policy_effective_date TEXT NOT NULL,
    policy_expiry_date TEXT NOT NULL,
    final_premium REAL NOT NULL,
    underwriter_name TEXT NOT NULL,
    policy_status TEXT DEFAULT 'EFFECTIVE',
    FOREIGN KEY (proposal_id) REFERENCES proposal(proposal_id)
);