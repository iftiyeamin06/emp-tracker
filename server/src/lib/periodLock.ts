import type { Pool, PoolConnection } from "mysql2/promise";

// LOCK CONTRACT (V1): there are no DB triggers, so every write to
// timecard_entries, timecard_days, or pay_periods MUST go through
// withOpenPeriod() below. It opens a transaction, re-reads the period status
// with SELECT ... FOR UPDATE (serializes concurrent submit/approve races),
// and aborts with 423 unless the period is OPEN.
//
// Status transitions themselves (submit/approve/return/reopen) use their own
// transition checks + audit writes; they never use this helper.
export async function assertPeriodOpen(conn: PoolConnection, payPeriodId: number): Promise<void> {
  const [rows] = await conn.query("SELECT status FROM pay_periods WHERE id = ? FOR UPDATE", [payPeriodId]);
  const status = (rows as any[])[0]?.status as string | undefined;
  if (!status) throw Object.assign(new Error("pay_period_not_found"), { status: 404 });
  if (status !== "OPEN")
    throw Object.assign(new Error(`pay_period_${status.toLowerCase()}_locked`), { status: 423 });
}

export async function withOpenPeriod<T>(
  pool: Pool,
  payPeriodId: number,
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await assertPeriodOpen(conn, payPeriodId);
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
