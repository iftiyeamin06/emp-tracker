import argon2 from "argon2";
import { pool } from "../../db/pool.js";

export interface SessionUser {
  id: number;
  email: string;
  role: "ADMIN" | "OWNER";
}

// Equalize timing for unknown/disabled accounts so login failures don't reveal
// whether an email exists. Only the neutral 401 message leaves the server.
let dummyHash: string | undefined;
async function burn(password: string): Promise<void> {
  dummyHash ??= await argon2.hash("invalid-credential-placeholder");
  await argon2.verify(dummyHash, password).catch(() => false);
}

export async function verifyLogin(email: string, password: string): Promise<SessionUser | null> {
  const [rows] = await pool.query(
    "SELECT id, email, password_hash, role, is_active FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  const u = (rows as any[])[0];
  if (!u || !u.is_active) {
    await burn(password);
    return null;
  }
  const ok = await argon2.verify(u.password_hash, password).catch(() => false);
  if (!ok) return null;
  return { id: u.id, email: u.email, role: u.role };
}
