# Employee Time & Activity Tracking Platform: Spec v4

Company size: 20–30 employees · Stack: MySQL 8, Node.js/Express, web UI
Status: Revised draft v4: adds daily timecard, dated sick/vacation/holiday tracking, holiday credits and CEO summary report (on top of NYC compliance and cash-paid employees)
Location: 40-05 21st St, Long Island City, NY 11101 (New York State and New York City rules apply)

## 1. Purpose and scope

Replace paper timecards and spreadsheets with an internal system to record, review, approve and export weekly employee hours.

In scope: hour entry, automatic overtime calculation, exception alerts, approval and locking, audit trail, leave balances, CPA export.

Out of scope: tax filings, withholding and check generation. These stay with the external CPA (Eakub A. Khan CPA P.C.). The system produces a clean export; it does not run payroll.

Success test: an admin enters a full week in under 15 minutes; the CEO reviews and approves in under 5.

## 1A. New York compliance profile

Because the company operates in Long Island City, NYC, New York State Labor Law and NYC rules apply. The system stores legal parameters as dated, editable rules (not hard-coded), because several change every January. Figures below reflect published guidance as of September 2026; the CPA or employment counsel must confirm them before go-live. This is not legal advice.

| Rule | Current requirement | How the system supports it |
|---|---|---|
| Minimum wage | $17.00/hr in NYC since Jan 1, 2026; indexed to inflation from 2027 | wage_rules table; saving an hourly rate below the minimum is blocked |
| Overtime | 1.5× the regular rate over 40 hrs/week for non-exempt employees | Auto-calculated from hours worked |
| Exempt status | Executive/administrative: at least $1,275/week ($66,300/yr) in NYC and a duties test; salary alone is not enough | Exempt flag needs a documented basis; alert if salary is below threshold |
| Paid sick/safe leave | Employers with 5–99 employees: 40 paid hrs/yr, plus 32 unpaid hrs available immediately (since Feb 22, 2026). 100+ employees: 56 paid hrs | Leave policies and ledger (section 4) |
| Pay statements | Every pay date, including cash payments, showing OT hours/rates and paid vs. unpaid leave used and available | Export carries these fields; CPA issues statements |
| Written notices | Pay notice signed at hire; written leave policy at hire and within 14 days of changes | pay_notice_signed_on; missing-notice alert |
| Spread of hours | One extra hour at minimum wage when a non-exempt workday spans more than 10 hours (scope depends on industry) | spread_days field and alert |
| Call-in pay | Show-up pay, generally the lesser of 4 hrs or the scheduled shift | call_in_hours field |
| Record retention | Payroll records kept 6 years | No hard deletes; retention date on records |

Employees paid in cash. Cash is a payment method, not a separate classification. It is only compliant when the pay is treated like any other wages: recorded, taxes withheld and reported through the CPA's payroll, and a wage statement issued. Accordingly:

- Cash-paid employees appear in the same weekly grid, approval and CPA export as everyone else. There is no way to exclude someone from the export.
- Each cash handover is logged (amount, date, who paid, signed receipt scan). Cash is paid after approval on pay date, so the dashboard flags any approved period past its pay date with missing receipts.
- The dashboard shows cash total and receipts outstanding for the period.
- If anyone is currently paid in cash outside payroll, resolve that with the CPA before go-live. Unreported wages create tax exposure and New York wage-statement and recordkeeping violations that a tracking tool cannot fix.

## 2. Roles and permissions

| Action | Admin | Owner (CEO) |
|---|---|---|
| Manage employee roster | Yes | View |
| Enter / edit hours (period Open) | Yes | No |
| Submit a period | Yes | No |
| Approve a period | No | Yes |
| Return a submitted period to Open | No | Yes (reason required) |
| Reopen an approved period | No | Yes (reason required) |
| View dashboard, trends, audit log | Yes | Yes |
| Export to CPA | Yes | Yes |
| Manage users and leave policies | No | Yes |

Authentication is by email and password (hashed with argon2/bcrypt), with session expiry. Owner accounts should use 2FA.

## 3. Period workflow

```
        submit                approve
 OPEN ─────────► SUBMITTED ─────────► APPROVED (locked)
   ▲                 │                     │
   └─── return ──────┘                     │
   ▲                                       │
   └────────────── reopen (reason) ────────┘
```

- Open: admin can edit entries.
- Submitted: entries are read-only for admin. The owner reviews and either approves or returns it.
- Approved: the period is locked in the database (not just the UI). approved_by and approved_at are recorded. Any reopen writes reopened_by, reopened_at and a reason to the audit log.
- Only Owner may move a period backwards. Every transition is audited.

## 4. Business rules

Hours entry. The admin enters daily hours from the physical card (see Daily timecard below). The system calculates weekly Worked, Regular and Overtime.

Overtime (hourly, non-exempt employees):

- reg_hours = MIN(hours_worked, 40)
- ot_hours = MAX(hours_worked − 40, 0)
- Vacation, sick and holiday hours are recorded separately and do not count toward the 40. Confirm this with the CPA.
- Manual OT override is allowed but requires a written reason and is flagged in the dashboard.

Salaried / exempt employees. No OT calculation and no OT alerts. Their weekly entry can default to a standard number of hours. Exempt vs. non-exempt status is a compliance decision made with the CPA; the system only stores the answer.

Leave (NY State and NYC).

- With 20–30 employees, the 5–99 employee tier applies: 40 paid sick/safe hours per year, plus 32 unpaid hours available immediately at hire and each January 1 (unpaid hours do not carry over). At 100 employees the paid tier becomes 56 hours, so the system alerts as headcount nears 100.
- Paid sick leave accrues at 1 hour per 30 hours worked, or is front-loaded (40 hours each January 1), which is simpler to run. Choose with the CPA and set it as the policy.
- Unused paid hours carry over; annual use may be capped at 40 hours.
- Paid prenatal leave (NYS) is its own leave type (20 hours per 52 weeks; confirm).
- Vacation is not statutory; it follows the company's written policy, including payout on termination.
- Balance = sum of the leave ledger. Accruals post when a period is approved; usage posts from the approved entry.
- Pay statements must show leave accrued, used and available (paid and unpaid separately), so the export includes those columns.
- Manual adjustments need a reason. Warn on entry if usage exceeds the balance.

Daily timecard. The company's physical timecard is the source of truth, so the system records it day by day. Each employee-day has a type: Work, Vacation, Sick, Unpaid Sick, Prenatal, Holiday (paid, not worked), Holiday Worked or Holiday (credit). Weekly totals (worked, regular, OT, vacation, sick, holiday) are always calculated from the days and never typed separately, so every sick, vacation and holiday hour has a date. Optional in/out times per day feed the spread-of-hours and call-in checks.

Holidays and holiday credits.

- The Owner maintains a company holiday calendar (date, name, default hours, e.g. 8).
- Holiday not worked: the employee gets Holiday hours on that date.
- Substitute day: if the CEO moves a holiday for an employee (e.g. the holiday falls on Tuesday and he gives Friday instead), the Owner records a substitution. Holiday hours then post on the substitute date and the original date is a normal day.
- Worked on a holiday: the day is logged as Holiday Worked. The hours are paid as worked and the system creates one holiday credit (an owed holiday) for that employee.
- Redeeming a credit: the Owner assigns a future day off against the credit. That day posts as Holiday (credit) and the credit becomes Used. A credit can instead be paid out or expired, with a reason.
- A comp day never replaces overtime pay: if holiday work pushes a non-exempt employee past 40 hours, OT is still owed in cash. Whether holiday work earns a pay premium as well is a CEO/CPA decision.

Employee lifecycle. Employees have hire and termination dates. Historical periods always show people who were employed then. is_active is derived from dates, not a manual flag. Rehire = new employment record under the same person.

## 5. Exception rules (dashboard alerts)

Thresholds are configurable by Owner.

| Alert | Default trigger |
|---|---|
| Overtime | Hourly employee with ot_hours > 0 |
| Excess hours | hours_worked > 60 in a week |
| Missing entry | Active employee with no entry in an open/submitted period |
| Large swing | Hours differ from the employee's trailing 4-week average by more than 30% |
| Large bonus / reimbursement | Above a set dollar amount (default $1,000 / $500) |
| Manual OT override | Any override used |
| Post-submit edit | Any change after a period was submitted, or reopen after approval |
| Leave overdraw | Usage exceeds available balance |
| Below minimum wage | Hourly rate under the current NYC minimum |
| Exempt review | Exempt employee below the salary threshold or with no documented basis |
| Spread of hours / call-in | spread_days or call_in_hours above 0 |
| Cash receipt missing | Cash-paid employee with no receipt logged one day after pay date |
| Missing pay notice | Employee with no signed pay notice date |
| Holiday credit aging | Holiday credit still owed 60 days after it was earned |

## 6. Screens

1. Executive Dashboard (Owner).
   - "Needs your attention" list at top (section 5), each item links to the entry.
   - Summary cards: total hours, total OT, sick/vacation used, holiday credits owed, active employees.
   - Period picker and status badge; Approve / Return buttons with confirmation.
   - Trend charts (Phase 3): weekly total hours and OT, OT by employee, leave usage by month.
2. Timecard Entry Grid (Admin).
   - One row per employee with Mon–Sun columns, mirroring the paper card. Type hours in a cell (8 = worked) or prefix a code: V8 vacation, S8 sick, SU8 unpaid sick, P4 prenatal, H8 holiday, HW8 worked holiday. Calendar holidays pre-fill on the right date. Optional in/out times open per day.
   - Weekly columns are calculated: Worked, Reg, OT, Vac, Sick, Holiday. Weekly Bonus ($), Reimb ($), Call-in Hrs and Notes are typed. A CASH badge shows on cash-paid rows.
   - Reg and OT shown as read-only computed columns.
   - Live row and column totals; keyboard navigation (Tab / Enter) for fast entry.
   - Autosave draft; Submit button validates and locks admin editing.
   - Optional attachment of a scanned card per entry.
3. Employee Roster and Profile.
   - Directory: Emp Num, name, pay type, exempt flag, status.
   - Profile: employment dates, weekly history, cumulative hours, leave balances and ledger.
4. Audit Log (Owner/Admin, read-only). Filter by employee, period, user, date. Shows field, old value, new value, who, when, reason.
5. Exports. Export history (who, when, which period, file) plus a download button.
6. Settings (Owner). Users, leave policies, alert thresholds, holidays.
7. Summary Report (Owner). Pick a range (one week, month, quarter, year or custom) and optionally one employee. View on screen, or download as PDF or Excel.
   - Headline totals: hours worked, regular, OT, vacation, sick, holiday hours, holiday credits owed, headcount, cash-paid total.
   - Per-employee table: worked, reg, OT, vacation, sick, holiday, holiday credits owed, sick and vacation balances.
   - Dated leave detail: every vacation, sick and holiday day with its date (e.g. "Sick: Tue 9/22, Wed 9/23").
   - Holiday ledger: holidays in range, who worked them, credits earned, substitute days granted, credits redeemed and still owed.
   - Exceptions: OT, overrides, missing entries, edits after submission.
   - Sign-off: period status, approved by and when.
   - A one-page weekly version is the default for the Monday review. The single-employee version shows the full day-by-day history for dispute resolution.

## 7. Database schema (MySQL 8)

See `server/src/db/migrations/001_init.sql` — canonical DDL for this spec (tables, views, seeds; no stored routines in V1).

Key objects:

- users (logins, 2FA-ready), employees (identity + employment dates only)
- employee_compensation (effective-dated pay classification — the only place rates/exemption live)
- wage_rules (dated legal parameters + seeds), pay_periods (OPEN/SUBMITTED/RETURNED/APPROVED)
- timecard_entries (weekly header, non-derived fields only), timecard_days (sole source of truth for time)
- timecard_weekly view (ALL derived totals: worked/leave buckets, reg/OT — single definition)
- holidays (calendar only; credits are Phase 2), leave_types (extensible) + leave_policies + leave_ledger, leave_balances view
- audit_log (append-only event log), attachments (opaque storage keys), cash_payments (control log), export_log, settings, sessions

Implementation notes:

- Daily rows are the source of truth; weekly totals are derived in timecard_weekly and never stored. V1 has deliberately no triggers/procedures (they would require elevated MySQL privileges); period locking and transition rules are enforced in API transactions that re-check period status on every write. DB-level lock triggers are deferred hardening.
- Audit rows for timecard_entries, employees, pay_periods, leave_ledger and users are written by the API layer inside the same transaction as the change, carrying actor, before/after JSON, request ID, IP, and reason. Status changes and reopens always carry a reason.
- Indexes on timecard_entries(employee_id, pay_period_id), audit_log(entity_table, entity_id, occurred_at), leave_ledger(employee_id, leave_type) and employee_compensation(employee_id, effective_from).
- Applicable payroll, wage, time, and related records are retained per CPA/legal confirmation (baseline: six years for NY wage/payroll records). No hard deletes of payroll-related rows; back up and test restores.

## 8. API routes

All routes require authentication; role checks are enforced server-side.

| Method | Route | Role | Purpose |
|---|---|---|---|
| POST | /api/auth/login, /logout | any | Session handling |
| GET/POST/PUT | /api/employees, /api/employees/:id | admin (write) | Roster; terminate via termination_date |
| GET | /api/employees/:id/history | any | Weekly history, leave ledger |
| GET/POST | /api/pay-periods | admin (create) | List / create weekly period |
| POST | /api/pay-periods/:id/submit | admin | Open → Submitted |
| POST | /api/pay-periods/:id/approve | owner | Submitted → Approved |
| POST | /api/pay-periods/:id/return | owner | Submitted → Open (reason) |
| POST | /api/pay-periods/:id/reopen | owner | Approved → Open (reason) |
| GET | /api/timecards/:pay_period_id | any | Entries plus computed Reg/OT |
| PUT | /api/timecards/bulk-update | admin | Transactional batch save of daily lines |
| POST | /api/timecards/:id/attachments | admin | Attach scanned card |
| GET | /api/dashboard/:pay_period_id | any | Cards plus exception list |
| GET | /api/trends?weeks=12 | any | Hours/OT/leave time series |
| GET | /api/leave/balances | any | Balances per employee (paid, unpaid, prenatal) |
| GET/POST | /api/cash-payments | admin | Log cash handover and signed receipt |
| GET/PUT | /api/compliance/wage-rules | owner (write) | Current and dated legal parameters |
| POST | /api/leave/adjustments | owner | Manual adjustment (reason) |
| GET | /api/audit-log | any | Filtered audit trail |
| GET | /api/reports/export/:pay_period_id | any | Excel/CSV (logged to export_log) |
| GET/POST | /api/holidays | owner (write) | Company holiday calendar |
| POST | /api/holidays/:id/substitutions | owner | Move a holiday to another day for an employee |
| GET | /api/holiday-credits | any | Credits owed / used per employee |
| POST | /api/holiday-credits/:id/redeem | owner | Assign a day off against a credit, or pay out (reason) |
| GET | /api/reports/summary?from=&to=&employee_id= | any | Summary report data |
| GET | /api/reports/summary/export?format=pdf\|xlsx | any | Summary report file |
| POST | /api/exports/:id/mark-sent | any | Record date sent to CPA |

## 9. CPA export

- Obtain the CPA's current sample file before building the export, and match column order and headings exactly.
- Columns expected: Emp Num, Name, S/H, Pay Method, Rate/Salary, Reg, OT, Vac, Bonus, Hol, Reimb, Sick (paid), Sick (unpaid), Prenatal, Spread Days, Call-in Hrs, Sick Accrued, Sick Balance, plus a totals row. Cash-paid employees are always included.
- Export is allowed only for Approved periods (a draft export can be watermarked "DRAFT").
- Each export is stored in export_log with a file hash so the CEO can confirm what the CPA received.

## 10. Roadmap

| Phase | Deliverables |
|---|---|
| 1. Foundation (MVP) | Migrations, login and roles, roster (pay method, rates), period creation, daily entry grid (Mon–Sun, type codes) with auto-OT and live totals, holiday calendar, minimum-wage validation, submit / approve / lock, CPA export, weekly summary report |
| 2. Control | Audit log with UI, exception alerts, reopen workflow, export history, scanned-card attachments, holiday substitutions and credits, cash payment receipts, paid/unpaid sick ledger and balances, range and per-employee summary reports (PDF/Excel) |
| 3. Insight | Trend charts, per-employee history, leave-policy screens, headcount-tier alert, email/Slack reminders for unsubmitted periods |
| 4. Hardening | Automated backups and restore test, 2FA for Owner, retention policy, role and lock tests |
