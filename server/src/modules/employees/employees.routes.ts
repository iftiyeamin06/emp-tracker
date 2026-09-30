import { Router } from "express";
import { pool } from "../../db/pool.js";
import { writeAudit } from "../../lib/audit.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/role.js";
import { createEmployee, deleteEmployee, listEmployees, setTermination } from "./employees.service.js";

export const employeeRoutes = Router();

employeeRoutes.get("/", requireAuth, async (_req, res, next) => {
  try {
    const data = await listEmployees(pool);
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

// POST inserts employees + employee_compensation + sick frontload + 2 audit
// rows in ONE transaction (hard rules 1 and 3). Admin only.
employeeRoutes.post("/", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const actor = req.session.user!.id;
    const ip = req.ip;
    const { employee, compensation, accrualId } = await createEmployee(conn, req.body, actor);
    await writeAudit(conn, {
      actorUserId: actor,
      action: "employee.create",
      entityTable: "employees",
      entityId: employee.id as number,
      after: employee,
      ip,
    });
    await writeAudit(conn, {
      actorUserId: actor,
      action: "compensation.create",
      entityTable: "employee_compensation",
      entityId: compensation.id as number,
      after: compensation,
      ip,
    });
    await writeAudit(conn, {
      actorUserId: actor,
      action: "leave.create",
      entityTable: "leave_ledger",
      entityId: accrualId,
      after: { employee_id: employee.id, leave_type: "SICK_SAFE_PAID", entry_type: "accrual", hours: 40 },
      ip,
    });
    await conn.commit();
    res.status(201).json({ data: { employee, compensation } });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

// Terminate (date) or rehire (null). Admin only. No hard deletes, ever:
// the row stays, history stays, only future visibility changes.
employeeRoutes.put("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "employee_id_invalid" });
    const { termination_date = null } = req.body ?? {};
    await conn.beginTransaction();
    const [[before]] = (await conn.query("SELECT * FROM employees WHERE id = ? LIMIT 1", [id])) as any[];
    const employee = await setTermination(conn, id, termination_date);
    await writeAudit(conn, {
      actorUserId: req.session.user!.id,
      action: termination_date == null ? "employee.rehire" : "employee.terminate",
      entityTable: "employees",
      entityId: id,
      before,
      after: employee,
      ip: req.ip,
    });
    await conn.commit();
    res.json({ data: { employee } });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

// Permanent delete, admin only. Allowed ONLY with zero business history
// (service checks + FK RESTRICT backstop); otherwise 409 directing to
// terminate. The deletion is audited before commit.
employeeRoutes.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "employee_id_invalid" });
    await conn.beginTransaction();
    const { employee, compensations } = await deleteEmployee(conn, id);
    await writeAudit(conn, {
      actorUserId: req.session.user!.id,
      action: "employee.delete",
      entityTable: "employees",
      entityId: id,
      before: { employee, compensations },
      ip: req.ip,
    });
    await conn.commit();
    res.json({ data: { deleted: id } });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
});

// Leave balances + ledger for one employee. Balances come from the
// leave_balances view; dates are ledger created_at (the ledger carries no
// per-date column by design — usage rows are keyed by pay_period_id).
employeeRoutes.get("/:id/leave", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "employee_id_invalid" });
    const [ex] = await pool.query("SELECT id FROM employees WHERE id = ? LIMIT 1", [id]);
    if ((ex as any[]).length === 0) return res.status(404).json({ error: "employee_not_found" });
    const [bal] = await pool.query("SELECT leave_type, balance_hours FROM leave_balances WHERE employee_id = ?", [id]);
    const [rows] = await pool.query(
      `SELECT DATE(created_at) AS date, leave_type, entry_type, hours, reason AS note
         FROM leave_ledger WHERE employee_id = ? ORDER BY created_at, id`,
      [id]
    );
    const balances: Record<string, number> = {};
    for (const b of bal as any[]) balances[b.leave_type] = Number(b.balance_hours);
    res.json({ data: { balances, ledger: rows } });
  } catch (e) {
    next(e);
  }
});
