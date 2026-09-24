import type { NextFunction, Request, Response } from "express";

// ponytail: no-op until audit trigger/API lands in Phase 2
export function audit(_req: Request, _res: Response, next: NextFunction) {
  next();
}
