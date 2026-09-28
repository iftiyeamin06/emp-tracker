import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as audit from "../src/lib/audit.js";
import { connectionOptions } from "../src/db/pool.js";
import mysql from "mysql2/promise";

describe("audit foundation (integration, rolled back)", () => {
  it("records transitions with actor, before/after, reason, request id and ip", async () => {
    const conn = await mysql.createConnection(connectionOptions());
    await conn.beginTransaction();
    try {
      const [ru] = await conn.query("INSERT INTO users (email, full_name, password_hash, role) VALUES ('audit-t@example.com','Audit T','x','OWNER')");
      const uid = (ru as any).insertId;
      const [rp] = await conn.query("INSERT INTO pay_periods (start_date, end_date, pay_date) VALUES ('2030-01-05','2030-01-11','2030-01-15')");
      const pid = (rp as any).insertId;
      await audit.writeAudit(conn, {
        actorUserId: uid,
        action: "period.submit",
        entityTable: "pay_periods",
        entityId: pid,
        before: { status: "OPEN" },
        after: { status: "SUBMITTED" },
        reason: "week complete",
        requestId: "req-1",
        ip: "127.0.0.1",
      });
      const [rows] = await conn.query(
        "SELECT actor_user_id, action, before_json, after_json, reason, request_id, ip_address FROM audit_log WHERE entity_table='pay_periods' AND entity_id=?",
        [pid]
      );
      const r = (rows as any[])[0];
      assert.equal(r.actor_user_id, uid);
      assert.equal(r.action, "period.submit");
      const asObj = (v: any) => (typeof v === "string" ? JSON.parse(v) : v); // mysql2 parses JSON columns
      assert.deepEqual(asObj(r.before_json), { status: "OPEN" });
      assert.deepEqual(asObj(r.after_json), { status: "SUBMITTED" });
      assert.equal(r.reason, "week complete");
      assert.equal(r.request_id, "req-1");
      assert.equal(r.ip_address, "127.0.0.1");
    } finally {
      await conn.rollback();
      await conn.end();
    }
  });

  it("exposes no update/delete functions (append-only from the app)", () => {
    assert.deepEqual(Object.keys(audit).sort(), ["writeAudit"]);
  });
});
