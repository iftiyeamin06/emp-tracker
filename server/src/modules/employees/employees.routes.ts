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

// POST inserts employees + employee_compensation + 2 audit rows in ONE
// transaction (hard rules 1 and 3). Admin only.
employeeRoutes.post("/", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const actor = req.session.user!.id;
    const ip = req.ip;
    const { employee, compensation } = await createEmployee(conn, req.body);
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
