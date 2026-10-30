import path from "node:path";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  // postgres://user:pass@host:5432/db  |  pglite:./data/pglite  |  pglite:memory
  DATABASE_URL: z.string().default("pglite:./data/pglite"),
  APP_URL: z.string().url().default("http://localhost:5173"),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: bool.default(false),
  FILE_STORAGE_DIR: z.string().default("./data/uploads"),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(512).default(25),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Campus LMS Lite <no-reply@localhost>"),
  WEB_DIST_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = z.infer<typeof EnvSchema> & { cookieSecure: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    FILE_STORAGE_DIR: path.resolve(c.FILE_STORAGE_DIR),
    cookieSecure: c.COOKIE_SECURE ?? c.NODE_ENV === "production",
  };
}
