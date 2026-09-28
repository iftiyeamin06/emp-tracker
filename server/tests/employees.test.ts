import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { connectionOptions } from "../src/db/pool.js";
import { writeAudit } from "../src/lib/audit.js";
import { createEmployee, listEmployees } from "../src/modules/employees/employees.service.js";

const valid = (n: string) => ({
  employee_number: n,
  full_name: "Roster Test",
  hire_date: "2026-09-01",
  payment_method: "CASH" as const,
  compensation: { pay_type: "HOURLY" as const, rate: 18.5, overtime_status: "NON_EXEMPT" as const },
});

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

describe("employees (integration, rolled back)", () => {
  it("create inserts employee + compensation + 2 audit rows; list shows it", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { employee, compensation } = await createEmployee(conn, valid("RT1"));
      assert.equal(employee.employee_number, "RT1");
      assert.equal(compensation.employee_id, employee.id);
      assert.equal(Number(compensation.rate), 18.5);
      const d = new Date(compensation.effective_from as any); // DATE arrives as Date; compare calendar parts (TZ-safe)
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      assert.equal(ymd, "2026-09-01"); // defaults to hire_date
      await writeAudit(conn, { actorUserId: 1, action: "employee.create", entityTable: "employees", entityId: employee.id as number, after: employee });
      await writeAudit(conn, { actorUserId: 1, action: "compensation.create", entityTable: "employee_compensation", entityId: compensation.id as number, after: compensation });
      const list = await listEmployees(conn);
      assert.ok(list.some((r) => r.employee_number === "RT1"));
      const [audit] = await conn.query(
        "SELECT action, actor_user_id FROM audit_log WHERE entity_table IN ('employees','employee_compensation') AND entity_id IN (?,?) ORDER BY id",
        [employee.id, compensation.id]
      );
      assert.deepEqual(
        (audit as any[]).map((r) => [r.action, r.actor_user_id]),
        [["employee.create", 1], ["compensation.create", 1]]
      );
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("duplicate employee_number is 409", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      await createEmployee(conn, valid("RT2"));
      await throwsStatus(() => createEmployee(conn, valid("RT2")), 409, /employee_number_taken/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("validation rejects bad input with 400", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const bad = valid("RT3") as any;
      await throwsStatus(() => createEmployee(conn, { ...bad, full_name: "  " }), 400, /full_name_required/);
      await throwsStatus(() => createEmployee(conn, { ...bad, compensation: { ...bad.compensation, overtime_status: "MAYBE" } }), 400, /overtime_status_invalid/);
      await throwsStatus(() => createEmployee(conn, { ...bad, compensation: { ...bad.compensation, rate: -1 } }), 400, /rate_invalid/);
      await throwsStatus(() => createEmployee(conn, { ...bad, termination_date: "2026-01-01" }), 400, /termination_before_hire/);
      const { compensation: _c, ...noComp } = bad;
      await throwsStatus(() => createEmployee(conn, noComp as any), 400, /compensation_required/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });
});
