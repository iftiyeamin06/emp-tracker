import { Router } from "express";
import { pool } from "../../db/pool.js";
import { assertPeriodOpen } from "../../lib/periodLock.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/role.js";
import { getGrid, saveGrid } from "./timecards.service.js";

export const timecardRoutes = Router();

timecardRoutes.get("/:periodId", requireAuth, async (req, res, next) => {
  try {
    const periodId = Number(req.params.periodId);
    if (!Number.isInteger(periodId)) return res.status(400).json({ error: "period_id_invalid" });
    const data = await getGrid(pool, periodId);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

// PUT re-checks the OPEN lock inside its own transaction (hard rule 2),
// then saves entries + days + one audit row per entry, atomically.
timecardRoutes.put(
  "/:periodId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const conn = await pool.getConnection();
    try {
      const periodId = Number(req.params.periodId);
      if (!Number.isInteger(periodId)) return res.status(400).json({ error: "period_id_invalid" });
      await conn.beginTransaction();
      await assertPeriodOpen(conn, periodId);
      const [prows] = await conn.query("SELECT id, start_date, end_date FROM pay_periods WHERE id = ?", [periodId]);
      const period = (prows as any[])[0];
      const saved = await saveGrid(conn, period, req.session.user!.id, req.ip, req.body?.rows);
      await conn.commit();
      res.json({ data: { saved } });
    } catch (e) {
      await conn.rollback();
      next(e);
    } finally {
      conn.release();
    }
  }
);
