import "express-session";

declare module "express-session" {
  interface SessionData {
    // Set on login, cleared on logout. Role comes from users.role (ADMIN/OWNER).
    // 2FA state will live here later (e.g. twoFactorVerified: boolean) — no fake 2FA now.
    user?: { id: number; email: string; role: "ADMIN" | "OWNER" };
  }
}
