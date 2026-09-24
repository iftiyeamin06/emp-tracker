import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

// ponytail: single JSON error shape, add codes when a client needs them
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  logger.error(err);
  res.status(err?.status ?? 500).json({ error: err?.message ?? "internal_error" });
}
