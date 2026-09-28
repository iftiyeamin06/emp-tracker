# DEPLOY.md — deploy decisions, made now so they're not surprises later

Target (3 weeks out): one host running MySQL + API, static UI naast it.
Nothing below needs new infra today — it's a list of constraints current code must respect.

## 1. Migrations — `npm run migrate` on every deploy

- `server/src/db/migrate.ts` self-bootstraps: `CREATE DATABASE` if missing,
  then applies pending `*.sql` from `src/db/migrations/` in filename order.
- Applied files are recorded in `schema_migrations` (created by the runner itself).
- Rules: never edit an applied migration — add a new numbered file.
  Deploys just run `npm run migrate`; re-runs are no-ops.
- Status: implemented ✅ (prod points `DATABASE_URL` at real MySQL —
  same files, same command).

## 2. Attachments — `storage_key` is an opaque key, not a path

- `attachments.storage_key` stores a **relative key**, never an absolute
  filesystem path or URL. Format: `attachments/<entry_id>/<uuid>-<filename>`.
- Why: the same column becomes an S3 key later with zero schema change.
- Planned (not built): `STORAGE_DIR` env (default `./uploads`) as the
  local-driver root; the API joins root + key. Nothing outside the API may
  interpret the key.
- Moving to S3 later = new storage driver behind the same read/write
  functions + backfill keys as objects. No migration, no re-upload.
- Status: schema ✅, convention ✅, drivers land with Phase 2 attachments work.

## 3. Audit — explicit actor in the same transaction (MySQL has no SET LOCAL)

- Every audited change runs inside one transaction; the API passes the actor
  explicitly via `writeAudit(conn, { actorUserId, action, ... })`, which
  inserts the audit row on the SAME connection before commit — never trust a
  client-sent user id, never write audit outside the change's transaction.
- `src/lib/audit.ts` is implemented ✅ and unit/integration-tested ✅.
- NOT production-ready: no business write routes exist yet, so nothing calls
  it; approval/export must stay disabled until routes write audit events.
  (`src/middleware/audit.ts` remains a no-op stub — do not rely on it.)

## 4. Env / config — 12-factor, `.env` for dev only

- Local: `server/.env` (copied from `.env.example`, git-ignored).
- Prod: real values come from the host environment, never a committed file.
- Required: `DATABASE_URL`, `SESSION_SECRET`, `PORT`. Prod also sets
  `COOKIE_SECURE=1` (HTTPS) and a long random `SESSION_SECRET`.
  `SEED_ADMIN/OWNER_*` are one-time dev bootstrap only, never production.
- `SESSION_SECRET` must be long + random in prod; uploads (Phase 2) must live
  on a persistent volume (not the repo dir).

## 5. Backups — retention per CPA/legal confirmation (NOT implemented)

- Applicable payroll, wage, time, and related records are retained per
  CPA/legal confirmation (baseline: six years for NY wage/payroll records).
  No hard deletes of payroll-related rows — retention is a policy, not a
  cron `DELETE`.
- Planned, not built: nightly `mysqldump` + off-host copy; monthly restore
  test into a scratch DB.
- `export_log.file_sha256` is the proof of what the CPA received — include
  the DB dump + uploads in the same backup set once backups exist.

## 6. Health / ops

- `GET /api/health` returns `{status, service, dbTime}`; `dbTime: null`
  means "API up, DB down". Load balancer / uptime check asserts `status: ok`
  AND non-null `dbTime`.
- The MySQL84 service must be running before the API (see `start.bat`: MySQL → migrate → API → UI).

## Explicitly deferred / not production-safe (do NOT build or claim now)

S3 driver, 2FA enrollment (columns exist, no flow), automated backups,
multi-host, CI pipeline, real payroll approval (audit unwired — no business
write routes exist yet), exact CPA export (samples not received).
