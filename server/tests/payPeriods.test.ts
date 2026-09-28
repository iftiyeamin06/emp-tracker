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
  it("create valid period + audit; list returns it", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const period = await createPayPeriod(conn, {
        start_date: "2026-10-05", // Monday
        end_date: "2026-10-11",
        pay_date: "2026-10-14",
      });
      assert.equal(period.status, "OPEN");
      await writeAudit(conn, { actorUserId: 1, action: "pay_period.create", entityTable: "pay_periods", entityId: period.id as number, after: period });
      const list = await listPayPeriods(conn);
      const ymd = (v: unknown) => {
        const d = new Date(v as any);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };
      assert.ok(list.some((r) => ymd(r.start_date) === "2026-10-05"));
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

  it("rejects non-Monday start_date", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      await throwsStatus(
        () => createPayPeriod(conn, { start_date: "2026-10-06", end_date: "2026-10-12", pay_date: "2026-10-14" }),
        400,
        /start_date_not_monday/
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
      await createPayPeriod(conn, { start_date: "2026-10-05", end_date: "2026-10-11", pay_date: "2026-10-14" });
      await throwsStatus(
        () => createPayPeriod(conn, { start_date: "2026-10-05", end_date: "2026-10-11", pay_date: "2026-10-15" }),
        409,
        /period_overlaps_existing/
      );
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("rejects end_date != start_date + 6 and pay_date before end", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      await throwsStatus(
        () => createPayPeriod(conn, { start_date: "2026-10-05", end_date: "2026-10-12", pay_date: "2026-10-14" }),
        400,
        /end_date_not_start_plus_six/
      );
      await throwsStatus(
        () => createPayPeriod(conn, { start_date: "2026-10-05", end_date: "2026-10-11", pay_date: "2026-10-10" }),
        400,
        /pay_date_before_end/
      );
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });
});
