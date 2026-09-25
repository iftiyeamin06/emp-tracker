# DEPLOY.md — deploy decisions, made now so they're not surprises later

Target (3 weeks out): one host running MySQL + API, static UI naast it.
Nothing below needs new infra today — it's a list of constraints current code must respect.

## 1. Migrations — `npm run migrate` on every deploy

- `server/src/db/migrate.ts` self-bootstraps: `CREATE DATABASE` if missing,
  then applies pending `*.sql` from `src/db/migrations/` in filename order.
- Applied files are recorded in `schema_migrations` (created by the runner itself).
- Rules: never edit an applied migration — add a new numbered file.
  Deploys just run `npm run migrate`; re-runs are no-ops.
- Status: implemented ✅ (dev `.local/pgdata` is throwaway; prod points
  `DATABASE_URL` at real MySQL — same files, same command).

## 2. Attachments — `storage_path` is an opaque key, not a path

- `attachments.storage_path` stores a **relative key**, never an absolute
  filesystem path or URL. Format: `attachments/<entry_id>/<uuid>-<filename>`.
- Why: the same column becomes an S3 key later with zero schema change.
- `STORAGE_DIR` env (default `./uploads`) is the local-driver root; the API
  joins root + key. Nothing outside the API may interpret the key.
- Moving to S3 later = new storage driver behind the same read/write
  functions + backfill keys as objects. No migration, no re-upload.
- Status: convention ✅ (drivers land with Phase 2 attachments work).

## 3. Audit — `app.user_id` session convention

- Every request transaction runs `SET LOCAL app.user_id = '<id>'`
  (empty string for unauthenticated/health). Audit triggers/API read it via
  `current_setting('app.user_id', true)` — never trust a client-sent user id.
- `SET LOCAL` requires a transaction, so request handlers that write must run
  inside one; the pool must `RESET`/release cleanly so ids never leak across requests.
- Status: convention from spec ✅, wiring lands with the Phase 2 audit
  trigger (`src/middleware/audit.ts` is still a no-op stub — do not rely on it yet).

## 4. Env / config — 12-factor, `.env` for dev only

- Local: `server/.env` (copied from `.env.example`, git-ignored).
- Prod: real values come from the host environment, never a committed file.
- Required: `DATABASE_URL`, `SESSION_SECRET`, `PORT`, `STORAGE_DIR`.
- `SESSION_SECRET` must be long + random in prod; `STORAGE_DIR` must be a
  persistent volume (not the repo dir, not `.local/`).

## 5. Backups — NY requires 6-year payroll record retention

- Nightly `mysqldump` + off-host copy; monthly restore test
  into a scratch DB. No hard deletes anywhere (spec §7) — retention is a
  policy, not a cron `DELETE`.
- `export_log.file_sha256` is the proof of what the CPA received — include
  the DB dump + `uploads/` (or S3 versioning) in the same backup set.

## 6. Health / ops

- `GET /api/health` returns `{status, service, dbTime}`; `dbTime: null`
  means "API up, DB down". Load balancer / uptime check asserts `status: ok`
  AND non-null `dbTime`.
- The MySQL84 service must be running before the API (see `start.bat`: MySQL → migrate → API → UI).

## Explicitly deferred (do NOT build now)

S3 driver, 2FA, automated backups, multi-host, CI pipeline.
Add each when the deploy actually needs it.
