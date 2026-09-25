-- 001_init.sql — clean V1 baseline for MySQL 8.4 (fresh design from spec.md, not a port).
--
-- DESIGN PRINCIPLES
-- * timecard_days is the ONLY source of truth for time. Weekly hour totals,
--   reg/OT, and leave buckets exist ONLY in the timecard_weekly view — there
--   are no stored totals and no triggers maintaining them, so there is exactly
--   one definition of every derived number.
-- * No stored procedures / triggers / functions in V1. Rationale: period
--   locking and rollups are enforced in the API transaction layer (status is
--   re-checked inside every write). DB-level lock triggers are deferred
--   hardening: they need SUPER / log_bin_trust_function_creators on MySQL 8.4
--   with binary logging, which the app user must not have.
-- * Leave types live in leave_types (rows, not enums): a new company leave
--   type is an INSERT, never DDL. Fixed workflow sets stay ENUM.
-- * Pay classification lives ONLY in employee_compensation (effective-dated).
--   employees carries identity + employment dates, never rates or exemption.
--   Exemption is stored as given by company/CPA, never inferred from salary.
-- * Paper-card codes (8, V8, S8, SU8, P4, H8, HW8) are a FRONTEND entry
--   convention; the DB stores explicit day_type values. Mapping S8/SU8 to
--   sick vs protected-unpaid REQUIRES_CONFIRMATION (see spec §13).
-- * Holiday credits / substitutions / redemptions are Phase 2 (spec §7):
--   V1 tracks the calendar + whether the holiday was worked, nothing more.
-- * No hard deletes of payroll-related rows (retention); audit_log is
--   append-only by convention (restrict grants on the app user in production).

-- ---------- users (system logins; 2FA-ready columns, no fake 2FA) ----------
CREATE TABLE users (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    email              VARCHAR(255) NOT NULL UNIQUE,
    full_name          VARCHAR(255) NOT NULL,
    password_hash      TEXT NOT NULL,                       -- argon2id (Day-2 auth)
    role               ENUM('ADMIN','OWNER') NOT NULL,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    two_factor_secret  TEXT NULL,                           -- set only when Owner enrolls 2FA
    last_login_at      TIMESTAMP NULL DEFAULT NULL,
    created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------- employees (identity + employment lifecycle only) ----------
CREATE TABLE employees (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    employee_number      VARCHAR(50) NOT NULL UNIQUE,       -- Emp Num on the paper card
    full_name            VARCHAR(255) NOT NULL,
    payment_method       ENUM('CHECK','DIRECT_DEPOSIT','CASH') NOT NULL DEFAULT 'DIRECT_DEPOSIT',
    pay_notice_signed_on DATE NULL,                         -- missing => missing-notice alert
    hire_date            DATE NOT NULL,
    termination_date     DATE NULL,                         -- NULL = currently employed
    created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (termination_date IS NULL OR termination_date >= hire_date)
);
-- Active = termination_date IS NULL OR termination_date > period end (derived per period, never a flag).

-- ---------- employee_compensation (the ONLY place pay classification lives) ----------
CREATE TABLE employee_compensation (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    employee_id     INT NOT NULL,
    effective_from  DATE NOT NULL,
    effective_to    DATE NULL,                              -- NULL = current
    pay_type        ENUM('HOURLY','SALARY') NOT NULL,
    rate            DECIMAL(10,2) NOT NULL,                 -- hourly rate OR weekly salary, per pay_type
    overtime_status ENUM('NON_EXEMPT','EXEMPT','REVIEW') NOT NULL,
    basis_note      TEXT NULL,                              -- company/CPA-provided classification basis
    created_by      INT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comp_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_comp_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CHECK (rate >= 0),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX idx_comp_employee_from ON employee_compensation(employee_id, effective_from);
-- REVIEW = needs human/CPA decision; resolves to "no automatic OT" until classified.

-- ---------- wage_rules (dated legal parameters; app resolves by date, never hard-codes) ----------
CREATE TABLE wage_rules (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    rule_key       VARCHAR(100) NOT NULL,
    value          DECIMAL(10,2) NOT NULL,
    effective_from DATE NOT NULL,
    source_note    TEXT NULL,
    UNIQUE (rule_key, effective_from)
);
INSERT INTO wage_rules (rule_key, value, effective_from, source_note) VALUES
  ('min_wage_nyc', 17.00, '2026-01-01', 'NYS minimum wage, NYC/Long Island/Westchester — CPA to confirm'),
  ('exempt_weekly_salary_nyc', 1275.00, '2026-01-01', 'Exec/admin exemption; duties test also required — CPA to confirm'),
  ('ot_threshold_hours', 40, '2026-01-01', 'Weekly threshold for non-exempt (hours basis; leave treatment TBD by CPA)');
-- Resolution pattern (app layer): latest row with effective_from <= date. NULL = REQUIRES_CONFIRMATION.

-- ---------- pay_periods (OPEN -> SUBMITTED -> APPROVED | RETURNED -> OPEN) ----------
CREATE TABLE pay_periods (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    start_date   DATE NOT NULL UNIQUE,                      -- Monday
    end_date     DATE NOT NULL,
    pay_date     DATE NOT NULL,
    status       ENUM('OPEN','SUBMITTED','RETURNED','APPROVED') NOT NULL DEFAULT 'OPEN',
    submitted_by INT NULL,
    submitted_at TIMESTAMP NULL DEFAULT NULL,
    approved_by  INT NULL,
    approved_at  TIMESTAMP NULL DEFAULT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_period_submitter FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_period_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CHECK (end_date = DATE_ADD(start_date, INTERVAL 6 DAY))
);
-- NOTE: "APPROVED requires approved_by/at" is enforced in the API layer:
-- MySQL 8.4 (err 3823) forbids CHECK constraints on columns that carry a
-- FOREIGN KEY referential action.
-- RETURNED is terminal-visible: a return never silently becomes OPEN; only the
-- Owner moves periods backward (RETURNED->OPEN, APPROVED->OPEN), always with a
-- reason recorded in audit_log. Valid transitions are enforced in the API layer.

-- ---------- holidays (company calendar; worked-ness lives on the day row) ----------
CREATE TABLE holidays (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    holiday_date  DATE NOT NULL UNIQUE,
    name          VARCHAR(100) NOT NULL,
    default_hours DECIMAL(4,2) NOT NULL DEFAULT 8
);

-- ---------- timecard_entries (weekly header: NON-derived fields only) ----------
CREATE TABLE timecard_entries (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    pay_period_id     INT NOT NULL,
    employee_id       INT NOT NULL,
    bonus_amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
    reimb_amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
    spread_days       SMALLINT NOT NULL DEFAULT 0,          -- workdays spanning >10h (in/out times decide)
    call_in_hours     DECIMAL(5,2) NOT NULL DEFAULT 0,
    ot_override_hours DECIMAL(5,2) NULL,                    -- NULL = use calculated OT
    ot_override_reason TEXT NULL,                           -- mandatory when override is set; always audited
    notes             TEXT NULL,
    created_by        INT NULL,
    updated_by        INT NULL,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_entry_period FOREIGN KEY (pay_period_id) REFERENCES pay_periods(id) ON DELETE RESTRICT,
    CONSTRAINT fk_entry_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_entry_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_entry_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (pay_period_id, employee_id),
    CHECK (bonus_amount >= 0),
    CHECK (reimb_amount >= 0),
    CHECK (call_in_hours >= 0),
    CHECK (spread_days BETWEEN 0 AND 7),
    CHECK (ot_override_hours IS NULL OR ot_override_reason IS NOT NULL)
);

-- ---------- timecard_days (THE source of truth for time) ----------
CREATE TABLE timecard_days (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    entry_id         INT NOT NULL,
    work_date        DATE NOT NULL,
    day_type         ENUM('WORK','VACATION','SICK_SAFE_PAID','PROTECTED_UNPAID','PRENATAL','HOLIDAY','HOLIDAY_WORKED') NOT NULL DEFAULT 'WORK',
    hours            DECIMAL(4,2) NOT NULL,
    time_in          TIME NULL,
    time_out         TIME NULL,
    unpaid_break_min SMALLINT NOT NULL DEFAULT 0,
    holiday_id       INT NULL,                              -- set when the day links to the company calendar
    note             TEXT NULL,
    CONSTRAINT fk_day_entry FOREIGN KEY (entry_id) REFERENCES timecard_entries(id) ON DELETE RESTRICT,
    CONSTRAINT fk_day_holiday FOREIGN KEY (holiday_id) REFERENCES holidays(id) ON DELETE SET NULL,
    UNIQUE (entry_id, work_date, day_type),
    CHECK (hours BETWEEN 0 AND 24)
);
CREATE INDEX idx_days_entry_date ON timecard_days(entry_id, work_date);
-- HOLIDAY = paid, not worked. HOLIDAY_WORKED = worked (paid as worked hours;
-- any credit owed is a Phase-2 concept, not modeled here).

-- ---------- timecard_weekly (ALL derived totals; the single definition) ----------
-- Days are pre-aggregated per entry in a derived table so the outer query
-- needs no GROUP BY (clean under ONLY_FULL_GROUP_BY).
CREATE VIEW timecard_weekly AS
SELECT
  e.id AS entry_id,
  e.pay_period_id,
  e.employee_id,
  p.start_date,
  p.end_date,
  p.status AS period_status,
  COALESCE(d.worked_hours, 0) AS worked_hours,
  COALESCE(d.vacation_hours, 0) AS vacation_hours,
  COALESCE(d.sick_safe_paid_hours, 0) AS sick_safe_paid_hours,
  COALESCE(d.protected_unpaid_hours, 0) AS protected_unpaid_hours,
  COALESCE(d.prenatal_hours, 0) AS prenatal_hours,
  COALESCE(d.holiday_hours, 0) AS holiday_hours,
  COALESCE(d.holiday_worked_hours, 0) AS holiday_worked_hours,
  comp.overtime_status,
  comp.pay_type,
  comp.rate,
  CASE WHEN comp.overtime_status = 'NON_EXEMPT'
       THEN LEAST(COALESCE(d.worked_hours, 0), 40)
       ELSE COALESCE(d.worked_hours, 0)
  END AS reg_hours,
  CASE WHEN comp.overtime_status <> 'NON_EXEMPT' THEN 0
       ELSE COALESCE(e.ot_override_hours, GREATEST(COALESCE(d.worked_hours, 0) - 40, 0))
  END AS ot_hours,
  (e.ot_override_hours IS NOT NULL) AS has_ot_override,
  (comp.overtime_status = 'REVIEW') AS needs_classification_review,
  e.bonus_amount,
  e.reimb_amount,
  e.spread_days,
  e.call_in_hours,
  e.notes
FROM timecard_entries e
JOIN pay_periods p ON p.id = e.pay_period_id
LEFT JOIN (
  SELECT entry_id,
    SUM(CASE WHEN day_type IN ('WORK','HOLIDAY_WORKED') THEN hours ELSE 0 END) AS worked_hours,
    SUM(CASE WHEN day_type = 'VACATION' THEN hours ELSE 0 END) AS vacation_hours,
    SUM(CASE WHEN day_type = 'SICK_SAFE_PAID' THEN hours ELSE 0 END) AS sick_safe_paid_hours,
    SUM(CASE WHEN day_type = 'PROTECTED_UNPAID' THEN hours ELSE 0 END) AS protected_unpaid_hours,
    SUM(CASE WHEN day_type = 'PRENATAL' THEN hours ELSE 0 END) AS prenatal_hours,
    SUM(CASE WHEN day_type = 'HOLIDAY' THEN hours ELSE 0 END) AS holiday_hours,
    SUM(CASE WHEN day_type = 'HOLIDAY_WORKED' THEN hours ELSE 0 END) AS holiday_worked_hours
  FROM timecard_days GROUP BY entry_id
) d ON d.entry_id = e.id
LEFT JOIN LATERAL (
  SELECT c.overtime_status, c.pay_type, c.rate
    FROM employee_compensation c
   WHERE c.employee_id = e.employee_id
     AND c.effective_from <= p.end_date
     AND (c.effective_to IS NULL OR c.effective_to >= p.end_date)
   ORDER BY c.effective_from DESC LIMIT 1
) AS comp ON TRUE;
-- Notes: only WORK+HOLIDAY_WORKED count toward the 40 (leave treatment beyond
-- that is REQUIRES_CONFIRMATION). REVIEW resolves to no automatic OT.

-- ---------- leave_types (extensible: new type = INSERT, never DDL) ----------
CREATE TABLE leave_types (
    code       VARCHAR(32) PRIMARY KEY,
    label      VARCHAR(100) NOT NULL,
    is_paid    BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order SMALLINT NOT NULL DEFAULT 0
);
INSERT INTO leave_types (code, label, is_paid, sort_order) VALUES
  ('VACATION', 'Vacation', TRUE, 1),
  ('SICK_SAFE_PAID', 'Sick / Safe (paid)', TRUE, 2),
  ('PROTECTED_UNPAID', 'Protected leave (unpaid)', FALSE, 3),
  ('PRENATAL', 'Prenatal (paid, separate balance)', TRUE, 4);

-- ---------- leave_policies (configurable accrual rules per type) ----------
CREATE TABLE leave_policies (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    leave_type           VARCHAR(32) NOT NULL,
    accrual_method       ENUM('PER_HOURS_WORKED','FRONTLOAD') NOT NULL,
    accrual_rate         DECIMAL(8,5) NULL,                 -- e.g. 1/30 = 0.03333
    frontload_hours      DECIMAL(6,2) NULL,
    annual_use_cap_hours DECIMAL(6,2) NULL,
    carryover            BOOLEAN NOT NULL DEFAULT TRUE,     -- FALSE for PROTECTED_UNPAID
    effective_from       DATE NOT NULL,
    CONSTRAINT fk_policy_type FOREIGN KEY (leave_type) REFERENCES leave_types(code) ON DELETE RESTRICT,
    UNIQUE (leave_type, effective_from)
);

-- ---------- leave_ledger (append-only; balance = SUM(hours)) ----------
CREATE TABLE leave_ledger (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    employee_id   INT NOT NULL,
    leave_type    VARCHAR(32) NOT NULL,
    entry_type    ENUM('ACCRUAL','USAGE','ADJUSTMENT') NOT NULL,
    hours         DECIMAL(6,2) NOT NULL,                    -- +accrual / -usage / signed adjustment
    pay_period_id INT NULL,
    reason        TEXT NULL,                               -- mandatory for ADJUSTMENT
    created_by    INT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ledger_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_ledger_type FOREIGN KEY (leave_type) REFERENCES leave_types(code) ON DELETE RESTRICT,
    CONSTRAINT fk_ledger_period FOREIGN KEY (pay_period_id) REFERENCES pay_periods(id) ON DELETE RESTRICT,
    CONSTRAINT fk_ledger_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CHECK (entry_type <> 'ADJUSTMENT' OR reason IS NOT NULL)
);
CREATE INDEX idx_ledger_employee_type ON leave_ledger(employee_id, leave_type);

CREATE VIEW leave_balances AS
SELECT employee_id, leave_type, SUM(hours) AS balance_hours
FROM leave_ledger GROUP BY employee_id, leave_type;

-- ---------- audit_log (append-only event log) ----------
CREATE TABLE audit_log (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    occurred_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_user_id INT NULL,                                -- NULL = system/unauthenticated
    action        VARCHAR(50) NOT NULL,                    -- e.g. period.submit, timecard.update
    entity_table  VARCHAR(100) NOT NULL,
    entity_id     INT NOT NULL,
    before_json   JSON NULL,
    after_json    JSON NULL,
    reason        TEXT NULL,                               -- mandatory for return/reopen/override/adjustment
    request_id    VARCHAR(64) NULL,
    ip_address    VARCHAR(45) NULL,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_audit_entity ON audit_log(entity_table, entity_id);
CREATE INDEX idx_audit_occurred ON audit_log(occurred_at);
-- Append-only is enforced by convention + restricted app-user grants in
-- production (no UPDATE/DELETE on this table for the app role).

-- ---------- attachments (scanned cards, receipts; storage_key is S3-ready) ----------
CREATE TABLE attachments (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    entry_id    INT NOT NULL,
    file_name   VARCHAR(255) NOT NULL,
    storage_key VARCHAR(255) NOT NULL,                     -- opaque relative key, never an absolute path/URL
    uploaded_by INT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_attach_entry FOREIGN KEY (entry_id) REFERENCES timecard_entries(id) ON DELETE RESTRICT,
    CONSTRAINT fk_attach_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ---------- cash_payments (company control log, not a separate payroll) ----------
CREATE TABLE cash_payments (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    entry_id              INT NOT NULL,
    amount                DECIMAL(10,2) NOT NULL,
    paid_on               DATE NOT NULL,
    paid_by               INT NOT NULL,
    receipt_attachment_id INT NULL,
    wage_statement_issued_at TIMESTAMP NULL DEFAULT NULL,
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cash_entry FOREIGN KEY (entry_id) REFERENCES timecard_entries(id) ON DELETE RESTRICT,
    CONSTRAINT fk_cash_payer FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_cash_receipt FOREIGN KEY (receipt_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL,
    CHECK (amount > 0)
);
-- Cash employees are tracked, calculated, approved, reported and exported
-- exactly like everyone else. Receipts are a company control; whether they
-- are statutorily required is REQUIRES_CONFIRMATION (CPA/legal).

-- ---------- export_log (proof of what the CPA received) ----------
CREATE TABLE export_log (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    pay_period_id INT NOT NULL,
    exported_by   INT NULL,
    exported_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    file_name     VARCHAR(255) NOT NULL,
    file_sha256   VARCHAR(64) NULL,
    sent_to_cpa_at TIMESTAMP NULL DEFAULT NULL,
    CONSTRAINT fk_export_period FOREIGN KEY (pay_period_id) REFERENCES pay_periods(id) ON DELETE RESTRICT,
    CONSTRAINT fk_export_user FOREIGN KEY (exported_by) REFERENCES users(id) ON DELETE SET NULL
);
-- Export column layout stays PROVISIONAL until the real CPA samples arrive.

-- ---------- settings (owner-configurable thresholds etc.) ----------
CREATE TABLE settings (
    `key` VARCHAR(100) PRIMARY KEY,
    value JSON NOT NULL
);

-- ---------- sessions (Day-2 auth store; table first so no later migration) ----------
CREATE TABLE sessions (
    session_id VARCHAR(128) PRIMARY KEY,
    expires    INT UNSIGNED NOT NULL,
    data       MEDIUMTEXT NULL
);
