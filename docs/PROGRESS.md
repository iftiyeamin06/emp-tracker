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
- `docs/spec.md` holds the v1 MVP spec
- `docs/spec-v2-target.md` holds the long-term target (compliance, exports, holiday credits)
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

## Foundation corrections — 2026-09-25 (spec §2–§15 batch)

Implemented:
- Migration 002: PERSONAL/OTHER leave types; compensation pay_frequency +
  classification; timecard_weekly now resolves the OT threshold from
  wage_rules (fallback 40). 001 untouched (append-only ✅).
- Libs: audit.ts (explicit-actor, same-txn writes), overtime.ts (testable
  mirror of the view), periodTransitions.ts (server-side state machine),
  leave.ts (accrual/balance/overdraw helpers), periodLock.ts (withOpenPeriod
  guard; audit proves zero runtime write paths exist to bypass).
- Tests: 29/29 pass (overtime, transitions + lock guard, leave, audit
  integration, compensation effective-dating integration).
- Docs: spec day-code table (TBDs marked), V1/later alerts split,
  provisional CPA export, cash-receipt control wording, §7 synced;
  DEPLOY reviewed (MySQL audit convention, unbuilt backups/2FA/export).
Partially: audit lib tested but unwired (no business write routes exist yet).
**v1 requirement:** every new write route (employees, pay-periods, timecards)
must call `writeAudit(...)` inside its transaction before commit — no
exceptions. See DEPLOY.md §3.
Deferred: holiday credits, DB lock triggers, S3, 2FA flow, exact CPA export.
Needs CPA/client: S8/SU8 mapping, leave-in-OT treatment, receipt legality,
  export columns, exemption calls, prenatal numbers.

## v1 MVP scope decided — 2026-09-28

Restructured specs to prevent scope creep:
- `docs/spec.md` — v1 working spec: 10 routes, 3 screens, focused MVP
- `docs/spec-v2-target.md` — long-term target (full compliance feature set)
- `agent.md` — added Specs section + Scope discipline rules

v1 builds only:
- Routes: auth (3), employees (2), pay-periods (3), timecards (2)
- Screens: Login, Timecard Entry Grid (admin), Owner Report (owner)
- Must be wired even in v1: audit writes, withOpenPeriod wrapper,
  compensation in employee_compensation, leave in leave_ledger, no hard deletes

Deferred to v2:
- Leave ledger UI, holiday credits, cash tracking, exports (Excel/PDF),
  wage-rule enforcement beyond min-wage check, alerts beyond six,
  trend charts, audit UI, return/reopen workflow, 2FA implementation

Schema unchanged. All 16 tables remain. Unused tables stay — dropping them
would require a new migration and gain nothing.

## v1 UI complete — 2026-09-28

- Login (branded card), Timecard Entry Grid (admin: view → click-edit →
  save → submit), Owner Report (period picker, approve), Employees
  (#/employees: roster + add form), New Period form on the grid.
- Auth shell: hash routing, role guards (wrong role → Access denied, never a
  login redirect), TopBar with logout, API status line DEV-only.
- Tests: 28 client (vitest) + 48 server (`tsx --test`) passing, `tsc` clean
  both sides. Full live flow verified: admin login → add employee → create
  period → enter hours → save → submit → owner login → report → approve.
- Bug found by tests: `loadPeriods` used `(selectId != null && find(...)) ??
  fallback` — when `selectId` is undefined the left side is `false`, which
  `??` does NOT skip, so the grid never loaded on first mount (older tests
  passed only via cross-test DOM contamination). Fixed with a ternary +
  comment; suite now passes in full isolation.

## Known gaps (real, scheduled — not this turn)
- No compensation-edit UI: pay rate / overtime status / classification can
  only be set at hire (Add form). Corrections need a DB update + audit row
  (done once for Test 1: EXEMPT → NON_EXEMPT, audited as
  compensation.correct). When built, it gets its own task + tests.
- No January 1 reset job yet. Employees hired in 2026 have their +40 for
  2026; they will need a new accrual for 2027 when we build the reset job.
- No proration for mid-year hires (deliberate v1 choice; confirm with CPA).
- Termination does not zero remaining balance (by design — payout rules
  are company policy).

## Deferred to v1.1/v2 (cash controls — method + badge are v1, rest is not)

- Cash handover log (`cash_payments` writes + UI)
- Signed receipt upload (depends on attachment/storage infra)
- Dashboard cash total and receipts-outstanding tile
- Missing-receipt alert

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
- V1 naming simplifications (disclosed, not hidden): the API speaks `SICK`
  while the DB stores `SICK_SAFE_PAID` (the correct legal category; mapped
  both ways so payloads round-trip), and the API uses `reimbursement_amount`
  while the column is `reimb_amount`. Non-v1 day types in legacy rows pass
  through untouched on reads.

## Sick leave ledger (frontload) — DONE 2026-09-30

- `PUT /api/timecards/:periodId` syncs `leave_ledger` in the same txn:
  key is (employee, SICK_SAFE_PAID, usage, period) — the ledger has no
  per-date column, so full-sync per period (delete + re-insert per sick day
  with hours > 0, reason = work_date). Removing/retyping a SICK day deletes it.
- `GET /api/employees/:id/leave` returns `{ balances, ledger }` from
  `leave_balances` + `leave_ledger` (date = created_at, note = reason).
- Seed: `npm run seed:leave` frontloaded +40 `SICK_SAFE_PAID` accrual
  (reason `2026 frontload`, pay_period_id NULL) for all 7 active employees;
  re-run is a no-op. No rollover/reset job (deferred per task).
- Employees page: "View" opens a profile drawer with Leave Balances card
  (`Sick: X of 40 hours remaining`) + Leave History table (Date|Type|Hours|Note).
- Auto-frontload on hire (no manual step): `createEmployee` inserts +40
  `SICK_SAFE_PAID` accrual (reason `Initial sick frontload on hire (YYYY
  frontload)`, `created_by` = admin, same txn) + `leave.create` audit row.
  Seed skip is reason-agnostic (any sick accrual blocks a re-grant), so it
  never stacks a second +40 on anyone — including pre-2026 hires.
- Delete rule adjusted: untouched accruals are not history (removed with the
  employee); timecards and leave usage still 409 → terminate instead.
- Tests: 69 server (ledger: insert/delete/retype/balance-sum/frontload,
  hire-accrual, rollback, no-double-grant, usage-blocks-delete) + 66 client
  pass, `tsc` clean both sides. Live-verified: hire → 40, sick day → usage
  row, delete → 200/404 + audit.

## Owner sick-leave visibility — DONE 2026-09-30

- Owner can't open #/employees (ADMIN-only), so the Report got its own
  drill-down: employee name is a toggle that lazy-fetches
  `GET /api/employees/:id/leave` (auth-only, no new route) and shows
  `Sick: X of 40 hours remaining` + usage dates (ledger `note` = sick date).
  Works in weekly + monthly tables; no extra fetch on load.
- Tests: 2 existing week-accordion queries disambiguated (▶/▼ exact names);
  1 new drill-down test. Client 66/66, server 69/69, `tsc` clean.