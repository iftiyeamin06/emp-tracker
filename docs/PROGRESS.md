# Progress Log

## Day 1 — 2026-09-25 — Foundation

Done:
- Repo scaffolded with client/ + server/ + docs/
- Express + TypeScript API on :5000, `/api/health` queries real DB
- MySQL 8.4 (Windows service MySQL84) — DB: emp_tracker, app user: emp
  - DB: emp_tracker (single DB; `npm run migrate` self-bootstraps it)
  - Schema applied via `npm run migrate` (tracked in schema_migrations)
- React + Vite frontend on :5173
- `start.bat` ensures MySQL84 → migrate → API → UI, opens browser
- `docs/DEPLOY.md` documents production architecture
- `docs/spec.md` holds the v4 spec
- Pushed to GitHub

Verified:
- `curl.exe http://localhost:5000/api/health` → real dbTime timestamp
- Frontend shows "API status: ok"

To restart after reboot:
- Double-click `start.bat` from File Explorer (interactive desktop required)
- Requires the MySQL84 Windows service running (start.bat starts it)

## Fresh MySQL baseline — 2026-09-25 (clean-sheet redesign, not a port)

- Replaced 001 with a V1 design: view-derived totals (no triggers/procedures,
  so `emp` needs no SUPER/global), leave_types table, employee_compensation
  history, RETURNED status, audit request_id/ip, 2FA columns, sessions table.
- Holiday credits/substitutions intentionally omitted (Phase 2).
- Verified: `npm run migrate` clean; 7-assertion smoke test on timecard_weekly
  (OT math, exemption, leave exclusion, override CHECK, ledger balance) passes;
  `/api/health` returns real MySQL dbTime. Smoke rows rolled back.

## Day 2 — Auth (DONE 2026-09-25)

- argon2id logins seeded for admin@example.com + owner@example.com
- express-session + express-mysql-session (MySQL-backed `sessions` table)
- Routes: POST /api/auth/login (rate-limited 10/10min, neutral errors, session
  regenerate), GET /api/auth/me, POST /api/auth/logout
- Middleware: requireAuth (401), requireRole('ADMIN'|'OWNER') (401/403, server-side)
- Login form + session check in the UI
- Verified live: anon/me→401, bad login→401, login→role, me→email,
  logout→me 401, sessions survive API restart, 11th rapid login→429,
  health dbTime real.

## Known tradeoffs (accepted, revisit in hardening)

- No DB-level period lock: MySQL 8.4 + binary logging would require SUPER /
  `log_bin_trust_function_creators` for lock triggers, which the app user must
  not have. Locking is enforced by `withOpenPeriod()` (transaction +
  `SELECT ... FOR UPDATE` + status re-check). Every future write to
  timecard_entries / timecard_days / pay_periods must use it — audited, zero
  runtime write paths exist yet.
- No stored procedures/functions: same privilege reason; all logic in SQL
  views + API code.
- All calculations in views (`timecard_weekly`, `leave_balances`): single
  definition of every derived number; fine at 20–30 employees, re-evaluate if
  reporting ever outgrows it.