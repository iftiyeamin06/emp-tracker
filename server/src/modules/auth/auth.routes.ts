import { Router } from "express";
import { dbNow } from "../../db/pool.js";
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { verifyLogin } from "./auth.service.js";

export const health = Router();
health.get("/", async (_req, res) => {
  res.json({ status: "ok", service: "employee-tracker-api", dbTime: await dbNow() });
});

export const authRoutes = Router();
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });

authRoutes.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string" || !email || !password)
      return res.status(400).json({ error: "email_and_password_required" });
    const user = await verifyLogin(email, password);
    if (!user) return res.status(401).json({ error: "invalid_email_or_password" });
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((e) => (e ? reject(e) : resolve()))
    );
    req.session.user = user;
    res.json({ user });
  } catch (e) {
    next(e);
  }
});

authRoutes.post("/logout", requireAuth, (req, res, next) => {
  req.session.destroy((e) => {
    if (e) return next(e);
    res.clearCookie("et.sid");
    res.json({ ok: true });
  });
});

authRoutes.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});
