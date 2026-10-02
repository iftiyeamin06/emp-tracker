import type { Db } from "../employees/employees.service.js";

export interface AuditFilters {
  limit: number;
  entityTable?: string;
  entityId?: number;
}

// Read-only audit trail for owners. Newest first; never exposes
// before/after payloads or IPs over this endpoint (reason + who/what/when).
export async function getAudit(db: Db, f: AuditFilters): Promise<Record<string, unknown>[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.entityTable) {
    where.push("a.entity_table = ?");
    params.push(f.entityTable);
  }
  if (f.entityId !== undefined) {
    where.push("a.entity_id = ?");
    params.push(f.entityId);
  }
  const [rows] = await db.query(
    `SELECT a.id, a.occurred_at, a.actor_user_id, u.email AS actor_email,
            u.full_name AS actor_name, a.action, a.entity_table, a.entity_id, a.reason
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
      ${where.length > 0 ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY a.occurred_at DESC, a.id DESC
      LIMIT ?`,
    [...params, Math.max(1, Math.min(f.limit, 500))]
  );
  return rows as Record<string, unknown>[];
}
