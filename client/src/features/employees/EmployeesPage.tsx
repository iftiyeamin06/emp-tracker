import { useEffect, useState } from "react";
import { del, get, patch, post, put } from "../../api/client";
import { fmtDay } from "../../lib/periodOptions";
import { CashBadge, EmptyState, Notice, Skeleton } from "../../components/polish";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Progress } from "../../components/ui/progress";
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

const PAY_LABELS: Record<string, string> = { DIRECT_DEPOSIT: "Direct Deposit", CHECK: "Check", CASH: "Cash" };

const money = (rate: unknown, payType: string): string => {
  const formatted = Number(rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return payType === "SALARY" ? `$${formatted} / wk` : `$${formatted} / hr`;
};

// Native select dressed like the shadcn Input. A Radix Select renders no
// native <select>, which would break the existing label/change tests.
const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const emptyForm = { employee_number: "", full_name: "", hire_date: "", pay: "H", rate: "", overtime_status: "NON_EXEMPT", classification: "", payment_method: "DIRECT_DEPOSIT" };

// Sick balance with a visual progress bar. The legacy sentence stays verbatim
// (tests + screen readers); the bar and the Balance line are the new visual.
function SickBalance({ leave }: { leave: LeaveData }) {
  const remaining = Number(leave.balances["SICK_SAFE_PAID"] ?? 0);
  const accrued = (leave.ledger ?? [])
    .filter((l) => l.leave_type === "SICK_SAFE_PAID" && String(l.entry_type).toLowerCase() === "accrual")
    .reduce((t, l) => t + Math.max(0, Number(l.hours) || 0), 0);
  const total = accrued > 0 ? accrued : Math.max(remaining, 0);
  const pct = total > 0 ? (remaining / total) * 100 : 0;
  const bar = pct > 50 ? "bg-emerald-500" : pct > 20 ? "bg-amber-500" : "bg-destructive";
  return (
    <div className="space-y-2 text-sm">
      <span>
        Sick: {remaining} of 40 hours remaining
      </span>
      <Progress value={pct} indicatorClassName={bar} />
      <span className="text-muted-foreground">
        Sick Leave Balance: {remaining} of {total} hrs remaining
      </span>
    </div>
  );
}

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
  const [profile, setProfile] = useState<Employee | null>(null);
  const [leave, setLeave] = useState<LeaveData | null>(null);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveError, setLeaveError] = useState("");

  const closeModal = () => {
    setOpen(false);
    setEditingId(null);
    setFormError("");
  };

  const closeProfile = () => setProfile(null);

  const openProfile = (emp: Employee) => {
    setProfile(emp);
    setLeave(null);
    setLeaveError("");
    setLeaveLoading(true);
    get<{ data: LeaveData }>(`/api/employees/${emp.id}/leave`)
      .then((j) => {
        setLeave(j.data);
        setLeaveLoading(false);
      })
      .catch(() => {
        setLeaveError("Could not load leave history.");
        setLeaveLoading(false);
      });
  };

  useEffect(() => {
    if (!open && !profile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
        closeProfile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, profile]);

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
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Emp #</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Hire date</TableHead>
                <TableHead>Pay</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Overtime</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const term = r.termination_date ? fmtDay(r.termination_date) : null;
                return (
                  <TableRow key={r.id} className="odd:bg-muted/50">
                    <TableCell>{r.employee_number}</TableCell>
                    <TableCell>
                      {r.full_name}
                      {r.payment_method === "CASH" && <CashBadge />}
                    </TableCell>
                    <TableCell>{fmtDay(r.hire_date)}</TableCell>
                    <TableCell>{r.compensation ? money(r.compensation.rate, r.compensation.pay_type) : "—"}</TableCell>
                    <TableCell>{PAY_LABELS[r.payment_method] ?? r.payment_method}</TableCell>
                    <TableCell>{r.compensation ? <Badge variant="outline" className="text-muted-foreground">{r.compensation.overtime_status}</Badge> : "—"}</TableCell>
                    <TableCell>
                      {term
                        ? <Badge variant="secondary" className="border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400">Terminated {term}</Badge>
                        : <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Active</Badge>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button variant="ghost" size="sm" onClick={() => openProfile(r)}>
                        View
                      </Button>
                      {!readOnly && (
                        <>
                          {" "}
                          <Button variant="ghost" size="sm" onClick={() => {
                            setEditingId(r.id);
                            setForm({ employee_number: r.employee_number, full_name: r.full_name, hire_date: String(r.hire_date).slice(0, 10), pay: r.compensation?.pay_type === "SALARY" ? "S" : "H", rate: r.compensation ? String(r.compensation.rate) : "0", overtime_status: r.compensation?.overtime_status ?? "NON_EXEMPT", classification: r.compensation?.classification ?? "", payment_method: r.payment_method });
                            setFormError(""); setOpen(true);
                          }}>Edit</Button>
                          {term ? (
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
      {profile && (
        <div
          role="presentation"
          onClick={closeProfile}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <Card
            role="dialog"
            aria-modal="true"
            aria-label={`${profile.full_name} profile`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto"
          >
            <CardHeader>
              <CardTitle>{profile.full_name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {profile.employee_number} · Hired {fmtDay(profile.hire_date)}
                {profile.compensation ? ` · ${money(profile.compensation.rate, profile.compensation.pay_type)}` : ""}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Card className="bg-muted/40 p-4 shadow-none">
                <h4 className="mb-2 text-sm font-medium">Leave Balances</h4>
                {leaveLoading && <span className="text-sm">Loading…</span>}
                {leaveError && <Notice title="Couldn't load leave" message={leaveError} />}
                {leave && <SickBalance leave={leave} />}
              </Card>
              <h4 className="text-sm font-medium">Leave History</h4>
              {leaveLoading && <span className="text-sm">Loading…</span>}
              {leave && leave.ledger.length === 0 && (
                <span className="text-sm text-muted-foreground">No leave entries yet.</span>
              )}
              {leave && leave.ledger.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leave.ledger.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>{fmtDay(l.date)}</TableCell>
                        <TableCell>{l.leave_type}</TableCell>
                        <TableCell>
                          {Number(l.hours) < 0 ? (
                            <span className="font-medium text-red-600 dark:text-red-400">{Number(l.hours)} hrs</span>
                          ) : (
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">+{Number(l.hours)} hrs</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{l.note ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Button type="button" variant="outline" className="w-full" onClick={closeProfile}>
                Close
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}
