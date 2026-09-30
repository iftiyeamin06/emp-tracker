import { Router } from "express";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../middleware/auth.js";
import { getAlerts } from "./alerts.service.js";

export const alertsRoutes = Router();

// Read-only: no audit writes, no transactions.
alertsRoutes.get("/:periodId/alerts", requireAuth, async (req, res, next) => {
  try {
    const periodId = Number(req.params.periodId);
    if (!Number.isInteger(periodId)) return res.status(400).json({ error: "period_id_invalid" });
    const alerts = await getAlerts(pool, periodId);
    res.json({ data: { alerts } });
  } catch (e) {
    next(e);
  }
});
