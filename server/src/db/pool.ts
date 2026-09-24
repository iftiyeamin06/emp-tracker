import "dotenv/config";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL ?? "";
export const pool = new Pool({ connectionString });

export async function dbNow(): Promise<string | null> {
  try {
    const r = await pool.query("SELECT now() AS now");
    return (r.rows[0]?.now as Date)?.toISOString?.() ?? String(r.rows[0]?.now);
  } catch {
    return null; // ponytail: DB optional for Day-1 health check
  }
}
