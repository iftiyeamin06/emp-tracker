import type { NextFunction, Request, Response } from "express";

// ponytail: stub auth — real session/JWT in Phase 1; health stays open
export function auth(req: Request, _res: Response, next: NextFunction) {
  (req as any).user = null;
  next();
}

export function requireRole(..._roles: string[]) {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}
