// Paper-card cell values: either a v1 code or plain hours.
// v1 speaks 5 codes; the API may return wider DB values, which pass through.
const PREFIX = {
    WORK: "",
    HOLIDAY: "H",
    SICK_SAFE_PAID: "S",
    VACATION: "V",
    PROTECTED_UNPAID: "SU",
    PRENATAL: "P",
    HOLIDAY_WORKED: "HW",
    // The API returns v1 wire names for these mapped DB values.
    SICK: "S",
    HW8: "HW",
};
const TO_DB = { H8: "HOLIDAY", S8: "SICK", V8: "VACATION", HW8: "HOLIDAY_WORKED" };
// Display an API day row as a cell string. WORK days show raw hours ("9"),
// coded types show their prefix ("H8"); 0-hour rows show empty.
export function formatDay(dayType, hours) {
    const h = Number(hours ?? 0);
    if (!dayType || Number.isNaN(h) || h === 0)
        return "";
    if (dayType === "WORK")
        return String(Math.round(h * 100) / 100);
    return `${PREFIX[dayType] ?? "?"}${Math.round(h * 100) / 100}`;
}
// Parse what the user typed. Returns null when invalid (caller reverts).
// Accepts: "" (clear), "8"/"H8"/"S8"/"V8"/"HW8" (case-insensitive, = 8h),
// or any number 0–24 (= WORK with those hours).
export function parseCell(input) {
    const t = input.trim().toUpperCase();
    if (t === "")
        return { day_type: "WORK", hours: 0 };
    if (t === "8")
        return { day_type: "WORK", hours: 8 };
    if (TO_DB[t] !== undefined)
        return { day_type: TO_DB[t], hours: 8 };
    if (/^\d{1,2}(\.\d{1,2})?$/.test(t)) {
        const h = Number(t);
        if (h >= 0 && h <= 24)
            return { day_type: "WORK", hours: h };
    }
    return null;
}
// Hours a cell contributes to WORKED. HOLIDAY_WORKED counts as worked (v1:
// no premium, no comp day — regular hours toward the OT threshold).
export function workedHoursOf(cell) {
    const p = parseCell(cell);
    if (!p || (p.day_type !== "WORK" && p.day_type !== "HOLIDAY_WORKED"))
        return 0;
    return p.hours;
}
// Hours a cell contributes to a leave bucket (0 unless it is that bucket).
export function leaveHoursOf(cell, bucket) {
    if (cell.trim().toUpperCase() === bucket)
        return 8;
    return 0;
}
