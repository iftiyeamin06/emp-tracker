// PAY-PERIOD STATE MACHINE (server-side single source of truth).
// Routes must call assertTransition() and reject anything else — clients can
// never PATCH status directly. Every transition is audited by the caller.
export type PeriodStatus = "OPEN" | "SUBMITTED" | "RETURNED" | "APPROVED";
export type Role = "ADMIN" | "OWNER";

interface Rule {
  roles: Role[];
  reason: boolean; // reason mandatory
}

const RULES: Record<PeriodStatus, Partial<Record<PeriodStatus, Rule>>> = {
  OPEN: { SUBMITTED: { roles: ["ADMIN"], reason: false } },
  SUBMITTED: {
    APPROVED: { roles: ["OWNER"], reason: false },
    RETURNED: { roles: ["OWNER"], reason: true },
  },
  // Admin fixes a returned period while RETURNED, then moves it back to OPEN
  // (reason recorded); only the Owner reopens APPROVED periods.
  RETURNED: { OPEN: { roles: ["ADMIN", "OWNER"], reason: true } },
  APPROVED: { OPEN: { roles: ["OWNER"], reason: true } },
};

export function assertTransition(
  from: PeriodStatus,
  to: PeriodStatus,
  role: Role,
  reason?: string
): void {
  const rule = RULES[from]?.[to];
  if (!rule) throw Object.assign(new Error(`transition_${from}_to_${to}_not_allowed`), { status: 422 });
  if (!rule.roles.includes(role))
    throw Object.assign(new Error(`role_${role}_cannot_move_${from}_to_${to}`), { status: 403 });
  if (rule.reason && !reason?.trim())
    throw Object.assign(new Error("transition_reason_required"), { status: 422 });
}
