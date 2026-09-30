import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { connectionOptions } from "../src/db/pool.js";
import { createEmployee } from "../src/modules/employees/employees.service.js";
import { createPayPeriod } from "../src/modules/pay-periods/payPeriods.service.js";
import { monthlyReport } from "../src/modules/reports/reports.service.js";
import { saveGrid } from "../src/modules/timecards/timecards.service.js";
import { getGrid } from "../src/modules/timecards/timecards.service.js";

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

async function setupEmp(conn: any, n: string) {
  const { employee } = await createEmployee(conn, {
    employee_number: n,
    full_name: "Monthly " + n,
    hire_date: "2026-09-01",
    compensation: { pay_type: "HOURLY", rate: 18, overtime_status: "NON_EXEMPT" },
  });
  return employee.id as number;
}

const workDays = (dates: string[], hours: number) =>
  dates.map((d) => ({ work_date: d, day_type: "WORK", hours }));

describe("monthly report (integration, rolled back)", () => {
  it("happy path: aggregates one period by employee", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const eid = await setupEmp(conn, "MR1");
      const period = await createPayPeriod(conn, { start_date: "2031-10-18", end_date: "2031-10-24", pay_date: "2031-10-27" });
      const grid = await getGrid(conn, period.id as number);
      await saveGrid(conn, grid.period as any, 1, undefined, [
        { employee_id: eid, days: workDays(["2031-10-20", "2031-10-21", "2031-10-22", "2031-10-23", "2031-10-24"], 8), bonus_amount: 50 },
      ]);
      const rep = await monthlyReport(conn, "2031-10");
      assert.equal(rep.month, "2031-10");
      assert.equal(rep.rows.length, 1);
      assert.deepEqual(rep.rows[0], {
        employee_id: eid, name: "Monthly MR1", cash: false, reg: 40, ot: 0, hol: 0, sick: 0, vacation: 0, bonus: 50, reimb: 0,
        weeks: [{ week_start: "2031-10-18", week_end: "2031-10-24", worked_hours: 40, reg: 40, ot: 0, hol: 0, sick: 0, vacation: 0, bonus: 50, reimb: 0 }],
      });
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("OT sums per week, never recomputed on the monthly total", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const eid = await setupEmp(conn, "MR2");
      const p1 = await createPayPeriod(conn, { start_date: "2031-10-18", end_date: "2031-10-24", pay_date: "2031-10-27" });
      const p2 = await createPayPeriod(conn, { start_date: "2031-10-25", end_date: "2031-10-31", pay_date: "2031-11-03" });
      const weeks = [
        { p: p1, dates: ["2031-10-20", "2031-10-21", "2031-10-22", "2031-10-23", "2031-10-24"], hrs: 9 },
        { p: p2, dates: ["2031-10-27", "2031-10-28", "2031-10-29", "2031-10-30", "2031-10-31"], hrs: 7 },
      ];
      for (const w of weeks) {
        const grid = await getGrid(conn, w.p.id as number);
        await saveGrid(conn, grid.period as any, 1, undefined, [{ employee_id: eid, days: workDays(w.dates, w.hrs) }]);
      }
      const rep = await monthlyReport(conn, "2031-10");
      const row = rep.rows.find((r) => r.employee_id === eid)!;
      // Week 1: 45h -> ot 5. Week 2: 35h -> ot 0. Monthly worked = 80, but OT stays 5.
      assert.equal(row.reg, 75);
      assert.equal(row.ot, 5);
      assert.deepEqual(
        row.weeks.map((w: any) => [w.week_start, w.reg, w.ot]),
        [["2031-10-18", 40, 5], ["2031-10-25", 35, 0]]
      );
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("boundary week splits days but attributes OT by majority month", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const eid = await setupEmp(conn, "MR4");
      // Mon Sep 30 2024 + Oct 1–4: 5 × 9h = 45h. Sep holds 1/7 days, Oct 4/7.
      const period = await createPayPeriod(conn, { start_date: "2024-09-28", end_date: "2024-10-04", pay_date: "2024-10-11" });
      const grid = await getGrid(conn, period.id as number);
      await saveGrid(conn, grid.period as any, 1, undefined, [{
        employee_id: eid,
        days: workDays(["2024-09-28", "2024-09-29", "2024-09-30", "2024-10-01", "2024-10-02"], 9),
      }]);
      const sep = await monthlyReport(conn, "2024-09");
      const sepRow = sep.rows.find((r) => r.employee_id === eid)!;
      assert.equal(sepRow.ot, 0); // week belongs to October
      assert.deepEqual(sepRow.weeks, []); // no attributed weeks
      const oct = await monthlyReport(conn, "2024-10");
      const octRow = oct.rows.find((r) => r.employee_id === eid)!;
      assert.equal(octRow.ot, 5);
      assert.equal(octRow.reg, 40);
      assert.deepEqual(octRow.weeks, [
        { week_start: "2024-09-28", week_end: "2024-10-04", worked_hours: 45, reg: 40, ot: 5, hol: 0, sick: 0, vacation: 0, bonus: 0, reimb: 0 },
      ]);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("rejects bad month and ignores other months", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      await throwsStatus(() => monthlyReport(conn, "october"), 400, /month_invalid/);
      await throwsStatus(() => monthlyReport(conn, "2026-13"), 400, /month_invalid/);
      const eid = await setupEmp(conn, "MR3");
      const period = await createPayPeriod(conn, { start_date: "2031-11-01", end_date: "2031-11-07", pay_date: "2031-11-10" });
      const grid = await getGrid(conn, period.id as number);
      await saveGrid(conn, grid.period as any, 1, undefined, [
        { employee_id: eid, days: workDays(["2031-11-01"], 8) },
      ]);
      const rep = await monthlyReport(conn, "2031-10");
      assert.ok(!rep.rows.some((r) => r.employee_id === eid));
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });
});
