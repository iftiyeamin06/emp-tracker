// Shared pay-period selector helpers (grid + report). Pure + unit-tested.
export interface PeriodOption {
  id: number;
  label: string;
}

export interface PeriodGroups {
  current: PeriodOption[];
  open: PeriodOption[];
  approved: PeriodOption[];
}

// Single day, e.g. "Nov 06, 2026" (UTC math on a calendar string).
export function fmtDay(v: unknown): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(String(v).slice(0, 10) + "T00:00:00Z");
  return `${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}, ${d.getUTCFullYear()}`;
}

// Short month-day range, e.g. "Oct 31 – Nov 06, 2026" (UTC math on calendar strings).
export function fmtRange(start: unknown, end: unknown): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = (v: unknown): Date => new Date(String(v).slice(0, 10) + "T00:00:00Z");
  const a = d(start);
  const b = d(end);
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${months[a.getUTCMonth()]} ${p2(a.getUTCDate())} – ${months[b.getUTCMonth()]} ${p2(b.getUTCDate())}, ${b.getUTCFullYear()}`;
}

// Cascading filter for large histories: year first, then archived toggle.
// Default view hides APPROVED (archived) periods; the year defaults to the
// current calendar year when it has data, else the latest year with data
// (so the selector never opens empty).
export interface PeriodFilter {
  year: string;
  includeArchived: boolean;
}

export function availableYears(periods: { start: string }[]): string[] {
  return [...new Set(periods.map((p) => p.start.slice(0, 4)))].sort().reverse();
}

export function defaultYear(periods: { start: string }[], todayYmd: string): string | null {
  const years = availableYears(periods);
  if (years.length === 0) return null;
  const current = todayYmd.slice(0, 4);
  return years.includes(current) ? current : years[0];
}

export function filterPeriods<T extends { start: string; status: string }>(
  periods: T[],
  filter: PeriodFilter
): T[] {
  return periods.filter(
    (p) => p.start.slice(0, 4) === filter.year && (filter.includeArchived || p.status !== "APPROVED")
  );
}
export function groupPeriods(
  periods: { id: number; start: string; end: string; status: string }[],
  todayYmd: string
): PeriodGroups {
  const g: PeriodGroups = { current: [], open: [], approved: [] };
  const opt = (id: number, label: string): PeriodOption => ({ id, label });
  for (const p of periods) {
    if (p.status === "APPROVED") {
      g.approved.push(opt(p.id, `🟢 ${fmtRange(p.start, p.end)} — Approved`));
    } else if (p.status === "OPEN" && p.start <= todayYmd && todayYmd <= p.end) {
      g.current.push(opt(p.id, `🟡 ${fmtRange(p.start, p.end)} — Current Week`));
    } else if (p.status === "SUBMITTED") {
      g.open.push(opt(p.id, `🔵 ${fmtRange(p.start, p.end)} — Submitted`));
    } else {
      g.open.push(opt(p.id, `🟡 ${fmtRange(p.start, p.end)} — Open`));
    }
  }
  return g;
}
