import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { get, post, put } from "../../api/client";
import { availableYears, defaultYear, filterPeriods, groupPeriods } from "../../lib/periodOptions";
import { CashBadge, EmptyState, Notice, Skeleton } from "../../components/polish";
import { hoverCss } from "../../components/theme";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { formatDay, leaveHoursOf, parseCell, workedHoursOf } from "./dayCodes";
const DOW = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
// Native select dressed like the shadcn Input (same reason as EmployeesPage).
const selectClass = "flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
// Full weekday label, e.g. "Saturday, September 19, 2026" (UTC math on a calendar string).
const fmtLong = (ymdStr) => {
    const d = new Date(ymdStr + "T00:00:00Z");
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${days[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const isSaturday = (ymdStr) => /^\d{4}-\d{2}-\d{2}$/.test(ymdStr) && new Date(ymdStr + "T00:00:00Z").getUTCDay() === 6;
const ymd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
// Calendar day in LOCAL time. The server validates work_date against the same
// local calendar (its ymd() uses local components), so the UI must too —
// slicing the UTC part of an ISO string shifts boundary days and the save is
// rejected with work_date_outside_period.
const cal = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const weekDates = (start) => {
    const base = new Date(start.slice(0, 10) + "T00:00:00Z").getTime();
    return Array.from({ length: 7 }, (_, i) => ymd(new Date(base + i * 86400000)));
};
const num = (v) => {
    const n = Number(v ?? 0);
    return Number.isNaN(n) ? "0" : String(Math.round(n * 100) / 100);
};
// Computed values render as disabled inputs: same field look as the editable
// cells, but never editable — they are derived (API view when clean, local
// preview when dirty), not typed.
function ComputedCell({ label, value }) {
    return (_jsx(Input, { "aria-label": label, value: value, disabled: true, readOnly: true, size: 5, className: "min-w-[34px] border-muted bg-muted px-0.5 text-center text-muted-foreground" }));
}
function DayCell({ value, readOnly, label, onCommit, }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    if (readOnly)
        return _jsx(_Fragment, { children: value || "–" });
    const commit = () => {
        const code = draft.trim().toUpperCase();
        if (onCommit(code))
            setDraft(code);
        else
            setDraft(value); // invalid → revert
    };
    return (_jsx(Input, { "aria-label": label, value: draft, placeholder: "\u2013", title: "8 = worked day, H8 holiday, S8 sick, V8 vacation \u2014 or type hours like 9", size: 4, className: "min-w-[34px] px-0.5 text-center", onChange: (e) => setDraft(e.target.value), onBlur: commit, onKeyDown: (e) => {
            // Commit directly (not via blur()): blur is a no-op on unfocused
            // elements, which would silently drop keyboard-driven commits.
            if (e.key === "Enter")
                commit();
            if (e.key === "Escape")
                setDraft(value);
        } }));
}
function MoneyCell({ value, readOnly, label, prefix, onCommit, }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    if (readOnly)
        return _jsx(_Fragment, { children: value || "0" });
    const commit = () => {
        const t = draft.trim();
        if (t === "" || (!Number.isNaN(Number(t)) && Number(t) >= 0))
            onCommit(t === "" ? "0" : t);
        else
            setDraft(value); // invalid → revert
    };
    return (_jsxs("span", { className: "inline-flex items-center gap-0.5", children: [prefix && _jsx("span", { "aria-hidden": true, className: "text-muted-foreground", children: prefix }), _jsx(Input, { "aria-label": label, value: draft, size: 6, className: "min-w-[34px] px-0.5 text-right", onChange: (e) => setDraft(e.target.value), onBlur: commit, onKeyDown: (e) => {
                    if (e.key === "Enter")
                        commit(); // direct: blur() no-ops on unfocused elements
                    if (e.key === "Escape")
                        setDraft(value);
                } })] }));
}
export default function TimecardPage() {
    const [periods, setPeriods] = useState([]);
    const [periodId, setPeriodId] = useState(null);
    const [period, setPeriod] = useState(null);
    const [baseRows, setBaseRows] = useState([]);
    const [cells, setCells] = useState({});
    const [extras, setExtras] = useState({});
    const [baseline, setBaseline] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");
    const [savedFlash, setSavedFlash] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [notesByEmp, setNotesByEmp] = useState({});
    const flashTimer = useRef(null);
    useEffect(() => () => { if (flashTimer.current)
        window.clearTimeout(flashTimer.current); }, []);
    const locked = period != null && period.status !== "OPEN";
    const applyGrid = (p, rows) => {
        setPeriod(p);
        setBaseRows(rows);
        const c = {};
        const x = {};
        const n = {};
        for (const r of rows) {
            c[r.employee.id] = {};
            for (const d of r.days)
                c[r.employee.id][cal(d.work_date)] = formatDay(d.day_type, d.hours);
            x[r.employee.id] = { bonus: num(r.entry?.bonus_amount), reimb: num(r.entry?.reimbursement_amount) };
            n[r.employee.id] = r.entry?.notes ?? null; // echoed back on save, never edited in v1
        }
        setCells(c);
        setExtras(x);
        setNotesByEmp(n);
        setBaseline(JSON.stringify({ c, x }));
    };
    const loadGrid = (id) => {
        setLoading(true);
        setError("");
        get(`/api/timecards/${id}`)
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
    const loadPeriods = (selectId) => {
        get("/api/pay-periods")
            .then((j) => {
            setPeriods(j.data);
            if (selectId != null)
                setPeriodId(selectId); // create flow: select the new one
            setLoading(false);
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
    useEffect(() => {
        if (!showNew)
            return;
        const onKey = (e) => {
            if (e.key === "Escape") {
                setShowNew(false);
                setNewError("");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [showNew]);
    const addDays = (ymd, n) => {
        const t = new Date(ymd + "T00:00:00Z").getTime();
        const d = new Date(t + n * 86400000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };
    const createPeriod = async (e) => {
        e.preventDefault();
        if (!isSaturday(newStart)) {
            setNewError("Start date must be a Saturday.");
            return;
        }
        if (newPay < addDays(newStart, 6)) {
            setNewError("Check date must be on or after the week end.");
            return;
        }
        setCreating(true);
        setNewError("");
        try {
            const j = await post("/api/pay-periods", {
                start_date: newStart,
                end_date: addDays(newStart, 6),
                pay_date: newPay,
            });
            setShowNew(false);
            setNewStart("");
            setNewPay("");
            loadPeriods(j.data.period.id); // refetch list and select the new one
        }
        catch (err) {
            setNewError(err?.status === 409
                ? "That week overlaps an existing period."
                : "Couldn't create the period. Start must be a Saturday and check date on/after week end.");
        }
        finally {
            setCreating(false);
        }
    };
    useEffect(() => {
        if (periodId == null)
            return;
        loadGrid(periodId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [periodId]);
    const dirty = baseline !== "" && JSON.stringify({ c: cells, x: extras }) !== baseline;
    const dates = period ? weekDates(cal(period.start_date)) : [];
    // v1 wire codes (route maps SICK/HW8 to the DB enum). Empty clears the day by
    // sending a 0-hour WORK row — the route deletes + reinserts per date.
    const WIRE = {
        "8": { day_type: "WORK", hours: 8 },
        H8: { day_type: "HOLIDAY", hours: 8 },
        S8: { day_type: "SICK", hours: 8 },
        V8: { day_type: "VACATION", hours: 8 },
        HW8: { day_type: "HW8", hours: 8 },
        "": { day_type: "WORK", hours: 0 },
    };
    const toWire = (cell) => {
        const t = cell.trim().toUpperCase();
        if (WIRE[t] !== undefined)
            return WIRE[t];
        const parsed = parseCell(t); // numeric hours accepted by the editor
        if (parsed)
            return parsed;
        return { day_type: "WORK", hours: 0 }; // unreachable: only valid cells reach state
    };
    const submit = async () => {
        if (periodId == null || submitting)
            return;
        if (!window.confirm("Submit this period? Admin edits will be locked."))
            return; // cancel = no API call
        setSubmitting(true);
        setSubmitError("");
        try {
            await post(`/api/pay-periods/${periodId}/submit`);
            loadGrid(periodId); // refetch: banner flips, grid locks
        }
        catch (e) {
            setSubmitError(e?.status === 409 ? "Submit failed — the period is no longer OPEN." : "Submit failed. Nothing was changed.");
        }
        finally {
            setSubmitting(false);
        }
    };
    const save = async () => {
        if (periodId == null || saving)
            return;
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
            if (flashTimer.current)
                window.clearTimeout(flashTimer.current);
            flashTimer.current = window.setTimeout(() => setSavedFlash(false), 3000);
        }
        catch (e) {
            // Local edits are untouched, so nothing is lost; dirty flag stays set.
            setSaveError(e?.status === 423 ? "Period is no longer OPEN — refetch to see its state." : "Save failed. Your edits are kept — fix the issue and retry.");
        }
        finally {
            setSaving(false);
        }
    };
    const commitCell = (empId, date) => (code) => {
        const parsed = parseCell(code);
        if (!parsed)
            return false; // invalid → caller reverts, state untouched
        setCells((prev) => ({ ...prev, [empId]: { ...prev[empId], [date]: code.trim().toUpperCase() } }));
        return true;
    };
    // Client-side preview from local cells. Simplification: leave buckets count
    // 8h each — the SERVER (timecard_weekly) is the source of truth and
    // recomputes from real hours + comp status on save. Exemption IS respected
    // here (status rides along on each grid row); missing status previews as
    // eligible, mirroring the view.
    const preview = (empId) => {
        const row = cells[empId] ?? {};
        const status = baseRows.find((r) => r.employee.id === empId)?.employee?.overtime_status;
        const eligible = status == null || status === "NON_EXEMPT";
        const sum = (f) => dates.reduce((t, d) => t + f(row[d] ?? ""), 0);
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
    const rowClean = (empId) => {
        const base = JSON.parse(baseline || "{}");
        return JSON.stringify({ c: cells[empId] ?? {}, x: extras[empId] ?? {} }) ===
            JSON.stringify({ c: base.c?.[empId] ?? {}, x: base.x?.[empId] ?? { bonus: "0", reimb: "0" } });
    };
    const todayYmd = cal(new Date());
    const [year, setYear] = useState(null);
    const [includeArchived, setIncludeArchived] = useState(false);
    const normalized = periods.map((p) => ({ ...p, start: cal(p.start_date), end: cal(p.end_date) }));
    const years = availableYears(normalized);
    const effYear = year ?? defaultYear(normalized, todayYmd);
    const visibleIds = new Set(effYear ? filterPeriods(normalized, { year: effYear, includeArchived }).map((p) => p.id) : []);
    const visiblePeriods = periods.filter((p) => visibleIds.has(p.id));
    const groups = groupPeriods(visiblePeriods.map((p) => ({ id: p.id, start: cal(p.start_date), end: cal(p.end_date), status: p.status })), todayYmd);
    const step = (dir) => {
        const idx = visiblePeriods.findIndex((p) => p.id === periodId);
        const next = visiblePeriods[idx + dir]; // list is newest-first: +1 = older week, -1 = newer
        if (next)
            setPeriodId(next.id);
    };
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
            if (!pref) {
                setPeriod(null);
                setBaseRows([]);
                setCells({});
                setExtras({});
                setBaseline("");
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [periods, year, includeArchived]);
    return (_jsxs("section", { className: "space-y-4", children: [_jsx("style", { children: hoverCss }), _jsxs(Card, { className: "p-4", children: [_jsx("h2", { className: "mb-3 text-lg font-semibold tracking-tight", children: "Timecards" }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsxs("label", { className: "flex items-center gap-1.5 text-sm", children: ["Year", " ", _jsx("select", { "aria-label": "Year", value: effYear ?? "", onChange: (e) => setYear(e.target.value), disabled: years.length === 0, className: selectClass, children: years.map((y) => (_jsx("option", { value: y, children: y }, y))) })] }), _jsxs("label", { className: "flex items-center gap-1.5 text-sm", children: [_jsx("input", { type: "checkbox", checked: includeArchived, onChange: (e) => setIncludeArchived(e.target.checked), className: "accent-primary" }), " ", "Include Archived/Approved Periods"] }), _jsxs("label", { className: "flex items-center gap-1 text-sm", children: ["Period", " ", _jsx(Button, { "aria-label": "Previous week", variant: "ghost", size: "icon", onClick: () => step(1), disabled: visiblePeriods.length === 0 || visiblePeriods.findIndex((p) => p.id === periodId) >= visiblePeriods.length - 1, children: "\u2039" }), _jsxs("select", { value: periodId ?? "", onChange: (e) => setPeriodId(Number(e.target.value)), disabled: visiblePeriods.length === 0, className: selectClass, children: [groups.current.length > 0 && (_jsx("optgroup", { label: "Active / Current Week", children: groups.current.map((o) => (_jsx("option", { value: o.id, children: o.label }, o.id))) })), groups.open.length > 0 && (_jsx("optgroup", { label: "Open / Action Required", children: groups.open.map((o) => (_jsx("option", { value: o.id, children: o.label }, o.id))) })), groups.approved.length > 0 && (_jsx("optgroup", { label: "Approved / Closed", children: groups.approved.map((o) => (_jsx("option", { value: o.id, children: o.label }, o.id))) }))] }), _jsx(Button, { "aria-label": "Next week", variant: "ghost", size: "icon", onClick: () => step(-1), disabled: visiblePeriods.length === 0 || visiblePeriods.findIndex((p) => p.id === periodId) <= 0, children: "\u203A" })] }), " ", _jsx(Button, { variant: "ghost", onClick: () => { setShowNew(true); setNewError(""); }, children: "New Period" }), _jsx("span", { className: "flex-1" }), !locked && (_jsx(Button, { variant: "outline", onClick: save, disabled: !dirty || saving, children: saving ? (_jsxs(_Fragment, { children: [_jsx("span", { "aria-hidden": true, className: "tc-spinner border-black/20 border-t-gray-900" }), " Saving\u2026"] })) : "Save" })), !locked && (_jsx(Button, { onClick: submit, disabled: dirty || submitting, children: submitting ? (_jsxs(_Fragment, { children: [_jsx("span", { "aria-hidden": true, className: "tc-spinner" }), " Submitting\u2026"] })) : "Submit Period" }))] }), dirty && _jsxs("span", { className: "text-sm", children: [_jsx("span", { "aria-hidden": true, className: "mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500" }), "\u25CF Unsaved changes"] }), !locked && (_jsx("p", { className: "my-1 text-[13px] text-muted-foreground", children: "Type hours (e.g. 9) or a code: 8 worked \u00B7 H8 holiday \u00B7 S8 sick \u00B7 V8 vacation \u00B7 HW8 worked holiday. Click Save when done." })), savedFlash && _jsx("span", { className: "rounded-xl bg-green-600 px-2.5 py-0.5 text-[13px] text-white", children: "Saved" })] }), showNew && (_jsx("div", { role: "presentation", onClick: () => { setShowNew(false); setNewError(""); }, className: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4", children: _jsxs(Card, { role: "dialog", "aria-modal": "true", "aria-label": "Create New Pay Period", onClick: (e) => e.stopPropagation(), className: "max-h-[90vh] w-full max-w-xl overflow-y-auto p-6", children: [_jsxs("div", { className: "mb-4 flex items-center justify-between", children: [_jsx("h3", { className: "text-base font-medium", children: "Create New Pay Period" }), _jsx(Button, { type: "button", "aria-label": "Close", variant: "ghost", size: "icon", onClick: () => { setShowNew(false); setNewError(""); }, children: "\u2715" })] }), _jsxs("form", { onSubmit: createPeriod, className: "space-y-3", children: [_jsxs("label", { className: "mb-3 block text-xs font-medium text-muted-foreground", children: ["Pay Period Start Date *", _jsx(Input, { "aria-label": "Start date", type: "date", className: "tc-date mt-1 min-w-[160px]", value: newStart, onChange: (e) => {
                                                const v = e.target.value;
                                                setNewStart(v);
                                                if (/^\d{4}-\d{2}-\d{2}$/.test(v))
                                                    setNewPay(addDays(v, 13)); // default payday, editable
                                            } }), _jsx("span", { className: "text-muted-foreground", children: newStart ? fmtLong(newStart) : "Pick a Saturday" }), newStart && !isSaturday(newStart) && (_jsx("span", { className: "text-destructive", children: "Start date must be a Saturday." }))] }), _jsxs("label", { className: "mb-3 block text-xs font-medium text-muted-foreground", children: ["Pay Period End Date (Auto-calculated)", _jsx(Input, { "aria-label": "End date", type: "date", className: "tc-date mt-1 bg-muted", value: newStart ? addDays(newStart, 6) : "", readOnly: true }), _jsxs("span", { className: "text-muted-foreground", children: ["\uD83D\uDD12 ", newStart ? fmtLong(addDays(newStart, 6)) : "—"] })] }), _jsxs("label", { className: "mb-3 block text-xs font-medium text-muted-foreground", children: ["Check Date (Payday) *", _jsx(Input, { "aria-label": "Pay date", type: "date", className: "tc-date mt-1 min-w-[160px]", value: newPay, onChange: (e) => setNewPay(e.target.value) }), _jsx("span", { className: "text-muted-foreground", children: newPay ? fmtLong(newPay) : "—" })] }), newError && _jsx(Notice, { title: "Couldn't create the period", message: newError }), _jsxs("div", { className: "mt-4 flex gap-2", children: [_jsx(Button, { type: "button", variant: "outline", onClick: () => { setShowNew(false); setNewError(""); }, children: "Cancel" }), _jsx(Button, { type: "submit", disabled: creating || !newStart || !newPay || !isSaturday(newStart), className: "flex-1", children: creating ? "Creating…" : "Create" })] })] })] }) })), saveError && _jsx(Notice, { title: "Couldn't save", message: saveError }), submitError && _jsx(Notice, { title: "Couldn't submit", message: submitError }), period && period.status !== "OPEN" && _jsxs("p", { className: "rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-amber-800", children: ["Period ", period.status, " \u2014 read only"] }), loading && _jsx(Skeleton, { rows: 6, cols: 10 }), error && _jsx(Notice, { title: "Couldn't load timecards", message: "Check your connection, then try again.", onRetry: () => periodId != null && loadGrid(periodId) }), !loading && !error && periods.length === 0 && (_jsxs(Card, { className: "p-8 text-center", children: [_jsx(EmptyState, { title: "No pay periods yet", hint: "Create your first weekly period to start entering time." }), _jsx(Button, { onClick: () => { setShowNew(true); setNewError(""); }, children: "Create your first period" })] })), !loading && !error && periods.length > 0 && baseRows.length === 0 && (_jsx(Card, { className: "p-4", children: _jsx(EmptyState, { title: "No employees in this period", hint: "Nobody was employed during this week.", action: _jsx("a", { href: "#/employees", className: "text-primary underline underline-offset-4", children: "Go to Employees" }) }) })), !loading && !error && baseRows.length > 0 && (_jsx(Card, { children: _jsxs(Table, { className: "timecard-table", children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { className: "sticky left-0 z-[3] bg-card", children: "Name" }), DOW.map((d) => (_jsx(TableHead, { children: d }, d))), _jsx(TableHead, { children: "Regular Hours" }), _jsx(TableHead, { children: "Overtime Hours" }), _jsx(TableHead, { children: "Vacation Hours" }), _jsx(TableHead, { children: "Bonus Amount" }), _jsx(TableHead, { children: "Holiday Hours" }), _jsx(TableHead, { children: "Reimbursement Amount" }), _jsx(TableHead, { children: "Sick Hours" })] }) }), _jsx(TableBody, { children: baseRows.map((r) => {
                                const empId = r.employee.id;
                                const clean = baseline !== "" && rowClean(empId);
                                const pv = preview(empId);
                                return (_jsxs(TableRow, { className: "tc-row odd:bg-muted/50", children: [_jsxs(TableCell, { className: "sticky left-0 z-[1] whitespace-nowrap bg-card font-semibold", children: [r.employee.full_name, r.employee.payment_method === "CASH" && _jsx(CashBadge, {})] }), dates.map((date) => (_jsx(TableCell, { className: "min-w-[60px]", children: _jsx(DayCell, { value: cells[empId]?.[date] ?? "", readOnly: locked, label: `day-${empId}-${date}`, onCommit: commitCell(empId, date) }) }, date))), _jsx(TableCell, { className: "text-right", children: _jsx(ComputedCell, { label: `reg-${empId}`, value: clean ? num(r.computed?.reg_hours) : String(pv.reg) }) }), _jsx(TableCell, { className: "text-right", children: _jsx(ComputedCell, { label: `ot-${empId}`, value: clean ? num(r.computed?.ot_hours) : String(pv.ot) }) }), _jsx(TableCell, { className: "text-right", children: _jsx(ComputedCell, { label: `vac-${empId}`, value: clean ? num(r.computed?.vacation_hours) : String(pv.vac) }) }), _jsx(TableCell, { className: "text-right", children: _jsx(MoneyCell, { value: extras[empId]?.bonus ?? "0", readOnly: locked, label: `bonus-${empId}`, prefix: "$", onCommit: (v) => setExtras((p) => ({ ...p, [empId]: { ...p[empId], bonus: v } })) }) }), _jsx(TableCell, { className: "text-right", children: _jsx(ComputedCell, { label: `hol-${empId}`, value: clean ? num(r.computed?.holiday_hours) : String(pv.hol) }) }), _jsx(TableCell, { className: "text-right", children: _jsx(MoneyCell, { value: extras[empId]?.reimb ?? "0", readOnly: locked, label: `reimb-${empId}`, prefix: "$", onCommit: (v) => setExtras((p) => ({ ...p, [empId]: { ...p[empId], reimb: v } })) }) }), _jsx(TableCell, { className: "text-right", children: _jsx(ComputedCell, { label: `sick-${empId}`, value: clean ? num(r.computed?.sick_safe_paid_hours) : String(pv.sick) }) })] }, empId));
                            }) })] }) }))] }));
}
