import type { Db, Tx } from "../employees/employees.service.js";
import { writeAudit } from "../../lib/audit.js";

// V1 day-type mapping. The API speaks 4 codes; the DB enum is wider.
// SICK means SICK_SAFE_PAID here (protected-unpaid/prenatal/holiday-worked
// rows can only exist outside v1 and pass through untouched on reads).
const TO_DB: Record<string, string> = { WORK: "WORK", HOLIDAY: "HOLIDAY", SICK: "SICK_SAFE_PAID", VACATION: "VACATION" };
const FROM_DB: Record<string, string> = { WORK: "WORK", HOLIDAY: "HOLIDAY", SICK_SAFE_PAID: "SICK", VACATION: "VACATION" };
const V1_TYPES = Object.keys(TO_DB);

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const isTime = (s: unknown): boolean =>
  s === undefined || s === null || (typeof s === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(s));

const isMoney = (n: unknown): boolean => typeof n === "number" && !Number.isNaN(n) && n >= 0;

export interface DayInput {
  work_date: string;
  day_type: string;
  hours: number;
  time_in?: string;
  time_out?: string;
}

export interface RowInput {
  employee_id: number;
  days: DayInput[];
  bonus_amount?: number;
  reimbursement_amount?: number;
  notes?: string;
}

export interface PeriodRow {
  id: number;
  start_date: unknown;
  end_date: unknown;
}

async function getPeriod(conn: Tx, periodId: number): Promise<PeriodRow> {
  const [rows] = await conn.query("SELECT id, start_date, end_date, status FROM pay_periods WHERE id = ? LIMIT 1", [
    periodId,
  ]);
  const p = (rows as any[])[0];
  if (!p) fail(404, "pay_period_not_found");
  return p as PeriodRow;
}

const ymd = (v: unknown): string => {
  const d = new Date(v as any);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function validateRows(period: PeriodRow, rows: RowInput[]): void {
  if (!Array.isArray(rows)) fail(400, "rows_required");
  const start = ymd(period.start_date);
  const end = ymd(period.end_date);
  for (const r of rows) {
    if (!r || typeof r.employee_id !== "number") fail(400, "employee_id_required");
    if (!Array.isArray(r.days)) fail(400, "days_required");
    if (r.bonus_amount !== undefined && !isMoney(r.bonus_amount)) fail(400, "bonus_amount_invalid");
    if (r.reimbursement_amount !== undefined && !isMoney(r.reimbursement_amount)) fail(400, "reimbursement_amount_invalid");
    for (const d of r.days) {
      if (!isDate(d.work_date)) fail(400, "work_date_invalid");
      if (d.work_date < start || d.work_date > end) fail(400, "work_date_outside_period");
      if (!V1_TYPES.includes(d.day_type)) fail(400, "day_type_invalid");
      if (typeof d.hours !== "number" || Number.isNaN(d.hours) || d.hours < 0 || d.hours > 24)
        fail(400, "hours_invalid");
      if (!isTime(d.time_in) || !isTime(d.time_out)) fail(400, "time_invalid");
    }
  }
}

export interface GridRow {
  employee: Record<string, unknown>;
  entry: { id: number; bonus_amount: unknown; reimbursement_amount: unknown; notes: unknown } | null;
  days: Record<string, unknown>[];
  computed: Record<string, unknown> | null;
}

// One row per employee active during the period, with days + view-computed totals.
export async function getGrid(db: Db, periodId: number): Promise<{ period: PeriodRow; rows: GridRow[] }> {
  const period = await getPeriod(db, periodId);
  const [emps] = await db.query(
    `SELECT id, employee_number, full_name FROM employees
      WHERE hire_date <= ? AND (termination_date IS NULL OR termination_date >= ?)
      ORDER BY full_name, id`,
    [ymd(period.end_date), ymd(period.start_date)]
  );
  const employees = emps as any[];
  const [entries] = await db.query("SELECT * FROM timecard_entries WHERE pay_period_id = ?", [periodId]);
  const entryByEmp = new Map((entries as any[]).map((e) => [e.employee_id, e]));
  const entryIds = [...entryByEmp.values()].map((e: any) => e.id);
  let daysByEntry = new Map<number, any[]>();
  let computedByEntry = new Map<number, any>();
  if (entryIds.length > 0) {
    const [days] = await db.query(
      "SELECT entry_id, work_date, day_type, hours, time_in, time_out FROM timecard_days WHERE entry_id IN (?) ORDER BY work_date",
      [entryIds]
    );
    for (const d of days as any[]) {
      const list = daysByEntry.get(d.entry_id) ?? [];
      list.push({ ...d, day_type: FROM_DB[d.day_type] ?? d.day_type });
      daysByEntry.set(d.entry_id, list);
    }
    const [comp] = await db.query(
      "SELECT entry_id, worked_hours, reg_hours, ot_hours, holiday_hours, sick_safe_paid_hours, vacation_hours FROM timecard_weekly WHERE entry_id IN (?)",
      [entryIds]
    );
    for (const c of comp as any[]) computedByEntry.set(c.entry_id, c);
  }
  const rows: GridRow[] = employees.map((e) => {
    const entry = entryByEmp.get(e.id);
    return {
      employee: e,
      entry: entry
        ? { id: entry.id, bonus_amount: entry.bonus_amount, reimbursement_amount: entry.reimb_amount, notes: entry.notes }
        : null,
      days: entry ? daysByEntry.get(entry.id) ?? [] : [],
      computed: entry ? computedByEntry.get(entry.id) ?? null : null,
    };
  });
  return { period, rows };
}

// Upserts entries + days + audit rows. Caller MUST hold the period lock
// (assertPeriodOpen inside its transaction) before calling.
export async function saveGrid(
  conn: Tx,
  period: PeriodRow,
  actorId: number,
  ip: string | undefined,
  rows: RowInput[]
): Promise<number> {
  validateRows(period, rows);
  let saved = 0;
  for (const r of rows) {
    const [ex] = await conn.query("SELECT id FROM employees WHERE id = ? LIMIT 1", [r.employee_id]);
    if ((ex as any[]).length === 0) fail(400, "employee_not_found");
    const [ee] = await conn.query("SELECT id FROM timecard_entries WHERE pay_period_id = ? AND employee_id = ? LIMIT 1", [
      period.id,
      r.employee_id,
    ]);
    let entryId: number;
    let created = false;
    if ((ee as any[]).length === 0) {
      const [ins] = await conn.query(
        "INSERT INTO timecard_entries (pay_period_id, employee_id, bonus_amount, reimb_amount, notes) VALUES (?, ?, ?, ?, ?)",
        [period.id, r.employee_id, r.bonus_amount ?? 0, r.reimbursement_amount ?? 0, r.notes ?? null]
      );
      entryId = (ins as any).insertId;
      created = true;
    } else {
      entryId = (ee as any[])[0].id;
      await conn.query(
        "UPDATE timecard_entries SET bonus_amount = ?, reimb_amount = ?, notes = ? WHERE id = ?",
        [r.bonus_amount ?? 0, r.reimbursement_amount ?? 0, r.notes ?? null, entryId]
      );
    }
    const dates = r.days.map((d) => d.work_date);
    if (dates.length > 0) {
      await conn.query(`DELETE FROM timecard_days WHERE entry_id = ? AND work_date IN (?)`, [entryId, dates]);
      const values = r.days.map((d) => [entryId, d.work_date, TO_DB[d.day_type], d.hours, d.time_in ?? null, d.time_out ?? null]);
      await conn.query(
        "INSERT INTO timecard_days (entry_id, work_date, day_type, hours, time_in, time_out) VALUES ?",
        [values]
      );
    }
    const [[after]] = (await conn.query("SELECT * FROM timecard_entries WHERE id = ?", [entryId])) as any[];
    await writeAudit(conn, {
      actorUserId: actorId,
      action: created ? "timecard.create" : "timecard.update",
      entityTable: "timecard_entries",
      entityId: entryId,
      after,
      ip,
    });
    saved += 1;
  }
  return saved;
}
