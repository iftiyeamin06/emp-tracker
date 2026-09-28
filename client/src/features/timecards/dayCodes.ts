// Paper-card code formatting for day cells (Stage A: display only).
// v1 speaks 4 codes; the API may return wider DB values, which pass through.
const PREFIX: Record<string, string> = {
  WORK: "",
  HOLIDAY: "H",
  SICK_SAFE_PAID: "S",
  VACATION: "V",
  PROTECTED_UNPAID: "SU",
  PRENATAL: "P",
  HOLIDAY_WORKED: "HW",
};

export function formatDay(dayType: unknown, hours: unknown): string {
  const h = Number(hours ?? 0);
  if (!dayType || Number.isNaN(h) || h === 0) return "";
  const hoursStr = String(Math.round(h * 100) / 100);
  if (dayType === "WORK") return hoursStr;
  return `${PREFIX[dayType as string] ?? "?"}${hoursStr}`;
}
