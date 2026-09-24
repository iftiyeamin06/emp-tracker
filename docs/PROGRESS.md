# Progress Log

## Day 1 — 2026-09-25 — Foundation

Done:
- Repo scaffolded with client/ + server/ + docs/
- Express + TypeScript API on :5000, `/api/health` queries real DB
- PostgreSQL 16.15 (portable, in .local/, gitignored)
  - DB: emp_tracker (single DB; `npm run migrate` self-bootstraps it)
  - Schema applied via `npm run migrate` (tracked in schema_migrations)
- React + Vite frontend on :5173
- `start.bat` orchestrates Postgres → migrate → API → UI
- `docs/DEPLOY.md` documents production architecture
- `docs/spec.md` holds the v4 spec
- Pushed to GitHub

Verified:
- `curl.exe http://localhost:5000/api/health` → real dbTime timestamp
- Frontend shows "API status: ok"

To restart after reboot:
- Double-click `start.bat` from File Explorer (interactive desktop required)
- Or: `.local\pgbin\bin\pg_ctl.exe -D .local\pgdata -l .local\pg.log start`

## Day 2 — Auth (NEXT)
- Seed admin@example.com + owner@example.com (argon2)
- express-session + connect-pg-simple
- Routes: POST /api/auth/login, GET /api/auth/me, POST /api/auth/logout
- Middleware: requireAuth, requireRole('owner'|'admin')
- Frontend: login page + session check