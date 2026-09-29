import { Router } from "express";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../middleware/auth.js";
import { monthlyReport } from "./reports.service.js";

export const reportRoutes = Router();

reportRoutes.get("/monthly", requireAuth, async (req, res, next) => {
  try {
    const month = typeof req.query.month === "string" ? req.query.month : "";
    const data = await monthlyReport(pool, month);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});
