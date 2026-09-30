# STATE.md — Current project state and rules (read before every task)

Last updated: 2026-09-30
Status: v1 in progress. Do NOT start v2 features.

---

## 1. What this project is

Internal Employee Time & Activity Tracking for a 20–30 person NYC company
(Long Island City). Admin enters hours, Owner approves, hours are exported
to the CPA. The app does not calculate money and does not run payroll.

Stack: Node.js + Express + TypeScript + MySQL 8 + React (Vite).
Styling: Tailwind CSS + shadcn/ui (installed). No inline styles for new code.

---

## 2. Hard rules (never violate)

1. Every mutation writes to `audit_log` in the same transaction.
2. Every write to `timecard_entries`, `timecard_days`, or `pay_periods`
   uses `withOpenPeriod` (transaction + FOR UPDATE + status re-check).
3. Compensation lives in `employee_compensation` (effective-dated), never
   on `employees`.
4. Leave usage goes into `leave_ledger`, never as a stored balance column.
5. No hard deletes on employees with history. Use `termination_date`.
   Hard delete allowed only when the employee has zero history.
6. Applied migrations (001, 002) are frozen. All changes go in new numbered
   files (`003_*.sql`).
7. Role checks are server-side, always. Frontend checks are cosmetic.
8. Money is `DECIMAL`, never float. Dates are `DATE`/`TIMESTAMP`, not strings.
9. `docs/spec.md` (v1 MVP) is the working spec.
   `docs/spec-v2-target.md` is reference only. Do not build from it.

---

## 3. Workweek rule (critical)

- Pay period starts: Saturday
- Pay period ends: start + 6 (Friday)
- Pay date (check date): start + 13 (Friday, one week later)
- OT is calculated per Sat–Fri pay week, NOT per ISO week.
- Monthly buckets: day hours split by work_date; whole-week OT attributed
  to the month holding 4+ of the week's days.

---

## 4. Day codes (v1 scope)

| Code | day_type           | Counts as worked | Counts toward OT |
|------|--------------------|------------------|------------------|
| 8    | WORK               | Yes              | Yes              |
| V8   | VACATION           | No               | No               |
| S8   | SICK_SAFE_PAID     | No               | No               |
| SU8  | PROTECTED_UNPAID   | No               | No               |
| P4   | PRENATAL           | No               | No               |
| H8   | HOLIDAY            | No               | No               |
| HW8  | HOLIDAY_WORKED     | Yes              | Yes              |

Leave does NOT count toward the 40-hour OT threshold.

---

## 5. Done and verified

### Backend
- Auth: login / logout / me (argon2id, sessions in MySQL, rate limited)
- Employees: GET, POST (creates employee + comp + leave accrual + 3 audit
  rows in one transaction), PUT (terminate / rehire), DELETE (blocked if
  history exists)
- Pay periods: GET, POST (validates Saturday start, computes end + 13 pay
  date), submit, approve, reopen
- Timecards: GET, PUT (bulk save with ledger sync for S8 days)
- Reports: weekly (per period), monthly (day-split buckets + week-attributed OT)
- Leave: GET /api/employees/:id/leave (balances + ledger), auto +40 sick
  accrual on hire, seed script for backfill
- 69 server tests passing

### Frontend
- Login page
- App shell (sidebar, top bar, role-based routing)
- Employees page: table, Add modal, View drawer (sick balance + history),
  Terminate / Rehire / Delete actions
- Timecards page: period selector, New Period form, editable grid with
  day codes, Save, Submit, read-only banner on SUBMITTED
- Report page: Weekly / Monthly toggle, per-employee table, Reopen modal
  on APPROVED periods
- 61 client tests passing

### Infrastructure
- MySQL 8.4 on Windows (dev)
- Tailwind + shadcn/ui installed
- start.bat runs MySQL → migrate → API → UI

---

## 6. Open bugs — fix before any new feature

These need visual verification and, if broken, a fix:

1. Weekly / Monthly toggle: does it stay on the selected mode? Verify.
2. Terminated employees: do they still appear in grids for periods after
   termination? Verify. (Filter should be: visible while termination_date
   >= period start.)
3. Timecards grid columns: are they ordered Sat → Fri? Verify.
4. Date inputs in New Period form: styled consistently, or still browser
   default?
5. Report page: does Reopen button appear only on APPROVED periods?

If any is broken → fix it before anything else.

---

## 7. NOT in scope — do not build without explicit instruction

- Holiday credits, substitutions, redemption (v2)
- Cash payment handover log + receipt upload (v2, blocked on file storage)
- CPA Excel/PDF export (blocked on receiving the CPA's sample file)
- Audit log UI (v2)
- Trend charts (v2)
- Range/custom summary reports (v2)
- 2FA implementation (v2)
- Automated backups (v2)
- Return workflow (v2 — only reopen is in v1)
- Email/Slack reminders (v2)
- Any money calculation (v2 — hours only in v1)

---

## 8. Priority queue (in order)

1. **Verify the five open bugs above visually.** No code changes until you
   know what's actually broken.
2. Fix whatever is broken — one bug per turn, with a test.
3. Deploy to a real host (VPS or EC2). Confirm /api/health on the server.
4. Stop.

After step 4, wait for the business owner to use it and tell us what to
build next.

---

## 9. How to work with me

- Read this file at the start of every task.
- If a task conflicts with §7 (NOT in scope), say so and stop.
- Do not expand scope. Do not build "adjacent improvements."
- Do not refactor working code unless explicitly asked.
- Do not touch files outside the scope of the task.
- Reply with: (a) what you'll change, (b) the diff, (c) tests.
- If something is ambiguous, ask before writing code.
- One concern per turn. Do not batch unrelated changes.

---

## 10. Definition of done for v1

v1 is done when ALL of these are true:

- [ ] All 5 open bugs verified fixed (or confirmed never broken)
- [ ] Full workflow works end-to-end in the browser:
      admin login → add employee → create period → enter hours → save →
      submit → owner login → approve → reopen → admin edits → resubmit →
      owner re-approves
- [ ] Sick balance shows correctly after hire (40 hours)
- [ ] Deployed to a real host with HTTPS
- [ ] /api/health returns 200 with a real dbTime on the deployed server
- [ ] The owner has logged in and used it at least once

Until all six are checked, v1 is not done. No new features.

---

## 11. Known gotchas

- MySQL returns ENUM values in their declared case (e.g., `ACCRUAL`, not
  `accrual`). Any string comparison against an ENUM must be case-insensitive
  or match the declared case exactly.