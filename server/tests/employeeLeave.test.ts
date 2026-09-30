import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import mysql from "mysql2/promise";
import { connectionOptions, pool } from "../src/db/pool.js";
import { createApp } from "../src/app.js";

// HTTP contract for GET /api/employees/:id/leave. Boots the real Express app
// on an ephemeral port and drives it with fetch — no new test deps. All rows
// created here are removed in cleanup (audit rows stay, append-only by design).
describe("GET /api/employees/:id/leave (http)", () => {
  process.env.SESSION_SECRET ??= "test-secret";
  let base = "";
  let server: any;
  let app: any;
  let cookie = "";
  const email = `leavehttp${Date.now()}@example.com`;
  const empNum = `LH${String(Date.now()).slice(-6)}`;
  let empId = 0;

  const api = (path: string, init?: RequestInit) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Cookie: cookie, ...(init?.headers ?? {}) },
    });

  before(async () => {
    const db = await mysql.createConnection(connectionOptions());
    try {
      const hash = await argon2.hash("test123", { type: argon2.argon2id });
      await db.query("INSERT INTO users (email, full_name, password_hash, role) VALUES (?, 'Leave HTTP', ?, 'ADMIN')", [
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

  it("hire (POST 201) then GET leave returns 40 plus the accrual row", async () => {
    const created = await api("/api/employees", {
      method: "POST",
      body: JSON.stringify({
        employee_number: empNum,
        full_name: "Leave HTTP",
        hire_date: "2026-09-01",
        compensation: { pay_type: "HOURLY", rate: 18, overtime_status: "NON_EXEMPT" },
      }),
    });
    assert.equal(created.status, 201);
    empId = ((await created.json()) as any).data.employee.id;
    assert.ok(empId > 0);

    const res = await api(`/api/employees/${empId}/leave`);
    assert.equal(res.status, 200);
    const { data } = (await res.json()) as any;
    assert.equal(data.balances["SICK_SAFE_PAID"], 40);
    assert.equal(data.ledger.length, 1);
    assert.equal(data.ledger[0].entry_type, "ACCRUAL"); // ENUM reads back canonical uppercase; comparisons stay case-insensitive
    assert.equal(Number(data.ledger[0].hours), 40); // DECIMAL arrives as string over JSON
    assert.equal(data.ledger[0].reason ?? data.ledger[0].note, "Initial sick frontload on hire (2026 frontload)");
  });

  it("balance reflects usage added after hire (40 - 8 = 32)", async () => {
    assert.ok(empId > 0);
    const db = await mysql.createConnection(connectionOptions());
    try {
      await db.query(
        "INSERT INTO leave_ledger (employee_id, leave_type, entry_type, hours) VALUES (?, 'SICK_SAFE_PAID', 'usage', -8)",
        [empId]
      );
    } finally {
      await db.end();
    }
    const res = await api(`/api/employees/${empId}/leave`);
    assert.equal(res.status, 200);
    const { data } = (await res.json()) as any;
    assert.equal(data.balances["SICK_SAFE_PAID"], 32);
    assert.equal(data.ledger.length, 2);
  });

  it("unknown employee is 404, anonymous caller is 401", async () => {
    const missing = await api("/api/employees/999999999/leave");
    assert.equal(missing.status, 404);
    const anon = await fetch(`${base}/api/employees/${empId}/leave`);
    assert.equal(anon.status, 401);
  });

  it("DELETE is 409 while usage history exists (terminate instead)", async () => {
    assert.ok(empId > 0);
    const del = await api(`/api/employees/${empId}`, { method: "DELETE" });
    assert.equal(del.status, 409);
  });
});
