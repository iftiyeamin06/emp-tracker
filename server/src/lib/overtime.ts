// OVERTIME RULE (V1), in plain code so it is testable and explainable.
// Canonical for READS is the timecard_weekly view; this mirror is used by the
// API for validation/preview and by tests. If the two ever disagree, the view
// wins and this file must be updated to match.
export interface OTInput {
  workedHours: number; // WORK + HOLIDAY_WORKED only; leave never included
  eligible: boolean; // overtime_status === 'NON_EXEMPT' as of the period end date
  threshold?: number; // default 40; resolved from wage_rules in production
  overrideHours?: number;
  overrideReason?: string;
}

export interface OTResult {
  reg: number;
  ot: number;
  overridden: boolean;
}

export function calcOvertime(i: OTInput): OTResult {
  const threshold = i.threshold ?? 40;
  if (i.overrideHours != null) {
    if (!i.overrideReason?.trim()) throw Object.assign(new Error("override_reason_required"), { status: 422 });
    return { reg: Math.min(i.workedHours, threshold), ot: i.overrideHours, overridden: true };
  }
  if (!i.eligible) return { reg: i.workedHours, ot: 0, overridden: false };
  return {
    reg: Math.min(i.workedHours, threshold),
    ot: Math.max(i.workedHours - threshold, 0),
    overridden: false,
  };
}
