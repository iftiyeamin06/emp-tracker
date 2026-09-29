import type { Db, Tx } from "../employees/employees.service.js";
import { writeAudit } from "../../lib/audit.js";

export interface PayPeriodInput {
  start_date: string; // YYYY-MM-DD, must be a Saturday
  // end_date / pay_date are server-computed (start+6, start+13); caller
  // values, if sent, are ignored to prevent drift.
  end_date?: string;
  pay_date?: string;
}

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const parseDay = (s: string): Date => new Date(s + "T00:00:00Z");

const fmt = (d: Date): string => d.toISOString().slice(0, 10);

function validate(p: PayPeriodInput): { end_date: string; pay_date: string } {
  if (!p || typeof p !== "object") fail(400, "period_required");
  if (!isDate(p.start_date)) fail(400, "start_date_invalid");
  if (parseDay(p.start_date).getUTCDay() !== 6) fail(400, "start_date must be a Saturday");
  const t = parseDay(p.start_date).getTime();
  return { end_date: fmt(new Date(t + 6 * 86400000)), pay_date: fmt(new Date(t + 13 * 86400000)) };
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
  const computed = validate(p);
  const [overlap] = await conn.query(
    "SELECT id FROM pay_periods WHERE start_date <= ? AND end_date >= ? LIMIT 1",
    [computed.end_date, p.start_date]
  );
  if ((overlap as any[]).length > 0) fail(409, "period_overlaps_existing");
  let id: number;
  try {
    const [r] = await conn.query(
      "INSERT INTO pay_periods (start_date, end_date, pay_date, status) VALUES (?, ?, ?, 'OPEN')",
      [p.start_date, computed.end_date, computed.pay_date]
    );
    id = (r as any).insertId;
  } catch (err: any) {
    if (err?.errno === 1062) fail(409, "period_overlaps_existing");
    throw err;
  }
  const [[period]] = (await conn.query("SELECT * FROM pay_periods WHERE id = ?", [id!])) as any[];
  return period as Record<string, unknown>;
}

// submitPeriod / approvePeriod take an open transaction connection and lock
// the row (SELECT ... FOR UPDATE) before checking status, so concurrent
// transitions serialize. Caller owns begin/commit + audit is written here,
// atomically with the change. Wrong start status is 409 (transition
// conflict); 423 is reserved for entry/day writes on locked periods.
export async function submitPeriod(
  conn: Tx,
  actorId: number,
  ip: string | undefined,
  id: number
): Promise<Record<string, unknown>> {
  const [[p]] = (await conn.query("SELECT * FROM pay_periods WHERE id = ? FOR UPDATE", [id])) as any[];
  if (!p) fail(404, "pay_period_not_found");
  if (p.status !== "OPEN") fail(409, "period_not_open");
  await conn.query("UPDATE pay_periods SET status = 'SUBMITTED', submitted_by = ?, submitted_at = NOW() WHERE id = ?", [
    actorId,
    id,
  ]);
  const [[period]] = (await conn.query("SELECT * FROM pay_periods WHERE id = ?", [id])) as any[];
  await writeAudit(conn, {
    actorUserId: actorId,
    action: "status",
    entityTable: "pay_periods",
    entityId: id,
    before: { status: "OPEN" },
    after: { status: "SUBMITTED" },
    ip,
  });
  return period as Record<string, unknown>;
}

export async function approvePeriod(
  conn: Tx,
  actorId: number,
  ip: string | undefined,
  id: number
): Promise<Record<string, unknown>> {
  const [[p]] = (await conn.query("SELECT * FROM pay_periods WHERE id = ? FOR UPDATE", [id])) as any[];
  if (!p) fail(404, "pay_period_not_found");
  if (p.status !== "SUBMITTED") fail(409, "period_not_submitted");
  await conn.query("UPDATE pay_periods SET status = 'APPROVED', approved_by = ?, approved_at = NOW() WHERE id = ?", [
    actorId,
    id,
  ]);
  const [[period]] = (await conn.query("SELECT * FROM pay_periods WHERE id = ?", [id])) as any[];
  await writeAudit(conn, {
    actorUserId: actorId,
    action: "status",
    entityTable: "pay_periods",
    entityId: id,
    before: { status: "SUBMITTED" },
    after: { status: "APPROVED" },
    ip,
  });
  return period as Record<string, unknown>;
}
