/**
 * Boots an isolated production-mode server for end-to-end tests:
 * fresh in-memory database, migrations, development seed, built SPA served by Fastify.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../server/src/app.js";
import { loadConfig } from "../server/src/config.js";
import { createDatabase } from "../server/src/db/client.js";
import { seed } from "../server/src/db/seed.js";
import { MemoryStorage } from "../server/src/services/storage.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT ?? 4173);
export const E2E_PASSWORD = "E2e-Password-2026";

const config = loadConfig({
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  PORT: String(PORT),
  DATABASE_URL: "pglite:memory",
  APP_URL: `http://127.0.0.1:${PORT}`,
  WEB_DIST_DIR: path.join(root, "../web/dist"),
  LOG_LEVEL: "warn",
  AUTH_RATE_LIMIT_PER_MINUTE: "10000",
});
const database = createDatabase(config.DATABASE_URL);
await database.migrate();
const app = await buildApp({ config, db: database.db, storage: new MemoryStorage() });
await seed(app, database.db, process.env.E2E_SEED_PASSWORD ?? E2E_PASSWORD, () => {});
await app.listen({ host: config.HOST, port: PORT });
console.log(`E2E server ready on ${PORT}`);
