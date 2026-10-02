import { Router } from "express";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/role.js";
import { getAudit } from "./audit.service.js";

export const auditRoutes = Router();

// Owner-only read of the audit trail. No writes, no transactions.
auditRoutes.get("/", requireAuth, requireRole("OWNER"), async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 100);
    const entityId = req.query.entity_id !== undefined ? Number(req.query.entity_id) : undefined;
    if (!Number.isInteger(limit) || limit < 1) return res.status(400).json({ error: "limit_invalid" });
    if (entityId !== undefined && !Number.isInteger(entityId)) return res.status(400).json({ error: "entity_id_invalid" });
    const rows = await getAudit(pool, {
      limit,
      entityTable: typeof req.query.entity_table === "string" && req.query.entity_table ? req.query.entity_table : undefined,
      entityId,
    });
    res.json({ data: { rows } });
  } catch (e) {
    next(e);
  }
});
