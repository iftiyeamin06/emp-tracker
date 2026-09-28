import { useEffect, useState } from "react";
import { get, post } from "../../api/client";

interface Period {
  id: number;
  start_date: string;
  end_date: string;
  status: "OPEN" | "SUBMITTED" | "APPROVED";
}

interface GridRow {
  employee: { id: number; full_name: string; employee_number: string };
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

const fmtDate = (v: unknown): string => String(v).slice(0, 10);

export default function ReportPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [status, setStatus] = useState<Period["status"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);

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
  }, [periodId]);

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
      <h2>Weekly report</h2>
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
      {status === "SUBMITTED" && (
        <button onClick={approve} disabled={approving}>
          {approving ? "Approving…" : "Approve"}
        </button>
      )}
      {status === "APPROVED" && <span style={{ color: "green" }}> Approved</span>}
      {status === "OPEN" && <span style={{ color: "#666" }}> Awaiting submission</span>}
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {!loading && !error && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Reg</th>
              <th>OT</th>
              <th>Hol</th>
              <th>Sick</th>
              <th>Vacation</th>
              <th>Bonus</th>
              <th>Reimbursement</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee.id}>
                <td>{r.employee.full_name}</td>
                <td>{num(r.computed?.reg_hours)}</td>
                <td>{num(r.computed?.ot_hours)}</td>
                <td>{num(r.computed?.holiday_hours)}</td>
                <td>{num(r.computed?.sick_safe_paid_hours)}</td>
                <td>{num(r.computed?.vacation_hours)}</td>
                <td>{num(r.entry?.bonus_amount)}</td>
                <td>{num(r.entry?.reimbursement_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
