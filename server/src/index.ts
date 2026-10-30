import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { releaseDueTopics } from "./routes/discussions.js";
import { expireStaleAttempts } from "./routes/quizzes.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);

// Apply pending migrations on boot so the schema always matches the code.
await database.migrate();

const app = await buildApp({ config, db: database.db });

// Time-based work: release delayed announcements and auto-submit expired quiz attempts.
// Both are also done lazily on read, so a missed tick never produces wrong results.
const ticker = setInterval(() => {
  void (async () => {
    try {
      await releaseDueTopics(app.ctx);
      await expireStaleAttempts(app.ctx);
    } catch (err) {
      app.log.error({ err }, "background tick failed");
    }
  })();
}, 60_000);
ticker.unref();

const shutdown = async (signal: string) => {
  clearInterval(ticker);
  app.log.info({ signal }, "shutting down");
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
app.log.info(
  { db: database.kind, email: app.ctx.mailer.configured ? "smtp" : "not configured" },
  "Campus LMS Lite API ready",
);
