import type { NextFunction, Request, Response } from "express";

type Role = "ADMIN" | "OWNER";

// Server-side authorization. Frontend role checks (if any) are cosmetic only.
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: "unauthenticated" });
    if (!roles.includes(user.role)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}
