import type { Db, Tx } from "../employees/employees.service.js";

export interface PayPeriodInput {
  start_date: string; // YYYY-MM-DD, must be a Monday
  end_date: string; // must equal start_date + 6
  pay_date: string; // must be >= end_date
}

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const parseDay = (s: string): Date => new Date(s + "T00:00:00Z");

const fmt = (d: Date): string => d.toISOString().slice(0, 10);

function validate(p: PayPeriodInput): void {
  if (!p || typeof p !== "object") fail(400, "period_required");
  if (!isDate(p.start_date)) fail(400, "start_date_invalid");
  if (!isDate(p.end_date)) fail(400, "end_date_invalid");
  if (!isDate(p.pay_date)) fail(400, "pay_date_invalid");
  if (parseDay(p.start_date).getUTCDay() !== 1) fail(400, "start_date_not_monday");
  const expectedEnd = new Date(parseDay(p.start_date).getTime() + 6 * 86400000);
  if (p.end_date !== fmt(expectedEnd)) fail(400, "end_date_not_start_plus_six");
  if (p.pay_date < p.end_date) fail(400, "pay_date_before_end");
}

export async function listPayPeriods(db: Db): Promise<Record<string, unknown>[]> {
  const [rows] = await db.query(
    `SELECT id, start_date, end_date, pay_date, status,
            submitted_by, submitted_at, approved_by, approved_at, created_at
       FROM pay_periods ORDER BY start_date DESC`
  );
  return rows as Record<string, unknown>[];
}

// Validates, checks overlap, inserts. Caller owns the transaction and the
// audit write (both must commit atomically — hard rule 1).
export async function createPayPeriod(conn: Tx, p: PayPeriodInput): Promise<Record<string, unknown>> {
  validate(p);
  const [overlap] = await conn.query(
    "SELECT id FROM pay_periods WHERE start_date <= ? AND end_date >= ? LIMIT 1",
    [p.end_date, p.start_date]
  );
  if ((overlap as any[]).length > 0) fail(409, "period_overlaps_existing");
  let id: number;
  try {
    const [r] = await conn.query(
      "INSERT INTO pay_periods (start_date, end_date, pay_date, status) VALUES (?, ?, ?, 'OPEN')",
      [p.start_date, p.end_date, p.pay_date]
    );
    id = (r as any).insertId;
  } catch (err: any) {
    if (err?.errno === 1062) fail(409, "period_overlaps_existing");
    throw err;
  }
  const [[period]] = (await conn.query("SELECT * FROM pay_periods WHERE id = ?", [id!])) as any[];
  return period as Record<string, unknown>;
}
