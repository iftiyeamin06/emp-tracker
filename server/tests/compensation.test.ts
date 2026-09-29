import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { connectionOptions } from "../src/db/pool.js";
import mysql from "mysql2/promise";

// Effective-dated compensation resolves through the real timecard_weekly view.
describe("compensation history (integration, rolled back)", () => {
  it("latest row as of the period end date wins", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const [re] = await conn.query("INSERT INTO employees (employee_number, full_name, hire_date) VALUES ('TC1','Comp T','2026-01-05')");
      const eid = (re as any).insertId;
      await conn.query(
        "INSERT INTO employee_compensation (employee_id, effective_from, effective_to, pay_type, rate, overtime_status) VALUES (?, '2026-01-01', '2026-06-30', 'SALARY', 1500.00, 'EXEMPT'), (?, '2026-07-01', NULL, 'HOURLY', 20.00, 'NON_EXEMPT')",
        [eid, eid]
      );
      const [rp] = await conn.query("INSERT INTO pay_periods (start_date, end_date, pay_date) VALUES ('2030-01-05','2030-01-11','2030-01-15')");
      const pid = (rp as any).insertId;
      const [rn] = await conn.query("INSERT INTO timecard_entries (pay_period_id, employee_id) VALUES (?, ?)", [pid, eid]);
      const nid = (rn as any).insertId;
      await conn.query("INSERT INTO timecard_days (entry_id, work_date, day_type, hours) VALUES (?, '2026-09-21', 'WORK', 9), (?, '2026-09-22', 'WORK', 9), (?, '2026-09-23', 'WORK', 9), (?, '2026-09-24', 'WORK', 9), (?, '2026-09-25', 'WORK', 9)", [nid, nid, nid, nid, nid]);
      const [w] = await conn.query("SELECT overtime_status, ot_hours FROM timecard_weekly WHERE entry_id=?", [nid]);
      assert.equal((w as any[])[0].overtime_status, "NON_EXEMPT");
      assert.equal(Number((w as any[])[0].ot_hours), 5);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });
});
