import { describe, it } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { connectionOptions } from "../src/db/pool.js";
import { writeAudit } from "../src/lib/audit.js";
import { createPayPeriod, listPayPeriods } from "../src/modules/pay-periods/payPeriods.service.js";

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

describe("pay periods (integration, rolled back)", () => {
  it("Saturday start creates the week with server-computed dates", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const period = await createPayPeriod(conn, { start_date: "2031-10-04" }); // Saturday
      assert.equal(period.status, "OPEN");
      const ymd = (v: unknown) => {
        const d = new Date(v as any);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };
      assert.equal(ymd(period.start_date), "2031-10-04");
      assert.equal(ymd(period.end_date), "2031-10-10"); // start + 6 (Friday)
      assert.equal(ymd(period.pay_date), "2031-10-17"); // start + 13 (Friday)
      await writeAudit(conn, { actorUserId: 1, action: "pay_period.create", entityTable: "pay_periods", entityId: period.id as number, after: period });
      const list = await listPayPeriods(conn);
      assert.ok(list.some((r) => ymd(r.start_date) === "2031-10-04"));
      const [audit] = await conn.query(
        "SELECT action FROM audit_log WHERE entity_table='pay_periods' AND entity_id=?",
        [period.id]
      );
      assert.equal((audit as any[])[0].action, "pay_period.create");
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("rejects Friday start_date", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      await throwsStatus(
        () => createPayPeriod(conn, { start_date: "2031-10-03" }),
        400,
        /start_date must be a Saturday/
      );
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("rejects Monday start_date", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      await throwsStatus(
        () => createPayPeriod(conn, { start_date: "2031-10-06" }),
        400,
        /start_date must be a Saturday/
      );
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("rejects overlapping period", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      await createPayPeriod(conn, { start_date: "2031-10-04" });
      await throwsStatus(
        () => createPayPeriod(conn, { start_date: "2031-10-04" }),
        409,
        /period_overlaps_existing/
      );
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });
});
