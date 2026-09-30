import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment, useEffect, useState } from "react";
import { get, post } from "../../api/client";
import { CashBadge, EmptyState, Notice, Skeleton } from "../../components/polish";
import { hoverCss } from "../../components/theme";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { availableYears, defaultYear, filterPeriods, fmtDay, fmtRange, groupPeriods } from "../../lib/periodOptions";
const num = (v) => {
    const n = Number(v ?? 0);
    return Number.isNaN(n) ? "0" : String(Math.round(n * 100) / 100);
};
const fmtDate = (v) => {
    const d = new Date(v); // local calendar, matching the server (never slice UTC)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const currentMonth = () => fmtDate(new Date()).slice(0, 7);
const monthLabel = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};
const money = (v) => {
    const n = Number(v ?? 0);
    return "$" + (Number.isNaN(n) ? "0.00" : n.toFixed(2));
};
// Native select dressed like the shadcn Input (same reason as EmployeesPage:
// Radix Select renders no native <select>).
const selectClass = "flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
function LeaveDetail({ leave }) {
    const bal = Number(leave.balances["SICK_SAFE_PAID"] ?? 0);
    // Usage rows carry the sick date in `note` (reason = work_date); fall back
    // to the ledger date for rows without a date-like note.
    const taken = (leave.ledger ?? []).filter((l) => l.entry_type === "usage");
    return (_jsxs("div", { className: "px-1 py-1 text-sm", children: [_jsxs("div", { children: ["Sick: ", bal, " of 40 hours remaining"] }), taken.length === 0 ? (_jsx("div", { className: "text-muted-foreground", children: "No sick days taken." })) : (_jsx("ul", { className: "ml-4 mt-1 list-disc", children: taken.map((l, i) => (_jsxs("li", { children: [fmtDay(/^\d{4}-\d{2}-\d{2}$/.test(String(l.note ?? "")) ? l.note : l.date), " \u2014 ", Number(l.hours), "h"] }, i))) }))] }));
}
const SEVERITY_DOT = {
    red: "bg-[#dc2626]",
    amber: "bg-[#d97706]",
    yellow: "bg-[#eab308]",
};
const SEVERITY_RANK = { red: 0, amber: 1, yellow: 2 };
// Read-only alerts card above the weekly table. Refetches when the selected
// period changes; never blocks the page (muted fallback on error).
function AlertsCard({ periodId }) {
    const [alerts, setAlerts] = useState(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        setAlerts(null);
        setFailed(false);
        get(`/api/dashboard/${periodId}/alerts`)
            .then((j) => {
            if (live)
                setAlerts(j.data?.alerts ?? []);
        })
            .catch(() => {
            if (live)
                setFailed(true);
        });
        return () => {
            live = false;
        };
    }, [periodId]);
    const sorted = [...(alerts ?? [])].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    return (_jsxs(Card, { className: "p-4", children: [_jsx("h3", { className: "mb-2 text-sm font-semibold", children: "Needs your attention" }), failed ? (_jsx("p", { className: "text-sm text-muted-foreground", children: "Unable to load alerts" })) : alerts === null ? (_jsx("p", { className: "text-sm text-muted-foreground", children: "Checking..." })) : sorted.length === 0 ? (_jsx("p", { className: "text-sm text-muted-foreground", children: "All clear" })) : (_jsx("ul", { className: "space-y-1.5", children: sorted.map((a, i) => (_jsxs("li", { className: "flex items-center gap-2 text-sm", children: [_jsx("span", { "aria-hidden": true, className: `inline-block h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[a.severity]}` }), _jsxs("span", { children: [a.message, a.employee_name ? ` — ${a.employee_name}` : ""] })] }, `${a.code}-${a.employee_id ?? "period"}-${i}`))) }))] }));
}
function ReportTable({ rows, openLeave, leaveById, leaveLoading, onToggleLeave, }) {
    const total = (f) => {
        const n = rows.reduce((t, r) => t + Number(f(r) ?? 0), 0);
        return String(Math.round(n * 100) / 100);
    };
    return (_jsx(Card, { children: _jsxs(Table, { className: "report-table min-w-[640px]", children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "Name" }), _jsx(TableHead, { className: "text-right", children: "Reg" }), _jsx(TableHead, { className: "text-right", children: "OT" }), _jsx(TableHead, { className: "text-right", children: "Hol" }), _jsx(TableHead, { className: "text-right", children: "Sick" }), _jsx(TableHead, { className: "text-right", children: "Vacation" }), _jsx(TableHead, { className: "text-right", children: "Bonus ($)" }), _jsx(TableHead, { className: "text-right", children: "Reimbursement ($)" })] }) }), _jsx(TableBody, { children: rows.map((r) => (_jsxs(Fragment, { children: [_jsxs(TableRow, { className: "tc-row odd:bg-muted/50", children: [_jsxs(TableCell, { children: [_jsx(Button, { variant: "link", onClick: () => onToggleLeave(r.employee_id ?? r.id), "aria-expanded": !!openLeave[r.employee_id ?? r.id], title: "Show sick leave balance and dates taken", className: "h-auto p-0 font-semibold", children: r.name }), r.cash && _jsx(CashBadge, {})] }), _jsx(TableCell, { className: "text-right", children: r.reg }), _jsx(TableCell, { className: "text-right", children: r.ot }), _jsx(TableCell, { className: "text-right", children: r.hol }), _jsx(TableCell, { className: "text-right", children: r.sick }), _jsx(TableCell, { className: "text-right", children: r.vac }), _jsx(TableCell, { className: "text-right", children: money(r.bonus) }), _jsx(TableCell, { className: "text-right", children: money(r.reimb) })] }), openLeave[r.employee_id ?? r.id] && (_jsx(TableRow, { className: "leave-detail-row bg-muted/50 hover:bg-muted/50", children: _jsxs(TableCell, { colSpan: 8, children: [leaveLoading[r.employee_id ?? r.id] && _jsx("span", { className: "text-sm", children: "Loading\u2026" }), leaveById[r.employee_id ?? r.id] && _jsx(LeaveDetail, { leave: leaveById[r.employee_id ?? r.id] })] }) }))] }, r.id))) }), _jsx(TableFooter, { className: "report-totals-row", children: _jsxs(TableRow, { className: "font-semibold", children: [_jsx(TableCell, { children: "Total" }), _jsx(TableCell, { className: "text-right", children: total((r) => r.reg) }), _jsx(TableCell, { className: "text-right", children: total((r) => r.ot) }), _jsx(TableCell, { className: "text-right", children: total((r) => r.hol) }), _jsx(TableCell, { className: "text-right", children: total((r) => r.sick) }), _jsx(TableCell, { className: "text-right", children: total((r) => r.vac) }), _jsx(TableCell, { className: "text-right", children: money(total((r) => r.bonus)) }), _jsx(TableCell, { className: "text-right", children: money(total((r) => r.reimb)) })] }) })] }) }));
}
function KpiCards({ rows }) {
    const sum = (f) => Math.round(rows.reduce((t, r) => t + Number(f(r) ?? 0), 0) * 100) / 100;
    const reg = sum((r) => r.reg);
    const ot = sum((r) => r.ot);
    const leave = sum((r) => r.sick) + sum((r) => r.vac) + sum((r) => r.hol);
    const extra = sum((r) => r.bonus) + sum((r) => r.reimb);
    const cards = [
        { label: "Total Worked Hours", value: String(Math.round((reg + ot) * 100) / 100), alert: false },
        { label: "Overtime Hours", value: String(ot), alert: ot > 0 },
        { label: "Leave Used", value: String(Math.round(leave * 100) / 100), alert: false },
        { label: "Extra Payouts", value: money(String(extra)), alert: false },
    ];
    return (_jsx("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4", children: cards.map((kpi) => (_jsxs(Card, { className: "kpi-card p-4", children: [_jsx("div", { className: "text-sm text-muted-foreground", children: kpi.label }), _jsx("div", { className: kpi.alert
                        ? "kpi-card-value kpi-card-value-alert mt-1 inline-block rounded-md bg-amber-100 px-2 py-0.5 text-2xl font-semibold text-amber-700 dark:bg-amber-900"
                        : "kpi-card-value mt-1 inline-block text-2xl font-semibold", children: kpi.value })] }, kpi.label))) }));
}
export default function ReportPage() {
    const [mode, setMode] = useState("weekly");
    const [periods, setPeriods] = useState([]);
    const [periodId, setPeriodId] = useState(null);
    const [rows, setRows] = useState([]);
    const [mrows, setMrows] = useState([]);
    const [month, setMonth] = useState("");
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [approving, setApproving] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [reopenOpen, setReopenOpen] = useState(false);
    const [reopenReason, setReopenReason] = useState("");
    const [reopenError, setReopenError] = useState("");
    const [reopening, setReopening] = useState(false);
    const [openEmp, setOpenEmp] = useState({});
    const [openLeave, setOpenLeave] = useState({});
    const [leaveById, setLeaveById] = useState({});
    const [leaveLoading, setLeaveLoading] = useState({});
    const [year, setYear] = useState(null);
    const [includeArchived, setIncludeArchived] = useState(false);
    const todayYmd = fmtDate(new Date());
    const normalized = periods.map((p) => ({ ...p, start: fmtDate(p.start_date), end: fmtDate(p.end_date) }));
    const years = availableYears(normalized);
    const effYear = year ?? defaultYear(normalized, todayYmd);
    const visibleIds = new Set(effYear ? filterPeriods(normalized, { year: effYear, includeArchived }).map((p) => p.id) : []);
    const visiblePeriods = periods.filter((p) => visibleIds.has(p.id));
    const groups = groupPeriods(visiblePeriods.map((p) => ({ id: p.id, start: fmtDate(p.start_date), end: fmtDate(p.end_date), status: p.status })), todayYmd);
    useEffect(() => {
        get("/api/pay-periods")
            .then((j) => {
            setPeriods(j.data);
            const months = [...new Set(j.data.map((p) => fmtDate(p.start_date).slice(0, 7)))];
            const latest = months[0] ?? currentMonth(); // periods arrive newest-first
            setMonth((cur) => cur || latest);
            setLoading(false);
        })
            .catch(() => {
            setError("Could not load pay periods.");
            setLoading(false);
        });
    }, []);
    // Keep the selection inside the visible filter (preferred: first OPEN).
    useEffect(() => {
        if (periods.length === 0) {
            if (periodId !== null)
                setPeriodId(null);
            return;
        }
        if (!visiblePeriods.some((p) => p.id === periodId)) {
            const pref = visiblePeriods.find((p) => p.status === "OPEN") ?? visiblePeriods[0] ?? null;
            setPeriodId(pref ? pref.id : null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [periods, year, includeArchived]);
    useEffect(() => {
        if (periodId == null)
            return;
        setLoading(true);
        setError("");
        get(`/api/timecards/${periodId}`)
            .then((j) => {
            setRows(j.data.rows ?? []);
            setStatus(j.data.period.status);
            setLoading(false);
        })
            .catch(() => {
            setError("Could not load timecards.");
            setLoading(false);
        });
    }, [periodId, reloadKey]);
    useEffect(() => {
        if (mode !== "monthly" || !month)
            return;
        setLoading(true);
        setError("");
        get(`/api/reports/monthly?month=${month}`)
            .then((j) => {
            setMrows((j.data.rows ?? []).map((r) => ({
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
                weeks: (r.weeks ?? []).map((w) => ({
                    week_start: w.week_start,
                    week_end: w.week_end,
                    reg: num(w.reg),
                    ot: num(w.ot),
                    hol: num(w.hol),
                    sick: num(w.sick),
                    vac: num(w.vacation ?? w.vac),
                    bonus: num(w.bonus),
                    reimb: num(w.reimb),
                })),
            })));
            setLoading(false);
        })
            .catch(() => {
            setError("Could not load the monthly report.");
            setLoading(false);
        });
    }, [mode, month]);
    const approve = async () => {
        if (periodId == null)
            return;
        setApproving(true);
        setError("");
        try {
            const j = await post(`/api/pay-periods/${periodId}/approve`);
            setStatus(j.data.period.status);
            const grid = await get(`/api/timecards/${periodId}`);
            setRows(grid.data.rows);
        }
        catch {
            setError("Approve failed — the period may no longer be SUBMITTED.");
        }
        finally {
            setApproving(false);
        }
    };
    const closeReopen = () => {
        setReopenOpen(false);
        setReopenReason("");
        setReopenError("");
    };
    const reopen = async (e) => {
        e.preventDefault();
        if (periodId == null || reopening)
            return;
        if (!reopenReason.trim()) {
            setReopenError("A reason is required to reopen.");
            return;
        }
        setReopening(true);
        setReopenError("");
        try {
            const j = await post(`/api/pay-periods/${periodId}/reopen`, { reason: reopenReason.trim() });
            setStatus(j.data.period.status);
            closeReopen();
            const grid = await get(`/api/timecards/${periodId}`);
            setRows(grid.data.rows);
        }
        catch {
            setReopenError("Reopen failed — the period may no longer be APPROVED.");
        }
        finally {
            setReopening(false);
        }
    };
    // Computed unconditionally but cheap; rows is always an array (guards on
    // setRows/setMrows coerce malformed payloads to []).
    const weeklyRows = (rows ?? []).map((r) => ({
        id: r.employee.id,
        employee_id: r.employee.id,
        name: r.employee.full_name,
        cash: r.employee.payment_method === "CASH",
        reg: num(r.computed?.reg_hours),
        ot: num(r.computed?.ot_hours),
        hol: num(r.computed?.holiday_hours),
        sick: num(r.computed?.sick_safe_paid_hours),
        vac: num(r.computed?.vacation_hours),
        bonus: num(r.entry?.bonus_amount),
        reimb: num(r.entry?.reimbursement_amount),
    }));
    // Owner drill-down: sick balance + dates taken per employee. Lazy per-row
    // fetch (no N+1 on load); GET /api/employees/:id/leave is auth-only so both
    // roles can call it.
    const toggleLeave = (id) => {
        const next = !openLeave[id];
        setOpenLeave((p) => ({ ...p, [id]: next }));
        if (!next || leaveById[id] || leaveLoading[id])
            return;
        setLeaveLoading((p) => ({ ...p, [id]: true }));
        get(`/api/employees/${id}/leave`)
            .then((j) => setLeaveById((p) => ({ ...p, [id]: j.data })))
            .catch(() => undefined)
            .finally(() => setLeaveLoading((p) => ({ ...p, [id]: false })));
    };
    const leaveProps = { openLeave, leaveById, leaveLoading, onToggleLeave: toggleLeave };
    const displayRows = mode === "weekly" ? weeklyRows : mrows;
    const showKpis = !loading && !error && displayRows.length > 0;
    const step = (dir) => {
        const idx = visiblePeriods.findIndex((p) => p.id === periodId);
        const next = visiblePeriods[idx + dir]; // list is newest-first: +1 = older week, -1 = newer
        if (next)
            setPeriodId(next.id);
    };
    return (_jsxs("section", { className: "space-y-4", children: [_jsx("style", { children: hoverCss }), _jsxs(Card, { className: "p-4", children: [_jsx("h2", { className: "mb-3 text-lg font-semibold tracking-tight", children: mode === "weekly" ? "Weekly report" : "Monthly report" }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsxs("div", { role: "group", "aria-label": "Report range", className: "flex gap-1", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: () => setMode("weekly"), disabled: mode === "weekly", children: "Weekly" }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => setMode("monthly"), disabled: mode === "monthly", children: "Monthly" })] }), mode === "weekly" ? (_jsxs(_Fragment, { children: [_jsxs("label", { className: "flex items-center gap-1.5 text-sm", children: ["Year", " ", _jsx("select", { "aria-label": "Year", value: effYear ?? "", onChange: (e) => setYear(e.target.value), disabled: years.length === 0, className: selectClass, children: years.map((y) => (_jsx("option", { value: y, children: y }, y))) })] }), _jsxs("label", { className: "flex items-center gap-1.5 text-sm", children: [_jsx("input", { type: "checkbox", checked: includeArchived, onChange: (e) => setIncludeArchived(e.target.checked), className: "accent-primary" }), " ", "Include Archived/Approved Periods"] }), _jsxs("label", { className: "flex items-center gap-1 text-sm", children: ["Period", " ", _jsx(Button, { "aria-label": "Previous week", variant: "ghost", size: "icon", onClick: () => step(1), disabled: visiblePeriods.length === 0 || visiblePeriods.findIndex((p) => p.id === periodId) >= visiblePeriods.length - 1, children: "\u2039" }), _jsxs("select", { value: periodId ?? "", onChange: (e) => setPeriodId(Number(e.target.value)), disabled: visiblePeriods.length === 0, className: selectClass, children: [groups.current.length > 0 && (_jsx("optgroup", { label: "Active / Current Week", children: groups.current.map((o) => (_jsx("option", { value: o.id, children: o.label }, o.id))) })), groups.open.length > 0 && (_jsx("optgroup", { label: "Open / Action Required", children: groups.open.map((o) => (_jsx("option", { value: o.id, children: o.label }, o.id))) })), groups.approved.length > 0 && (_jsx("optgroup", { label: "Approved / Closed", children: groups.approved.map((o) => (_jsx("option", { value: o.id, children: o.label }, o.id))) }))] }), _jsx(Button, { "aria-label": "Next week", variant: "ghost", size: "icon", onClick: () => step(-1), disabled: visiblePeriods.length === 0 || visiblePeriods.findIndex((p) => p.id === periodId) <= 0, children: "\u203A" })] }), " "] })) : (_jsxs("label", { className: "flex items-center gap-1.5 text-sm", children: ["Month", " ", _jsx("select", { "aria-label": "Month", value: month, onChange: (e) => setMonth(e.target.value), disabled: periods.length === 0, className: selectClass, children: [...new Set(periods.map((p) => fmtDate(p.start_date).slice(0, 7)))].map((m) => (_jsx("option", { value: m, children: monthLabel(m) }, m))) })] })), mode === "weekly" && (_jsxs(_Fragment, { children: [_jsx(Button, { onClick: approve, disabled: status !== "SUBMITTED" || approving || reopening, children: approving ? "Approving…" : "Approve" }), _jsx(Button, { variant: "outline", onClick: () => { setReopenOpen(true); setReopenError(""); }, disabled: (status !== "APPROVED" && status !== "SUBMITTED") || approving || reopening, children: "Reopen" })] })), reopenOpen && (_jsx("div", { role: "presentation", onClick: closeReopen, className: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4", children: _jsxs(Card, { role: "dialog", "aria-modal": "true", "aria-label": "Reopen period", onClick: (e) => e.stopPropagation(), className: "w-full max-w-md p-6", children: [_jsx("h3", { className: "mb-3 text-lg font-semibold tracking-tight", children: "Reopen period" }), _jsxs("form", { onSubmit: reopen, className: "space-y-4", children: [_jsxs("label", { className: "block text-xs font-medium text-muted-foreground", children: ["Reason for reopening (required)", _jsx("textarea", { "aria-label": "Reopen reason", value: reopenReason, onChange: (e) => setReopenReason(e.target.value), rows: 3, className: "mt-1 flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" })] }), reopenError && _jsx(Notice, { title: "Couldn't reopen", message: reopenError }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { type: "button", variant: "outline", onClick: closeReopen, children: "Cancel" }), _jsx(Button, { type: "submit", disabled: reopening, className: "flex-1", children: reopening ? "Reopening…" : "Reopen" })] })] })] }) }))] })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [mode === "weekly" && status === "OPEN" && _jsx(Badge, { className: "border-transparent bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-100", children: "\uD83D\uDFE1 OPEN (Awaiting Submission)" }), mode === "weekly" && status === "SUBMITTED" && _jsx(Badge, { className: "border-transparent bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-100", children: "\uD83D\uDD35 SUBMITTED (Pending CEO Approval)" }), mode === "weekly" && status === "APPROVED" && _jsx(Badge, { className: "border-transparent bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-100", children: "\uD83D\uDFE2 APPROVED" })] }), loading && _jsx(Skeleton, { rows: 5, cols: 8 }), error && _jsx(Notice, { title: "Something didn't load", message: error, onRetry: () => setReloadKey((k) => k + 1) }), showKpis && _jsx(KpiCards, { rows: displayRows }), mode === "weekly" && periodId != null && _jsx(AlertsCard, { periodId: periodId }), mode === "monthly" && !loading && !error && mrows.length === 0 && (_jsx(EmptyState, { title: "No data for this month", hint: "Pick a month with approved or open weeks." })), mode === "monthly" && !loading && !error && mrows.length > 0 && _jsx(ReportTable, { rows: mrows, ...leaveProps }), mode === "monthly" && !loading && !error && mrows.some((r) => (r.weeks ?? []).length > 0) && (_jsxs(_Fragment, { children: [_jsx("h3", { className: "text-lg font-semibold tracking-tight", children: "By week" }), _jsx(Card, { children: _jsxs(Table, { className: "report-table min-w-[480px]", children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "Employee" }), _jsx(TableHead, { children: "Week" }), _jsx(TableHead, { className: "text-right", children: "Reg" }), _jsx(TableHead, { className: "text-right", children: "OT" }), _jsx(TableHead, { className: "text-right", children: "Hol" }), _jsx(TableHead, { className: "text-right", children: "Sick" }), _jsx(TableHead, { className: "text-right", children: "Vac" }), _jsx(TableHead, { className: "text-right", children: "Bonus ($)" }), _jsx(TableHead, { className: "text-right", children: "Reimb ($)" })] }) }), _jsx(TableBody, { children: mrows.filter((r) => (r.weeks ?? []).length > 0).map((r) => (_jsxs(Fragment, { children: [_jsx(TableRow, { className: "tc-row odd:bg-muted/50", children: _jsx(TableCell, { colSpan: 4, children: _jsxs("button", { onClick: () => setOpenEmp((p) => ({ ...p, [r.employee_id ?? r.id]: !p[r.employee_id ?? r.id] })), "aria-expanded": !!openEmp[r.employee_id ?? r.id], className: "cursor-pointer bg-transparent p-0 text-sm font-semibold", children: [openEmp[r.employee_id ?? r.id] ? "▼" : "▶", " ", r.name] }) }) }), (openEmp[r.employee_id ?? r.id] ? r.weeks ?? [] : []).map((w) => (_jsxs(TableRow, { className: "tc-row", children: [_jsx(TableCell, {}), _jsx(TableCell, { children: fmtRange(w.week_start, w.week_end) }), _jsx(TableCell, { className: "text-right", children: num(w.reg) }), _jsx(TableCell, { className: "text-right", children: num(w.ot) }), _jsx(TableCell, { className: "text-right", children: num(w.hol) }), _jsx(TableCell, { className: "text-right", children: num(w.sick) }), _jsx(TableCell, { className: "text-right", children: num(w.vac) }), _jsx(TableCell, { className: "text-right", children: money(w.bonus) }), _jsx(TableCell, { className: "text-right", children: money(w.reimb) })] }, `${r.employee_id}-${w.week_start}`)))] }, `emp-${r.employee_id ?? r.id}`))) })] }) })] })), mode === "weekly" && !loading && !error && periods.length === 0 && (_jsx(EmptyState, { title: "No pay periods yet", hint: "Create a weekly period to see the report." })), mode === "weekly" && !loading && !error && periods.length > 0 && rows.length === 0 && (_jsx(EmptyState, { title: "No employees in this period", hint: "Add employees to the roster first." })), mode === "weekly" && !loading && !error && rows.length > 0 && (_jsx(ReportTable, { rows: weeklyRows, ...leaveProps }))] }));
}
