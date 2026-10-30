import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createDatabase } from "./client.js";
import { seed } from "./seed.js";

const config = loadConfig();
if (config.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=true only for a disposable demo environment.");
  process.exit(1);
}
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 10) {
  console.error("Set SEED_PASSWORD (at least 10 characters, with a letter and a number) — it becomes the password of every demo account.");
  process.exit(1);
}

const database = createDatabase(config.DATABASE_URL);
await database.migrate();
// Seeding runs through the API; relax the login rate limit for this process only.
const app = await buildApp({ config: { ...config, AUTH_RATE_LIMIT_PER_MINUTE: 10_000 }, db: database.db, logger: false });
try {
  const result = await seed(app, database.db, password);
  console.log("Demo accounts (all use SEED_PASSWORD):");
  for (const [role, email] of Object.entries(result.emails)) console.log(`  ${role.padEnd(8)} ${email}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await app.close();
  await database.close();
}
