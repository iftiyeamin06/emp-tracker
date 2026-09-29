import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { connectionOptions } from "../src/db/pool.js";
import { writeAudit } from "../src/lib/audit.js";
import { createEmployee, deleteEmployee, listEmployees, setTermination } from "../src/modules/employees/employees.service.js";

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
      assert.equal(employee.payment_method, "CASH"); // persists as stored
      assert.equal(compensation.employee_id, employee.id);
      assert.equal(Number(compensation.rate), 18.5);
      const d = new Date(compensation.effective_from as any); // DATE arrives as Date; compare calendar parts (TZ-safe)
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      assert.equal(ymd, "2026-09-01"); // defaults to hire_date
      await writeAudit(conn, { actorUserId: 1, action: "employee.create", entityTable: "employees", entityId: employee.id as number, after: employee });
      await writeAudit(conn, { actorUserId: 1, action: "compensation.create", entityTable: "employee_compensation", entityId: compensation.id as number, after: compensation });
      const list = await listEmployees(conn);
      assert.ok(list.some((r) => r.employee_number === "RT1"));
      assert.equal(list.find((r) => r.employee_number === "RT1")?.payment_method, "CASH");
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

  it("list embeds current compensation, null when none exists", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      await createEmployee(conn, valid("RT4"));
      await conn.query(
        "INSERT INTO employees (employee_number, full_name, hire_date) VALUES ('RT5','No Comp','2026-09-01')"
      );
      const list = await listEmployees(conn);
      const withComp = list.find((r) => r.employee_number === "RT4") as any;
      const withoutComp = list.find((r) => r.employee_number === "RT5") as any;
      assert.deepEqual(withComp.compensation, {
        pay_type: "HOURLY",
        rate: 18.5,
        overtime_status: "NON_EXEMPT",
        classification: null,
      });
      assert.equal(withoutComp.compensation, null);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("terminate sets the date, rehire clears it, audit recorded", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { employee } = await createEmployee(conn, valid("RT6"));
      const eid = employee.id as number;
      const term = await setTermination(conn, eid, "2026-10-31");
      const td = new Date(term.termination_date as any);
      assert.equal(`${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, "0")}-${String(td.getDate()).padStart(2, "0")}`, "2026-10-31");
      await writeAudit(conn, { actorUserId: 1, action: "employee.terminate", entityTable: "employees", entityId: eid, after: term });
      const rehired = await setTermination(conn, eid, null);
      assert.equal(rehired.termination_date, null);
      const [audit] = await conn.query(
        "SELECT action FROM audit_log WHERE entity_table='employees' AND entity_id=?",
        [eid]
      );
      assert.deepEqual((audit as any[]).map((r) => r.action), ["employee.terminate"]);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("terminate validates date, hire bound, and existence", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { employee } = await createEmployee(conn, valid("RT7"));
      const eid = employee.id as number;
      await throwsStatus(() => setTermination(conn, eid, "not-a-date"), 400, /termination_date_invalid/);
      await throwsStatus(() => setTermination(conn, eid, "2026-01-01"), 400, /termination_before_hire/);
      await throwsStatus(() => setTermination(conn, 999999, "2026-10-31"), 404, /employee_not_found/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("delete removes a history-free employee and audits it", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { employee } = await createEmployee(conn, valid("RT8"));
      const eid = employee.id as number;
      const out = await deleteEmployee(conn, eid);
      assert.equal(out.employee.id, eid);
      await writeAudit(conn, { actorUserId: 1, action: "employee.delete", entityTable: "employees", entityId: eid, before: out });
      const [gone] = await conn.query("SELECT id FROM employees WHERE id=?", [eid]);
      assert.equal((gone as any[]).length, 0);
      const [comp] = await conn.query("SELECT id FROM employee_compensation WHERE employee_id=?", [eid]);
      assert.equal((comp as any[]).length, 0);
      const [audit] = await conn.query("SELECT action FROM audit_log WHERE entity_table='employees' AND entity_id=?", [eid]);
      assert.equal((audit as any[])[0].action, "employee.delete");
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("delete is blocked when timecard history exists", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const { employee } = await createEmployee(conn, valid("RT9"));
      const eid = employee.id as number;
      await conn.query("INSERT INTO pay_periods (start_date, end_date, pay_date) VALUES ('2030-11-02','2030-11-08','2030-11-12')");
      const [pp] = await conn.query("SELECT id FROM pay_periods WHERE start_date='2030-11-02'");
      const pid = (pp as any[])[0].id;
      await conn.query("INSERT INTO timecard_entries (pay_period_id, employee_id) VALUES (?, ?)", [pid, eid]);
      await throwsStatus(() => deleteEmployee(conn, eid), 409, /employee_has_history/);
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
