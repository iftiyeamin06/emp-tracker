import "dotenv/config";
import mysql from "mysql2/promise";

export function connectionOptions() {
  const u = new URL(process.env.DATABASE_URL ?? "");
  return {
    host: u.hostname || "127.0.0.1",
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: (u.pathname.replace("/", "") || "emp_tracker").replace(/[`"]/g, ""),
  };
}

export const pool = mysql.createPool({
  ...connectionOptions(),
  waitForConnections: true,
  connectionLimit: 10,
});

export async function dbNow(): Promise<string | null> {
  try {
    const [rows] = await pool.query("SELECT NOW() AS now");
    const v = (rows as any[])[0]?.now;
    return v instanceof Date ? v.toISOString() : String(v);
  } catch {
    return null; // ponytail: DB optional for Day-1 health check
  }
}
