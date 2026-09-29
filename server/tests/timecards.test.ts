import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { connectionOptions } from "../src/db/pool.js";
import { assertPeriodOpen } from "../src/lib/periodLock.js";
import { createEmployee } from "../src/modules/employees/employees.service.js";
import { createPayPeriod } from "../src/modules/pay-periods/payPeriods.service.js";
import { getGrid, saveGrid } from "../src/modules/timecards/timecards.service.js";

const throwsStatus = async (fn: () => Promise<unknown>, status: number, pattern: RegExp) => {
  try {
    await fn();
  } catch (e: any) {
    assert.equal(e.status, status);
    assert.match(e.message, pattern);
    return;
  }
  assert.fail("expected throw");
};

async function setup(conn: any) {
  const { employee } = await createEmployee(conn, {
    employee_number: "TC" + Math.floor(Math.random() * 1e6),
    full_name: "Timecard Test",
    hire_date: "2026-09-01",
    compensation: { pay_type: "HOURLY", rate: 18, overtime_status: "NON_EXEMPT" },
  });
  const period = await createPayPeriod(conn, { start_date: "2031-10-04", end_date: "2031-10-10", pay_date: "2031-10-15" });
  return { eid: employee.id as number, pid: period.id as number };
}

const week = (eid: number) => ({
  employee_id: eid,
  days: ["2031-10-04", "2031-10-05", "2031-10-06", "2031-10-07", "2031-10-08"].map((d) => ({
    work_date: d,
    day_type: "WORK",
    hours: 8,
  })),
  bonus_amount: 50,
  reimbursement_amount: 20,
  notes: "good week",
});

describe("timecards (integration, rolled back)", () => {
  it("GET returns employees with empty days for a fresh period", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { eid, pid } = await setup(conn);
      const grid = await getGrid(conn, pid);
      const row = grid.rows.find((r: any) => r.employee.id === eid) as any;
      assert.ok(row);
      assert.equal(row.entry, null);
      assert.deepEqual(row.days, []);
      assert.equal(row.computed, null);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("PUT saves days and extras; GET returns them with computed totals", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { eid, pid } = await setup(conn);
      const period = (await getGrid(conn, pid)).period as any;
      const saved = await saveGrid(conn, period, 1, undefined, [week(eid)]);
      assert.equal(saved, 1);
      const grid = await getGrid(conn, pid);
      const row = grid.rows.find((r: any) => r.employee.id === eid) as any;
      assert.equal(row.days.length, 5);
      assert.equal(row.entry.bonus_amount, "50.00");
      assert.equal(row.entry.reimbursement_amount, "20.00");
      assert.equal(Number(row.computed.worked_hours), 40);
      assert.equal(Number(row.computed.reg_hours), 40);
      assert.equal(Number(row.computed.ot_hours), 0);
      const [audit] = await conn.query(
        "SELECT action FROM audit_log WHERE entity_table='timecard_entries' AND entity_id=?",
        [row.entry.id]
      );
      assert.equal((audit as any[])[0].action, "timecard.create");
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("SUBMITTED period rejects writes with 423", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { pid } = await setup(conn);
      await conn.query("UPDATE pay_periods SET status='SUBMITTED' WHERE id=?", [pid]);
      await throwsStatus(() => assertPeriodOpen(conn, pid), 423, /submitted_locked/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("day outside the period is 400", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { eid, pid } = await setup(conn);
      const period = (await getGrid(conn, pid)).period as any;
      const bad = week(eid);
      (bad.days as any[]).push({ work_date: "2031-10-13", day_type: "WORK", hours: 8 });
      await throwsStatus(() => saveGrid(conn, period, 1, undefined, [bad]), 400, /work_date_outside_period/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("invalid day_type is 400", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { eid, pid } = await setup(conn);
      const period = (await getGrid(conn, pid)).period as any;
      const bad = week(eid);
      (bad.days as any[])[0] = { work_date: "2031-10-04", day_type: "FUNDAY", hours: 8 };
      await throwsStatus(() => saveGrid(conn, period, 1, undefined, [bad]), 400, /day_type_invalid/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("hours above 24 is 400", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { eid, pid } = await setup(conn);
      const period = (await getGrid(conn, pid)).period as any;
      const bad = week(eid);
      (bad.days as any[])[0] = { work_date: "2031-10-04", day_type: "WORK", hours: 25 };
      await throwsStatus(() => saveGrid(conn, period, 1, undefined, [bad]), 400, /hours_invalid/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("HW8 stores HOLIDAY_WORKED and counts toward worked/OT", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { eid, pid } = await setup(conn);
      const period = (await getGrid(conn, pid)).period as any;
      const row = week(eid);
      (row.days as any[])[4] = { work_date: "2031-10-08", day_type: "HW8", hours: 8 };
      await saveGrid(conn, period, 1, undefined, [row]);
      const [days] = await conn.query("SELECT day_type FROM timecard_days WHERE work_date='2031-10-08'");
      assert.equal((days as any[])[0].day_type, "HOLIDAY_WORKED");
      const [w] = await conn.query("SELECT worked_hours, holiday_worked_hours FROM timecard_weekly WHERE employee_id=?", [eid]);
      assert.equal(Number((w as any[])[0].worked_hours), 40);
      assert.equal(Number((w as any[])[0].holiday_worked_hours), 8);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });
});
