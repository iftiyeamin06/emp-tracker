import { Router } from "express";
import { pool } from "../../db/pool.js";
import { writeAudit } from "../../lib/audit.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/role.js";
import { createPayPeriod, listPayPeriods } from "./payPeriods.service.js";

export const payPeriodRoutes = Router();

payPeriodRoutes.get("/", requireAuth, async (_req, res, next) => {
  try {
    const data = await listPayPeriods(pool);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

// POST creates the period + audit row in ONE transaction (hard rule 1).
// Admin only. Status is always OPEN; submit/approve are separate transitions.
payPeriodRoutes.post("/", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const period = await createPayPeriod(conn, req.body);
    await writeAudit(conn, {
      actorUserId: req.session.user!.id,
      action: "pay_period.create",
      entityTable: "pay_periods",
      entityId: period.id as number,
      after: period,
      ip: req.ip,
    });
    await conn.commit();
    res.status(201).json({ data: { period } });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});
