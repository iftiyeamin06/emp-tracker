import "dotenv/config";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";

const port = Number(process.env.PORT ?? 5000);
createApp().listen(port, () => logger.info(`API listening on http://localhost:${port}`));
