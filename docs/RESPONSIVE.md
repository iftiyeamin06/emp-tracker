# RESPONSIVE.md — mobile/tablet plan (CEO: phone-readable reports + approve)

Context: internal time-tracking tool. Primary = desktop office laptops (already
works at >= 1024px). Secondary = owner on phone/tablet reading reports and
approving. No layout engine in tests (vitest + jsdom), so responsive behavior
is verified through a `useIsMobile` hook unit test + DOM assertions on the
mobile/desktop gates — never through pixel assertions.

Breakpoints (tailwind defaults, no custom screens): mobile 375–767px
(`max-md` / base styles), tablet 768–1023px (`md:`), desktop >= 1024px (`lg:`).

Shared mechanism (built once in Turn 1, reused everywhere):
`client/src/lib/useIsMobile.ts` → `matchMedia("(max-width: 767px)")` hook
(defaults to desktop on first render to avoid hydration/SSR-style flicker;
vitest mocks `matchMedia`). All gates below use it — no `window.innerWidth`
reads in components.

---

## 1. Per-screen plan

### 1a. App shell — sidebar + topbar (`TopBar.tsx`, `App.tsx`)
- Current: sidebar is fixed `w-56 shrink-0` (`TopBar.tsx:49`); on a 375px
  phone it eats 224px and crushes `main`. TopBar is
  `justify-between px-6` with email + role badge + theme toggle in one row —
  overflows and wraps ugly on narrow screens.
- Breaks: tablet = sidebar usable but wide (acceptable); mobile = content
  unreadable, topbar overflows.
- Fix (Turn 1):
  - Sidebar: `hidden md:flex` (off-canvas entirely on mobile; navigation
    moves to a compact top bar — see below). Tablet keeps full sidebar.
  - Mobile nav: horizontal scroll row of the same `NAV` links under the
    header (`md:hidden flex gap-1 overflow-x-auto`), reusing `NavLink`.
  - TopBar on mobile: hide email text (`hidden sm:inline`), keep title +
    role badge + theme toggle; `px-4 py-3`.
  - `main`: `p-4 md:p-6`.
- Tests: `useIsMobile` unit test (matchMedia mock → true/false); App test
  asserting the mobile nav row renders links (query by nav anchor text —
  existing sidebar assertions unchanged).

### 1b. Login (`LoginPage.tsx`)
- Current: centered `max-w-sm` card with `p-6` — already stacks vertically.
- Breaks: nothing structural; `-m-6` on the wrapper assumes the `p-6`
  parent in `App.tsx` (fine after shell change keeps mobile `p-4` — update
  to `-m-4 md:-m-6`).
- Fix (Turn 2): one-line margin fix + `min-h-[100dvh]` instead of
  `min-h-screen` so mobile browser chrome doesn't clip the card.
- Tests: none new (existing login tests cover behavior; no text changes).

### 1c. Report weekly — KPI cards + distribution + table (`ReportPage.tsx`)
- Current: KPI grid is already `grid-cols-2 sm:3 lg:6` (fine on all sizes);
  distribution bar is full-width flex (fine); `report-table min-w-[640px]`
  inside `Table`'s `overflow-auto` wrapper (scrolls — acceptable); control
  bar is `flex-wrap` (wraps — acceptable).
- Breaks: mobile = table requires horizontal scroll (accepted for data
  tables — readable via scroll, not crushed); Approve/Reopen buttons are
  `h-9` (36px), below the 44px touch minimum.
- Fix (Turn 3): no layout change except `min-h-[44px] min-w-[44px]` on
  Approve/Reopen (and their disabled states unchanged); keep table scroll.
  Tablet: no change needed.
- Tests: assert Approve/Reopen render with touch-size classes (class
  assertion, not pixels).

### 1d. Report monthly + Reopen modal (`ReportPage.tsx`)
- Current: same table pattern (`min-w-[480px]`, scrolls fine); Year/Month
  selects in a wrapping flex row (fine); Reopen modal is
  `fixed inset-0 p-4` + `max-w-md` (already fits phones).
- Breaks: nothing structural on tablet/mobile.
- Fix (Turn 4): modal `p-6` → `p-4 sm:p-6` so small screens keep more
  content width; selects get `max-w-full`.
- Tests: existing modal tests cover open/close/validation (no text changes).

### 1e. Alerts card (`ReportPage.tsx` AlertsCard)
- Current: single-column list of severity-dot rows in a `Card` — inherently
  narrow-friendly.
- Breaks: nothing at any breakpoint.
- Fix (Turn 5): none needed — verify only (render at 375px by inspection).
- Tests: none new (existing alert tests unchanged).

### 1f. Employees list — view only (`EmployeesPage.tsx`)
- Current: roster table (Emp # / Name / Hire / Pay / Payment / Overtime /
  Status / Actions) inside `Table`'s `overflow-auto` wrapper; header row has
  Add Employee button.
- Breaks: mobile = 8 columns crush; action cluster (View/Edit/Terminate/
  Delete in one `whitespace-nowrap` cell) forces wide scroll — tolerable but
  the read-only owner view only needs Name/Pay/Status.
- Fix (Turn 6): on mobile (`useIsMobile`), render a compact card list —
  one card per employee (name + status badge + pay line + View button) —
  instead of the table; tablet/desktop keep the table. Add/Edit/Terminate/
  Delete stay as-is (owner view is read-only anyway; admin mutations on
  phones are out of scope but remain reachable via scroll, not removed).
- Tests: new test with `matchMedia` mocked narrow → compact cards render and
  table does not; wide → table renders (existing tests keep passing —
  default mock is wide).

### 1g. Timecard grid — desktop-only gate (`TimecardPage.tsx`)
- Current: 7 day-columns × N employees with sticky name column; minimum
  usable width ~900px+. Unusable on phones by nature, not by bug.
- Fix (Turn 7): when `useIsMobile`, replace the grid `Card` with a notice
  ("Timecard entry needs a larger screen — reviews and approvals still work
  from Report on this device") linking to `#/report`; keep period selector
  visible (read-only context). Desktop/tablet unchanged.
- Tests: narrow mock → gate message renders, no `day-*-*` inputs;
  wide mock → grid renders (existing tests unchanged — default wide).

---

## 2. OUT of scope and why

- **Timecard grid entry on phones** — 7-day × N-employee matrix cannot fit
  375px without destroying the sticky-column/editing model; gated with a
  message instead (Turn 7).
- **Complex modals (Add Employee, New Period)** — already phone-safe
  (`fixed inset-0 p-4`, `max-h-[90vh] overflow-y-auto`); no rebuild, desktop
  remains the primary path for data entry.
- **Audit log** — owner-desktop feature, dense 5-column table; explicitly
  excluded by the brief (stays scrollable, untouched).
- **No custom breakpoints, no CSS rewrites** — tailwind `md:`/`lg:` plus one
  hook; no new dependencies.

## 3. Implementation order (one screen per turn)

1. Turn 1 — shell: `useIsMobile` hook + sidebar/topbar/mobile nav.
2. Turn 2 — login margin/viewport fix.
3. Turn 3 — report weekly: Approve/Reopen touch targets.
4. Turn 4 — report monthly: modal padding, select widths.
5. Turn 5 — alerts: verify-only, no code expected.
6. Turn 6 — employees: mobile compact card list.
7. Turn 7 — timecards: mobile desktop-only gate.
8. Turn 8 — full `npm test` (client + server) + `npm run build`, fix fallout.

## 4. Tests to add or modify

- ADD `client/src/lib/useIsMobile.test.ts`: matchMedia mock → returns true
  when matching, false otherwise; listener cleanup on unmount.
- ADD (Turn 6): employees narrow-renders-cards / wide-renders-table.
- ADD (Turn 7): timecards narrow-renders-gate (no day inputs) /
  wide-renders-grid.
- ADD (Turn 3): Approve/Reopen touch-size class assertion.
- MODIFY none expected: no user-facing text changes are planned, so all
  existing `findByText`/`getByRole` assertions keep passing; if a label must
  change, its test is updated in the same turn.
