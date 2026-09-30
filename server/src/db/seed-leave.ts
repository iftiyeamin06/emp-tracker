import "dotenv/config";
import mysql from "mysql2/promise";
import { connectionOptions, pool } from "./pool.js";

// 2026 sick frontload: +40 SICK_SAFE_PAID accrual per active employee who
// has none yet. Skip is reason-agnostic — any existing sick accrual counts
// (seed rows AND on-hire auto-frontloads from any year), so re-running can
// never stack a second +40 on anyone. Safe to re-run. No rollover/reset here
// by design; no proration (flat +40 v1).
export async function frontloadSick2026(
  conn: mysql.PoolConnection | mysql.Connection
): Promise<number> {
  const [rows] = await conn.query(
    `SELECT id FROM employees
      WHERE termination_date IS NULL
        AND hire_date <= '2026-12-31'
        AND id NOT IN (
          SELECT employee_id FROM leave_ledger
          WHERE leave_type = 'SICK_SAFE_PAID'
            AND entry_type = 'accrual'
        )`
  );
  const ids = (rows as any[]).map((r) => r.id);
  if (ids.length === 0) return 0;
  const values = ids.map((id) => [id, "SICK_SAFE_PAID", "accrual", 40, null, "2026 frontload", null]);
  await conn.query(
    "INSERT INTO leave_ledger (employee_id, leave_type, entry_type, hours, pay_period_id, reason, created_by) VALUES ?",
    [values]
  );
  return ids.length;
}

async function main() {
  const n = await frontloadSick2026(pool);
  console.log(`frontloaded: ${n} employee(s)`);
  await pool.end();
}

// Only run when executed directly (npm run seed:leave), never on import.
// argv check works under both CJS and ESM tsx (require.main does not).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("seed-leave.ts") || process.argv[1]?.endsWith("seed-leave.js")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
