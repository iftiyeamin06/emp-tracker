import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { del, get, patch, post, put } from "../../api/client";
import { fmtDay } from "../../lib/periodOptions";
import { CashBadge, EmptyState, Notice, Skeleton } from "../../components/polish";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
const PAY_LABELS = { DIRECT_DEPOSIT: "Direct Deposit", CHECK: "Check", CASH: "Cash" };
const money = (rate, payType) => {
    const formatted = Number(rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return payType === "SALARY" ? `SALARY $${formatted}/wk` : `HOURLY $${formatted}`;
};
// Native select dressed like the shadcn Input. A Radix Select renders no
// native <select>, which would break the existing label/change tests.
const selectClass = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const emptyForm = { employee_number: "", full_name: "", hire_date: "", pay: "H", rate: "", overtime_status: "NON_EXEMPT", classification: "", payment_method: "DIRECT_DEPOSIT" };
export default function EmployeesPage({ readOnly = false }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [open, setOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [formError, setFormError] = useState("");
    const [saving, setSaving] = useState(false);
    const [addedFlash, setAddedFlash] = useState(false);
    const [rowError, setRowError] = useState("");
    const [profile, setProfile] = useState(null);
    const [leave, setLeave] = useState(null);
    const [leaveLoading, setLeaveLoading] = useState(false);
    const [leaveError, setLeaveError] = useState("");
    const closeModal = () => {
        setOpen(false);
        setEditingId(null);
        setFormError("");
    };
    const closeProfile = () => setProfile(null);
    const openProfile = (emp) => {
        setProfile(emp);
        setLeave(null);
        setLeaveError("");
        setLeaveLoading(true);
        get(`/api/employees/${emp.id}/leave`)
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
        if (!open && !profile)
            return;
        const onKey = (e) => {
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
        get("/api/employees")
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
    const today = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    // Terminate (date) or rehire (null). No hard deletes: the row, its history
    // and its audit trail stay; only future visibility changes.
    const changeTermination = async (id, date, message) => {
        if (!window.confirm(message))
            return;
        setRowError("");
        try {
            await put(`/api/employees/${id}`, { termination_date: date });
            load();
        }
        catch {
            setRowError("Couldn't update employment status. Try again.");
        }
    };
    // Permanent delete, only for history-free rows (server enforces: 409 when
    // timecards/leave exist, directing to Terminate instead).
    const removeEmployee = async (id, name) => {
        if (!window.confirm(`Delete ${name} permanently? Only possible with no timecard history.`))
            return;
        setRowError("");
        try {
            await del(`/api/employees/${id}`);
            load();
        }
        catch (err) {
            setRowError(err?.status === 409
                ? "Cannot delete — this employee has history. Terminate instead."
                : "Couldn't delete. Try again.");
        }
    };
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const field = (label, name, control) => (_jsxs("label", { className: "block text-xs font-medium text-muted-foreground", children: [label, _jsx("span", { className: "mt-1 block", children: control })] }, String(name)));
    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setFormError("");
        try {
            const rate = Number(form.rate);
            if (!form.employee_number.trim() || !form.full_name.trim())
                throw { status: 400, message: "number_name_required" };
            if (!/^\d{4}-\d{2}-\d{2}$/.test(form.hire_date))
                throw { status: 400, message: "hire_date_invalid" };
            if (Number.isNaN(rate) || rate < 0)
                throw { status: 400, message: "rate_invalid" };
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
            if (editingId !== null)
                await patch(`/api/employees/${editingId}`, payload);
            else
                await post("/api/employees", payload);
            setForm(emptyForm);
            closeModal();
            load();
            setAddedFlash(editingId === null);
            window.setTimeout(() => setAddedFlash(false), 3000);
        }
        catch (err) {
            setFormError(err?.status === 409
                ? "That employee number is already taken."
                : "Couldn't save the employee. Check the fields and retry.");
        }
        finally {
            setSaving(false);
        }
    };
    return (_jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "text-lg font-semibold tracking-tight", children: "Employees" }), !readOnly && _jsx(Button, { onClick: () => { setOpen(true); setFormError(""); }, children: "Add Employee" })] }), rowError && _jsx(Notice, { title: "Couldn't update", message: rowError }), addedFlash && _jsx("span", { className: "text-sm text-green-600", children: " Added" }), open && (_jsx("div", { role: "presentation", onClick: closeModal, className: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4", children: _jsxs(Card, { role: "dialog", "aria-modal": "true", "aria-label": "Add Employee", onClick: (e) => e.stopPropagation(), className: "max-h-[90vh] w-full max-w-xl overflow-y-auto", children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: editingId !== null ? "Edit Employee" : "Add Employee" }) }), _jsx(CardContent, { children: _jsxs("form", { onSubmit: submit, className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [field("Employee number", "employee_number", _jsx(Input, { id: "f-employee-number", "aria-label": "Employee number", placeholder: "e.g. E042", value: form.employee_number, onChange: set("employee_number") })), field("Full name", "full_name", _jsx(Input, { id: "f-full-name", "aria-label": "Full name", placeholder: "e.g. Jane Doe", value: form.full_name, onChange: set("full_name") })), field("Hire date", "hire_date", _jsx(Input, { id: "f-hire-date", "aria-label": "Hire date", type: "date", value: form.hire_date, onChange: set("hire_date") })), field("Pay type", "pay_type", _jsxs("select", { className: selectClass, id: "f-pay-type", "aria-label": "Pay type", value: form.pay, onChange: set("pay"), children: [_jsx("option", { value: "H", children: "Hourly (H)" }), _jsx("option", { value: "S", children: "Salary (S)" })] })), field(form.pay === "H" ? "Hourly rate" : "Weekly salary", "rate", _jsx(Input, { id: "f-rate", "aria-label": "Rate", placeholder: form.pay === "H" ? "e.g. 18.50" : "e.g. 900.00", value: form.rate, onChange: set("rate"), inputMode: "decimal" })), field("Overtime status", "overtime", _jsxs("select", { className: selectClass, id: "f-overtime-status", "aria-label": "Overtime status", value: form.overtime_status, onChange: set("overtime_status"), children: [_jsx("option", { value: "NON_EXEMPT", children: "Non-exempt" }), _jsx("option", { value: "EXEMPT", children: "Exempt" }), _jsx("option", { value: "REVIEW", children: "Needs review" })] })), field("Payment method", "payment", _jsxs("select", { className: selectClass, id: "f-payment-method", "aria-label": "Payment method", value: form.payment_method, onChange: set("payment_method"), children: [_jsx("option", { value: "DIRECT_DEPOSIT", children: "Direct Deposit" }), _jsx("option", { value: "CHECK", children: "Check" }), _jsx("option", { value: "CASH", children: "Cash" })] })), field("Classification", "class", _jsx(Input, { id: "f-classification", "aria-label": "Classification", placeholder: "e.g. Crew A (optional)", value: form.classification, onChange: set("classification") }))] }), formError && _jsx(Notice, { title: "Couldn't add the employee", message: formError }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { type: "button", variant: "outline", onClick: closeModal, children: "Cancel" }), _jsx(Button, { type: "submit", disabled: saving, className: "flex-1", children: saving ? "Saving…" : editingId !== null ? "Save changes" : "Add" })] })] }) })] }) })), loading && _jsx(Skeleton, { rows: 5, cols: 4 }), error && _jsx(Notice, { title: "Something didn't load", message: error, onRetry: load }), !loading && !error && rows.length === 0 && (_jsx(EmptyState, { title: "No employees yet", hint: "Add your first employee to get started." })), !loading && !error && rows.length > 0 && (_jsx(Card, { children: _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "Emp #" }), _jsx(TableHead, { children: "Name" }), _jsx(TableHead, { children: "Hire date" }), _jsx(TableHead, { children: "Pay" }), _jsx(TableHead, { children: "Payment" }), _jsx(TableHead, { children: "Overtime" }), _jsx(TableHead, { children: "Status" }), _jsx(TableHead, { children: _jsx("span", { className: "sr-only", children: "Actions" }) })] }) }), _jsx(TableBody, { children: rows.map((r) => {
                                const term = r.termination_date ? fmtDay(r.termination_date) : null;
                                return (_jsxs(TableRow, { className: "odd:bg-muted/50", children: [_jsx(TableCell, { children: r.employee_number }), _jsxs(TableCell, { children: [r.full_name, r.payment_method === "CASH" && _jsx(CashBadge, {})] }), _jsx(TableCell, { children: fmtDay(r.hire_date) }), _jsx(TableCell, { children: r.compensation ? money(r.compensation.rate, r.compensation.pay_type) : "—" }), _jsx(TableCell, { children: PAY_LABELS[r.payment_method] ?? r.payment_method }), _jsx(TableCell, { children: r.compensation ? r.compensation.overtime_status : "—" }), _jsx(TableCell, { children: term
                                                ? _jsxs(Badge, { variant: "secondary", children: ["Terminated ", term] })
                                                : _jsx(Badge, { className: "border-transparent bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-100", children: "Active" }) }), _jsxs(TableCell, { className: "whitespace-nowrap text-right", children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: () => openProfile(r), children: "View" }), !readOnly && (_jsxs(_Fragment, { children: [" ", _jsx(Button, { variant: "ghost", size: "sm", onClick: () => {
                                                                setEditingId(r.id);
                                                                setForm({ employee_number: r.employee_number, full_name: r.full_name, hire_date: String(r.hire_date).slice(0, 10), pay: r.compensation?.pay_type === "SALARY" ? "S" : "H", rate: r.compensation ? String(r.compensation.rate) : "0", overtime_status: r.compensation?.overtime_status ?? "NON_EXEMPT", classification: r.compensation?.classification ?? "", payment_method: r.payment_method });
                                                                setFormError("");
                                                                setOpen(true);
                                                            }, children: "Edit" }), term ? (_jsx(Button, { variant: "ghost", size: "sm", onClick: () => changeTermination(r.id, null, `Rehire ${r.full_name}?`), children: "Rehire" })) : (_jsx(Button, { variant: "ghost", size: "sm", className: "text-destructive hover:bg-destructive/10 hover:text-destructive", onClick: () => changeTermination(r.id, today(), `Terminate ${r.full_name} as of today?`), children: "Terminate" })), " ", _jsx(Button, { variant: "ghost", size: "sm", className: "text-destructive hover:bg-destructive/10 hover:text-destructive", onClick: () => removeEmployee(r.id, r.full_name), children: "Delete" })] }))] })] }, r.id));
                            }) })] }) })), profile && (_jsx("div", { role: "presentation", onClick: closeProfile, className: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4", children: _jsxs(Card, { role: "dialog", "aria-modal": "true", "aria-label": `${profile.full_name} profile`, onClick: (e) => e.stopPropagation(), className: "max-h-[90vh] w-full max-w-xl overflow-y-auto", children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: profile.full_name }), _jsxs("p", { className: "text-sm text-muted-foreground", children: [profile.employee_number, " \u00B7 Hired ", fmtDay(profile.hire_date), profile.compensation ? ` · ${money(profile.compensation.rate, profile.compensation.pay_type)}` : ""] })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs(Card, { className: "bg-muted/40 p-4 shadow-none", children: [_jsx("h4", { className: "mb-2 text-sm font-medium", children: "Leave Balances" }), leaveLoading && _jsx("span", { className: "text-sm", children: "Loading\u2026" }), leaveError && _jsx(Notice, { title: "Couldn't load leave", message: leaveError }), leave && (_jsxs("span", { className: "text-sm", children: ["Sick: ", Number(leave.balances["SICK_SAFE_PAID"] ?? 0), " of 40 hours remaining"] }))] }), _jsx("h4", { className: "text-sm font-medium", children: "Leave History" }), leaveLoading && _jsx("span", { className: "text-sm", children: "Loading\u2026" }), leave && leave.ledger.length === 0 && (_jsx("span", { className: "text-sm text-muted-foreground", children: "No leave entries yet." })), leave && leave.ledger.length > 0 && (_jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "Date" }), _jsx(TableHead, { children: "Type" }), _jsx(TableHead, { children: "Hours" }), _jsx(TableHead, { children: "Note" })] }) }), _jsx(TableBody, { children: leave.ledger.map((l, i) => (_jsxs(TableRow, { children: [_jsx(TableCell, { children: fmtDay(l.date) }), _jsx(TableCell, { children: l.leave_type }), _jsx(TableCell, { children: Number(l.hours) }), _jsx(TableCell, { children: l.note ?? "—" })] }, i))) })] })), _jsx(Button, { type: "button", variant: "outline", className: "w-full", onClick: closeProfile, children: "Close" })] })] }) }))] }));
}
