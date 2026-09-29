import { useEffect, useState } from "react";
import { get, post } from "../../api/client";
import { CashBadge, EmptyState, Notice, Skeleton } from "../../components/polish";
import { btnPrimary, btnOff, card, font, hoverCss, table, td, th } from "../../components/theme";

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

interface MonthlyWeek {
  week_start: string;
  week_end: string;
  reg: string;
  ot: string;
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

function ReportTable({ rows }: { rows: TableRow[] }) {
  return (
    <div style={{ ...card, overflowX: "auto" }}>
    <table style={{ ...table, minWidth: 640 }}>
      <thead>
        <tr>
          <th style={th}>Name</th>
          <th style={th}>Reg</th>
          <th style={th}>OT</th>
          <th style={th}>Hol</th>
          <th style={th}>Sick</th>
          <th style={th}>Vacation</th>
          <th style={th}>Bonus</th>
          <th style={th}>Reimbursement</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
            <tr key={r.id} className="tc-row" style={i % 2 === 1 ? { background: "#f8fafc" } : undefined}>
              <td style={td}>{r.name}{r.cash && <CashBadge />}</td>
            <td style={td}>{r.reg}</td>
            <td style={td}>{r.ot}</td>
            <td style={td}>{r.hol}</td>
            <td style={td}>{r.sick}</td>
            <td style={td}>{r.vac}</td>
            <td style={td}>{r.bonus}</td>
            <td style={td}>{r.reimb}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

export default function ReportPage() {
  const [mode, setMode] = useState<"weekly" | "monthly">("weekly");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [mrows, setMrows] = useState<TableRow[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [status, setStatus] = useState<Period["status"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    get<{ data: Period[] }>("/api/pay-periods")
      .then((j) => {
        setPeriods(j.data);
        const preferred = j.data.find((p) => p.status === "OPEN" || p.status === "SUBMITTED") ?? j.data[0] ?? null;
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
        setRows(j.data.rows);
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
          j.data.rows.map((r) => ({
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

  return (
    <section>
      <style>{hoverCss}</style>
      <div style={{ ...card, padding: 16, marginBottom: 16 }}>
      <h2 style={{ ...font.section, margin: "0 0 12px" }}>{mode === "weekly" ? "Weekly report" : "Monthly report"}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <div role="group" aria-label="Report range">
        <button onClick={() => setMode("weekly")} disabled={mode === "weekly"}>Weekly</button>{" "}
        <button onClick={() => setMode("monthly")} disabled={mode === "monthly"}>Monthly</button>
      </div>
      {mode === "weekly" ? (
      <>
      <label>
        Period{" "}
        <select
          value={periodId ?? ""}
          onChange={(e) => setPeriodId(Number(e.target.value))}
          disabled={periods.length === 0}
        >
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {fmtDate(p.start_date)} → {fmtDate(p.end_date)} ({p.status})
            </option>
          ))}
        </select>
      </label>{" "}
      </>
      ) : (
      <label>
        Month{" "}
        <input
          aria-label="Month"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </label>
      )}
      {mode === "weekly" && status === "SUBMITTED" && (
        <button onClick={approve} disabled={approving} style={approving ? { ...btnPrimary, ...btnOff } : btnPrimary}>
          {approving ? "Approving…" : "Approve"}
        </button>
      )}
      </div>
      </div>
      {mode === "weekly" && status === "APPROVED" && <span style={{ color: "green" }}> Approved</span>}
      {mode === "weekly" && status === "OPEN" && <span style={{ color: "#666" }}> Awaiting submission</span>}
      {loading && <Skeleton rows={5} cols={8} />}
      {error && <Notice title="Something didn't load" message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {mode === "monthly" && !loading && !error && mrows.length === 0 && (
        <EmptyState title="No data for this month" hint="Pick a month with approved or open weeks." />
      )}
      {mode === "monthly" && !loading && !error && mrows.length > 0 && <ReportTable rows={mrows} />}
      {mode === "monthly" && !loading && !error && mrows.some((r) => (r.weeks ?? []).length > 0) && (
        <>
        <h3 style={{ ...font.section, margin: "16px 0 8px" }}>By week</h3>
        <div style={{ ...card, overflowX: "auto" }}>
        <table style={{ ...table, minWidth: 480 }}>
          <thead>
            <tr>
              <th style={th}>Employee</th>
              <th style={th}>Week</th>
              <th style={th}>Reg</th>
              <th style={th}>OT</th>
            </tr>
          </thead>
          <tbody>
            {mrows.flatMap((r) =>
              (r.weeks ?? []).map((w, i) => (
                <tr key={`${r.employee_id}-${w.week_start}`} className="tc-row" style={i % 2 === 1 ? { background: "#f8fafc" } : undefined}>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{w.week_start} → {w.week_end}</td>
                  <td style={td}>{num(w.reg)}</td>
                  <td style={td}>{num(w.ot)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
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
          rows={rows.map((r) => ({
            id: r.employee.id,
            name: r.employee.full_name,
            cash: r.employee.payment_method === "CASH",
            reg: num(r.computed?.reg_hours),
            ot: num(r.computed?.ot_hours),
            hol: num(r.computed?.holiday_hours),
            sick: num(r.computed?.sick_safe_paid_hours),
            vac: num(r.computed?.vacation_hours),
            bonus: num(r.entry?.bonus_amount),
            reimb: num(r.entry?.reimbursement_amount),
          }))}
        />
      )}
    </section>
  );
}
