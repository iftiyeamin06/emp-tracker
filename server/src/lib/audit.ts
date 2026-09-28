import type { PoolConnection } from "mysql2/promise";

// AUDIT FOUNDATION. MySQL has no SET LOCAL: the caller passes the actor
// explicitly and MUST use a transaction connection (never the pool), so the
// audit row commits or rolls back atomically with the change it describes.
// Append-only from the application perspective: this module exposes no
// update/delete functions, and the app DB user must not be granted them
// on audit_log in production.
export interface AuditEvent {
  actorUserId: number | null; // NULL = system/unauthenticated
  action: string; // e.g. "period.submit", "timecard.update", "leave.adjust"
  entityTable: string;
  entityId: number;
  before?: unknown;
  after?: unknown;
  reason?: string; // mandatory for return/reopen/override/adjustment (enforced by callers)
  requestId?: string;
  ip?: string;
}

const toJson = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

export async function writeAudit(conn: PoolConnection, e: AuditEvent): Promise<void> {
  await conn.query(
    `INSERT INTO audit_log
       (actor_user_id, action, entity_table, entity_id, before_json, after_json, reason, request_id, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.actorUserId,
      e.action,
      e.entityTable,
      e.entityId,
      toJson(e.before),
      toJson(e.after),
      e.reason ?? null,
      e.requestId ?? null,
      e.ip ?? null,
    ]
  );
}
