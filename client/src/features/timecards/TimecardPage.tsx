import { useEffect, useRef, useState } from "react";
import { get, post, put } from "../../api/client";
import { CashBadge, EmptyState, Notice, Skeleton } from "../../components/polish";
import { btnGhost, btnOff, btnPrimary, btnSecondary, c, card, font, hoverCss, table, td, th } from "../../components/theme";
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

// Page-specific: cell inputs, sticky name column, banners (tokens in theme.ts).
const cellInput: React.CSSProperties = { width: "100%", minWidth: 34, boxSizing: "border-box", padding: "6px 2px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, textAlign: "center", background: "#fff" };
const lockBanner: React.CSSProperties = { border: "1px solid #fcd34d", background: "#fef3c7", borderRadius: 8, padding: "8px 12px", color: "#92400e" };
const toastOk: React.CSSProperties = { background: c.success, color: "#fff", borderRadius: 12, padding: "2px 10px", fontSize: 13 };
const amberDot: React.CSSProperties = { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c.warning, marginRight: 6 };

// Shared date-input look (New Period form and any future date input).
const dateInput: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  minWidth: 160,
  background: "#fff",
  color: "#111827",
};

// Long week-ends label, e.g. "Sat Sep 19, 2026" (UTC math on a calendar string).
const fmtLong = (ymdStr: string): string => {
  const d = new Date(ymdStr + "T00:00:00Z");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

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
  return (
    <input
      aria-label={label}
      value={value}
      disabled
      readOnly
      size={5}
      style={{ color: "#6b7280", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 6, width: "100%", minWidth: 34, boxSizing: "border-box", padding: "6px 2px", fontSize: 14, textAlign: "center" }}
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
    <input
      aria-label={label}
      value={draft}
      placeholder="–"
      title="8 = worked day, H8 holiday, S8 sick, V8 vacation — or type hours like 9"
      size={4}
      style={cellInput}
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {prefix && <span aria-hidden style={{ color: "#6b7280" }}>{prefix}</span>}
      <input
        aria-label={label}
        value={draft}
        size={6}
        style={{ ...cellInput, textAlign: "right" }}
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
        // NOTE: `selectId != null && ...` would yield `false` (not nullish),
        // which ?? would NOT skip — hence the ternary here.
        const preferred =
          (selectId != null ? j.data.find((p) => p.id === selectId) : undefined) ??
          j.data.find((p) => p.status === "OPEN") ??
          j.data[0] ??
          null;
        setPeriodId(preferred ? preferred.id : null);
        if (!preferred) setLoading(false);
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

  const addDays = (ymd: string, n: number): string => {
    const t = new Date(ymd + "T00:00:00Z").getTime();
    const d = new Date(t + n * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };

  const createPeriod = async (e: React.FormEvent) => {
    e.preventDefault();
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
          : "Couldn't create the period. Start must be a Monday and pay day on/after week end."
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

  return (
    <section>
      <style>{hoverCss}</style>
      <div style={{ ...card, padding: 16, marginBottom: 16 }}>
      <h2 style={{ ...font.section, margin: "0 0 12px" }}>Timecards</h2>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <label>
        Period{" "}
        <select value={periodId ?? ""} onChange={(e) => setPeriodId(Number(e.target.value))} disabled={periods.length === 0} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 }}>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {cal(p.start_date)} → {cal(p.end_date)} ({p.status})
            </option>
          ))}
        </select>
      </label>{" "}
      <button style={btnGhost} onClick={() => { setShowNew((s) => !s); setNewError(""); }}>
        {showNew ? "Cancel" : "New Period"}
      </button>
      <span style={{ flex: 1 }} />
      {!locked && (
        <button onClick={save} disabled={!dirty || saving} style={!dirty || saving ? { ...btnSecondary, ...btnOff } : btnSecondary}>
          {saving ? (<><span aria-hidden className="tc-spinner" style={{ borderColor: "rgba(0,0,0,.2)", borderTopColor: "#111827" }} /> Saving…</>) : "Save"}
        </button>
      )}
      {!locked && (
        <button onClick={submit} disabled={dirty || submitting} style={dirty || submitting ? { ...btnPrimary, ...btnOff } : btnPrimary}>
          {submitting ? (<><span aria-hidden className="tc-spinner" /> Submitting…</>) : "Submit Period"}
        </button>
      )}
      </div>
      {dirty && <span><span aria-hidden style={amberDot} />● Unsaved changes</span>}
      {!locked && (
        <p style={{ color: "#666", fontSize: 13, margin: "4px 0" }}>
          Type hours (e.g. 9) or a code: 8 worked · H8 holiday · S8 sick · V8 vacation · HW8 worked holiday. Click Save when done.
        </p>
      )}
      {savedFlash && <span style={toastOk}>Saved</span>}
      </div>
      {showNew && (
        <div style={{ ...card, padding: 16, marginBottom: 16 }}>
        <form onSubmit={createPeriod}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12 }}>
          <label>
            Start (Monday)<br />
            <input
              aria-label="Start date"
              type="date"
              className="tc-date"
              style={dateInput}
              value={newStart}
              onChange={(e) => {
                const v = e.target.value;
                setNewStart(v);
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setNewPay(addDays(v, 11)); // default pay day, editable
              }}
            />
          </label>
          <label>
            Pay date<br />
            <input aria-label="Pay date" type="date" className="tc-date" style={dateInput} value={newPay} onChange={(e) => setNewPay(e.target.value)} />
          </label>
          <span style={{ color: "#666" }}>Week ends: {newStart ? fmtLong(addDays(newStart, 6)) : "—"}</span>
          <span style={{ flex: 1 }} />
          <button type="button" style={btnSecondary} onClick={() => { setShowNew(false); setNewError(""); }}>Cancel</button>
          <button type="submit" disabled={creating || !newStart || !newPay} style={creating || !newStart || !newPay ? { ...btnPrimary, ...btnOff } : btnPrimary}>
            {creating ? "Creating…" : "Create"}
          </button>
          </div>
          {newError && <Notice title="Couldn't create the period" message={newError} />}
        </form>
        </div>
      )}
      {saveError && <Notice title="Couldn't save" message={saveError} />}
      {submitError && <Notice title="Couldn't submit" message={submitError} />}
      {period && period.status !== "OPEN" && <p style={lockBanner}>Period {period.status} — read only</p>}
      {loading && <Skeleton rows={6} cols={10} />}
      {error && <Notice title="Couldn't load timecards" message="Check your connection, then try again." onRetry={() => periodId != null && loadGrid(periodId)} />}
      {!loading && !error && periods.length === 0 && (
        <div style={{ ...card, padding: 32, textAlign: "center" }}>
          <EmptyState title="No pay periods yet" hint="Create your first weekly period to start entering time." />
          <button style={btnPrimary} onClick={() => { setShowNew(true); setNewError(""); }}>
            Create your first period
          </button>
        </div>
      )}
      {!loading && !error && periods.length > 0 && baseRows.length === 0 && (
        <div style={{ ...card, padding: 16 }}>
          <EmptyState
            title="No employees in this period"
            hint="Nobody was employed during this week."
            action={<a href="#/employees">Go to Employees</a>}
          />
        </div>
      )}
      {!loading && !error && baseRows.length > 0 && (
        <div style={card}>
        <table style={table}>
          <thead>
            <tr>
              <th style={{ ...th, left: 0, zIndex: 3 }}>Name</th>
              {DOW.map((d) => (
                <th style={th} key={d}>{d}</th>
              ))}
              <th style={th}>Regular Hours</th>
              <th style={th}>Overtime Hours</th>
              <th style={th}>Vacation Hours</th>
              <th style={th}>Bonus Amount</th>
              <th style={th}>Holiday Hours</th>
              <th style={th}>Reimbursement Amount</th>
              <th style={th}>Sick Hours</th>
            </tr>
          </thead>
          <tbody>
            {baseRows.map((r, i) => {
              const empId = r.employee.id;
              const clean = baseline !== "" && rowClean(empId);
              const pv = preview(empId);
              return (
                <tr key={empId} className="tc-row" style={i % 2 === 1 ? { background: "#f8fafc" } : undefined}>
                  <td style={{ ...td, position: "sticky", left: 0, background: "inherit", fontWeight: 600, whiteSpace: "nowrap", zIndex: 1 }}>{r.employee.full_name}{r.employee.payment_method === "CASH" && <CashBadge />}</td>
                  {dates.map((date) => (
                    <td key={date} style={{ ...td, minWidth: 60 }}>
                      <DayCell
                        value={cells[empId]?.[date] ?? ""}
                        readOnly={locked}
                        label={`day-${empId}-${date}`}
                        onCommit={commitCell(empId, date)}
                      />
                    </td>
                  ))}
                  <td style={{ ...td, textAlign: "right" }}><ComputedCell label={`reg-${empId}`} value={clean ? num(r.computed?.reg_hours) : String(pv.reg)} /></td>
                  <td style={{ ...td, textAlign: "right" }}><ComputedCell label={`ot-${empId}`} value={clean ? num(r.computed?.ot_hours) : String(pv.ot)} /></td>
                  <td style={{ ...td, textAlign: "right" }}><ComputedCell label={`vac-${empId}`} value={clean ? num(r.computed?.vacation_hours) : String(pv.vac)} /></td>
                  <td style={{ ...td, textAlign: "right" }}><MoneyCell
                      value={extras[empId]?.bonus ?? "0"}
                      readOnly={locked}
                      label={`bonus-${empId}`}
                      prefix="$"
                      onCommit={(v) => setExtras((p) => ({ ...p, [empId]: { ...p[empId], bonus: v } }))}
                    />
                  </td>
                  <td style={{ ...td, textAlign: "right" }}><ComputedCell label={`hol-${empId}`} value={clean ? num(r.computed?.holiday_hours) : String(pv.hol)} /></td>
                  <td style={{ ...td, textAlign: "right" }}><MoneyCell
                      value={extras[empId]?.reimb ?? "0"}
                      readOnly={locked}
                      label={`reimb-${empId}`}
                      prefix="$"
                      onCommit={(v) => setExtras((p) => ({ ...p, [empId]: { ...p[empId], reimb: v } }))}
                    />
                  </td>
                  <td style={{ ...td, textAlign: "right" }}><ComputedCell label={`sick-${empId}`} value={clean ? num(r.computed?.sick_safe_paid_hours) : String(pv.sick)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}
