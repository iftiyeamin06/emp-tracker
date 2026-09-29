import { useEffect, useState } from "react";
import { del, get, post, put } from "../../api/client";
import { btnPrimary, btnSecondary, card, font, hoverCss, table, td, th } from "../../components/theme";
import { CashBadge, EmptyState, Notice, Skeleton } from "../../components/polish";

// Local calendar day (matches the server; never slice the UTC part of ISO).
const cal = (v: unknown): string => {
  const d = new Date(v as any);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface Employee {
  id: number;
  employee_number: string;
  full_name: string;
  hire_date: string;
  termination_date: string | null;
  payment_method: string;
  compensation: { pay_type: string; rate: unknown; overtime_status: string; classification: string | null } | null;
}

const PAY_LABELS: Record<string, string> = { DIRECT_DEPOSIT: "Direct Deposit", CHECK: "Check", CASH: "Cash" };

const money = (rate: unknown, payType: string): string => {
  const formatted = Number(rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return payType === "SALARY" ? `SALARY $${formatted}/wk` : `HOURLY $${formatted}`;
};

const input: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  margin: "4px 0 0",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 14,
};

const fieldLabel: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 500, color: "#6b7280" };

const ghostDanger: React.CSSProperties = {
  background: "transparent",
  border: 0,
  color: "#dc2626",
  cursor: "pointer",
  fontSize: 14,
  padding: "6px 8px",
  borderRadius: 6,
};

const ghost: React.CSSProperties = {
  background: "transparent",
  border: 0,
  color: "#2563eb",
  cursor: "pointer",
  fontSize: 14,
  padding: "6px 8px",
  borderRadius: 6,
};

const pill = (bg: string, fg: string): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: 600,
  background: bg,
  color: fg,
  borderRadius: 10,
  padding: "2px 10px",
  whiteSpace: "nowrap",
});

const emptyForm = { employee_number: "", full_name: "", hire_date: "", pay: "H", rate: "", overtime_status: "NON_EXEMPT", classification: "", payment_method: "DIRECT_DEPOSIT" };

export default function EmployeesPage() {
  const [rows, setRows] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [addedFlash, setAddedFlash] = useState(false);
  const [rowError, setRowError] = useState("");

  const closeModal = () => {
    setOpen(false);
    setFormError("");
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

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
    <label style={fieldLabel}>
      {label}
      {control}
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
      await post("/api/employees", {
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
      });
      setForm(emptyForm);
      closeModal();
      load();
      setAddedFlash(true);
      window.setTimeout(() => setAddedFlash(false), 3000);
    } catch (err: any) {
      setFormError(
        err?.status === 409
          ? "That employee number is already taken."
          : "Couldn't add the employee. Check the fields and retry."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <style>{hoverCss}</style>
      <h2 style={{ ...font.section, margin: "0 0 12px" }}>Employees</h2>
      <button style={btnPrimary} onClick={() => { setOpen(true); setFormError(""); }}>Add Employee</button>
      {rowError && <Notice title="Couldn't update" message={rowError} />}
      {addedFlash && <span style={{ color: "green" }}> Added</span>}
      {open && (
        <div
          role="presentation"
          onClick={closeModal}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add Employee"
            onClick={(e) => e.stopPropagation()}
            style={{ ...card, width: "100%", maxWidth: 560, padding: 24, maxHeight: "90vh", overflowY: "auto" }}
          >
            <h3 style={{ ...font.section, margin: "0 0 16px" }}>Add Employee</h3>
            <form onSubmit={submit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {field("Employee number", "employee_number",
                  <input style={input} id="f-employee-number" aria-label="Employee number" placeholder="e.g. E042" value={form.employee_number} onChange={set("employee_number")} />)}
                {field("Full name", "full_name",
                  <input style={input} id="f-full-name" aria-label="Full name" placeholder="e.g. Jane Doe" value={form.full_name} onChange={set("full_name")} />)}
                {field("Hire date", "hire_date",
                  <input style={input} id="f-hire-date" aria-label="Hire date" type="date" value={form.hire_date} onChange={set("hire_date")} />)}
                {field("Pay type", "pay_type",
                  <select style={input} id="f-pay-type" aria-label="Pay type" value={form.pay} onChange={set("pay")}>
                    <option value="H">Hourly (H)</option>
                    <option value="S">Salary (S)</option>
                  </select>)}
                {field(form.pay === "H" ? "Hourly rate" : "Weekly salary", "rate",
                  <input style={input} id="f-rate" aria-label="Rate" placeholder={form.pay === "H" ? "e.g. 18.50" : "e.g. 900.00"} value={form.rate} onChange={set("rate")} inputMode="decimal" />)}
                {field("Overtime status", "overtime",
                  <select style={input} id="f-overtime-status" aria-label="Overtime status" value={form.overtime_status} onChange={set("overtime_status")}>
                    <option value="NON_EXEMPT">Non-exempt</option>
                    <option value="EXEMPT">Exempt</option>
                    <option value="REVIEW">Needs review</option>
                  </select>)}
                {field("Payment method", "payment",
                  <select style={input} id="f-payment-method" aria-label="Payment method" value={form.payment_method} onChange={set("payment_method")}>
                    <option value="DIRECT_DEPOSIT">Direct Deposit</option>
                    <option value="CHECK">Check</option>
                    <option value="CASH">Cash</option>
                  </select>)}
                {field("Classification", "class",
                  <input style={input} id="f-classification" aria-label="Classification" placeholder="e.g. Crew A (optional)" value={form.classification} onChange={set("classification")} />)}
              </div>
              {formError && <Notice title="Couldn't add the employee" message={formError} />}
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button type="button" style={btnSecondary} onClick={closeModal}>Cancel</button>
                <button type="submit" disabled={saving} style={{ ...btnPrimary, flex: 1, justifyContent: "center", ...(saving ? { opacity: 0.45 } : {}) }}>
                  {saving ? "Adding…" : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {loading && <Skeleton rows={5} cols={4} />}
      {error && <Notice title="Something didn't load" message={error} onRetry={load} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title="No employees yet" hint="Add your first employee to get started." />
      )}
      {!loading && !error && rows.length > 0 && (
        <div style={{ ...card, overflowX: "auto" }}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Emp #</th>
              <th style={th}>Name</th>
              <th style={th}>Hire date</th>
              <th style={th}>Pay</th>
              <th style={th}>Payment</th>
              <th style={th}>Overtime</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
                const term = r.termination_date ? cal(r.termination_date) : null;
                return (
                <tr key={r.id} className="tc-row" style={i % 2 === 1 ? { background: "#f8fafc" } : undefined}>
                  <td style={td}>{r.employee_number}</td>
                  <td style={td}>
                    {r.full_name}
                    {r.payment_method === "CASH" && <CashBadge />}
                  </td>
                  <td style={td}>{cal(r.hire_date)}</td>
                  <td style={td}>{r.compensation ? money(r.compensation.rate, r.compensation.pay_type) : "—"}</td>
                  <td style={td}>{PAY_LABELS[r.payment_method] ?? r.payment_method}</td>
                  <td style={td}>{r.compensation ? r.compensation.overtime_status : "—"}</td>
                  <td style={td}>
                    {term
                      ? <span style={pill("#f3f4f6", "#4b5563")}>Terminated {term}</span>
                      : <span style={pill("#dcfce7", "#166534")}>Active</span>}
                  </td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    {term ? (
                      <button style={ghost} onClick={() => changeTermination(r.id, null, `Rehire ${r.full_name}?`)}>
                        Rehire
                      </button>
                    ) : (
                      <button style={ghostDanger} onClick={() => changeTermination(r.id, today(), `Terminate ${r.full_name} as of today?`)}>
                        Terminate
                      </button>
                    )}{" "}
                    <button style={ghostDanger} onClick={() => removeEmployee(r.id, r.full_name)}>Delete</button>
                  </td>
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
