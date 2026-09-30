import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import mysql from "mysql2/promise";
import { connectionOptions, pool } from "../src/db/pool.js";
import { createApp } from "../src/app.js";
import { createEmployee } from "../src/modules/employees/employees.service.js";
import { approvePeriod, createPayPeriod, submitPeriod } from "../src/modules/pay-periods/payPeriods.service.js";
import { writeAudit } from "../src/lib/audit.js";
import { getAlerts } from "../src/modules/alerts/alerts.service.js";

async function realActor(conn: any): Promise<number> {
  const [rows] = await conn.query("SELECT id FROM users LIMIT 1");
  if ((rows as any[]).length === 0) throw new Error("seed a user first (npm run seed)");
  return (rows as any[])[0].id;
}

const hire = (n: string) => ({
  employee_number: n,
  full_name: "Alert Test",
  hire_date: "2031-09-01",
  compensation: { pay_type: "HOURLY" as const, rate: 18, overtime_status: "NON_EXEMPT" as const },
});

async function freshPeriod(conn: any) {
  return createPayPeriod(conn, { start_date: "2031-10-04", end_date: "2031-10-10", pay_date: "2031-10-20" });
}

describe("alerts (integration, rolled back)", () => {
  it("empty period with one active employee -> one missing_entry", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const period = await freshPeriod(conn);
      const { employee } = await createEmployee(conn, hire("AL" + Math.floor(Math.random() * 1e6)));
      // Other committed employees share the DB: assert on our own row only.
      const alerts = (await getAlerts(conn, period.id as number)).filter((a) => a.employee_id === employee.id);
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].code, "missing_entry");
      assert.equal(alerts[0].severity, "amber");
      assert.equal(alerts[0].employee_id, employee.id);
      assert.equal(alerts[0].employee_name, "Alert Test");
      assert.equal(alerts[0].message, "No timecard entered for this period");
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("45h week for a non-exempt employee -> one overtime", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const period = await freshPeriod(conn);
      const pid = period.id as number;
      const { employee } = await createEmployee(conn, hire("OT" + Math.floor(Math.random() * 1e6)));
      const eid = employee.id as number;
      const [ins] = await conn.query("INSERT INTO timecard_entries (pay_period_id, employee_id) VALUES (?, ?)", [pid, eid]);
      const entryId = (ins as any).insertId;
      const values = ["2031-10-04", "2031-10-05", "2031-10-06", "2031-10-07", "2031-10-08"].map((d) => [
        entryId,
        d,
        "WORK",
        9,
      ]);
      await conn.query("INSERT INTO timecard_days (entry_id, work_date, day_type, hours) VALUES ?", [values]);
      const alerts = (await getAlerts(conn, pid)).filter((a) => a.employee_id === eid);
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].code, "overtime");
      assert.equal(alerts[0].severity, "amber");
      assert.equal(alerts[0].employee_id, eid);
      assert.equal(alerts[0].message, "5 OT hours this week");
      assert.equal((alerts[0].detail as any).ot_hours, 5);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("SUBMITTED period -> awaiting_approval; APPROVED -> none", async () => {    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    const actor = await realActor(conn);
    try {
      const period = await freshPeriod(conn);
      const pid = period.id as number;
      await submitPeriod(conn, actor, undefined, pid);
      const waiting = await getAlerts(conn, pid);
      const approval = waiting.filter((a) => a.code === "awaiting_approval");
      assert.equal(approval.length, 1);
      assert.equal(approval[0].severity, "yellow");
      assert.equal(approval[0].employee_id, null);
      assert.match(approval[0].message, /Awaiting approval since \d{4}-\d{2}-\d{2}, \d+ days ago/);
      assert.equal((approval[0].detail as any).days_waiting, 0);
      await approvePeriod(conn, actor, undefined, pid);
      const after = await getAlerts(conn, pid);
      assert.ok(after.every((a) => a.code !== "awaiting_approval"));
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("period with ot_override_hours set -> one manual_ot_override", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const period = await freshPeriod(conn);
      const pid = period.id as number;
      const { employee } = await createEmployee(conn, hire("OV" + Math.floor(Math.random() * 1e6)));
      const eid = employee.id as number;
      await conn.query(
        "INSERT INTO timecard_entries (pay_period_id, employee_id, ot_override_hours, ot_override_reason) VALUES (?, ?, 2.00, 'Holiday rush')",
        [pid, eid]
      );
      const alerts = (await getAlerts(conn, pid)).filter(
        (a) => a.employee_id === eid && a.code === "manual_ot_override"
      );
      // Note: the view folds the override into ot_hours, so the plain
      // overtime alert fires alongside — correct composition, not a dup.
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].code, "manual_ot_override");
      assert.equal(alerts[0].severity, "amber");
      assert.equal(alerts[0].message, "OT overridden to 2 (reason: Holiday rush)");
      assert.deepEqual(alerts[0].detail, { ot_override_hours: 2, ot_override_reason: "Holiday rush" });
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("usage beyond balance -> one leave_overdraw; covered usage -> none", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const period = await freshPeriod(conn);
      const pid = period.id as number;
      const { employee: over } = await createEmployee(conn, hire("OD" + Math.floor(Math.random() * 1e6)));
      const overId = over.id as number;
      await conn.query(
        "INSERT INTO leave_ledger (employee_id, leave_type, entry_type, hours, pay_period_id) VALUES (?, 'SICK_SAFE_PAID', 'usage', -48, ?)",
        [overId, pid]
      );
      const { employee: fine } = await createEmployee(conn, hire("OK" + Math.floor(Math.random() * 1e6)));
      const fineId = fine.id as number;
      await conn.query(
        "INSERT INTO leave_ledger (employee_id, leave_type, entry_type, hours, pay_period_id) VALUES (?, 'SICK_SAFE_PAID', 'usage', -8, ?)",
        [fineId, pid]
      );
      const alerts = await getAlerts(conn, pid);
      const mine = alerts.filter((a) => a.employee_id === overId || a.employee_id === fineId);
      const overdrawn = mine.filter((a) => a.code === "leave_overdraw");
      assert.equal(overdrawn.length, 1);
      assert.equal(overdrawn[0].severity, "red");
      assert.equal(overdrawn[0].employee_id, overId);
      assert.equal(overdrawn[0].message, "Sick leave overdraw by 8 hours");
      assert.deepEqual(overdrawn[0].detail, { usage: -48, balance_after: -8 });
      assert.ok(mine.every((a) => a.employee_id !== fineId || a.code !== "leave_overdraw"));
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("SUBMITTED period with a later audit row -> one post_submit_edit; OPEN -> none", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    const actor = await realActor(conn);
    try {
      const period = await freshPeriod(conn);
      const pid = period.id as number;
      const { employee } = await createEmployee(conn, hire("PS" + Math.floor(Math.random() * 1e6)));
      const eid = employee.id as number;
      await submitPeriod(conn, actor, undefined, pid);
      await conn.query("UPDATE pay_periods SET submitted_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?", [pid]);
      const [ins] = await conn.query("INSERT INTO timecard_entries (pay_period_id, employee_id) VALUES (?, ?)", [pid, eid]);
      const entryId = (ins as any).insertId;
      await writeAudit(conn, { actorUserId: actor, action: "timecard.update", entityTable: "timecard_entries", entityId: entryId });
      const alerts = await getAlerts(conn, pid);
      const edits = alerts.filter((a) => a.code === "post_submit_edit");
      assert.equal(edits.length, 1);
      assert.equal(edits[0].severity, "red");
      assert.equal(edits[0].message, "Edited after submission: timecard_entries timecard.update");
      assert.equal((edits[0].detail as any).actor_user_id, actor);
      assert.ok((edits[0].detail as any).occurred_at);

      const open = await createPayPeriod(conn, { start_date: "2031-10-11", end_date: "2031-10-17", pay_date: "2031-10-20" });
      const [ins2] = await conn.query("INSERT INTO timecard_entries (pay_period_id, employee_id) VALUES (?, ?)", [
        (open as any).id,
        eid,
      ]);
      await writeAudit(conn, { actorUserId: actor, action: "timecard.update", entityTable: "timecard_entries", entityId: (ins2 as any).insertId });
      const openAlerts = await getAlerts(conn, (open as any).id);
      assert.ok(openAlerts.every((a) => a.code !== "post_submit_edit"));
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("alerts sort reds before ambers before yellows", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    const actor = await realActor(conn);
    try {
      const period = await freshPeriod(conn);
      const pid = period.id as number;
      const { employee: red } = await createEmployee(conn, hire("SR" + Math.floor(Math.random() * 1e6)));
      await conn.query(
        "INSERT INTO leave_ledger (employee_id, leave_type, entry_type, hours, pay_period_id) VALUES (?, 'SICK_SAFE_PAID', 'usage', -48, ?)",
        [red.id, pid]
      );
      const { employee: amber } = await createEmployee(conn, hire("SA" + Math.floor(Math.random() * 1e6)));
      const aid = amber.id as number;
      const [ins] = await conn.query("INSERT INTO timecard_entries (pay_period_id, employee_id) VALUES (?, ?)", [pid, aid]);
      const entryId = (ins as any).insertId;
      const values = ["2031-10-04", "2031-10-05", "2031-10-06", "2031-10-07", "2031-10-08"].map((d) => [entryId, d, "WORK", 9]);
      await conn.query("INSERT INTO timecard_days (entry_id, work_date, day_type, hours) VALUES ?", [values]);
      await submitPeriod(conn, actor, undefined, pid);
      const codes = (await getAlerts(conn, pid)).map((a) => a.code);
      const rank: Record<string, number> = {
        leave_overdraw: 0,
        post_submit_edit: 0,
        missing_entry: 1,
        overtime: 1,
        manual_ot_override: 1,
        awaiting_approval: 2,
      };
      const ranks = codes.map((c) => rank[c]);
      assert.ok(ranks.every((r, i) => i === 0 || ranks[i - 1] <= r), `not severity-sorted: ${codes.join(",")}`);
      assert.equal(codes[0], "leave_overdraw");
      assert.equal(codes[codes.length - 1], "awaiting_approval");
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });
});

describe("GET /api/dashboard/:periodId/alerts (http)", () => {
  process.env.SESSION_SECRET ??= "test-secret";
  let base = "";
  let server: any;
  let app: any;
  let cookie = "";
  const email = `alertshttp${Date.now()}@example.com`;
  const empNum = `AH${String(Date.now()).slice(-6)}`;
  let periodId = 0;
  let empId = 0;

  const ymd = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (s: string, n: number): string => {
    const d = new Date(s + "T00:00:00");
    d.setDate(d.getDate() + n);
    return ymd(d);
  };

  const api = (path: string, init?: RequestInit) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Cookie: cookie, ...(init?.headers ?? {}) },
    });

  before(async () => {
    const db = await mysql.createConnection(connectionOptions());
    try {
      const hash = await argon2.hash("test123", { type: argon2.argon2id });
      await db.query("INSERT INTO users (email, full_name, password_hash, role) VALUES (?, 'Alerts HTTP', ?, 'ADMIN')", [
        email,
        hash,
      ]);
    } finally {
      await db.end();
    }
    server = await new Promise<any>((res) => {
      app = createApp();
      const s = app.listen(0, "127.0.0.1", () => res(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "test123" }),
    });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.ok(cookie.length > 0);
    // Next Saturday as period start (end +6, pay +13 per workweek rule).
    const now = new Date();
    const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((6 - now.getDay() + 7) % 7));
    const start = ymd(sat);
    const created = await fetch(`${base}/api/pay-periods`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ start_date: start, end_date: addDays(start, 6), pay_date: addDays(start, 13) }),
    });
    assert.equal(created.status, 201);
    periodId = ((await created.json()) as any).data.period.id;
    const hired = await fetch(`${base}/api/employees`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        employee_number: empNum,
        full_name: "Alerts HTTP",
        hire_date: start,
        compensation: { pay_type: "HOURLY", rate: 18, overtime_status: "NON_EXEMPT" },
      }),
    });
    assert.equal(hired.status, 201);
    empId = ((await hired.json()) as any).data.employee.id;
  });

  after(async () => {
    try {
      const db = await mysql.createConnection(connectionOptions());
      try {
        if (empId) {
          await db.query("DELETE FROM leave_ledger WHERE employee_id = ?", [empId]);
          await db.query("DELETE FROM employee_compensation WHERE employee_id = ?", [empId]);
          await db.query("DELETE FROM employees WHERE id = ?", [empId]);
        }
        if (periodId) await db.query("DELETE FROM pay_periods WHERE id = ?", [periodId]);
        await db.query("DELETE FROM users WHERE email = ?", [email]);
      } finally {
        await db.end();
      }
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((res) => server.close(() => res()));
      app.locals.sessionStore.close();
      await pool.end();
    }
  });

  it("200 shape with alerts array; unknown id is 404; anon is 401", async () => {
    const res = await api(`/api/dashboard/${periodId}/alerts`);
    assert.equal(res.status, 200);
    const { data } = (await res.json()) as any;
    assert.ok(Array.isArray(data.alerts));
    const missing = data.alerts.filter((a: any) => a.code === "missing_entry" && a.employee_id === empId);
    assert.equal(missing.length, 1);
    assert.equal(missing[0].employee_id, empId);
    assert.ok(["red", "amber", "yellow"].includes(missing[0].severity));
    const gone = await api("/api/dashboard/999999999/alerts");
    assert.equal(gone.status, 404);
    const anon = await fetch(`${base}/api/dashboard/${periodId}/alerts`);
    assert.equal(anon.status, 401);
  });
});
