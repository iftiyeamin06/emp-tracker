-- 002_v1_gaps.sql — append-only corrections (001 is applied; never edited).
--
-- 1. Extra leave types (extensible model: INSERTs, no DDL on consumers).
-- 2. Compensation: pay_frequency + human/CPA classification label.
--    Overlap prevention is enforced in the service layer (MySQL has no
--    exclusion constraints); overtime_status alone drives calculation.
-- 3. timecard_weekly resolves the OT threshold from wage_rules as of the
--    period end date (fallback 40 = documented default, not hard-coded law).

-- ---- 1. leave types ----
INSERT INTO leave_types (code, label, is_paid, sort_order) VALUES
  ('PERSONAL', 'Personal', TRUE, 5),
  ('OTHER', 'Other (company-defined)', TRUE, 6);

-- ---- 2. compensation columns ----
ALTER TABLE employee_compensation
  ADD COLUMN pay_frequency ENUM('WEEKLY','BIWEEKLY','MONTHLY') NULL
    COMMENT 'REQUIRES_CONFIRMATION: populated only if CPA needs frequency for export',
  ADD COLUMN classification VARCHAR(100) NULL
    COMMENT 'human/CPA label (e.g. Executive); overtime_status drives calculation, never salary';

-- ---- 3. threshold-driven weekly view (restated in full) ----
CREATE OR REPLACE VIEW timecard_weekly AS
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
  COALESCE(thr.ot_threshold, 40) AS weekly_threshold,
  CASE WHEN comp.overtime_status = 'NON_EXEMPT'
       THEN LEAST(COALESCE(d.worked_hours, 0), COALESCE(thr.ot_threshold, 40))
       ELSE COALESCE(d.worked_hours, 0)
  END AS reg_hours,
  CASE WHEN comp.overtime_status <> 'NON_EXEMPT' THEN 0
       ELSE COALESCE(e.ot_override_hours,
                     GREATEST(COALESCE(d.worked_hours, 0) - COALESCE(thr.ot_threshold, 40), 0))
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
) AS comp ON TRUE
LEFT JOIN LATERAL (
  SELECT w.value AS ot_threshold FROM wage_rules w
   WHERE w.rule_key = 'ot_threshold_hours' AND w.effective_from <= p.end_date
   ORDER BY w.effective_from DESC LIMIT 1
) AS thr ON TRUE;
