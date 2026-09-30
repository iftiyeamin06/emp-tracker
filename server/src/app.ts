import cors from "cors";
import express from "express";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import { connectionOptions } from "./db/pool.js";
import { errorHandler } from "./middleware/error.js";
import { authRoutes, health } from "./modules/auth/auth.routes.js";
import { employeeRoutes } from "./modules/employees/employees.routes.js";
import { payPeriodRoutes } from "./modules/pay-periods/payPeriods.routes.js";
import { reportRoutes } from "./modules/reports/reports.routes.js";
import { timecardRoutes } from "./modules/timecards/timecards.routes.js";

export function createApp() {
  const secret = process.env.SESSION_SECRET ?? "";
  if (!secret) throw new Error("SESSION_SECRET is required");
  if (secret === "change-me") console.warn("[warn] SESSION_SECRET is still the default value");

  const app = express();
  app.use(cors());
  app.use(express.json());

  const MySQLStore = MySQLStoreFactory(session);
  const sessionStore = new MySQLStore(connectionOptions());
  app.locals.sessionStore = sessionStore; // teardown hook for tests
  app.use(
    session({
      name: "et.sid",
      secret,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.COOKIE_SECURE === "1", // set 1 when serving over HTTPS
        maxAge: 12 * 60 * 60 * 1000,
      },
    })
  );

  app.use("/api/health", health);
  app.use("/api/auth", authRoutes);
  app.use("/api/employees", employeeRoutes);
  app.use("/api/pay-periods", payPeriodRoutes);
  app.use("/api/reports", reportRoutes);
  app.use("/api/timecards", timecardRoutes);
  app.use(errorHandler);
  return app;
}
