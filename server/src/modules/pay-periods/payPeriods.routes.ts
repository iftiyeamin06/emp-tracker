import { Router } from "express";
import { pool } from "../../db/pool.js";
import { writeAudit } from "../../lib/audit.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/role.js";
import { withOpenPeriod } from "../../lib/periodLock.js";
import { approvePeriod, createPayPeriod, listPayPeriods, submitPeriod } from "./payPeriods.service.js";

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

// Submit reuses withOpenPeriod for the lock; its 423 is converted to 409 so
// every transition violation reports consistently (423 stays reserved for
// entry/day writes on locked periods).
payPeriodRoutes.post("/:id/submit", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "period_id_invalid" });
    const period = await withOpenPeriod(pool, id, (conn) =>
      submitPeriod(conn, req.session.user!.id, req.ip, id)
    );
    res.json({ data: { period } });
  } catch (e: any) {
    if (e?.status === 423) e.status = 409;
    next(e);
  }
});

// Approve cannot use withOpenPeriod (it starts from SUBMITTED, not OPEN), so
// it locks the row itself the same way. Owner only.
payPeriodRoutes.post("/:id/approve", requireAuth, requireRole("OWNER"), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "period_id_invalid" });
    await conn.beginTransaction();
    const period = await approvePeriod(conn, req.session.user!.id, req.ip, id);
    await conn.commit();
    res.json({ data: { period } });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});
