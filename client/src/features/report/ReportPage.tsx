import { Fragment, useEffect, useState } from "react";
import { AlertTriangle, Calendar, Clock, DollarSign } from "lucide-react";
import { get, post } from "../../api/client";
import { CashBadge, EmptyState, Notice, Skeleton } from "../../components/polish";
import { hoverCss } from "../../components/theme";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { availableYears, defaultYear, filterPeriods, fmtDay, fmtRange, groupPeriods } from "../../lib/periodOptions";

interface Period {
  id: number;
  start_date: string;
  end_date: string;
  status: "OPEN" | "SUBMITTED" | "APPROVED";
}

interface GridRow {
  employee: { id: number; full_name: string; employee_number: string; payment_method?: string | null };
  entry: { bonus_amount: unknown; reimbursement_amount: unknown } | null;
  computed: {
    reg_hours: unknown;
    ot_hours: unknown;
    holiday_hours: unknown;
    sick_safe_paid_hours: unknown;
    vacation_hours: unknown;
  } | null;
}

const num = (v: unknown): string => {
  const n = Number(v ?? 0);
  return Number.isNaN(n) ? "0" : String(Math.round(n * 100) / 100);
};

const fmtDate = (v: unknown): string => {
  const d = new Date(v as any); // local calendar, matching the server (never slice UTC)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const currentMonth = (): string => fmtDate(new Date()).slice(0, 7);

const monthLabel = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};

const money = (v: unknown): string => {
  const n = Number(v ?? 0);
  return "$" + (Number.isNaN(n) ? "0.00" : n.toFixed(2));
};

// Zero values show as a muted dash (see .zero-mute in theme hoverCss) while
// the real text stays in the DOM for tests and screen readers.
const isZeroish = (v: unknown): boolean => Number(String(v).replace(/[$,\s]/g, "")) === 0;

function Zero({ value }: { value: string }) {
  return isZeroish(value) ? <span className="zero-mute">{value}</span> : <>{value}</>;
}

function Ot({ value }: { value: string }) {
  if (isZeroish(value)) return <Zero value={value} />;
  return <span className="font-semibold text-amber-600 dark:text-amber-400">{value}</span>;
}

// Native select dressed like the shadcn Input (same reason as EmployeesPage:
// Radix Select renders no native <select>).
const selectClass =
  "flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

interface MonthlyWeek {
  week_start: string;
  week_end: string;
  reg: string;
  ot: string;
  hol?: string;
  sick?: string;
  vac?: string;
  bonus?: string;
  reimb?: string;
}

interface TableRow {
  id: number;
  employee_id?: number;
  name: string;
  cash?: boolean;
  reg: string;
  ot: string;
  hol: string;
  sick: string;
  vac: string;
  bonus: string;
  reimb: string;
  weeks?: MonthlyWeek[];
}

interface LedgerRow {
  date: string;
  leave_type: string;
  entry_type: string;
  hours: number | string;
  note: string | null;
}

interface LeaveData {
  balances: Record<string, number>;
  ledger: LedgerRow[];
}

function LeaveDetail({ leave }: { leave: LeaveData }) {

  const bal = Number(leave.balances["SICK_SAFE_PAID"] ?? 0);
  // Usage rows carry the sick date in `note` (reason = work_date); fall back
  // to the ledger date for rows without a date-like note.
  // entry_type arrives in the ENUM's declared case (USAGE) while mocks and
  // older rows may use lowercase — compare case-insensitively.
  const taken = (leave.ledger ?? []).filter((l) => String(l.entry_type).toLowerCase() === "usage");
  return (
    <div className="px-1 py-1 text-sm">
      <div>Sick: {bal} of 40 hours remaining</div>
      {taken.length === 0 ? (
        <div className="text-muted-foreground">No sick days taken.</div>
      ) : (
        <ul className="ml-4 mt-1 list-disc">
          {taken.map((l, i) => (
            <li key={i}>
              {fmtDay(/^\d{4}-\d{2}-\d{2}$/.test(String(l.note ?? "")) ? l.note : l.date)} — {Number(l.hours)}h
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface AlertItem {
  code: string;
  severity: "red" | "amber" | "yellow";
  employee_id: number | null;
  employee_name: string | null;
  message: string;
  detail: Record<string, unknown>;
}

const SEVERITY_DOT: Record<AlertItem["severity"], string> = {
  red: "bg-[#dc2626]",
  amber: "bg-[#d97706]",
  yellow: "bg-[#eab308]",
};

const SEVERITY_RANK: Record<AlertItem["severity"], number> = { red: 0, amber: 1, yellow: 2 };

// Read-only alerts card above the weekly table. Refetches when the selected
// period changes; never blocks the page (muted fallback on error).
function AlertsCard({ periodId }: { periodId: number }) {
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setAlerts(null);
    setFailed(false);
    get<{ data: { alerts: AlertItem[] } }>(`/api/dashboard/${periodId}/alerts`)
      .then((j) => {
        if (live) setAlerts(j.data?.alerts ?? []);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [periodId]);

  const sorted = [...(alerts ?? [])].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return (
    <Card className="p-4">
      <h3 className="mb-2 text-sm font-semibold">Needs your attention</h3>
      {failed ? (
        <p className="text-sm text-muted-foreground">Unable to load alerts</p>
      ) : alerts === null ? (
        <p className="text-sm text-muted-foreground">Checking...</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">All clear</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((a, i) => (
            <li key={`${a.code}-${a.employee_id ?? "period"}-${i}`} className="flex items-center gap-2 text-sm">
              <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[a.severity]}`} />
              <span>
                {a.message}
                {a.employee_name ? ` — ${a.employee_name}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReportTable({
  rows,
  openLeave,
  leaveById,
  leaveLoading,
  onToggleLeave,
}: {
  rows: TableRow[];
  openLeave: Record<number, boolean>;
  leaveById: Record<number, LeaveData>;
  leaveLoading: Record<number, boolean>;
  onToggleLeave: (id: number) => void;
}) {
  const total = (f: (r: TableRow) => string): string => {
    const n = rows.reduce((t, r) => t + Number(f(r) ?? 0), 0);
    return String(Math.round(n * 100) / 100);
  };
  return (
    <Card>
      <Table className="report-table min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Reg</TableHead>
            <TableHead className="text-right">OT</TableHead>
            <TableHead className="text-right">Hol</TableHead>
            <TableHead className="text-right">Sick</TableHead>
            <TableHead className="text-right">Vacation</TableHead>
            <TableHead className="text-right">Bonus ($)</TableHead>
            <TableHead className="text-right">Reimbursement ($)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <TableRow className="tc-row odd:bg-muted/50">
                <TableCell>
                  <Button
                    variant="link"
                    onClick={() => onToggleLeave(r.employee_id ?? r.id)}
                    aria-expanded={!!openLeave[r.employee_id ?? r.id]}
                    title="Show sick leave balance and dates taken"
                    className="h-auto p-0 font-semibold"
                  >
                    {r.name}
                  </Button>
                  {r.cash && <CashBadge />}
                </TableCell>
                <TableCell className="text-right"><Zero value={r.reg} /></TableCell>
                <TableCell className="text-right"><Ot value={r.ot} /></TableCell>
                <TableCell className="text-right"><Zero value={r.hol} /></TableCell>
                <TableCell className="text-right"><Zero value={r.sick} /></TableCell>
                <TableCell className="text-right"><Zero value={r.vac} /></TableCell>
                <TableCell className="text-right"><Zero value={money(r.bonus)} /></TableCell>
                <TableCell className="text-right"><Zero value={money(r.reimb)} /></TableCell>
              </TableRow>
              {openLeave[r.employee_id ?? r.id] && (
                <TableRow className="leave-detail-row bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={8}>
                    {leaveLoading[r.employee_id ?? r.id] && <span className="text-sm">Loading…</span>}
                    {leaveById[r.employee_id ?? r.id] && <LeaveDetail leave={leaveById[r.employee_id ?? r.id]} />}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
        <TableFooter className="report-totals-row">
          <TableRow className="font-semibold">
            <TableCell>Total</TableCell>
            <TableCell className="text-right"><Zero value={total((r) => r.reg)} /></TableCell>
            <TableCell className="text-right"><Ot value={total((r) => r.ot)} /></TableCell>
            <TableCell className="text-right"><Zero value={total((r) => r.hol)} /></TableCell>
            <TableCell className="text-right"><Zero value={total((r) => r.sick)} /></TableCell>
            <TableCell className="text-right"><Zero value={total((r) => r.vac)} /></TableCell>
            <TableCell className="text-right"><Zero value={money(total((r) => r.bonus))} /></TableCell>
            <TableCell className="text-right"><Zero value={money(total((r) => r.reimb))} /></TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </Card>
  );
}

function KpiCards({ rows }: { rows: TableRow[] }) {
  const sum = (f: (r: TableRow) => string): number =>
    Math.round(rows.reduce((t, r) => t + Number(f(r) ?? 0), 0) * 100) / 100;
  const reg = sum((r) => r.reg);
  const ot = sum((r) => r.ot);
  const hol = sum((r) => r.hol);
  const leave = sum((r) => r.sick) + sum((r) => r.vac) + hol;
  const extra = sum((r) => r.bonus) + sum((r) => r.reimb);
  const worked = Math.round((reg + ot) * 100) / 100;
  const otPct = worked > 0 ? ((ot / worked) * 100).toFixed(1) : "0.0";
  const total = Math.round((reg + ot + hol) * 100) / 100;
  const seg = (v: number): string => (total > 0 ? `${Math.max(0, Math.min(100, (v / total) * 100))}%` : "0%");
  const cards = [
    {
      label: "Total Worked Hours",
      value: String(worked),
      icon: Clock,
      iconClass: "text-slate-400 dark:text-slate-500",
      valueClass: "text-slate-900 dark:text-slate-50",
      badge: null as React.ReactNode,
    },
    {
      label: "Overtime Hours",
      value: String(ot),
      icon: AlertTriangle,
      iconClass: "text-amber-500",
      valueClass: "text-amber-600 dark:text-amber-500",
      badge: (
        <Badge className="mt-1 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
          {otPct}% OT
        </Badge>
      ),
    },
    {
      label: "Leave & PTO",
      value: String(leave),
      icon: Calendar,
      iconClass: "text-slate-400 dark:text-slate-500",
      valueClass: "text-slate-900 dark:text-slate-50",
      badge: null as React.ReactNode,
    },
    {
      label: "Est. Gross Payroll",
      value: money(String(extra)),
      icon: DollarSign,
      iconClass: "text-slate-400 dark:text-slate-500",
      valueClass: "text-slate-900 dark:text-slate-50",
      badge: null as React.ReactNode,
    },
  ];
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((kpi) => (
          <Card key={kpi.label} className="kpi-card border border-slate-200 bg-white p-0 shadow-xs dark:border-slate-800 dark:bg-slate-950">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{kpi.label}</CardTitle>
              <kpi.icon aria-hidden className={`h-4 w-4 shrink-0 ${kpi.iconClass}`} />
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className={`kpi-card-value text-2xl font-bold ${kpi.valueClass}`}>{kpi.value}</div>
              {kpi.badge}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">Pay period hours distribution</span>
          <span className="shrink-0 font-semibold">{total} Total Hours</span>
        </div>
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`Regular ${reg} hours, overtime ${ot} hours, holiday ${hol} hours`}
        >
          <div className="bg-slate-800 dark:bg-slate-200" style={{ width: seg(reg) }} />
          <div className="bg-amber-500" style={{ width: seg(ot) }} />
          <div className="bg-slate-300 dark:bg-slate-700" style={{ width: seg(hol) }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-slate-800" />Reg ({reg}h)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-amber-500" />OT ({ot}h)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-slate-300" />Holiday ({hol}h)
          </span>
        </div>
      </Card>
    </>
  );
}

export default function ReportPage() {
  const [mode, setMode] = useState<"weekly" | "monthly">("weekly");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [mrows, setMrows] = useState<TableRow[]>([]);
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState<Period["status"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState("");
  const [reopening, setReopening] = useState(false);
  const [openEmp, setOpenEmp] = useState<Record<number, boolean>>({});
  const [openLeave, setOpenLeave] = useState<Record<number, boolean>>({});
  const [leaveById, setLeaveById] = useState<Record<number, LeaveData>>({});
  const [leaveLoading, setLeaveLoading] = useState<Record<number, boolean>>({});
  const [year, setYear] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  const todayYmd = fmtDate(new Date());
  const normalized = periods.map((p) => ({ ...p, start: fmtDate(p.start_date), end: fmtDate(p.end_date) }));
  const years = availableYears(normalized);
  const effYear = year ?? defaultYear(normalized, todayYmd);
  const visibleIds = new Set(
    effYear ? filterPeriods(normalized, { year: effYear, includeArchived }).map((p) => p.id) : []
  );
  const visiblePeriods = periods.filter((p) => visibleIds.has(p.id));
  const groups = groupPeriods(
    visiblePeriods.map((p) => ({ id: p.id, start: fmtDate(p.start_date), end: fmtDate(p.end_date), status: p.status })),
    todayYmd
  );

  useEffect(() => {
    get<{ data: Period[] }>("/api/pay-periods")
      .then((j) => {
        setPeriods(j.data);
        const months = [...new Set(j.data.map((p) => fmtDate(p.start_date).slice(0, 7)))];
        const latest = months[0] ?? currentMonth(); // periods arrive newest-first
        setMonth((cur) => cur || latest);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load pay periods.");
        setLoading(false);
      });
  }, []);

  // Keep the selection inside the visible filter (preferred: first OPEN).
  useEffect(() => {
    if (periods.length === 0) {
      if (periodId !== null) setPeriodId(null);
      return;
    }
    if (!visiblePeriods.some((p) => p.id === periodId)) {
      const pref = visiblePeriods.find((p) => p.status === "OPEN") ?? visiblePeriods[0] ?? null;
      setPeriodId(pref ? pref.id : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, year, includeArchived]);

  useEffect(() => {
    if (periodId == null) return;
    setLoading(true);
    setError("");
    get<{ data: { period: Period; rows: GridRow[] } }>(`/api/timecards/${periodId}`)
      .then((j) => {
        setRows(j.data.rows ?? []);
        setStatus(j.data.period.status);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load timecards.");
        setLoading(false);
      });
  }, [periodId, reloadKey]);

  useEffect(() => {
    if (mode !== "monthly" || !month) return;
    setLoading(true);
    setError("");
    get<{ data: { month: string; rows: any[] } }>(`/api/reports/monthly?month=${month}`)
      .then((j) => {
        setMrows(
          (j.data.rows ?? []).map((r) => ({
            id: r.employee_id,
            employee_id: r.employee_id,
            name: r.name,
            cash: r.cash === true,
            reg: num(r.reg),
            ot: num(r.ot),
            hol: num(r.hol),
            sick: num(r.sick),
            vac: num(r.vacation),
            bonus: num(r.bonus),
            reimb: num(r.reimb),
            weeks: (r.weeks ?? []).map((w: any) => ({
              week_start: w.week_start,
              week_end: w.week_end,
              reg: num(w.reg),
              ot: num(w.ot),
              hol: num(w.hol),
              sick: num(w.sick),
              vac: num(w.vacation ?? w.vac),
              bonus: num(w.bonus),
              reimb: num(w.reimb),
            })),
          }))
        );
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load the monthly report.");
        setLoading(false);
      });
  }, [mode, month]);

  const approve = async () => {
    if (periodId == null) return;
    setApproving(true);
    setError("");
    try {
      const j = await post<{ data: { period: Period } }>(`/api/pay-periods/${periodId}/approve`);
      setStatus(j.data.period.status);
      const grid = await get<{ data: { period: Period; rows: GridRow[] } }>(`/api/timecards/${periodId}`);
      setRows(grid.data.rows);
    } catch {
      setError("Approve failed — the period may no longer be SUBMITTED.");
    } finally {
      setApproving(false);
    }
  };

  const closeReopen = () => {
    setReopenOpen(false);
    setReopenReason("");
    setReopenError("");
  };

  const reopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (periodId == null || reopening) return;
    if (!reopenReason.trim()) {
      setReopenError("A reason is required to reopen.");
      return;
    }
    setReopening(true);
    setReopenError("");
    try {
      const j = await post<{ data: { period: Period } }>(`/api/pay-periods/${periodId}/reopen`, { reason: reopenReason.trim() });
      setStatus(j.data.period.status);
      closeReopen();
      const grid = await get<{ data: { period: Period; rows: GridRow[] } }>(`/api/timecards/${periodId}`);
      setRows(grid.data.rows);
    } catch {
      setReopenError("Reopen failed — the period may no longer be APPROVED.");
    } finally {
      setReopening(false);
    }
  };

  // Computed unconditionally but cheap; rows is always an array (guards on
  // setRows/setMrows coerce malformed payloads to []).
  const weeklyRows: TableRow[] = (rows ?? []).map((r) => ({
    id: r.employee.id,
    employee_id: r.employee.id,
    name: r.employee.full_name,
    cash: r.employee.payment_method === "CASH",
    reg: num(r.computed?.reg_hours),
    ot: num(r.computed?.ot_hours),
    hol: num(r.computed?.holiday_hours),
    sick: num(r.computed?.sick_safe_paid_hours),
    vac: num(r.computed?.vacation_hours),
    bonus: num(r.entry?.bonus_amount),
    reimb: num(r.entry?.reimbursement_amount),
  }));

  // Owner drill-down: sick balance + dates taken per employee. Lazy per-row
  // fetch (no N+1 on load); GET /api/employees/:id/leave is auth-only so both
  // roles can call it.
  const toggleLeave = (id: number) => {
    const next = !openLeave[id];
    setOpenLeave((p) => ({ ...p, [id]: next }));
    if (!next || leaveById[id] || leaveLoading[id]) return;
    setLeaveLoading((p) => ({ ...p, [id]: true }));
    get<{ data: LeaveData }>(`/api/employees/${id}/leave`)
      .then((j) => setLeaveById((p) => ({ ...p, [id]: j.data })))
      .catch(() => undefined)
      .finally(() => setLeaveLoading((p) => ({ ...p, [id]: false })));
  };

  const leaveProps = { openLeave, leaveById, leaveLoading, onToggleLeave: toggleLeave };

  const displayRows: TableRow[] = mode === "weekly" ? weeklyRows : mrows;
  const showKpis = !loading && !error && displayRows.length > 0;

  const step = (dir: 1 | -1) => {
    const idx = visiblePeriods.findIndex((p) => p.id === periodId);
    const next = visiblePeriods[idx + dir]; // list is newest-first: +1 = older week, -1 = newer
    if (next) setPeriodId(next.id);
  };

  return (
    <section className="space-y-4">
      <style>{hoverCss}</style>
      <Card className="p-4">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">{mode === "weekly" ? "Weekly report" : "Monthly report"}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Report range" className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setMode("weekly")} disabled={mode === "weekly"}>Weekly</Button>
            <Button variant="outline" size="sm" onClick={() => setMode("monthly")} disabled={mode === "monthly"}>Monthly</Button>
          </div>
          {mode === "weekly" ? (
            <>
              <label className="flex items-center gap-1.5 text-sm">
                Year{" "}
                <select
                  aria-label="Year"
                  value={effYear ?? ""}
                  onChange={(e) => setYear(e.target.value)}
                  disabled={years.length === 0}
                  className={selectClass}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                  className="accent-primary"
                />{" "}
                Include Archived/Approved Periods
              </label>
              <label className="flex items-center gap-1 text-sm">
                Period{" "}
                <Button aria-label="Previous week" variant="ghost" size="icon" onClick={() => step(1)} disabled={visiblePeriods.length === 0 || visiblePeriods.findIndex((p) => p.id === periodId) >= visiblePeriods.length - 1}>‹</Button>
                <select
                  value={periodId ?? ""}
                  onChange={(e) => setPeriodId(Number(e.target.value))}
                  disabled={visiblePeriods.length === 0}
                  className={selectClass}
                >
                  {groups.current.length > 0 && (
                    <optgroup label="Active / Current Week">
                      {groups.current.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </optgroup>
                  )}
                  {groups.open.length > 0 && (
                    <optgroup label="Open / Action Required">
                      {groups.open.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </optgroup>
                  )}
                  {groups.approved.length > 0 && (
                    <optgroup label="Approved / Closed">
                      {groups.approved.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <Button aria-label="Next week" variant="ghost" size="icon" onClick={() => step(-1)} disabled={visiblePeriods.length === 0 || visiblePeriods.findIndex((p) => p.id === periodId) <= 0}>›</Button>
              </label>{" "}
            </>
          ) : (
            <label className="flex items-center gap-1.5 text-sm">
              Month{" "}
              <select
                aria-label="Month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                disabled={periods.length === 0}
                className={selectClass}
              >
                {[...new Set(periods.map((p) => fmtDate(p.start_date).slice(0, 7)))].map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === "weekly" && (
            <>
            {status === "SUBMITTED" && (
            <Button onClick={approve} disabled={approving || reopening}>
              {approving ? "Approving…" : "Approve"}
            </Button>
            )}
            <Button variant="outline" onClick={() => { setReopenOpen(true); setReopenError(""); }} disabled={(status !== "APPROVED" && status !== "SUBMITTED") || approving || reopening}>
              Reopen
            </Button>
            </>
          )}
          {reopenOpen && (
            <div
              role="presentation"
              onClick={closeReopen}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            >
              <Card
                role="dialog"
                aria-modal="true"
                aria-label="Reopen period"
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md p-6"
              >
                <h3 className="mb-3 text-lg font-semibold tracking-tight">Reopen period</h3>
                <form onSubmit={reopen} className="space-y-4">
                  <label className="block text-xs font-medium text-muted-foreground">
                    Reason for reopening (required)
                    <textarea
                      aria-label="Reopen reason"
                      value={reopenReason}
                      onChange={(e) => setReopenReason(e.target.value)}
                      rows={3}
                      className="mt-1 flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                  {reopenError && <Notice title="Couldn't reopen" message={reopenError} />}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={closeReopen}>Cancel</Button>
                    <Button type="submit" disabled={reopening} className="flex-1">
                      {reopening ? "Reopening…" : "Reopen"}
                    </Button>
                  </div>
                </form>
              </Card>
            </div>
          )}
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">
        {mode === "weekly" && status === "OPEN" && <Badge className="border-transparent bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-100">🟡 OPEN (Awaiting Submission)</Badge>}
        {mode === "weekly" && status === "SUBMITTED" && <Badge className="border-transparent bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-100">🔵 SUBMITTED (Pending CEO Approval)</Badge>}
        {mode === "weekly" && status === "APPROVED" && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">🟢 APPROVED</Badge>}
      </div>
      {loading && <Skeleton rows={5} cols={8} />}
      {error && <Notice title="Something didn't load" message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {showKpis && <KpiCards rows={displayRows} />}
      {mode === "weekly" && periodId != null && <AlertsCard periodId={periodId} />}
      {mode === "monthly" && !loading && !error && mrows.length === 0 && (
        <EmptyState title="No data for this month" hint="Pick a month with approved or open weeks." />
      )}
      {mode === "monthly" && !loading && !error && mrows.length > 0 && <ReportTable rows={mrows} {...leaveProps} />}
      {mode === "monthly" && !loading && !error && mrows.some((r) => (r.weeks ?? []).length > 0) && (
        <>
          <h3 className="text-lg font-semibold tracking-tight">By week</h3>
          <Card>
            <Table className="report-table min-w-[480px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Week</TableHead>
                  <TableHead className="text-right">Reg</TableHead>
                  <TableHead className="text-right">OT</TableHead>
                  <TableHead className="text-right">Hol</TableHead>
                  <TableHead className="text-right">Sick</TableHead>
                  <TableHead className="text-right">Vac</TableHead>
                  <TableHead className="text-right">Bonus ($)</TableHead>
                  <TableHead className="text-right">Reimb ($)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mrows.filter((r) => (r.weeks ?? []).length > 0).map((r) => (
                  <Fragment key={`emp-${r.employee_id ?? r.id}`}>
                    <TableRow className="tc-row odd:bg-muted/50">
                      <TableCell colSpan={4}>
                        <button
                          onClick={() => setOpenEmp((p) => ({ ...p, [r.employee_id ?? r.id]: !p[r.employee_id ?? r.id] }))}
                          aria-expanded={!!openEmp[r.employee_id ?? r.id]}
                          className="cursor-pointer bg-transparent p-0 text-sm font-semibold"
                        >
                          {openEmp[r.employee_id ?? r.id] ? "▼" : "▶"} {r.name}
                        </button>
                      </TableCell>
                    </TableRow>
                    {(openEmp[r.employee_id ?? r.id] ? r.weeks ?? [] : []).map((w) => (
                      <TableRow key={`${r.employee_id}-${w.week_start}`} className="tc-row">
                        <TableCell></TableCell>
                        <TableCell>{fmtRange(w.week_start, w.week_end)}</TableCell>
                        <TableCell className="text-right"><Zero value={num(w.reg)} /></TableCell>
                        <TableCell className="text-right"><Ot value={num(w.ot)} /></TableCell>
                        <TableCell className="text-right"><Zero value={num(w.hol)} /></TableCell>
                        <TableCell className="text-right"><Zero value={num(w.sick)} /></TableCell>
                        <TableCell className="text-right"><Zero value={num(w.vac)} /></TableCell>
                        <TableCell className="text-right"><Zero value={money(w.bonus)} /></TableCell>
                        <TableCell className="text-right"><Zero value={money(w.reimb)} /></TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
      {mode === "weekly" && !loading && !error && periods.length === 0 && (
        <EmptyState title="No pay periods yet" hint="Create a weekly period to see the report." />
      )}
      {mode === "weekly" && !loading && !error && periods.length > 0 && rows.length === 0 && (
        <EmptyState title="No employees in this period" hint="Add employees to the roster first." />
      )}
      {mode === "weekly" && !loading && !error && rows.length > 0 && (
        <ReportTable
          rows={weeklyRows}
          {...leaveProps}
        />
      )}
    </section>
  );
}
