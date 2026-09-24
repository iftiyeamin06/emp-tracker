import { Router } from "express";
import { dbNow } from "../../db/pool.js";

export const health = Router();
health.get("/", async (_req, res) => {
  res.json({ status: "ok", service: "employee-tracker-api", dbTime: await dbNow() });
});
