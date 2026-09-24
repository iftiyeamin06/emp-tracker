import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

// ponytail: migrate self-bootstraps the DB (CREATE DATABASE if missing) and
// records applied files in schema_migrations, so deploys just run `npm run migrate`.
async function main() {
  const target = process.env.DATABASE_URL ?? "";
  const u = new URL(target);
  const dbName = (u.pathname.replace("/", "") || "emp_tracker").replace(/"/g, "");
  u.pathname = "/postgres";

  const admin = new Client({ connectionString: u.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`).catch((e: any) => {
    if (e?.code !== "42P04") throw e; // 42P04 = already exists, fine
  });
  await admin.end();

  const dir = join(__dirname, "migrations");
  const app = new Client({ connectionString: target });
  await app.connect();
  try {
    await app.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    );
    const applied = new Set(
      (await app.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename)
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (applied.has(f)) continue;
      await app.query(await readFile(join(dir, f), "utf8"));
      await app.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [f]);
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
