import { useEffect, useState } from "react";
import { get, post } from "../../api/client";
import { EmptyState, Notice, ScrollX, Skeleton } from "../../components/polish";

interface Employee {
  id: number;
  employee_number: string;
  full_name: string;
  hire_date: string;
  compensation: { pay_type: string; rate: unknown; overtime_status: string; classification: string | null } | null;
}

const input: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  margin: "6px 0",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 14,
};

const emptyForm = { employee_number: "", full_name: "", hire_date: "", pay: "H", rate: "", overtime_status: "NON_EXEMPT", classification: "" };

export default function EmployeesPage() {
  const [rows, setRows] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [addedFlash, setAddedFlash] = useState(false);

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

  const set = (k: keyof typeof emptyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

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
        compensation: {
          pay_type: form.pay === "H" ? "HOURLY" : "SALARY",
          rate,
          overtime_status: form.overtime_status,
          classification: form.classification.trim() || undefined,
        },
      });
      setForm(emptyForm);
      setOpen(false);
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
      <h2>Employees</h2>
      <button onClick={() => { setOpen((o) => !o); setFormError(""); }}>{open ? "Cancel" : "Add Employee"}</button>
      {addedFlash && <span style={{ color: "green" }}> Added</span>}
      {open && (
        <form onSubmit={submit} style={{ maxWidth: 420, margin: "12px 0" }}>
          <input style={input} aria-label="Employee number" placeholder="Employee number" value={form.employee_number} onChange={set("employee_number")} />
          <input style={input} aria-label="Full name" placeholder="Full name" value={form.full_name} onChange={set("full_name")} />
          <input style={input} aria-label="Hire date" type="date" value={form.hire_date} onChange={set("hire_date")} />
          <label>
            Pay type{" "}
            <select aria-label="Pay type" value={form.pay} onChange={set("pay")}>
              <option value="H">Hourly (H)</option>
              <option value="S">Salary (S)</option>
            </select>
          </label>
          <input style={input} aria-label="Rate" placeholder={form.pay === "H" ? "Hourly rate" : "Weekly salary"} value={form.rate} onChange={set("rate")} inputMode="decimal" />
          <label>
            Overtime status{" "}
            <select aria-label="Overtime status" value={form.overtime_status} onChange={set("overtime_status")}>
              <option value="NON_EXEMPT">Non-exempt</option>
              <option value="EXEMPT">Exempt</option>
              <option value="REVIEW">Needs review</option>
            </select>
          </label>
          <input style={input} aria-label="Classification" placeholder="Classification (optional)" value={form.classification} onChange={set("classification")} />
          <button type="submit" disabled={saving}>{saving ? "Adding…" : "Add"}</button>
          {formError && <Notice title="Couldn't add the employee" message={formError} />}
        </form>
      )}
      {loading && <Skeleton rows={5} cols={4} />}
      {error && <Notice title="Something didn't load" message={error} onRetry={load} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title="No employees yet" hint="Add your first employee to get started." />
      )}
      {!loading && !error && rows.length > 0 && (
        <ScrollX>
          <table style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Emp #</th>
                <th>Name</th>
                <th>Hire date</th>
                <th>Pay</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.employee_number}</td>
                  <td>{r.full_name}</td>
                  <td>{String(r.hire_date).slice(0, 10)}</td>
                  <td>{r.compensation ? `${r.compensation.pay_type} ${r.compensation.rate}` : "—"}</td>
                  <td>{r.compensation ? r.compensation.overtime_status : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}
    </section>
  );
}
