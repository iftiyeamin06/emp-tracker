import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import mysql from "mysql2/promise";

// ponytail: migrate self-bootstraps the DB (CREATE DATABASE IF NOT EXISTS) and
// records applied files in schema_migrations, so deploys just run `npm run migrate`.
function opts(db?: string) {
  const u = new URL(process.env.DATABASE_URL ?? "");
  return {
    host: u.hostname || "127.0.0.1",
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ...(db ? { database: db } : {}),
  };
}

async function main() {
  const u = new URL(process.env.DATABASE_URL ?? "");
  const dbName = (u.pathname.replace("/", "") || "emp_tracker").replace(/[`"]/g, "");

  const admin = await mysql.createConnection(opts());
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.end();

  // multipleStatements only here (never on the app pool): the migration file
  // holds triggers/procedures whose bodies contain semicolons; the server
  // parses BEGIN/END blocks itself, so no DELIMITER lines are needed.
  const app = await mysql.createConnection({ ...opts(dbName), multipleStatements: true });
  try {
    await app.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (filename VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    );
    const [rows] = await app.query("SELECT filename FROM schema_migrations");
    const applied = new Set((rows as any[]).map((r) => r.filename));
    const dir = join(__dirname, "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (applied.has(f)) continue;
      await app.query(await readFile(join(dir, f), "utf8"));
      await app.query("INSERT INTO schema_migrations (filename) VALUES (?)", [f]);
      console.log("migrated: " + f);
    }
  } finally {
    await app.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
