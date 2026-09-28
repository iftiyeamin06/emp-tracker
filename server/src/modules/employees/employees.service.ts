// Db/Tx above are structural; mysql2 Pool and PoolConnection both satisfy them.

// Reads and single-entity writes take any query-capable handle (pool for
// reads, transaction connection for writes). Routes pass a transaction conn
// so the audit rows commit atomically with the change.
export interface Db {
  query: (sql: string, params?: unknown[]) => Promise<[any[], unknown]>;
}
export type Tx = Db;

export interface CompensationInput {
  pay_type: "HOURLY" | "SALARY";
  rate: number;
  overtime_status: "NON_EXEMPT" | "EXEMPT" | "REVIEW";
  effective_from?: string; // defaults to hire_date
  pay_frequency?: "WEEKLY" | "BIWEEKLY" | "MONTHLY";
  classification?: string;
  basis_note?: string;
}

export interface EmployeeInput {
  employee_number: string;
  full_name: string;
  hire_date: string; // YYYY-MM-DD
  termination_date?: string;
  payment_method?: "CHECK" | "DIRECT_DEPOSIT" | "CASH";
  pay_notice_signed_on?: string;
  compensation: CompensationInput; // required: hard rule 3, never bare employees
}

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function validate(e: EmployeeInput): void {
  if (!e || typeof e !== "object") fail(400, "employee_required");
  if (!e.employee_number?.trim()) fail(400, "employee_number_required");
  if (!e.full_name?.trim()) fail(400, "full_name_required");
  if (!isDate(e.hire_date)) fail(400, "hire_date_invalid");
  if (e.termination_date !== undefined && !isDate(e.termination_date)) fail(400, "termination_date_invalid");
  if (e.termination_date && e.termination_date < e.hire_date) fail(400, "termination_before_hire");
  if (e.payment_method !== undefined && !["CHECK", "DIRECT_DEPOSIT", "CASH"].includes(e.payment_method))
    fail(400, "payment_method_invalid");
  if (e.pay_notice_signed_on !== undefined && !isDate(e.pay_notice_signed_on))
    fail(400, "pay_notice_date_invalid");
  const c = e.compensation;
  if (!c || typeof c !== "object") fail(400, "compensation_required");
  if (!["HOURLY", "SALARY"].includes(c.pay_type)) fail(400, "pay_type_invalid");
  if (typeof c.rate !== "number" || Number.isNaN(c.rate) || c.rate < 0) fail(400, "rate_invalid");
  if (!["NON_EXEMPT", "EXEMPT", "REVIEW"].includes(c.overtime_status)) fail(400, "overtime_status_invalid");
  if (c.effective_from !== undefined && !isDate(c.effective_from)) fail(400, "effective_from_invalid");
  if (c.pay_frequency !== undefined && !["WEEKLY", "BIWEEKLY", "MONTHLY"].includes(c.pay_frequency))
    fail(400, "pay_frequency_invalid");
}

export interface CreatedEmployee {
  employee: Record<string, unknown>;
  compensation: Record<string, unknown>;
}

export async function listEmployees(db: Db): Promise<Record<string, unknown>[]> {
  const [rows] = await db.query(
    `SELECT id, employee_number, full_name, payment_method, pay_notice_signed_on,
            hire_date, termination_date, created_at
       FROM employees ORDER BY full_name, id`
  );
  return rows as Record<string, unknown>[];
}

// Inserts employee + initial compensation. Caller owns the transaction and the
// audit writes (both must commit atomically — hard rules 1 and 3).
export async function createEmployee(conn: Tx, e: EmployeeInput): Promise<CreatedEmployee> {
  validate(e);
  let employeeId: number;
  try {
    const [r] = await conn.query(
      `INSERT INTO employees
         (employee_number, full_name, hire_date, termination_date, payment_method, pay_notice_signed_on)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        e.employee_number.trim(),
        e.full_name.trim(),
        e.hire_date,
        e.termination_date ?? null,
        e.payment_method ?? "DIRECT_DEPOSIT",
        e.pay_notice_signed_on ?? null,
      ]
    );
    employeeId = (r as any).insertId;
  } catch (err: any) {
    if (err?.errno === 1062) fail(409, "employee_number_taken");
    throw err;
  }
  const c = e.compensation;
  const [rc] = await conn.query(
    `INSERT INTO employee_compensation
       (employee_id, effective_from, pay_type, rate, overtime_status, pay_frequency, classification, basis_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      employeeId!,
      c.effective_from ?? e.hire_date,
      c.pay_type,
      c.rate,
      c.overtime_status,
      c.pay_frequency ?? null,
      c.classification ?? null,
      c.basis_note ?? null,
    ]
  );
  const compId = (rc as any).insertId;
  const [[employee]] = (await conn.query("SELECT * FROM employees WHERE id = ?", [employeeId!])) as any[];
  const [[compensation]] = (await conn.query("SELECT * FROM employee_compensation WHERE id = ?", [compId])) as any[];
  return { employee: employee as Record<string, unknown>, compensation: compensation as Record<string, unknown> };
}
