import { useEffect, useState } from "react";
import { del, get, patch, post, put } from "../../api/client";
import { fmtRange } from "../../lib/periodOptions";
import { CashBadge, EmptyState, Notice, Skeleton } from "../../components/polish";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

interface Employee {
  id: number;
  employee_number: string;
  full_name: string;
  hire_date: string;
  termination_date: string | null;
  payment_method: string;
  compensation: { pay_type: string; rate: unknown; overtime_status: string; classification: string | null } | null;
}

interface Period {
  id: number;
  start_date: string;
  end_date: string;
}

interface GridRow {
  employee: { id: number };
  days: { day_type: string; hours: unknown }[];
  computed: {
    reg_hours: unknown;
    ot_hours: unknown;
    holiday_hours: unknown;
    sick_safe_paid_hours: unknown;
    vacation_hours: unknown;
  } | null;
}

interface PeriodSummary {
  worked: number;
  ot: number;
  sick: number;
  vac: number;
  hol: number;
  hw: number;
}

type View = "weekly" | "monthly" | "yearly";

const r2 = (n: number): number => Math.round(n * 100) / 100;

const monthLabel = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};

// Compact inline select for the summary toolbar (pairs with the tab group).
const inlineSelectClass =
  "flex h-9 rounded-md border border-input bg-background px-3 py-1 font-mono text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const money = (rate: unknown, payType: string): string => {
  const formatted = Number(rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return payType === "SALARY" ? `$${formatted} / wk` : `$${formatted} / hr`;
};

// Native select dressed like the shadcn Input. A Radix Select renders no
// native <select>, which would break the existing label/change tests.
const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const emptyForm = { employee_number: "", full_name: "", hire_date: "", pay: "H", rate: "", overtime_status: "NON_EXEMPT", classification: "", payment_method: "DIRECT_DEPOSIT" };

export default function EmployeesPage({ readOnly = false }: { readOnly?: boolean }) {
  const [rows, setRows] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [addedFlash, setAddedFlash] = useState(false);
  const [rowError, setRowError] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [view, setView] = useState<View>("weekly");
  const [yearSel, setYearSel] = useState<string | null>(null);
  const [weekId, setWeekId] = useState<number | null>(null);
  const [monthSel, setMonthSel] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<number, PeriodSummary>>({});

  const closeModal = () => {
    setOpen(false);
    setEditingId(null);
    setFormError("");
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const load = () => {
    setLoading(true);
    setError("");
    get<{ data: Employee[] }>("/api/employees")
      .then((j) => {
        setRows(j.data);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load employees.");
        setLoading(false);
      });
  };
  useEffect(load, []);

  // Period options for the summary columns (newest-first, like the API returns).
  useEffect(() => {
    get<{ data: Period[] }>("/api/pay-periods")
      .then((j) =>
        setPeriods(
          (j.data ?? []).filter((p) => p && typeof p.id === "number" && typeof p.start_date === "string" && typeof p.end_date === "string")
        )
      )
      .catch(() => undefined); // summary columns fall back to dashes
  }, []);

  const years = [...new Set(periods.map((p) => p.start_date.slice(0, 4)))];
  const effYear = yearSel ?? years[0] ?? null;
  const yearPeriods = effYear ? periods.filter((p) => p.start_date.slice(0, 4) === effYear) : [];
  const monthOptions = [...new Set(yearPeriods.map((p) => p.start_date.slice(0, 7)))];
  const effMonth = monthSel ?? monthOptions[0] ?? null;
  const effWeekId = weekId ?? yearPeriods[0]?.id ?? null;
  const week = yearPeriods.find((p) => p.id === effWeekId) ?? yearPeriods[0];

  const pickYear = (y: string) => {
    setYearSel(y);
    const yp = periods.filter((p) => p.start_date.slice(0, 4) === y);
    setWeekId(yp[0]?.id ?? null);
    setMonthSel(yp[0]?.start_date.slice(0, 7) ?? null);
  };

  const targets: Period[] =
    view === "yearly"
      ? yearPeriods
      : view === "monthly"
        ? effMonth
          ? yearPeriods.filter((p) => p.start_date.slice(0, 7) === effMonth)
          : []
        : week
          ? [week]
          : [];

  // Per-employee totals over the selected window. Gross = wages + bonus
  // (hourly: reg x rate + OT x 1.5 x rate; salary: weekly rate).
  useEffect(() => {
    let live = true;
    if (targets.length === 0 || rows.length === 0) {
      setSummary({});
      return;
    }
    const num = (v: unknown): number => {
      const n = Number(v ?? 0);
      return Number.isNaN(n) ? 0 : n;
    };
    Promise.all(
      targets.map((p) =>
        get<{ data: { rows: GridRow[] } }>(`/api/timecards/${p.id}`)
          .then((j) => j.data?.rows ?? [])
          .catch(() => [] as GridRow[])
      )
    ).then((grids) => {
      if (!live) return;
      const agg: Record<number, PeriodSummary> = {};
      for (const grid of grids) {
        for (const r of grid) {
          const id = r.employee?.id;
          if (id == null) continue;
          const reg = num(r.computed?.reg_hours);
          const ot = num(r.computed?.ot_hours);
          const sick = num(r.computed?.sick_safe_paid_hours);
          const vac = num(r.computed?.vacation_hours);
          const hol = num(r.computed?.holiday_hours);
          const hw = (r.days ?? []).reduce((t, d) => t + (d.day_type === "HW8" ? num(d.hours) : 0), 0);
          const cur = agg[id] ?? { worked: 0, ot: 0, sick: 0, vac: 0, hol: 0, hw: 0 };
          cur.worked += reg + ot;
          cur.ot += ot;
          cur.sick += sick;
          cur.vac += vac;
          cur.hol += hol;
          cur.hw += hw;
          agg[id] = cur;
        }
      }
      for (const k of Object.keys(agg)) {
        const a = agg[Number(k)];
        a.worked = r2(a.worked);
        a.ot = r2(a.ot);
        a.sick = r2(a.sick);
        a.vac = r2(a.vac);
        a.hol = r2(a.hol);
        a.hw = r2(a.hw);
      }
      setSummary(agg);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, periods, rows, yearSel, weekId, monthSel]);

  const today = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // Terminate (date) or rehire (null). No hard deletes: the row, its history
  // and its audit trail stay; only future visibility changes.
  const changeTermination = async (id: number, date: string | null, message: string) => {
    if (!window.confirm(message)) return;
    setRowError("");
    try {
      await put(`/api/employees/${id}`, { termination_date: date });
      load();
    } catch {
      setRowError("Couldn't update employment status. Try again.");
    }
  };

  // Permanent delete, only for history-free rows (server enforces: 409 when
  // timecards/leave exist, directing to Terminate instead).
  const removeEmployee = async (id: number, name: string) => {
    if (!window.confirm(`Delete ${name} permanently? Only possible with no timecard history.`)) return;
    setRowError("");
    try {
      await del(`/api/employees/${id}`);
      load();
    } catch (err: any) {
      setRowError(
        err?.status === 409
          ? "Cannot delete — this employee has history. Terminate instead."
          : "Couldn't delete. Try again."
      );
    }
  };

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const field = (
    label: string,
    name: keyof typeof emptyForm | "pay_type" | "overtime" | "payment" | "rate" | "class",
    control: React.ReactNode
  ) => (
    <label key={String(name)} className="block text-xs font-medium text-muted-foreground">
      {label}
      <span className="mt-1 block">{control}</span>
    </label>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const rate = Number(form.rate);
      if (!form.employee_number.trim() || !form.full_name.trim()) throw { status: 400, message: "number_name_required" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.hire_date)) throw { status: 400, message: "hire_date_invalid" };
      if (Number.isNaN(rate) || rate < 0) throw { status: 400, message: "rate_invalid" };
      const payload = {
        employee_number: form.employee_number.trim(),
        full_name: form.full_name.trim(),
        hire_date: form.hire_date,
        payment_method: form.payment_method,
        compensation: {
          pay_type: form.pay === "H" ? "HOURLY" : "SALARY",
          rate,
          overtime_status: form.overtime_status,
          classification: form.classification.trim() || undefined,
        },
      };
      if (editingId !== null) await patch(`/api/employees/${editingId}`, payload);
      else await post("/api/employees", payload);
      setForm(emptyForm);
      closeModal();
      load();
      setAddedFlash(editingId === null);
      window.setTimeout(() => setAddedFlash(false), 3000);
    } catch (err: any) {
      setFormError(
        err?.status === 409
          ? "That employee number is already taken."
          : "Couldn't save the employee. Check the fields and retry."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Employees</h2>
        {!readOnly && <Button onClick={() => { setOpen(true); setFormError(""); }}>Add Employee</Button>}
      </div>
      {rowError && <Notice title="Couldn't update" message={rowError} />}
      {addedFlash && <span className="text-sm text-green-600"> Added</span>}
      {open && (
        <div
          role="presentation"
          onClick={closeModal}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Add Employee"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto"
          >
            <CardHeader>
            <CardTitle>{editingId !== null ? "Edit Employee" : "Add Employee"}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {field("Employee number", "employee_number",
                    <Input id="f-employee-number" aria-label="Employee number" placeholder="e.g. E042" value={form.employee_number} onChange={set("employee_number")} />)}
                  {field("Full name", "full_name",
                    <Input id="f-full-name" aria-label="Full name" placeholder="e.g. Jane Doe" value={form.full_name} onChange={set("full_name")} />)}
                  {field("Hire date", "hire_date",
                    <Input id="f-hire-date" aria-label="Hire date" type="date" value={form.hire_date} onChange={set("hire_date")} />)}
                  {field("Pay type", "pay_type",
                    <select className={selectClass} id="f-pay-type" aria-label="Pay type" value={form.pay} onChange={set("pay")}>
                      <option value="H">Hourly (H)</option>
                      <option value="S">Salary (S)</option>
                    </select>)}
                  {field(form.pay === "H" ? "Hourly rate" : "Weekly salary", "rate",
                    <Input id="f-rate" aria-label="Rate" placeholder={form.pay === "H" ? "e.g. 18.50" : "e.g. 900.00"} value={form.rate} onChange={set("rate")} inputMode="decimal" />)}
                  {field("Overtime status", "overtime",
                    <select className={selectClass} id="f-overtime-status" aria-label="Overtime status" value={form.overtime_status} onChange={set("overtime_status")}>
                      <option value="NON_EXEMPT">Non-exempt</option>
                      <option value="EXEMPT">Exempt</option>
                      <option value="REVIEW">Needs review</option>
                    </select>)}
                  {field("Payment method", "payment",
                    <select className={selectClass} id="f-payment-method" aria-label="Payment method" value={form.payment_method} onChange={set("payment_method")}>
                      <option value="DIRECT_DEPOSIT">Direct Deposit</option>
                      <option value="CHECK">Check</option>
                      <option value="CASH">Cash</option>
                    </select>)}
                  {field("Classification", "class",
                    <Input id="f-classification" aria-label="Classification" placeholder="e.g. Crew A (optional)" value={form.classification} onChange={set("classification")} />)}
                </div>
                {formError && <Notice title="Couldn't add the employee" message={formError} />}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={closeModal}>Cancel</Button>
                  <Button type="submit" disabled={saving} className="flex-1">
                    {saving ? "Saving…" : editingId !== null ? "Save changes" : "Add"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
      {loading && <Skeleton rows={5} cols={4} />}
      {error && <Notice title="Something didn't load" message={error} onRetry={load} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title="No employees yet" hint="Add your first employee to get started." />
      )}
      {!loading && !error && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Summary view" className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(["weekly", "monthly", "yearly"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={
                  view === v
                    ? "rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 shadow-xs dark:bg-slate-950 dark:text-slate-100"
                    : "rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                }
              >
                {v === "weekly" ? "Weekly" : v === "monthly" ? "Monthly" : "Yearly (YTD)"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
              Year{" "}
              <select
                aria-label="Summary year"
                value={effYear ?? ""}
                onChange={(e) => pickYear(e.target.value)}
                disabled={years.length === 0}
                className={inlineSelectClass}
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
            {view === "weekly" && (
              <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                Week{" "}
                <select
                  aria-label="Summary week"
                  value={effWeekId ?? ""}
                  onChange={(e) => setWeekId(Number(e.target.value))}
                  disabled={yearPeriods.length === 0}
                  className={inlineSelectClass}
                >
                  {yearPeriods.map((p) => (
                    <option key={p.id} value={p.id}>{fmtRange(p.start_date, p.end_date)}</option>
                  ))}
                </select>
              </label>
            )}
            {view === "monthly" && (
              <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                Month{" "}
                <select
                  aria-label="Summary month"
                  value={effMonth ?? ""}
                  onChange={(e) => setMonthSel(e.target.value)}
                  disabled={monthOptions.length === 0}
                  className={inlineSelectClass}
                >
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>{monthLabel(m)}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      )}
      {!loading && !error && rows.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Emp #</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Pay Rate</TableHead>
                <TableHead className="text-right">Worked Hrs</TableHead>
                <TableHead className="text-right">OT Hrs</TableHead>
                <TableHead className="text-right">Sick Hrs</TableHead>
                <TableHead className="text-right">Vacation Hrs</TableHead>
                <TableHead className="text-right">Holiday Hrs</TableHead>
                <TableHead className="text-right">HW Hrs</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const s = summary[r.id];
                const hrs = (v: number | undefined): React.ReactNode =>
                  s == null || v == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    `${v} hrs`
                  );
                return (
                  <TableRow key={r.id} className="odd:bg-muted/50">
                    <TableCell className="font-mono tabular-nums">{r.employee_number}</TableCell>
                    <TableCell>
                      {r.full_name}
                      {r.payment_method === "CASH" && <CashBadge />}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono tabular-nums">{r.compensation ? money(r.compensation.rate, r.compensation.pay_type) : "—"}</span>
                      {r.compensation && (
                        <Badge variant="outline" className="ml-1.5 text-muted-foreground">{r.compensation.overtime_status}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {s ? `${s.worked} hrs` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {s == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : s.ot > 0 ? (
                        <span className="font-mono tabular-nums text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-xs">{s.ot} hrs</span>
                      ) : (
                        <span className="font-mono tabular-nums text-slate-400">0 hrs</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {hrs(s?.sick)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {hrs(s?.vac)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {hrs(s?.hol)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {hrs(s?.hw)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {!readOnly && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => {
                            setEditingId(r.id);
                            setForm({ employee_number: r.employee_number, full_name: r.full_name, hire_date: String(r.hire_date).slice(0, 10), pay: r.compensation?.pay_type === "SALARY" ? "S" : "H", rate: r.compensation ? String(r.compensation.rate) : "0", overtime_status: r.compensation?.overtime_status ?? "NON_EXEMPT", classification: r.compensation?.classification ?? "", payment_method: r.payment_method });
                            setFormError(""); setOpen(true);
                          }}>Edit</Button>
                          {r.termination_date ? (
                            <Button variant="ghost" size="sm" onClick={() => changeTermination(r.id, null, `Rehire ${r.full_name}?`)}>
                              Rehire
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => changeTermination(r.id, today(), `Terminate ${r.full_name} as of today?`)}>
                              Terminate
                            </Button>
                          )}{" "}
                          <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => removeEmployee(r.id, r.full_name)}>Delete</Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
  );
}
