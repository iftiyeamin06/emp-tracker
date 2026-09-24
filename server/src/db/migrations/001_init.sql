-- 001_init.sql — Spec v4 canonical schema
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    full_name     VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    role          VARCHAR(10) NOT NULL CHECK (role IN ('admin','owner')),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE employees (
    id              SERIAL PRIMARY KEY,
    employee_number VARCHAR(50) UNIQUE NOT NULL,
    full_name       VARCHAR(255) NOT NULL,
    pay_type        CHAR(1) NOT NULL DEFAULT 'H' CHECK (pay_type IN ('H','S')),
    is_overtime_eligible BOOLEAN NOT NULL DEFAULT TRUE,
    default_weekly_hours NUMERIC(5,2),
    hourly_rate     NUMERIC(8,2),
    weekly_salary   NUMERIC(8,2),
    exempt_basis    TEXT,
    payment_method  VARCHAR(15) NOT NULL DEFAULT 'direct_deposit'
                    CHECK (payment_method IN ('check','direct_deposit','cash')),
    pay_notice_signed_on DATE,
    hire_date       DATE NOT NULL,
    termination_date DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (termination_date IS NULL OR termination_date >= hire_date)
);

CREATE TABLE pay_periods (
    id           SERIAL PRIMARY KEY,
    start_date   DATE NOT NULL,
    end_date     DATE NOT NULL,
    pay_date     DATE NOT NULL,
    status       VARCHAR(10) NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','submitted','approved')),
    submitted_by INT REFERENCES users(id),
    submitted_at TIMESTAMPTZ,
    approved_by  INT REFERENCES users(id),
    approved_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (start_date),
    CHECK (end_date = start_date + 6),
    CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE timecard_entries (
    id             SERIAL PRIMARY KEY,
    pay_period_id  INT NOT NULL REFERENCES pay_periods(id) ON DELETE RESTRICT,
    employee_id    INT NOT NULL REFERENCES employees(id)   ON DELETE RESTRICT,
    hours_worked   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (hours_worked BETWEEN 0 AND 168),
    vac_hours      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (vac_hours  >= 0),
    hol_hours      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (hol_hours  >= 0),
    sick_hours     NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (sick_hours >= 0),
    unpaid_sick_hours NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (unpaid_sick_hours >= 0),
    prenatal_hours NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (prenatal_hours >= 0),
    spread_days    SMALLINT NOT NULL DEFAULT 0 CHECK (spread_days BETWEEN 0 AND 7),
    call_in_hours  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (call_in_hours >= 0),
    bonus_amount   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
    reimb_amount   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (reimb_amount >= 0),
    ot_override_hours  NUMERIC(5,2),
    ot_override_reason TEXT,
    notes          TEXT,
    created_by     INT REFERENCES users(id),
    updated_by     INT REFERENCES users(id),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (pay_period_id, employee_id),
    CHECK (ot_override_hours IS NULL OR ot_override_reason IS NOT NULL)
);

CREATE TABLE holidays (
    id            SERIAL PRIMARY KEY,
    holiday_date  DATE NOT NULL UNIQUE,
    name          VARCHAR(100) NOT NULL,
    default_hours NUMERIC(4,2) NOT NULL DEFAULT 8
);

CREATE TABLE holiday_substitutions (
    id              SERIAL PRIMARY KEY,
    holiday_id      INT NOT NULL REFERENCES holidays(id),
    employee_id     INT NOT NULL REFERENCES employees(id),
    substitute_date DATE NOT NULL,
    granted_by      INT NOT NULL REFERENCES users(id),
    reason          TEXT,
    UNIQUE (holiday_id, employee_id)
);

CREATE TABLE holiday_credits (
    id          SERIAL PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(id),
    holiday_id  INT NOT NULL REFERENCES holidays(id),
    earned_on   DATE NOT NULL,
    status      VARCHAR(10) NOT NULL DEFAULT 'owed'
                CHECK (status IN ('owed','used','paid_out','expired')),
    redeemed_on DATE,
    granted_by  INT REFERENCES users(id),
    expires_on  DATE,
    note        TEXT,
    UNIQUE (employee_id, holiday_id)
);

CREATE TABLE timecard_days (
    id         SERIAL PRIMARY KEY,
    entry_id   INT NOT NULL REFERENCES timecard_entries(id) ON DELETE RESTRICT,
    work_date  DATE NOT NULL,
    day_type   VARCHAR(14) NOT NULL DEFAULT 'work' CHECK (day_type IN
               ('work','vacation','sick','sick_unpaid','prenatal','holiday','holiday_worked','holiday_credit')),
    hours      NUMERIC(4,2) NOT NULL CHECK (hours BETWEEN 0 AND 24),
    time_in    TIME,
    time_out   TIME,
    unpaid_break_min SMALLINT NOT NULL DEFAULT 0,
    holiday_id INT REFERENCES holidays(id),
    credit_id  INT REFERENCES holiday_credits(id),
    note       TEXT,
    UNIQUE (entry_id, work_date, day_type)
);

CREATE FUNCTION refresh_entry_totals() RETURNS trigger AS $$
DECLARE eid INT := COALESCE(NEW.entry_id, OLD.entry_id);
BEGIN
  UPDATE timecard_entries SET
    hours_worked      = COALESCE((SELECT SUM(hours) FROM timecard_days WHERE entry_id = eid AND day_type IN ('work','holiday_worked')), 0),
    vac_hours         = COALESCE((SELECT SUM(hours) FROM timecard_days WHERE entry_id = eid AND day_type = 'vacation'), 0),
    sick_hours        = COALESCE((SELECT SUM(hours) FROM timecard_days WHERE entry_id = eid AND day_type = 'sick'), 0),
    unpaid_sick_hours = COALESCE((SELECT SUM(hours) FROM timecard_days WHERE entry_id = eid AND day_type = 'sick_unpaid'), 0),
    prenatal_hours    = COALESCE((SELECT SUM(hours) FROM timecard_days WHERE entry_id = eid AND day_type = 'prenatal'), 0),
    hol_hours         = COALESCE((SELECT SUM(hours) FROM timecard_days WHERE entry_id = eid AND day_type IN ('holiday','holiday_credit')), 0)
  WHERE id = eid;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_days_totals
AFTER INSERT OR UPDATE OR DELETE ON timecard_days
FOR EACH ROW EXECUTE FUNCTION refresh_entry_totals();

CREATE VIEW timecard_calculated AS
SELECT t.*,
  CASE WHEN e.is_overtime_eligible THEN LEAST(t.hours_worked, 40)
       ELSE t.hours_worked END AS reg_hours,
  CASE WHEN NOT e.is_overtime_eligible THEN 0
       ELSE COALESCE(t.ot_override_hours, GREATEST(t.hours_worked - 40, 0)) END AS ot_hours
FROM timecard_entries t
JOIN employees e ON e.id = t.employee_id;

CREATE TABLE leave_policies (
    id                   SERIAL PRIMARY KEY,
    leave_type           VARCHAR(12) NOT NULL
                         CHECK (leave_type IN ('vacation','sick','sick_unpaid','prenatal')),
    is_paid              BOOLEAN NOT NULL DEFAULT TRUE,
    accrual_method       VARCHAR(16) NOT NULL CHECK (accrual_method IN ('per_hours_worked','frontload')),
    accrual_rate         NUMERIC(8,5),
    frontload_hours      NUMERIC(6,2),
    annual_use_cap_hours NUMERIC(6,2),
    carryover            BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from       DATE NOT NULL,
    UNIQUE (leave_type, effective_from)
);

CREATE TABLE leave_ledger (
    id            SERIAL PRIMARY KEY,
    employee_id   INT NOT NULL REFERENCES employees(id),
    leave_type    VARCHAR(12) NOT NULL CHECK (leave_type IN ('vacation','sick','sick_unpaid','prenatal')),
    entry_type    VARCHAR(12) NOT NULL CHECK (entry_type IN ('accrual','usage','adjustment')),
    hours         NUMERIC(6,2) NOT NULL,
    pay_period_id INT REFERENCES pay_periods(id),
    reason        TEXT,
    created_by    INT REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (entry_type <> 'adjustment' OR reason IS NOT NULL)
);

CREATE VIEW leave_balances AS
SELECT employee_id, leave_type, SUM(hours) AS balance_hours
FROM leave_ledger GROUP BY employee_id, leave_type;

CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id     INT REFERENCES users(id),
    table_name  TEXT NOT NULL,
    record_id   INT NOT NULL,
    action      VARCHAR(10) NOT NULL,
    old_values  JSONB,
    new_values  JSONB,
    reason      TEXT
);
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

CREATE TABLE attachments (
    id           SERIAL PRIMARY KEY,
    entry_id     INT NOT NULL REFERENCES timecard_entries(id),
    file_name    TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    uploaded_by  INT REFERENCES users(id),
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE export_log (
    id            SERIAL PRIMARY KEY,
    pay_period_id INT NOT NULL REFERENCES pay_periods(id),
    exported_by   INT REFERENCES users(id),
    exported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    file_name     TEXT NOT NULL,
    file_sha256   TEXT,
    sent_to_cpa_at TIMESTAMPTZ
);

CREATE TABLE wage_rules (
    id             SERIAL PRIMARY KEY,
    rule_key       TEXT NOT NULL,
    value          NUMERIC(10,2) NOT NULL,
    effective_from DATE NOT NULL,
    source_note    TEXT,
    UNIQUE (rule_key, effective_from)
);
INSERT INTO wage_rules (rule_key, value, effective_from, source_note) VALUES
  ('min_wage_nyc', 17.00, '2026-01-01', 'NYS minimum wage, NYC/Long Island/Westchester'),
  ('exempt_weekly_salary_nyc', 1275.00, '2026-01-01', 'Exec/admin exemption; duties test also required'),
  ('ot_threshold_hours', 40, '2026-01-01', 'Weekly, non-exempt');

CREATE TABLE cash_payments (
    id            SERIAL PRIMARY KEY,
    entry_id      INT NOT NULL REFERENCES timecard_entries(id),
    amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    paid_on       DATE NOT NULL,
    paid_by       INT NOT NULL REFERENCES users(id),
    receipt_attachment_id INT REFERENCES attachments(id),
    wage_statement_issued_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
);

CREATE FUNCTION enforce_period_open() RETURNS trigger AS $$
DECLARE p_status TEXT;
BEGIN
  SELECT status INTO p_status FROM pay_periods
   WHERE id = COALESCE(NEW.pay_period_id, OLD.pay_period_id);
  IF p_status <> 'open' THEN
    RAISE EXCEPTION 'Pay period is % and cannot be edited', p_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_timecard_lock
BEFORE INSERT OR UPDATE OR DELETE ON timecard_entries
FOR EACH ROW EXECUTE FUNCTION enforce_period_open();

CREATE INDEX idx_entries_emp_period ON timecard_entries(employee_id, pay_period_id);
CREATE INDEX idx_audit_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_ledger_emp_type ON leave_ledger(employee_id, leave_type);
