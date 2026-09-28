import { useEffect, useState } from "react";
import { get } from "../../api/client";
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
  entry: { bonus_amount: unknown; reimbursement_amount: unknown } | null;
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

  const locked = period != null && period.status !== "OPEN";

  useEffect(() => {
    get<{ data: Period[] }>("/api/pay-periods")
      .then((j) => {
        setPeriods(j.data);
        const preferred = j.data.find((p) => p.status === "OPEN") ?? j.data[0] ?? null;
        setPeriodId(preferred ? preferred.id : null);
        if (!preferred) setLoading(false);
      })
      .catch(() => {
        setError("Could not load pay periods.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (periodId == null) return;
    setLoading(true);
    setError("");
    get<{ data: { period: Period; rows: GridRow[] } }>(`/api/timecards/${periodId}`)
      .then((j) => {
        setPeriod(j.data.period);
        setBaseRows(j.data.rows);
        const c: Cells = {};
        const x: Extras = {};
        for (const r of j.data.rows) {
          c[r.employee.id] = {};
          for (const d of r.days) c[r.employee.id][String(d.work_date).slice(0, 10)] = formatDay(d.day_type, d.hours);
          x[r.employee.id] = { bonus: num(r.entry?.bonus_amount), reimb: num(r.entry?.reimbursement_amount) };
        }
        setCells(c);
        setExtras(x);
        setBaseline(JSON.stringify({ c, x }));
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load timecards.");
        setLoading(false);
      });
  }, [periodId]);

  const dirty = baseline !== "" && JSON.stringify({ c: cells, x: extras }) !== baseline;
  const dates = period ? weekDates(String(period.start_date)) : [];

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
      {dirty && <span>● Unsaved changes</span>}
      {period && period.status !== "OPEN" && <p>Period {period.status} — read only</p>}
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {!loading && !error && (
        <table>
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
      )}
    </section>
  );
}
