import "dotenv/config";
import argon2 from "argon2";
import { pool } from "./pool.js";

// One-time bootstrap: creates ADMIN/OWNER logins from env. Refuses to run
// with missing passwords; skips addresses that already exist (safe to re-run).
async function ensure(email: string | undefined, password: string | undefined, role: string, name: string) {
  if (!email || !password) {
    console.log(`skip ${role}: set the matching SEED_* env vars to create it`);
    return;
  }
  const [rows] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if ((rows as any[]).length > 0) {
    console.log(`exists: ${email}`);
    return;
  }
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  await pool.query("INSERT INTO users (email, full_name, password_hash, role) VALUES (?, ?, ?, ?)", [
    email,
    name,
    hash,
    role,
  ]);
  console.log(`created: ${email} (${role})`);
}

async function main() {
  await ensure(process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD, "ADMIN", "Admin");
  await ensure(process.env.SEED_OWNER_EMAIL, process.env.SEED_OWNER_PASSWORD, "OWNER", "Owner");
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
