import { useEffect, useRef, useState } from "react";
import { get, post, put } from "../../api/client";
import { EmptyState, Notice, ScrollX, Skeleton } from "../../components/polish";
import { formatDay } from "./dayCodes";

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
  employee: { id: number; full_name: string };
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

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// v1 entry codes (case-insensitive on input, stored uppercase). Anything else
// reverts — the full DB enum arrives in later stages, never by guessing here.
const ALLOWED = new Set(["8", "H8", "S8", "V8", ""]);

type Cells = Record<number, Record<string, string>>;
type Extras = Record<number, { bonus: string; reimb: string }>;

const ymd = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

const weekDates = (start: string): string[] => {
  const base = new Date(start.slice(0, 10) + "T00:00:00Z").getTime();
  return Array.from({ length: 7 }, (_, i) => ymd(new Date(base + i * 86400000)));
};

const num = (v: unknown): string => {
  const n = Number(v ?? 0);
  return Number.isNaN(n) ? "0" : String(Math.round(n * 100) / 100);
};

const grey: React.CSSProperties = { color: "#666" };

function DayCell({
  value,
  readOnly,
  label,
  forceOpen,
  onCommit,
  onClosed,
}: {
  value: string;
  readOnly: boolean;
  label: string;
  forceOpen: boolean;
  onCommit: (code: string) => boolean;
  onClosed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (forceOpen && !readOnly) {
      setDraft(value);
      setEditing(true);
    }
  }, [forceOpen, readOnly, value]);
  if (readOnly) return <>{value}</>;
  if (!editing) {
    return (
      <span style={{ display: "inline-block", minWidth: 24 }}>
        {value || <span style={{ color: "#bbb" }}>–</span>}
      </span>
    );
  }
  const close = (save: boolean) => {
    if (save) {
      const code = draft.trim().toUpperCase();
      if (onCommit(code)) {
        setEditing(false);
        onClosed();
        return;
      }
      setDraft(value); // invalid → revert
    } else {
      setDraft(value);
    }
    setEditing(false);
    onClosed();
  };
  return (
    <input
      aria-label={label}
      autoFocus
      value={draft}
      size={4}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => close(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") close(true);
        if (e.key === "Escape") close(false);
      }}
    />
  );
}

function MoneyCell({
  value,
  readOnly,
  label,
  onCommit,
}: {
  value: string;
  readOnly: boolean;
  label: string;
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
    <input
      aria-label={label}
      value={draft}
      size={6}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
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
  // Which cell is open for editing ("empId|date"). Whole-td click target;
  // DayCell opens when its key matches, and clears on commit/cancel.
  const [openKey, setOpenKey] = useState<string | null>(null);
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
      for (const d of r.days) c[r.employee.id][String(d.work_date).slice(0, 10)] = formatDay(d.day_type, d.hours);
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
  const dates = period ? weekDates(String(period.start_date)) : [];

  // v1 wire codes (route maps SICK to the DB enum). Empty clears the day by
  // sending a 0-hour WORK row — the route deletes + reinserts per date.
  const WIRE: Record<string, { day_type: string; hours: number }> = {
    "8": { day_type: "WORK", hours: 8 },
    H8: { day_type: "HOLIDAY", hours: 8 },
    S8: { day_type: "SICK", hours: 8 },
    V8: { day_type: "VACATION", hours: 8 },
    "": { day_type: "WORK", hours: 0 },
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
          const w = WIRE[cells[r.employee.id]?.[date] ?? ""];
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
    if (!ALLOWED.has(code)) return false; // invalid → caller reverts, state untouched
    setCells((prev) => ({ ...prev, [empId]: { ...prev[empId], [date]: code } }));
    return true;
  };

  // Client-side preview from local codes. Simplification: every "8" counts 8h
  // and everyone previews as hourly — the SERVER (timecard_weekly) is the
  // source of truth and recomputes from real hours + comp status on save.
  const preview = (empId: number) => {
    const row = cells[empId] ?? {};
    const count = (code: string) => dates.filter((d) => (row[d] ?? "") === code).length;
    const worked = count("8") * 8;
    return {
      worked,
      reg: Math.min(worked, 40),
      ot: Math.max(worked - 40, 0),
      hol: count("H8") * 8,
      sick: count("S8") * 8,
      vac: count("V8") * 8,
    };
  };

  const rowClean = (empId: number): boolean => {
    const base = JSON.parse(baseline || "{}") as { c?: Cells; x?: Extras };
    return JSON.stringify({ c: cells[empId] ?? {}, x: extras[empId] ?? {} }) ===
      JSON.stringify({ c: base.c?.[empId] ?? {}, x: base.x?.[empId] ?? { bonus: "0", reimb: "0" } });
  };

  return (
    <section>
      <h2>Timecards</h2>
      <label>
        Period{" "}
        <select value={periodId ?? ""} onChange={(e) => setPeriodId(Number(e.target.value))} disabled={periods.length === 0}>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {String(p.start_date).slice(0, 10)} → {String(p.end_date).slice(0, 10)} ({p.status})
            </option>
          ))}
        </select>
      </label>{" "}
      <button onClick={() => { setShowNew((s) => !s); setNewError(""); }}>
        {showNew ? "Cancel" : "New Period"}
      </button>
      {showNew && (
        <form onSubmit={createPeriod} style={{ margin: "12px 0" }}>
          <label>
            Start (Monday){" "}
            <input
              aria-label="Start date"
              type="date"
              value={newStart}
              onChange={(e) => {
                const v = e.target.value;
                setNewStart(v);
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setNewPay(addDays(v, 11)); // default pay day, editable
              }}
            />
          </label>{" "}
          <label>
            Pay date{" "}
            <input aria-label="Pay date" type="date" value={newPay} onChange={(e) => setNewPay(e.target.value)} />
          </label>{" "}
          <span style={{ color: "#666" }}>Week ends {newStart ? addDays(newStart, 6) : "—"}</span>{" "}
          <button type="submit" disabled={creating || !newStart || !newPay}>
            {creating ? "Creating…" : "Create"}
          </button>
          {newError && <Notice title="Couldn't create the period" message={newError} />}
        </form>
      )}
      {dirty && <span>● Unsaved changes</span>}
      {!locked && (
        <button onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      )}
      {!locked && (
        <button onClick={submit} disabled={dirty || submitting}>
          {submitting ? "Submitting…" : "Submit Period"}
        </button>
      )}
      {savedFlash && <span style={{ color: "green" }}> Saved</span>}
      {saveError && <Notice title="Couldn't save" message={saveError} />}
      {submitError && <Notice title="Couldn't submit" message={submitError} />}
      {period && period.status !== "OPEN" && <p>Period {period.status} — read only</p>}
      {loading && <Skeleton rows={6} cols={10} />}
      {error && <Notice title="Couldn't load timecards" message="Check your connection, then try again." onRetry={() => periodId != null && loadGrid(periodId)} />}
      {!loading && !error && periods.length === 0 && (
        <EmptyState title="No pay periods yet" hint="Create a weekly period to start entering time." />
      )}
      {!loading && !error && periods.length > 0 && baseRows.length === 0 && (
        <EmptyState title="No employees yet" hint="Add employees to the roster, then enter their hours here." />
      )}
      {!loading && !error && baseRows.length > 0 && (
        <ScrollX>
        <table style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>Name</th>
              {DOW.map((d) => (
                <th key={d}>{d}</th>
              ))}
              <th>Reg</th>
              <th>OT</th>
              <th>Hol</th>
              <th>Sick</th>
              <th>Vacation</th>
              <th>Bonus</th>
              <th>Reimb</th>
            </tr>
          </thead>
          <tbody>
            {baseRows.map((r) => {
              const empId = r.employee.id;
              const clean = baseline !== "" && rowClean(empId);
              const pv = preview(empId);
              return (
                <tr key={empId}>
                  <td>{r.employee.full_name}</td>
                  {dates.map((date) => (
                    <td
                      key={date}
                      onClick={() => { if (!locked) setOpenKey(`${empId}|${date}`); }}
                      style={locked ? undefined : { cursor: "pointer" }}
                    >
                      <DayCell
                        value={cells[empId]?.[date] ?? ""}
                        readOnly={locked}
                        label={`day-${empId}-${date}`}
                        forceOpen={openKey === `${empId}|${date}`}
                        onCommit={commitCell(empId, date)}
                        onClosed={() => setOpenKey((k) => (k === `${empId}|${date}` ? null : k))}
                      />
                    </td>
                  ))}
                  <td style={grey}>{clean ? num(r.computed?.reg_hours) : pv.reg}</td>
                  <td style={grey}>{clean ? num(r.computed?.ot_hours) : pv.ot}</td>
                  <td style={grey}>{clean ? num(r.computed?.holiday_hours) : pv.hol}</td>
                  <td style={grey}>{clean ? num(r.computed?.sick_safe_paid_hours) : pv.sick}</td>
                  <td style={grey}>{clean ? num(r.computed?.vacation_hours) : pv.vac}</td>
                  <td>
                    <MoneyCell
                      value={extras[empId]?.bonus ?? "0"}
                      readOnly={locked}
                      label={`bonus-${empId}`}
                      onCommit={(v) => setExtras((p) => ({ ...p, [empId]: { ...p[empId], bonus: v } }))}
                    />
                  </td>
                  <td>
                    <MoneyCell
                      value={extras[empId]?.reimb ?? "0"}
                      readOnly={locked}
                      label={`reimb-${empId}`}
                      onCommit={(v) => setExtras((p) => ({ ...p, [empId]: { ...p[empId], reimb: v } }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </ScrollX>
      )}
    </section>
  );
}
