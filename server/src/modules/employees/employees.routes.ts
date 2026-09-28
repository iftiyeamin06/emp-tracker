import { Router } from "express";
import { pool } from "../../db/pool.js";
import { writeAudit } from "../../lib/audit.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/role.js";
import { createEmployee, listEmployees } from "./employees.service.js";

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
