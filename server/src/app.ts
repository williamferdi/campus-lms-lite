import { existsSync } from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { and, eq, gt } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { authSessions, users } from "./db/schema.js";
import { sha256 } from "./lib/crypto.js";
import { AppError } from "./lib/errors.js";
import { registerRoutes } from "./routes/index.js";
import { createMailer, type Mailer } from "./services/mail.js";
import { LocalDiskStorage, type FileStorage } from "./services/storage.js";
import "./types.js";

import { SESSION_COOKIE } from "./lib/session.js";
export { SESSION_COOKIE };
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface BuildOptions {
  config: Config;
  db: Db;
  storage?: FileStorage;
  mailer?: Mailer;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { config } = opts;
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.decorate("ctx", {
    db: opts.db,
    config,
    storage: opts.storage ?? new LocalDiskStorage(config.FILE_STORAGE_DIR),
    mailer: opts.mailer ?? createMailer(config, app.log),
  });
  app.decorateRequest("user", null);
  app.decorateRequest("authSession", null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        mediaSrc: ["'self'"],
        frameSrc: ["https://www.youtube-nocookie.com", "https://www.youtube.com", "https://player.vimeo.com"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 10, fields: 20 },
  });

  // ---- session + CSRF
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const [row] = await opts.db
        .select({
          sessionId: authSessions.id,
          csrfToken: authSessions.csrfToken,
          id: users.id,
          orgId: users.orgId,
          email: users.email,
          name: users.name,
          role: users.role,
        })
        .from(authSessions)
        .innerJoin(users, eq(users.id, authSessions.userId))
        .where(
          and(
            eq(authSessions.id, sha256(token)),
            gt(authSessions.expiresAt, new Date()),
            eq(users.status, "active"),
          ),
        );
      if (row) {
        req.user = { id: row.id, orgId: row.orgId, email: row.email, name: row.name, role: row.role };
        req.authSession = { id: row.sessionId, csrfToken: row.csrfToken };
      }
    }
    if (req.authSession && !SAFE_METHODS.has(req.method) && req.url.startsWith("/api/")) {
      if (req.headers["x-csrf-token"] !== req.authSession.csrfToken) {
        throw new AppError(403, "csrf_failed", "Your session security token is missing or expired. Reload the page and try again.");
      }
    }
  });

  // ---- errors: consistent envelope, no internals leaked
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { code?: string; statusCode?: number; message: string; validation?: unknown };
    if (e.code === "FST_REQ_FILE_TOO_LARGE" || e.code === "FST_FILES_LIMIT") {
      return reply.status(413).send({
        error: { code: "file_too_large", message: `Files must be ${config.MAX_UPLOAD_MB} MB or smaller.` },
      });
    }
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: { code: "rate_limited", message: "Too many attempts. Please wait a minute and try again." } });
    }
    if (e.validation || (e.statusCode && e.statusCode >= 400 && e.statusCode < 500)) {
      return reply.status(e.statusCode ?? 400).send({ error: { code: "bad_request", message: e.message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal_error", message: "Something went wrong. Please try again." } });
  });

  app.get("/healthz", async () => ({ ok: true }));
  await app.register(registerRoutes, { prefix: "/api/v1" });

  // ---- SPA (production): serve the built web app with client-side routing fallback
  const webDist = path.resolve(config.WEB_DIST_DIR ?? path.join(process.cwd(), "../web/dist"));
  const serveSpa = config.NODE_ENV !== "test" && existsSync(path.join(webDist, "index.html"));
  if (serveSpa) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, index: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (serveSpa && req.method === "GET" && !req.url.startsWith("/api/")) {
      return reply.type("text/html").sendFile("index.html");
    }
    return reply.status(404).send({ error: { code: "not_found", message: "Route not found." } });
  });

  return app;
}
