import type { Db } from "../employees/employees.service.js";

export interface MonthlyWeek {
  week_start: string; // period start (Sat)
  week_end: string; // period end (Fri)
  worked_hours: number; // full period, all 7 days, wherever they fall
  reg: number;
  ot: number;
  hol: number;
  sick: number;
  vacation: number;
  bonus: number;
  reimb: number;
}

export interface MonthlyRow {
  employee_id: number;
  name: string;
  reg: number;
  ot: number;
  hol: number;
  sick: number;
  vacation: number;
  bonus: number;
  reimb: number;
  weeks: MonthlyWeek[];
}

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isNaN(n) ? 0 : Math.round(n * 100) / 100;
};

const iso = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

const parseDay = (s: string): Date => new Date(s + "T00:00:00Z"); // work_date is a calendar day, no TZ

// Calendar day of a DB DATE value. DATE columns arrive as Date objects at
// local midnight — UTC getters would shift them a day back, so local getters
// for Dates, verbatim slice for strings.
const calOf = (v: unknown): string => {
  if (typeof v === "string") return v.slice(0, 10);
  const d = new Date(v as any);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

// Monthly report. Buckets (worked/sick/holiday/vacation) split strictly by
// work_date, so a boundary week contributes days to each month it touches.
// OT is attributed WHOLE, per pay period (Sat–Fri), to the month holding the
// majority (4+) of the period's 7 days — never pro-rated, never recomputed
// on the monthly total. Pay periods (not ISO weeks) are used deliberately:
// this company's weeks run Sat–Fri, and ISO weeks would shove Saturday hours
// into the previous ISO week, silently undercounting OT whenever Saturdays
// are worked. Reg/OT therefore always match timecard_weekly exactly.
export async function monthlyReport(db: Db, month: string): Promise<{ month: string; rows: MonthlyRow[] }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(400, "month_invalid");
  const first = parseDay(month + "-01");
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const firstS = iso(first);
  const lastS = iso(last);

  const [dayRows] = await db.query(
    `SELECT te.id AS entry_id, te.employee_id, e.full_name AS name, e.payment_method, d.work_date, d.day_type, d.hours
       FROM timecard_days d
       JOIN timecard_entries te ON te.id = d.entry_id
       JOIN employees e ON e.id = te.employee_id
      WHERE d.work_date BETWEEN ? AND ?
      ORDER BY te.employee_id, d.work_date`,
    [iso(addDays(first, -6)), iso(addDays(last, 6))]
  );
  const days = dayRows as any[];

  const empIds = [...new Set(days.map((d) => d.employee_id))];
  const compByEmp = new Map<number, any[]>();
  if (empIds.length > 0) {
    const [comps] = await db.query(
      "SELECT employee_id, effective_from, effective_to, overtime_status FROM employee_compensation WHERE employee_id IN (?) ORDER BY effective_from",
      [empIds]
    );
    for (const c of comps as any[]) {
      const list = compByEmp.get(c.employee_id) ?? [];
      list.push(c);
      compByEmp.set(c.employee_id, list);
    }
  }

  const [thrRows] = await db.query(
    "SELECT value, effective_from FROM wage_rules WHERE rule_key='ot_threshold_hours' ORDER BY effective_from DESC"
  );
  const thresholds = (thrRows as any[]).map((r) => ({ value: Number(r.value), from: calOf(r.effective_from) }));
  const thresholdAt = (dateS: string): number => {
    const hit = thresholds.find((t) => t.from <= dateS);
    return hit ? hit.value : 40;
  };

  // All entries (with their periods) for involved employees: OT is computed
  // per pay period from its FULL 7 days, then attributed by majority month.
  const [entryRows] = await db.query(
    `SELECT te.id AS entry_id, te.employee_id, te.bonus_amount, te.reimb_amount, p.start_date, p.end_date
       FROM timecard_entries te
       JOIN pay_periods p ON p.id = te.pay_period_id
      WHERE te.employee_id IN (?)`,
    [empIds.length > 0 ? empIds : [0]]
  );

  const [bonusRows] = await db.query(
    `SELECT te.employee_id, e.full_name AS name, e.payment_method,
            COALESCE(SUM(te.bonus_amount), 0) AS bonus,
            COALESCE(SUM(te.reimb_amount), 0) AS reimb
       FROM timecard_entries te
       JOIN pay_periods p ON p.id = te.pay_period_id
       JOIN employees e ON e.id = te.employee_id
      WHERE p.start_date <= ? AND p.end_date >= ?
      GROUP BY te.employee_id, e.full_name, e.payment_method`,
    [lastS, firstS]
  );
  const bonusByEmp = new Map<number, { bonus: number; reimb: number }>();
  for (const b of bonusRows as any[])
    bonusByEmp.set(b.employee_id, { bonus: num(b.bonus), reimb: num(b.reimb) });

  interface Agg {
    id: number;
    name: string;
    cash: boolean;
    worked: number;
    sick: number;
    hol: number;
    vac: number;
    reg: number;
    ot: number;
    weeks: MonthlyWeek[];
  }
  const agg = new Map<number, Agg>();
  const daysByEntry = new Map<number, any[]>();

  for (const d of days) {
    const wd = calOf(d.work_date);
    const a = agg.get(d.employee_id) ?? { id: d.employee_id, name: d.name, cash: d.payment_method === "CASH", worked: 0, sick: 0, hol: 0, vac: 0, reg: 0, ot: 0, weeks: [] };
    if (wd >= firstS && wd <= lastS) {
      const h = Number(d.hours);
      if (d.day_type === "WORK" || d.day_type === "HOLIDAY_WORKED") a.worked += h;
      else if (d.day_type === "SICK_SAFE_PAID") a.sick += h;
      else if (d.day_type === "HOLIDAY") a.hol += h;
      else if (d.day_type === "VACATION") a.vac += h;
    }
    agg.set(d.employee_id, a);
    const list = daysByEntry.get(d.entry_id) ?? [];
    list.push(d);
    daysByEntry.set(d.entry_id, list);
  }

  // Bonus-only employees (overlapping entry, no days in range) still appear.
  for (const b of bonusRows as any[]) {
    if (!agg.has(b.employee_id) && (Number(b.bonus) > 0 || Number(b.reimb) > 0)) {
      agg.set(b.employee_id, {
        id: b.employee_id, name: b.name, cash: b.payment_method === "CASH", worked: 0, sick: 0, hol: 0, vac: 0, reg: 0, ot: 0, weeks: [],
      });
    }
  }

  const eligibility = (emp: number, endS: string): boolean => {
    const rows = compByEmp.get(emp) ?? [];
    let status: string | null = null;
    for (const c of rows) {
      const from = calOf(c.effective_from);
      const to = c.effective_to ? calOf(c.effective_to) : null;
      if (from <= endS && (to === null || to >= endS)) status = c.overtime_status;
    }
    if (status) return status === "NON_EXEMPT";
    return true; // no comp row: timecard_weekly also treats this as eligible
  };

  // OT per pay period (full 7 days), attributed by majority month. Matches
  // timecard_weekly exactly — same eligibility date, same threshold date.
  for (const en of entryRows as any[]) {
    const startS = calOf(en.start_date);
    const endS = calOf(en.end_date);
    let inMonth = 0;
    for (let i = 0; i < 7; i++) {
      const s = iso(addDays(parseDay(startS), i));
      if (s >= firstS && s <= lastS) inMonth += 1;
    }
    if (inMonth < 4) continue; // period belongs to the other month
    let worked = 0, hol = 0, sick = 0, vac = 0;
    for (const d of daysByEntry.get(en.entry_id) ?? []) {
      const h = Number(d.hours);
      if (d.day_type === "WORK" || d.day_type === "HOLIDAY_WORKED") worked += h;
      else if (d.day_type === "SICK_SAFE_PAID") sick += h;
      else if (d.day_type === "HOLIDAY") hol += h;
      else if (d.day_type === "VACATION") vac += h;
    }
    const elig = eligibility(en.employee_id, endS);
    const thr = thresholdAt(endS);
    const ot = elig ? Math.max(worked - thr, 0) : 0;
    const reg = elig ? Math.min(worked, thr) : worked;
    const a = agg.get(en.employee_id);
    if (!a) continue;
    a.reg += reg;
    a.ot += ot;
    a.weeks.push({ week_start: startS, week_end: endS, worked_hours: num(worked), reg: num(reg), ot: num(ot),
      hol: num(hol), sick: num(sick), vacation: num(vac), bonus: num(en.bonus_amount), reimb: num(en.reimb_amount) });
  }

  return {
    month,
    rows: [...agg.values()]
      .filter((a) => {
        const b = bonusByEmp.get(a.id);
        return a.worked + a.sick + a.hol + a.vac + a.reg + a.ot + (b?.bonus ?? 0) + (b?.reimb ?? 0) > 0;
      })
      .map((a) => {
        const b = bonusByEmp.get(a.id) ?? { bonus: 0, reimb: 0 };
        return {
          employee_id: a.id,
          name: a.name,
          cash: a.cash,
          reg: num(a.reg),
          ot: num(a.ot),
          hol: num(a.hol),
          sick: num(a.sick),
          vacation: num(a.vac),
          bonus: b.bonus,
          reimb: b.reimb,
          weeks: a.weeks.sort((x, y) => (x.week_start < y.week_start ? -1 : 1)),
        };
      })
      .sort((x, y) => x.name.localeCompare(y.name)),
  };
}
