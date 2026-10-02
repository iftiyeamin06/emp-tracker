import { useEffect, useRef, useState } from "react";
import { Clock, Lock } from "lucide-react";
import { get, post, put } from "../../api/client";
import { availableYears, defaultYear, filterPeriods, groupPeriods } from "../../lib/periodOptions";
import { CashBadge, EmptyState, Notice, Skeleton } from "../../components/polish";
import { hoverCss } from "../../components/theme";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { formatDay, leaveHoursOf, parseCell, workedHoursOf } from "./dayCodes";

interface Period {
  id: number;
  start_date: string;
  end_date: string;
  status: "OPEN" | "SUBMITTED" | "APPROVED";
}

interface Day {
  work_date: string;
  day_type: string;
  hours: unknown;
}

interface GridRow {
  employee: { id: number; full_name: string; overtime_status?: string | null; payment_method?: string | null };
  entry: { bonus_amount: unknown; reimbursement_amount: unknown; notes: unknown } | null;
  days: Day[];
  computed: {
    reg_hours: unknown;
    ot_hours: unknown;
    holiday_hours: unknown;
    sick_safe_paid_hours: unknown;
    vacation_hours: unknown;
  } | null;
}

const DOW = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

// Native select dressed like the shadcn Input (same reason as EmployeesPage).
const selectClass =
  "flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// Full weekday label, e.g. "Saturday, September 19, 2026" (UTC math on a calendar string).
const fmtLong = (ymdStr: string): string => {
  const d = new Date(ymdStr + "T00:00:00Z");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${days[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

const isSaturday = (ymdStr: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(ymdStr) && new Date(ymdStr + "T00:00:00Z").getUTCDay() === 6;

// v1 entry codes (case-insensitive on input, stored uppercase).
// Plain 0–24 numbers are also accepted and mean WORK with those hours,
// so real workdays like "9" or "7.5" persist instead of silently reverting.

type Cells = Record<number, Record<string, string>>;
type Extras = Record<number, { bonus: string; reimb: string }>;

const ymd = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

// Calendar day in LOCAL time. The server validates work_date against the same
// local calendar (its ymd() uses local components), so the UI must too —
// slicing the UTC part of an ISO string shifts boundary days and the save is
// rejected with work_date_outside_period.
const cal = (iso: unknown): string => {
  const d = new Date(iso as any);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const weekDates = (start: string): string[] => {
  const base = new Date(start.slice(0, 10) + "T00:00:00Z").getTime();
  return Array.from({ length: 7 }, (_, i) => ymd(new Date(base + i * 86400000)));
};

const num = (v: unknown): string => {
  const n = Number(v ?? 0);
  return Number.isNaN(n) ? "0" : String(Math.round(n * 100) / 100);
};

// Computed values render as disabled inputs: same field look as the editable
// cells, but never editable — they are derived (API view when clean, local
// preview when dirty), not typed.
function ComputedCell({ label, value }: { label: string; value: string }) {
  const empty = Number(value) === 0;
  return (
    <Input
      aria-label={label}
      value={value}
      disabled
      readOnly
      size={5}
      className={`min-w-[34px] border-muted bg-muted px-0.5 text-center text-muted-foreground${empty ? " text-muted-foreground/50" : ""}`}
    />
  );
}

function DayCell({
  value,
  readOnly,
  label,
  onCommit,
}: {
  value: string;
  readOnly: boolean;
  label: string;
  onCommit: (code: string) => boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (readOnly) return <>{value || "–"}</>;
  const commit = () => {
    const code = draft.trim().toUpperCase();
    if (onCommit(code)) setDraft(code);
    else setDraft(value); // invalid → revert
  };
  return (
    <Input
      aria-label={label}
      value={draft}
      placeholder="–"
      title="8 = worked day, H8 holiday, S8 sick, V8 vacation — or type hours like 9"
      size={4}
      className="min-w-[34px] px-0.5 text-center transition-colors hover:border-primary/60"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // Commit directly (not via blur()): blur is a no-op on unfocused
        // elements, which would silently drop keyboard-driven commits.
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

function MoneyCell({
  value,
  readOnly,
  label,
  prefix,
  onCommit,
}: {
  value: string;
  readOnly: boolean;
  label: string;
  prefix?: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (readOnly) return <>{value || "0"}</>;
  const commit = () => {
    const t = draft.trim();
    if (t === "" || (!Number.isNaN(Number(t)) && Number(t) >= 0)) onCommit(t === "" ? "0" : t);
    else setDraft(value); // invalid → revert
  };
  return (
    <span className="inline-flex items-center gap-0.5">
      {prefix && <span aria-hidden className="text-muted-foreground">{prefix}</span>}
      <Input
        aria-label={label}
        value={draft}
        size={6}
        className="min-w-[34px] px-0.5 text-right"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(); // direct: blur() no-ops on unfocused elements
        if (e.key === "Escape") setDraft(value);
      }}
      />
    </span>
  );
}

export default function TimecardPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [baseRows, setBaseRows] = useState<GridRow[]>([]);
  const [cells, setCells] = useState<Cells>({});
  const [extras, setExtras] = useState<Extras>({});
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [notesByEmp, setNotesByEmp] = useState<Record<number, string | null>>({});
  const flashTimer = useRef<number | null>(null);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  const locked = period != null && period.status !== "OPEN";

  const applyGrid = (p: Period, rows: GridRow[]) => {
    setPeriod(p);
    setBaseRows(rows);
    const c: Cells = {};
    const x: Extras = {};
    const n: Record<number, string | null> = {};
    for (const r of rows) {
      c[r.employee.id] = {};
      for (const d of r.days) c[r.employee.id][cal(d.work_date)] = formatDay(d.day_type, d.hours);
      x[r.employee.id] = { bonus: num(r.entry?.bonus_amount), reimb: num(r.entry?.reimbursement_amount) };
      n[r.employee.id] = (r.entry?.notes as string | null) ?? null; // echoed back on save, never edited in v1
    }
    setCells(c);
    setExtras(x);
    setNotesByEmp(n);
    setBaseline(JSON.stringify({ c, x }));
  };

  const loadGrid = (id: number) => {
    setLoading(true);
    setError("");
    get<{ data: { period: Period; rows: GridRow[] } }>(`/api/timecards/${id}`)
      .then((j) => {
        applyGrid(j.data.period, j.data.rows);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load timecards.");
        setLoading(false);
      });
  };

  const [showNew, setShowNew] = useState(false);
  const [newStart, setNewStart] = useState("");
  const [newPay, setNewPay] = useState("");
  const [newError, setNewError] = useState("");
  const [creating, setCreating] = useState(false);

  const loadPeriods = (selectId?: number) => {
    get<{ data: Period[] }>("/api/pay-periods")
      .then((j) => {
        setPeriods(j.data);
        if (selectId != null) setPeriodId(selectId); // create flow: select the new one
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load pay periods.");
        setLoading(false);
      });
  };

  useEffect(() => {
    loadPeriods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showNew) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowNew(false);
        setNewError("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showNew]);

  const addDays = (ymd: string, n: number): string => {
    const t = new Date(ymd + "T00:00:00Z").getTime();
    const d = new Date(t + n * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };

  const createPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSaturday(newStart)) {
      setNewError("Start date must be a Saturday.");
      return;
    }
    if (newPay < addDays(newStart, 6)) {
      setNewError("Check date must be on or after the week end.");
      return;
    }
    setCreating(true);
    setNewError("");
    try {
      const j = await post<{ data: { period: Period } }>("/api/pay-periods", {
        start_date: newStart,
        end_date: addDays(newStart, 6),
        pay_date: newPay,
      });
      setShowNew(false);
      setNewStart("");
      setNewPay("");
      loadPeriods(j.data.period.id); // refetch list and select the new one
    } catch (err: any) {
      setNewError(
        err?.status === 409
          ? "That week overlaps an existing period."
          : "Couldn't create the period. Start must be a Saturday and check date on/after week end."
      );
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (periodId == null) return;
    loadGrid(periodId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId]);

  const dirty = baseline !== "" && JSON.stringify({ c: cells, x: extras }) !== baseline;
  const dates = period ? weekDates(cal(period.start_date)) : [];

  // Operational strip stats (server-computed values, never the local preview).
  const statNum = (v: unknown): number => {
    const n = Number(v ?? 0);
    return Number.isNaN(n) ? 0 : Math.round(n * 100) / 100;
  };
  const periodHours =
    Math.round(baseRows.reduce((t, r) => t + statNum(r.computed?.reg_hours) + statNum(r.computed?.ot_hours), 0) * 100) / 100;
  const flaggedOt = baseRows.filter((r) => statNum(r.computed?.ot_hours) > 0).length;
  const totalOf = (f: (r: GridRow) => unknown): string => String(Math.round(baseRows.reduce((t, r) => t + statNum(f(r)), 0) * 100) / 100);

  // v1 wire codes (route maps SICK/HW8 to the DB enum). Empty clears the day by
  // sending a 0-hour WORK row — the route deletes + reinserts per date.
  const WIRE: Record<string, { day_type: string; hours: number }> = {
    "8": { day_type: "WORK", hours: 8 },
    H8: { day_type: "HOLIDAY", hours: 8 },
    S8: { day_type: "SICK", hours: 8 },
    V8: { day_type: "VACATION", hours: 8 },
    HW8: { day_type: "HW8", hours: 8 },
    "": { day_type: "WORK", hours: 0 },
  };

  const toWire = (cell: string): { day_type: string; hours: number } => {
    const t = cell.trim().toUpperCase();
    if (WIRE[t] !== undefined) return WIRE[t];
    const parsed = parseCell(t); // numeric hours accepted by the editor
    if (parsed) return parsed;
    return { day_type: "WORK", hours: 0 }; // unreachable: only valid cells reach state
  };

  const submit = async () => {
    if (periodId == null || submitting) return;
    if (!window.confirm("Submit this period? Admin edits will be locked.")) return; // cancel = no API call
    setSubmitting(true);
    setSubmitError("");
    try {
      await post(`/api/pay-periods/${periodId}/submit`);
      loadGrid(periodId); // refetch: banner flips, grid locks
    } catch (e: any) {
      setSubmitError(e?.status === 409 ? "Submit failed — the period is no longer OPEN." : "Submit failed. Nothing was changed.");
    } finally {
      setSubmitting(false);
    }
  };

  const save = async () => {
    if (periodId == null || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const rows = baseRows.map((r) => ({
        employee_id: r.employee.id,
        days: dates.map((date) => {
          const w = toWire(cells[r.employee.id]?.[date] ?? "");
          return { work_date: date, day_type: w.day_type, hours: w.hours };
        }),
        bonus_amount: Number(extras[r.employee.id]?.bonus ?? 0),
        reimbursement_amount: Number(extras[r.employee.id]?.reimb ?? 0),
        notes: notesByEmp[r.employee.id] ?? null,
      }));
      await put(`/api/timecards/${periodId}`, { rows });
      loadGrid(periodId); // refetch: server response is the source of truth
      setSavedFlash(true);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setSavedFlash(false), 3000);
    } catch (e: any) {
      // Local edits are untouched, so nothing is lost; dirty flag stays set.
      setSaveError(e?.status === 423 ? "Period is no longer OPEN — refetch to see its state." : "Save failed. Your edits are kept — fix the issue and retry.");
    } finally {
      setSaving(false);
    }
  };

  const commitCell = (empId: number, date: string) => (code: string): boolean => {
    const parsed = parseCell(code);
    if (!parsed) return false; // invalid → caller reverts, state untouched
    setCells((prev) => ({ ...prev, [empId]: { ...prev[empId], [date]: code.trim().toUpperCase() } }));
    return true;
  };

  // Client-side preview from local cells. Simplification: leave buckets count
  // 8h each — the SERVER (timecard_weekly) is the source of truth and
  // recomputes from real hours + comp status on save. Exemption IS respected
  // here (status rides along on each grid row); missing status previews as
  // eligible, mirroring the view.
  const preview = (empId: number) => {
    const row = cells[empId] ?? {};
    const status = baseRows.find((r) => r.employee.id === empId)?.employee?.overtime_status;
    const eligible = status == null || status === "NON_EXEMPT";
    const sum = (f: (c: string) => number) => dates.reduce((t, d) => t + f(row[d] ?? ""), 0);
    const worked = sum(workedHoursOf);
    return {
      worked,
      reg: eligible ? Math.min(worked, 40) : worked,
      ot: eligible ? Math.max(worked - 40, 0) : 0,
      hol: sum((c) => leaveHoursOf(c, "H8")),
      sick: sum((c) => leaveHoursOf(c, "S8")),
      vac: sum((c) => leaveHoursOf(c, "V8")),
    };
  };

  const rowClean = (empId: number): boolean => {
    const base = JSON.parse(baseline || "{}") as { c?: Cells; x?: Extras };
    return JSON.stringify({ c: cells[empId] ?? {}, x: extras[empId] ?? {} }) ===
      JSON.stringify({ c: base.c?.[empId] ?? {}, x: base.x?.[empId] ?? { bonus: "0", reimb: "0" } });
  };

  const todayYmd = cal(new Date());
  const [year, setYear] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const normalized = periods.map((p) => ({ ...p, start: cal(p.start_date), end: cal(p.end_date) }));
  const years = availableYears(normalized);
  const effYear = year ?? defaultYear(normalized, todayYmd);
  const visibleIds = new Set(
    effYear ? filterPeriods(normalized, { year: effYear, includeArchived }).map((p) => p.id) : []
  );
  const visiblePeriods = periods.filter((p) => visibleIds.has(p.id));
  const groups = groupPeriods(
    visiblePeriods.map((p) => ({ id: p.id, start: cal(p.start_date), end: cal(p.end_date), status: p.status })),
    todayYmd
  );
  const step = (dir: 1 | -1) => {
    const idx = visiblePeriods.findIndex((p) => p.id === periodId);
    const next = visiblePeriods[idx + dir]; // list is newest-first: +1 = older week, -1 = newer
    if (next) setPeriodId(next.id);
  };

  // Keep the selection inside the visible filter (preferred: first OPEN).
  useEffect(() => {
    if (periods.length === 0) {
      if (periodId !== null) setPeriodId(null);
      return;
    }
    if (!visiblePeriods.some((p) => p.id === periodId)) {
      const pref = visiblePeriods.find((p) => p.status === "OPEN") ?? visiblePeriods[0] ?? null;
      setPeriodId(pref ? pref.id : null);
      if (!pref) {
        setPeriod(null);
        setBaseRows([]);
        setCells({});
        setExtras({});
        setBaseline("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, year, includeArchived]);

  return (
    <section className="space-y-4">
      <style>{hoverCss}</style>
      <Card className="p-4">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Timecards</h2>
      <div className="flex flex-wrap items-center gap-2">
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
      <label className="flex min-w-0 max-w-full items-center gap-1 text-sm">
        Period{" "}
        <Button aria-label="Previous week" variant="ghost" size="icon" onClick={() => step(1)} disabled={visiblePeriods.length === 0 || visiblePeriods.findIndex((p) => p.id === periodId) >= visiblePeriods.length - 1}>‹</Button>
        <select value={periodId ?? ""} onChange={(e) => setPeriodId(Number(e.target.value))} disabled={visiblePeriods.length === 0} className={`${selectClass} min-w-0 max-w-full`}>
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
      <Button variant="ghost" onClick={() => { setShowNew(true); setNewError(""); }}>
        New Period
      </Button>
      <span className="flex-1" />
      {!locked && (
        <Button variant="outline" onClick={save} disabled={!dirty || saving}>
          {saving ? (<><span aria-hidden className="tc-spinner border-black/20 border-t-gray-900" /> Saving…</>) : "Save"}
        </Button>
      )}
      {!locked && (
        <Button onClick={submit} disabled={dirty || submitting}>
          {submitting ? (<><span aria-hidden className="tc-spinner" /> Submitting…</>) : "Submit Period"}
        </Button>
      )}
      </div>
      {dirty && <span className="text-sm"><span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500" />● Unsaved changes</span>}
      {!locked && (
        <p className="my-1 text-[13px] text-slate-600 dark:text-slate-300">
          Type hours (e.g. 9) or a code: <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">8</kbd> worked · <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">H8</kbd> holiday · <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">S8</kbd> sick · <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">V8</kbd> vacation · <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">HW8</kbd> worked holiday. Click Save when done.
        </p>
      )}
      {savedFlash && <span className="rounded-xl bg-green-600 px-2.5 py-0.5 text-[13px] text-white">Saved</span>}
      </Card>
      {showNew && (
        <div
          role="presentation"
          onClick={() => { setShowNew(false); setNewError(""); }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
        <Card
          role="dialog"
          aria-modal="true"
          aria-label="Create New Pay Period"
          onClick={(e) => e.stopPropagation()}
          className="max-h-[90vh] w-full max-w-xl overflow-y-auto p-6"
        >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-medium">Create New Pay Period</h3>
          <Button type="button" aria-label="Close" variant="ghost" size="icon" onClick={() => { setShowNew(false); setNewError(""); }}>✕</Button>
        </div>
        <form onSubmit={createPeriod} className="space-y-3">
          <label className="mb-3 block text-xs font-medium text-muted-foreground">
            Pay Period Start Date *
            <Input
              aria-label="Start date"
              type="date"
              className="tc-date mt-1 min-w-[160px]"
              value={newStart}
              onChange={(e) => {
                const v = e.target.value;
                setNewStart(v);
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setNewPay(addDays(v, 13)); // default payday, editable
              }}
            />
            <span className="text-muted-foreground">{newStart ? fmtLong(newStart) : "Pick a Saturday"}</span>
            {newStart && !isSaturday(newStart) && (
              <span className="text-destructive">Start date must be a Saturday.</span>
            )}
          </label>
          <label className="mb-3 block text-xs font-medium text-muted-foreground">
            Pay Period End Date (Auto-calculated)
            <Input
              aria-label="End date"
              type="date"
              className="tc-date mt-1 bg-muted"
              value={newStart ? addDays(newStart, 6) : ""}
              readOnly
            />
            <span className="text-muted-foreground">🔒 {newStart ? fmtLong(addDays(newStart, 6)) : "—"}</span>
          </label>
          <label className="mb-3 block text-xs font-medium text-muted-foreground">
            Check Date (Payday) *
            <Input
              aria-label="Pay date"
              type="date"
              className="tc-date mt-1 min-w-[160px]"
              value={newPay}
              onChange={(e) => setNewPay(e.target.value)}
            />
            <span className="text-muted-foreground">{newPay ? fmtLong(newPay) : "—"}</span>
          </label>
          {newError && <Notice title="Couldn't create the period" message={newError} />}
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="outline" onClick={() => { setShowNew(false); setNewError(""); }}>Cancel</Button>
            <Button
              type="submit"
              disabled={creating || !newStart || !newPay || !isSaturday(newStart)}
              className="flex-1"
            >
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
        </Card>
        </div>
      )}
      {saveError && <Notice title="Couldn't save" message={saveError} />}
      {submitError && <Notice title="Couldn't submit" message={submitError} />}
      {period && period.status !== "OPEN" && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300/70 bg-amber-100 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {period.status === "APPROVED" ? (
            <Lock aria-hidden className="h-4 w-4 shrink-0" />
          ) : (
            <Clock aria-hidden className="h-4 w-4 shrink-0" />
          )}
          <p className="m-0">Period {period.status} — read only</p>
        </div>
      )}
      {loading && <Skeleton rows={6} cols={10} />}
      {error && <Notice title="Couldn't load timecards" message="Check your connection, then try again." onRetry={() => periodId != null && loadGrid(periodId)} />}
      {!loading && !error && periods.length === 0 && (
        <Card className="p-8 text-center">
          <EmptyState title="No pay periods yet" hint="Create your first weekly period to start entering time." />
          <Button onClick={() => { setShowNew(true); setNewError(""); }}>
            Create your first period
          </Button>
        </Card>
      )}
      {!loading && !error && periods.length > 0 && baseRows.length === 0 && (
        <Card className="p-4">
          <EmptyState
            title="No employees in this period"
            hint="Nobody was employed during this week."
            action={<a href="#/employees" className="text-primary underline underline-offset-4">Go to Employees</a>}
          />
        </Card>
      )}
      {!loading && !error && baseRows.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">Active Workers</div>
            <div className="mt-1 text-2xl font-semibold">{baseRows.length}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">Total Period Hours</div>
            <div className="mt-1 text-2xl font-semibold">{periodHours}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">Flagged Overtime</div>
            <div className="mt-1 text-2xl font-semibold">{flaggedOt}</div>
          </Card>
        </div>
      )}
      {!loading && !error && baseRows.length > 0 && (
        <Card>
        <Table className="timecard-table">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-[3] bg-card">Name</TableHead>
              {DOW.map((d) => (
                <TableHead key={d} className="border-l border-border/50">{d}</TableHead>
              ))}
              <TableHead>Regular Hours</TableHead>
              <TableHead>Overtime Hours</TableHead>
              <TableHead>Vacation Hours</TableHead>
              <TableHead>Bonus Amount</TableHead>
              <TableHead>Holiday Hours</TableHead>
              <TableHead>Reimbursement Amount</TableHead>
              <TableHead>Sick Hours</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {baseRows.map((r) => {
              const empId = r.employee.id;
              const clean = baseline !== "" && rowClean(empId);
              const pv = preview(empId);
              return (
                <TableRow key={empId} className="tc-row odd:bg-muted/50">
                  <TableCell className="sticky left-0 z-[1] whitespace-nowrap bg-card font-semibold">{r.employee.full_name}{r.employee.payment_method === "CASH" && <CashBadge />}</TableCell>
                  {dates.map((date) => (
                    <TableCell key={date} className="min-w-[60px]">
                      <DayCell
                        value={cells[empId]?.[date] ?? ""}
                        readOnly={locked}
                        label={`day-${empId}-${date}`}
                        onCommit={commitCell(empId, date)}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="text-right"><ComputedCell label={`reg-${empId}`} value={clean ? num(r.computed?.reg_hours) : String(pv.reg)} /></TableCell>
                  <TableCell className="text-right"><ComputedCell label={`ot-${empId}`} value={clean ? num(r.computed?.ot_hours) : String(pv.ot)} /></TableCell>
                  <TableCell className="text-right"><ComputedCell label={`vac-${empId}`} value={clean ? num(r.computed?.vacation_hours) : String(pv.vac)} /></TableCell>
                  <TableCell className="text-right"><MoneyCell
                      value={extras[empId]?.bonus ?? "0"}
                      readOnly={locked}
                      label={`bonus-${empId}`}
                      prefix="$"
                      onCommit={(v) => setExtras((p) => ({ ...p, [empId]: { ...p[empId], bonus: v } }))}
                    />
                  </TableCell>
                  <TableCell className="text-right"><ComputedCell label={`hol-${empId}`} value={clean ? num(r.computed?.holiday_hours) : String(pv.hol)} /></TableCell>
                  <TableCell className="text-right"><MoneyCell
                      value={extras[empId]?.reimb ?? "0"}
                      readOnly={locked}
                      label={`reimb-${empId}`}
                      prefix="$"
                      onCommit={(v) => setExtras((p) => ({ ...p, [empId]: { ...p[empId], reimb: v } }))}
                    />
                  </TableCell>
                  <TableCell className="text-right"><ComputedCell label={`sick-${empId}`} value={clean ? num(r.computed?.sick_safe_paid_hours) : String(pv.sick)} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter className="bg-muted/50 font-bold">
            <TableRow>
              <TableCell>Total</TableCell>
              {dates.map((date) => (
                <TableCell key={date} />
              ))}
              <TableCell className="text-right">{totalOf((r) => r.computed?.reg_hours)}</TableCell>
              <TableCell className="text-right">{totalOf((r) => r.computed?.ot_hours)}</TableCell>
              <TableCell className="text-right">{totalOf((r) => r.computed?.vacation_hours)}</TableCell>
              <TableCell className="text-right">{totalOf((r) => r.entry?.bonus_amount)}</TableCell>
              <TableCell className="text-right">{totalOf((r) => r.computed?.holiday_hours)}</TableCell>
              <TableCell className="text-right">{totalOf((r) => r.entry?.reimbursement_amount)}</TableCell>
              <TableCell className="text-right">{totalOf((r) => r.computed?.sick_safe_paid_hours)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        </Card>
      )}
    </section>
  );
}
