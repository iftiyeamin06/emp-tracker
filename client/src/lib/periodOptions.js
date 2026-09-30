// Single day, e.g. "Nov 06, 2026" (UTC math on a calendar string).
export function fmtDay(v) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = new Date(String(v).slice(0, 10) + "T00:00:00Z");
    return `${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}, ${d.getUTCFullYear()}`;
}
// Short month-day range, e.g. "Oct 31 – Nov 06, 2026" (UTC math on calendar strings).
export function fmtRange(start, end) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = (v) => new Date(String(v).slice(0, 10) + "T00:00:00Z");
    const a = d(start);
    const b = d(end);
    const p2 = (n) => String(n).padStart(2, "0");
    return `${months[a.getUTCMonth()]} ${p2(a.getUTCDate())} – ${months[b.getUTCMonth()]} ${p2(b.getUTCDate())}, ${b.getUTCFullYear()}`;
}
export function availableYears(periods) {
    return [...new Set(periods.map((p) => p.start.slice(0, 4)))].sort().reverse();
}
export function defaultYear(periods, todayYmd) {
    const years = availableYears(periods);
    if (years.length === 0)
        return null;
    const current = todayYmd.slice(0, 4);
    return years.includes(current) ? current : years[0];
}
export function filterPeriods(periods, filter) {
    return periods.filter((p) => p.start.slice(0, 4) === filter.year && (filter.includeArchived || p.status !== "APPROVED"));
}
export function groupPeriods(periods, todayYmd) {
    const g = { current: [], open: [], approved: [] };
    const opt = (id, label) => ({ id, label });
    for (const p of periods) {
        if (p.status === "APPROVED") {
            g.approved.push(opt(p.id, `🟢 ${fmtRange(p.start, p.end)} — Approved`));
        }
        else if (p.status === "OPEN" && p.start <= todayYmd && todayYmd <= p.end) {
            g.current.push(opt(p.id, `🟡 ${fmtRange(p.start, p.end)} — Current Week`));
        }
        else if (p.status === "SUBMITTED") {
            g.open.push(opt(p.id, `🔵 ${fmtRange(p.start, p.end)} — Submitted`));
        }
        else {
            g.open.push(opt(p.id, `🟡 ${fmtRange(p.start, p.end)} — Open`));
        }
    }
    return g;
}
