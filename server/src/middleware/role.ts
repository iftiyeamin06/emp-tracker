import type { NextFunction, Request, Response } from "express";

export function requireRole(..._roles: string[]) {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}
