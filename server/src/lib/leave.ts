// LEAVE POLICY MATH (pure helpers; balances themselves come from leave_balances).
export function frontloadedBalance(grants: number[], usages: number[]): number {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return sum(grants) - sum(usages);
}

export function accruedByHours(hoursWorked: number, ratePerHour: number): number {
  return hoursWorked * ratePerHour; // e.g. 1/30 for NYC sick accrual
}

export function isOverdrawn(balance: number, requestedUsage: number): boolean {
  return requestedUsage > balance;
}

export function adjustmentRequiresReason(entryType: string): boolean {
  return entryType === "ADJUSTMENT";
}
