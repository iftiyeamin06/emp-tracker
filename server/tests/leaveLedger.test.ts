import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { connectionOptions } from "../src/db/pool.js";
import { frontloadSick2026 } from "../src/db/seed-leave.js";
import { createEmployee } from "../src/modules/employees/employees.service.js";
import { createPayPeriod } from "../src/modules/pay-periods/payPeriods.service.js";
import { getGrid, saveGrid } from "../src/modules/timecards/timecards.service.js";

async function setup(conn: any) {
  const { employee } = await createEmployee(conn, {
    employee_number: "LV" + Math.floor(Math.random() * 1e6),
    full_name: "Leave Test",
    hire_date: "2026-09-01",
    compensation: { pay_type: "HOURLY", rate: 18, overtime_status: "NON_EXEMPT" },
  });
  const period = await createPayPeriod(conn, { start_date: "2031-10-11", end_date: "2031-10-17", pay_date: "2031-10-20" });
  return { eid: employee.id as number, period };
}

const usageRows = async (conn: any, eid: number, pid: number) =>
  (await conn.query(
    "SELECT hours, entry_type, pay_period_id FROM leave_ledger WHERE employee_id=? AND leave_type='SICK_SAFE_PAID' AND entry_type='usage' AND pay_period_id=?",
    [eid, pid]
  ))[0] as any[];

describe("sick leave ledger (integration, rolled back)", () => {
  it("saving a SICK day inserts a -8 usage row", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { eid, period } = await setup(conn);
      await saveGrid(conn, period as any, 1, undefined, [
        { employee_id: eid, days: [{ work_date: "2031-10-13", day_type: "SICK", hours: 8 }] },
      ]);
      const rows = await usageRows(conn, eid, (period as any).id);
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].hours), -8);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("removing the SICK day deletes its usage row", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { eid, period } = await setup(conn);
      const pid = (period as any).id;
      await saveGrid(conn, period as any, 1, undefined, [
        { employee_id: eid, days: [{ work_date: "2031-10-13", day_type: "SICK", hours: 8 }] },
      ]);
      assert.equal((await usageRows(conn, eid, pid)).length, 1);
      await saveGrid(conn, period as any, 1, undefined, [{ employee_id: eid, days: [] }]);
      assert.equal((await usageRows(conn, eid, pid)).length, 0);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("changing SICK to WORK deletes the usage row", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { eid, period } = await setup(conn);
      const pid = (period as any).id;
      const day = { work_date: "2031-10-13", day_type: "SICK", hours: 8 };
      await saveGrid(conn, period as any, 1, undefined, [{ employee_id: eid, days: [day] }]);
      assert.equal((await usageRows(conn, eid, pid)).length, 1);
      await saveGrid(conn, period as any, 1, undefined, [
        { employee_id: eid, days: [{ ...day, day_type: "WORK" }] },
      ]);
      assert.equal((await usageRows(conn, eid, pid)).length, 0);
      const [days] = await conn.query("SELECT day_type FROM timecard_days WHERE work_date='2031-10-13'");
      assert.equal((days as any[])[0].day_type, "WORK");
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("balances sum accruals and usages (40 - 8 = 32)", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { eid } = await setup(conn); // setup hires → +40 on-hire accrual, no manual frontload needed
      await conn.query(
        "INSERT INTO leave_ledger (employee_id, leave_type, entry_type, hours) VALUES (?, 'SICK_SAFE_PAID', 'usage', -8)",
        [eid]
      );
      const [bal] = await conn.query(
        "SELECT leave_type, balance_hours FROM leave_balances WHERE employee_id=?",
        [eid]
      );
      const map: Record<string, number> = {};
      for (const b of bal as any[]) map[b.leave_type] = Number(b.balance_hours);
      assert.equal(map["SICK_SAFE_PAID"], 32);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("frontload seeds every active employee once (re-run is a no-op)", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const added = await frontloadSick2026(conn);
      assert.ok(added >= 0);
      // Every active employee now holds at least one sick accrual —
      // whether from this seed or an on-hire auto-frontload of any year.
      const [uncovered] = await conn.query(
        `SELECT COUNT(*) AS n FROM employees
          WHERE termination_date IS NULL AND hire_date <= '2026-12-31'
            AND id NOT IN (
              SELECT employee_id FROM leave_ledger
              WHERE leave_type='SICK_SAFE_PAID' AND entry_type='accrual'
            )`
      );
      assert.equal((uncovered as any[])[0].n, 0);
      assert.equal(await frontloadSick2026(conn), 0); // second run adds nothing
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("hire auto-inserts a +40 sick accrual in the same transaction", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const num = "HF" + Math.floor(Math.random() * 1e6);
      const { employee } = await createEmployee(
        conn,
        {
          employee_number: num,
          full_name: "Frontload Hire",
          hire_date: "2026-09-01",
          compensation: { pay_type: "HOURLY", rate: 18, overtime_status: "NON_EXEMPT" },
        },
        1
      );
      const eid = employee.id as number;
      const [rows] = await conn.query(
        "SELECT hours, reason, created_by, pay_period_id FROM leave_ledger WHERE employee_id=? AND leave_type='SICK_SAFE_PAID' AND entry_type='accrual'",
        [eid]
      );
      assert.equal((rows as any[]).length, 1);
      assert.equal(Number((rows as any[])[0].hours), 40);
      assert.equal((rows as any[])[0].reason, "Initial sick frontload on hire (2026 frontload)");
      assert.equal((rows as any[])[0].created_by, 1);
      assert.equal((rows as any[])[0].pay_period_id, null);
      const [bal] = await conn.query(
        "SELECT balance_hours FROM leave_balances WHERE employee_id=? AND leave_type='SICK_SAFE_PAID'",
        [eid]
      );
      assert.equal(Number((bal as any[])[0].balance_hours), 40);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("seed never double-grants an on-hire frontload", async () => {    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const num = "HD" + Math.floor(Math.random() * 1e6);
      const { employee } = await createEmployee(
        conn,
        {
          employee_number: num,
          full_name: "Double Grant Check",
          hire_date: "2026-09-01",
          compensation: { pay_type: "HOURLY", rate: 18, overtime_status: "NON_EXEMPT" },
        },
        1
      );
      await frontloadSick2026(conn);
      const [rows] = await conn.query(
        "SELECT COUNT(*) AS n FROM leave_ledger WHERE employee_id=? AND leave_type='SICK_SAFE_PAID' AND entry_type='accrual'",
        [employee.id as number]
      );
      assert.equal((rows as any[])[0].n, 1);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("a failing ledger insert rolls back the whole hire (no employee left behind)", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const num = "HB" + Math.floor(Math.random() * 1e6);
      const sabotaged = {
        query: (sql: string, params?: unknown[]) => {
          if (/leave_ledger/i.test(sql)) throw Object.assign(new Error("ledger boom"), { errno: 9999 });
          return (conn as any).query(sql, params);
        },
      };
      await assert.rejects(() =>
        createEmployee(
          sabotaged as any,
          {
            employee_number: num,
            full_name: "Rollback Hire",
            hire_date: "2026-09-01",
            compensation: { pay_type: "HOURLY", rate: 18, overtime_status: "NON_EXEMPT" },
          },
          1
        )
      );
      await conn.rollback();
      const [rows] = await conn.query("SELECT id FROM employees WHERE employee_number=?", [num]);
      assert.equal((rows as any[]).length, 0);
    } finally {
      try {
        await conn.rollback();
      } catch {
        /* already rolled back */
      }
      await conn.end();
    }
  });

  it("seed skips an employee whose frontload reason is from any other year", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const num = "FY" + Math.floor(Math.random() * 1e6);
      const [r] = await conn.query(
        "INSERT INTO employees (employee_number, full_name, hire_date) VALUES (?, 'Old Frontload', '2026-01-15')",
        [num]
      );
      const eid = (r as any).insertId;
      await conn.query(
        "INSERT INTO leave_ledger (employee_id, leave_type, entry_type, hours, reason) VALUES (?, 'SICK_SAFE_PAID', 'accrual', 40, '2021 frontload')",
        [eid]
      );
      await frontloadSick2026(conn);
      const [rows] = await conn.query(
        "SELECT COUNT(*) AS n, SUM(hours) AS h FROM leave_ledger WHERE employee_id=? AND leave_type='SICK_SAFE_PAID' AND entry_type='accrual'",
        [eid]
      );
      assert.equal((rows as any[])[0].n, 1);
      assert.equal(Number((rows as any[])[0].h), 40);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });
});
