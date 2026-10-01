import type { Db } from "../employees/employees.service.js";

// Read-only dashboard alerts. One function per alert; getAlerts collects
// them sorted red > amber > yellow (stable — within-severity order is the
// collection order below).
export interface Alert {
  code: "missing_entry" | "overtime" | "holiday" | "vacation" | "sick" | "holiday_worked" | "awaiting_approval" | "manual_ot_override" | "leave_overdraw" | "post_submit_edit";
  severity: "red" | "amber" | "yellow";
  employee_id: number | null;
  employee_name: string | null;
  message: string;
  detail: Record<string, unknown>;
}

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

// Calendar day in LOCAL time. DATE columns arrive as Date objects at local
// midnight — UTC getters would shift them a day back, so local getters for
// Dates, verbatim slice for strings.
const day = (v: unknown): string => {
  if (typeof v === "string") return v.slice(0, 10);
  const d = new Date(v as any);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isNaN(n) ? 0 : Math.round(n * 100) / 100;
};

interface PeriodRow {
  id: number;
  start_date: unknown;
  end_date: unknown;
  status: string;
  submitted_at: unknown;
}

// Active = employed during the period (hired on/before its end, not
// terminated before its start) with zero timecard_entries rows for it.
async function missingEntry(db: Db, period: PeriodRow): Promise<Alert[]> {
  const start = day(period.start_date);
  const end = day(period.end_date);
  const [rows] = await db.query(
    `SELECT e.id, e.full_name FROM employees e
      LEFT JOIN timecard_entries te
        ON te.employee_id = e.id AND te.pay_period_id = ?
     WHERE e.hire_date <= ? AND (e.termination_date IS NULL OR e.termination_date >= ?)
       AND te.id IS NULL
     ORDER BY e.full_name, e.id`,
    [period.id, end, start]
  );
  return (rows as any[]).map((r) => ({
    code: "missing_entry" as const,
    severity: "amber" as const,
    employee_id: r.id,
    employee_name: r.full_name,
    message: "No timecard entered for this period",
    detail: {},
  }));
}

// Surface any overtime amount the report view calculates. In particular,
// the view can calculate OT when no compensation row covers period end, so
// filtering on overtime_status here would hide OT already shown in the report.
// Same pass also flags paid time-off buckets (holiday, vacation, sick,
// worked-holiday) so a reviewer sees every non-regular hour at a glance.
async function overtime(db: Db, periodId: number): Promise<Alert[]> {
  const [rows] = await db.query(
    `SELECT w.employee_id, e.full_name, w.ot_hours,
            w.holiday_hours, w.vacation_hours, w.sick_safe_paid_hours, w.holiday_worked_hours
       FROM timecard_weekly w
       JOIN employees e ON e.id = w.employee_id
      WHERE w.pay_period_id = ?
        AND (w.ot_hours > 0 OR w.holiday_hours > 0 OR w.vacation_hours > 0
             OR w.sick_safe_paid_hours > 0 OR w.holiday_worked_hours > 0)
      ORDER BY e.full_name, e.id`,
    [periodId]
  );
  const out: Alert[] = [];
  for (const r of rows as any[]) {
    const buckets: { code: Alert["code"]; hours: number; message: string; detail: Record<string, unknown> }[] = [
      { code: "overtime", hours: num(r.ot_hours), message: `${num(r.ot_hours)} OT hours this week`, detail: { ot_hours: num(r.ot_hours) } },
      { code: "holiday", hours: num(r.holiday_hours), message: `${num(r.holiday_hours)} holiday hours this week`, detail: { holiday_hours: num(r.holiday_hours) } },
      { code: "vacation", hours: num(r.vacation_hours), message: `${num(r.vacation_hours)} vacation hours this week`, detail: { vacation_hours: num(r.vacation_hours) } },
      { code: "sick", hours: num(r.sick_safe_paid_hours), message: `${num(r.sick_safe_paid_hours)} sick hours this week`, detail: { sick_hours: num(r.sick_safe_paid_hours) } },
      { code: "holiday_worked", hours: num(r.holiday_worked_hours), message: `${num(r.holiday_worked_hours)} holiday-worked hours this week`, detail: { holiday_worked_hours: num(r.holiday_worked_hours) } },
    ];
    for (const b of buckets) {
      if (b.hours > 0) {
        out.push({
          code: b.code,
          severity: "amber" as const,
          employee_id: r.employee_id,
          employee_name: r.full_name,
          message: b.message,
          detail: b.detail,
        });
      }
    }
  }
  return out;
}

// SUBMITTED (and only SUBMITTED) periods waiting on the owner.
function awaitingApproval(period: PeriodRow): Alert[] {
  if (period.status !== "SUBMITTED" || !period.submitted_at) return [];
  const submitted = new Date(period.submitted_at as any);
  const days = Math.max(0, Math.floor((Date.now() - submitted.getTime()) / 86400000));
  const since = day(period.submitted_at);
  return [
    {
      code: "awaiting_approval" as const,
      severity: "yellow" as const,
      employee_id: null,
      employee_name: null,
      message: `Awaiting approval since ${since}, ${days} days ago`,
      detail: { submitted_at: since, days_waiting: days },
    },
  ];
}

export async function getAlerts(db: Db, periodId: number): Promise<Alert[]> {
  const [rows] = await db.query("SELECT id, start_date, end_date, status, submitted_at FROM pay_periods WHERE id = ? LIMIT 1", [
    periodId,
  ]);
  const period = (rows as any[])[0] as PeriodRow | undefined;
  if (!period) fail(404, "pay_period_not_found");
  const alerts = [
    ...(await missingEntry(db, period!)),
    ...(await overtime(db, periodId)),
    ...awaitingApproval(period!),
    ...(await manualOtOverride(db, periodId)),
    ...(await leaveOverdraw(db, periodId)),
    ...(await postSubmitEdit(db, period!)),
  ];
  const rank = { red: 0, amber: 1, yellow: 2 } as const;
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// Manual OT overrides on this period's entries. The override (and its
// reason) replaces the calculated OT, so it always deserves a look.
async function manualOtOverride(db: Db, periodId: number): Promise<Alert[]> {
  const [rows] = await db.query(
    `SELECT te.employee_id, e.full_name, te.ot_override_hours, te.ot_override_reason
       FROM timecard_entries te
       JOIN employees e ON e.id = te.employee_id
      WHERE te.pay_period_id = ? AND te.ot_override_hours IS NOT NULL
      ORDER BY e.full_name, e.id`,
    [periodId]
  );
  return (rows as any[]).map((r) => {
    const hours = num(r.ot_override_hours);
    return {
      code: "manual_ot_override" as const,
      severity: "amber" as const,
      employee_id: r.employee_id,
      employee_name: r.full_name,
      message: `OT overridden to ${hours} (reason: ${r.ot_override_reason})`,
      detail: { ot_override_hours: hours, ot_override_reason: r.ot_override_reason },
    };
  });
}

// Sick usage in this period that outruns the employee's current balance.
// Ledger usage rows are negative and the live balance already includes this
// period's usage, so an overdraw is simply balance < 0 while this period
// contributed usage — short by the balance's absolute value. (Reading the
// task's "balance - usage < 0" with stored-negative usage would double-count
// the period and never fire on the basic case.)
async function leaveOverdraw(db: Db, periodId: number): Promise<Alert[]> {
  const [rows] = await db.query(
    `SELECT u.employee_id, e.full_name, u.\`usage\`, COALESCE(b.balance_hours, 0) AS balance
       FROM (SELECT employee_id, SUM(hours) AS \`usage\` FROM leave_ledger
              WHERE pay_period_id = ? AND leave_type = 'SICK_SAFE_PAID' AND entry_type = 'usage'
              GROUP BY employee_id) u
       JOIN employees e ON e.id = u.employee_id
       LEFT JOIN leave_balances b ON b.employee_id = u.employee_id AND b.leave_type = 'SICK_SAFE_PAID'
      ORDER BY e.full_name, e.id`,
    [periodId]
  );
  const out: Alert[] = [];
  for (const r of rows as any[]) {
    const usage = num(r.usage);
    const balance = num(r.balance);
    if (usage < 0 && balance < 0) {
      out.push({
        code: "leave_overdraw" as const,
        severity: "red" as const,
        employee_id: r.employee_id,
        employee_name: r.full_name,
        message: `Sick leave overdraw by ${-balance} hours`,
        detail: { usage, balance_after: balance },
      });
    }
  }
  return out;
}

// Edits to timecard rows after the period was submitted. One alert per audit
// row; OPEN periods (submitted_at NULL) never qualify.
async function postSubmitEdit(db: Db, period: PeriodRow): Promise<Alert[]> {
  if ((period.status !== "SUBMITTED" && period.status !== "APPROVED") || !period.submitted_at) return [];
  const [rows] = await db.query(
    `SELECT a.entity_table, a.action, a.occurred_at, a.actor_user_id,
            e.id AS employee_id, e.full_name AS employee_name
       FROM audit_log a
       LEFT JOIN timecard_entries te
         ON a.entity_table = 'timecard_entries' AND te.id = a.entity_id
       LEFT JOIN timecard_days td
         ON a.entity_table = 'timecard_days' AND td.id = a.entity_id
       LEFT JOIN timecard_entries te2
         ON te2.id = td.entry_id
       LEFT JOIN employees e
         ON e.id = COALESCE(te.employee_id, te2.employee_id)
       LEFT JOIN timecard_entries te_scope
         ON te_scope.id = COALESCE(te.id, te2.id)
      WHERE a.entity_table IN ('timecard_entries', 'timecard_days')
        AND a.occurred_at > ?
        AND te_scope.pay_period_id = ?
      ORDER BY a.occurred_at, a.id`,
    [period.submitted_at, period.id]
  );
  return (rows as any[]).map((r) => ({
    code: "post_submit_edit" as const,
    severity: "red" as const,
    employee_id: r.employee_id ?? null,
    employee_name: r.employee_name ?? null,
    message: `Timecard ${r.action === "timecard.create" ? "added" : "edited"} after submission`,
    detail: { occurred_at: new Date(r.occurred_at).toISOString(), actor_user_id: r.actor_user_id },
  }));
}
