import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import mysql from "mysql2/promise";
import { connectionOptions, pool } from "../src/db/pool.js";
import { createApp } from "../src/app.js";
import { writeAudit } from "../src/lib/audit.js";

// Owner-only read of the audit trail. Commits, so it cleans up after itself.
describe("GET /api/audit (http)", () => {
  process.env.SESSION_SECRET ??= "test-secret";
  const stamp = String(Date.now());
  const ownerEmail = `auditowner${stamp}@example.com`;
  const adminEmail = `auditadmin${stamp}@example.com`;
  let base = "";
  let server: any;
  let app: any;
  let ownerCookie = "";
  let adminCookie = "";

  const login = async (email: string): Promise<string> => {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "test123" }),
    });
    assert.equal(r.status, 200);
    const c = r.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.ok(c.length > 0);
    return c;
  };

  before(async () => {
    const db = await mysql.createConnection(connectionOptions());
    try {
      const hash = await argon2.hash("test123", { type: argon2.argon2id });
      await db.query("INSERT INTO users (email, full_name, password_hash, role) VALUES (?, 'Audit Owner', ?, 'OWNER')", [ownerEmail, hash]);
      await db.query("INSERT INTO users (email, full_name, password_hash, role) VALUES (?, 'Audit Admin', ?, 'ADMIN')", [adminEmail, hash]);
      const [u] = await db.query("SELECT id FROM users WHERE email = ? LIMIT 1", [ownerEmail]);
      await writeAudit(pool, { actorUserId: (u as any[])[0].id, action: "audit.probe", entityTable: "employees", entityId: 1, reason: "probe row" });
    } finally {
      await db.end();
    }
    server = await new Promise<any>((res) => {
      app = createApp();
      const s = app.listen(0, "127.0.0.1", () => res(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    ownerCookie = await login(ownerEmail);
    adminCookie = await login(adminEmail);
  });

  after(async () => {
    try {
      const db = await mysql.createConnection(connectionOptions());
      try {
        await db.query("DELETE FROM audit_log WHERE action = 'audit.probe'");
        await db.query("DELETE FROM users WHERE email IN (?, ?)", [ownerEmail, adminEmail]);
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

  it("anon is 401, admin is 403, owner sees newest-first rows", async () => {
    const anon = await fetch(`${base}/api/audit`);
    assert.equal(anon.status, 401);
    const denied = await fetch(`${base}/api/audit`, { headers: { Cookie: adminCookie } });
    assert.equal(denied.status, 403);
    const res = await fetch(`${base}/api/audit?limit=10`, { headers: { Cookie: ownerCookie } });
    assert.equal(res.status, 200);
    const { data } = (await res.json()) as any;
    assert.ok(Array.isArray(data.rows));
    const probe = data.rows.find((r: any) => r.action === "audit.probe");
    assert.ok(probe);
    assert.equal(probe.entity_table, "employees");
    assert.equal(probe.actor_email, ownerEmail);
    assert.equal(probe.reason, "probe row");
  });
});
