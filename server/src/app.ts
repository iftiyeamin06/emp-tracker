import cors from "cors";
import express from "express";
import { health } from "./modules/auth/auth.routes.js";
import { errorHandler } from "./middleware/error.js";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/health", health);
  app.use(errorHandler);
  return app;
}
