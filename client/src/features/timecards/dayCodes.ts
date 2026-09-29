// Paper-card cell values: either a v1 code or plain hours.
// v1 speaks 5 codes; the API may return wider DB values, which pass through.
const PREFIX: Record<string, string> = {
  WORK: "",
  HOLIDAY: "H",
  SICK_SAFE_PAID: "S",
  VACATION: "V",
  PROTECTED_UNPAID: "SU",
  PRENATAL: "P",
  HOLIDAY_WORKED: "HW",
};

const TO_DB: Record<string, string> = { H8: "HOLIDAY", S8: "SICK", V8: "VACATION", HW8: "HOLIDAY_WORKED" };

export interface ParsedCell {
  day_type: string; // v1 wire code: WORK | HOLIDAY | SICK | VACATION | HOLIDAY_WORKED
  hours: number;
}

// Display an API day row as a cell string. WORK days show raw hours ("9"),
// coded types show their prefix ("H8"); 0-hour rows show empty.
export function formatDay(dayType: unknown, hours: unknown): string {
  const h = Number(hours ?? 0);
  if (!dayType || Number.isNaN(h) || h === 0) return "";
  if (dayType === "WORK") return String(Math.round(h * 100) / 100);
  return `${PREFIX[dayType as string] ?? "?"}${Math.round(h * 100) / 100}`;
}

// Parse what the user typed. Returns null when invalid (caller reverts).
// Accepts: "" (clear), "8"/"H8"/"S8"/"V8"/"HW8" (case-insensitive, = 8h),
// or any number 0–24 (= WORK with those hours).
export function parseCell(input: string): ParsedCell | null {
  const t = input.trim().toUpperCase();
  if (t === "") return { day_type: "WORK", hours: 0 };
  if (t === "8") return { day_type: "WORK", hours: 8 };
  if (TO_DB[t] !== undefined) return { day_type: TO_DB[t], hours: 8 };
  if (/^\d{1,2}(\.\d{1,2})?$/.test(t)) {
    const h = Number(t);
    if (h >= 0 && h <= 24) return { day_type: "WORK", hours: h };
  }
  return null;
}

// Hours a cell contributes to WORKED. HOLIDAY_WORKED counts as worked (v1:
// no premium, no comp day — regular hours toward the OT threshold).
export function workedHoursOf(cell: string): number {
  const p = parseCell(cell);
  if (!p || (p.day_type !== "WORK" && p.day_type !== "HOLIDAY_WORKED")) return 0;
  return p.hours;
}

// Hours a cell contributes to a leave bucket (0 unless it is that bucket).
export function leaveHoursOf(cell: string, bucket: "H8" | "S8" | "V8"): number {
  if (cell.trim().toUpperCase() === bucket) return 8;
  return 0;
}
