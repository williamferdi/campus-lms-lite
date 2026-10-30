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
  // S3-compatible object storage. Set all four, or leave all empty to use FILE_STORAGE_DIR.
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Campus LMS Lite <no-reply@localhost>"),
  WEB_DIST_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export type Config = z.infer<typeof EnvSchema> & { cookieSecure: boolean; s3: S3Config | null };

function loadS3(c: z.infer<typeof EnvSchema>): S3Config | null {
  const { S3_ENDPOINT: endpoint, S3_BUCKET: bucket, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = c;
  if (!endpoint && !bucket && !accessKeyId && !secretAccessKey) return null;
  // A partial setup must stop the server: falling back to local disk would silently lose uploads on hosts with temporary disks.
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Invalid environment configuration: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must all be set together");
  }
  if (!z.url().safeParse(endpoint).success) throw new Error("Invalid environment configuration: S3_ENDPOINT must be a URL");
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: c.S3_REGION };
}

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
    s3: loadS3(c),
  };
}
