import type { NextFunction, Request, Response } from "express";

// ponytail: in-memory sliding window, no dep. Correct for a single host (V1);
// replace with a shared store if the API ever runs on more than one instance.
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || now > h.reset) {
      h = { count: 0, reset: now + windowMs };
      hits.set(ip, h);
    }
    h.count += 1;
    if (h.count > max) return res.status(429).json({ error: "too_many_requests" });
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}
