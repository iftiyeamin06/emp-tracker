import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { connectionOptions } from "../src/db/pool.js";
import { assertPeriodOpen } from "../src/lib/periodLock.js";
import { approvePeriod, createPayPeriod, reopenPeriod, submitPeriod } from "../src/modules/pay-periods/payPeriods.service.js";

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

async function freshPeriod(conn: any, start = "2031-10-04") {
  const end = start === "2031-10-04" ? "2031-10-10" : "2031-10-19";
  return createPayPeriod(conn, { start_date: start, end_date: end, pay_date: "2031-10-20" });
}

async function realActor(conn: any): Promise<number> {
  const [rows] = await conn.query("SELECT id FROM users LIMIT 1");
  if ((rows as any[]).length === 0) throw new Error("seed a user first (npm run seed)");
  return (rows as any[])[0].id;
}

describe("period workflow (integration, rolled back)", () => {
  it("submit: OPEN -> SUBMITTED with audit", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    const actor = await realActor(conn);
    try {
      const created = await freshPeriod(conn);
      const period = await submitPeriod(conn, actor, undefined, created.id as number);
      assert.equal(period.status, "SUBMITTED");
      assert.equal(period.submitted_by, actor);
      const [audit] = await conn.query(
        "SELECT action, before_json, after_json, actor_user_id FROM audit_log WHERE entity_table='pay_periods' AND entity_id=?",
        [period.id]
      );
      const r = (audit as any[])[0];
      const asObj = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
      assert.equal(r.action, "status");
      assert.deepEqual(asObj(r.before_json), { status: "OPEN" });
      assert.deepEqual(asObj(r.after_json), { status: "SUBMITTED" });
      assert.equal(r.actor_user_id, actor);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("submit on SUBMITTED returns 409", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    const actor = await realActor(conn);
    try {
      const created = await freshPeriod(conn);
      await submitPeriod(conn, actor, undefined, created.id as number);
      await throwsStatus(() => submitPeriod(conn, actor, undefined, created.id as number), 409, /period_not_open/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("approve: SUBMITTED -> APPROVED with audit", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    const actor = await realActor(conn);
    try {
      const created = await freshPeriod(conn);
      await submitPeriod(conn, actor, undefined, created.id as number);
      const period = await approvePeriod(conn, actor, undefined, created.id as number);
      assert.equal(period.status, "APPROVED");
      assert.equal(period.approved_by, actor);
      const [audit] = await conn.query(
        "SELECT action, before_json, after_json FROM audit_log WHERE entity_table='pay_periods' AND entity_id=? ORDER BY id DESC LIMIT 1",
        [period.id]
      );
      const r = (audit as any[])[0];
      const asObj = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
      assert.equal(r.action, "status");
      assert.deepEqual(asObj(r.before_json), { status: "SUBMITTED" });
      assert.deepEqual(asObj(r.after_json), { status: "APPROVED" });
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("approve on OPEN returns 409", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    const actor = await realActor(conn);
    try {
      const created = await freshPeriod(conn);
      await throwsStatus(() => approvePeriod(conn, actor, undefined, created.id as number), 409, /period_not_submitted/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("after approve, entry writes reject with 423", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const actor = await realActor(conn);
      const created = await freshPeriod(conn);
      await submitPeriod(conn, actor, undefined, created.id as number);
      await approvePeriod(conn, actor, undefined, created.id as number);
      await throwsStatus(() => assertPeriodOpen(conn, created.id as number), 423, /approved_locked/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("reopen with reason on APPROVED returns it to OPEN + audit", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const actor = await realActor(conn);
      const created = await freshPeriod(conn);
      await submitPeriod(conn, actor, undefined, created.id as number);
      await approvePeriod(conn, actor, undefined, created.id as number);
      const period = await reopenPeriod(conn, actor, undefined, created.id as number, "payroll error");
      assert.equal(period.status, "OPEN");
      assert.equal(period.approved_by, null);
      assert.equal(period.approved_at, null);
      const [audit] = await conn.query(
        "SELECT action, before_json, after_json, reason FROM audit_log WHERE entity_table='pay_periods' AND entity_id=? ORDER BY id DESC LIMIT 1",
        [period.id]
      );
      const r = (audit as any[])[0];
      const asObj = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
      assert.equal(r.action, "reopen");
      assert.equal(asObj(r.before_json).status, "APPROVED");
      assert.deepEqual(asObj(r.after_json), { status: "OPEN" });
      assert.equal(r.reason, "payroll error");
      await assertPeriodOpen(conn, created.id as number); // editable again
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("reopen without reason is 400; on OPEN or SUBMITTED is 409", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const actor = await realActor(conn);
      const created = await freshPeriod(conn);
      await submitPeriod(conn, actor, undefined, created.id as number);
      await approvePeriod(conn, actor, undefined, created.id as number);
      await throwsStatus(() => reopenPeriod(conn, actor, undefined, created.id as number, "  "), 400, /reopen_reason_required/);
      await throwsStatus(() => reopenPeriod(conn, actor, undefined, created.id as number, undefined), 400, /reopen_reason_required/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("reopen on OPEN or SUBMITTED is 409", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const actor = await realActor(conn);
      const created = await freshPeriod(conn);
      await throwsStatus(() => reopenPeriod(conn, actor, undefined, created.id as number, "x"), 409, /period_not_approved/);
      await submitPeriod(conn, actor, undefined, created.id as number);
      await throwsStatus(() => reopenPeriod(conn, actor, undefined, created.id as number, "x"), 409, /period_not_approved/);
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });
});
