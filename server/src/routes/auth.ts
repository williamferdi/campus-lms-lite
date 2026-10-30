import { and, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SESSION_COOKIE } from "../lib/session.js";
import type { Executor } from "../db/client.js";
import { authSessions, authTokens, users } from "../db/schema.js";
import { hashPassword, passwordProblems, randomToken, sha256, verifyPassword } from "../lib/crypto.js";
import { AppError, unprocessable } from "../lib/errors.js";
import { parse, requireChanges, trimmed } from "../lib/http.js";
import { audit } from "../services/audit.js";
import { requireUser } from "../services/policy.js";
import type { AppContext } from "../types.js";

// Used to equalize timing when the email does not exist.
const DUMMY_HASH = await hashPassword("timing-equalizer-not-a-real-password-1");

const TOKEN_TTL_HOURS = { activation: 24 * 7, password_reset: 1 } as const;

export function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    sortableName: u.sortableName,
    role: u.role,
    status: u.status,
    bio: u.bio,
    timeZone: u.timeZone,
    emailNotifications: u.emailNotifications,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export function sortableNameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  const last = parts.pop()!;
  return `${last}, ${parts.join(" ")}`;
}

/** Issue a single-use token (invalidating earlier unused ones of the same kind). */
export async function issueToken(db: Executor, userId: string, kind: "activation" | "password_reset") {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)));
  const token = randomToken();
  await db.insert(authTokens).values({
    userId,
    kind,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS[kind] * 3600_000),
  });
  return token;
}

export function tokenUrl(ctx: AppContext, kind: "activation" | "password_reset", token: string) {
  const route = kind === "activation" ? "activate" : "reset-password";
  return `${ctx.config.APP_URL}/${route}?token=${encodeURIComponent(token)}`;
}

async function findValidToken(ctx: AppContext, token: string, kind?: "activation" | "password_reset") {
  const [row] = await ctx.db
    .select({ token: authTokens, user: users })
    .from(authTokens)
    .innerJoin(users, eq(users.id, authTokens.userId))
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
        kind ? eq(authTokens.kind, kind) : undefined,
      ),
    );
  return row ?? null;
}

async function startSession(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = randomToken();
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + ctx.config.SESSION_TTL_HOURS * 3600_000);
  await ctx.db.insert(authSessions).values({
    id: sha256(token),
    userId,
    csrfToken,
    expiresAt,
    ip: req.ip,
    userAgent: (req.headers["user-agent"] ?? "").slice(0, 300),
  });
  await ctx.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  // Opportunistic cleanup of expired sessions.
  await ctx.db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.config.cookieSecure,
    expires: expiresAt,
  });
  return csrfToken;
}

const passwordField = z.string().superRefine((v, c) => {
  const problem = passwordProblems(v);
  if (problem) c.addIssue({ code: "custom", message: problem });
});

export default async function authRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const authRateLimit = { config: { rateLimit: { max: ctx.config.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" } } };

  app.post("/auth/login", authRateLimit, async (req, reply) => {
    const body = parse(z.object({ email: z.string().trim().max(320), password: z.string().max(500) }), req.body);
    const [user] = await ctx.db.select().from(users).where(sql`lower(${users.email}) = ${body.email.toLowerCase()}`);
    const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new AppError(401, "invalid_credentials", "Invalid email or password.");
    if (user.status === "deactivated") throw new AppError(403, "account_deactivated", "This account has been deactivated. Contact your administrator.");
    if (user.status === "pending") throw new AppError(403, "account_pending", "This account has not been activated yet.");
    const csrfToken = await startSession(ctx, req, reply, user.id);
    return { user: publicUser(user), csrfToken };
  });

  app.post("/auth/logout", async (req, reply) => {
    if (req.authSession) await ctx.db.delete(authSessions).where(eq(authSessions.id, req.authSession.id));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (req) => {
    if (!req.user || !req.authSession) return { user: null, csrfToken: null };
    const [user] = await ctx.db.select().from(users).where(eq(users.id, req.user.id));
    return { user: user ? publicUser(user) : null, csrfToken: req.authSession.csrfToken, emailConfigured: ctx.mailer.configured };
  });

  app.patch("/auth/me", async (req) => {
    const me = requireUser(req);
    const body = parse(
      z.object({
        name: trimmed(1, 120).optional(),
        bio: z.string().max(2000).optional(),
        timeZone: z.string().max(64).refine((tz) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        }, "Unknown time zone").optional(),
        emailNotifications: z.boolean().optional(),
      }),
      req.body,
    );
    requireChanges(body);
    const [user] = await ctx.db
      .update(users)
      .set({ ...body, ...(body.name ? { sortableName: sortableNameOf(body.name) } : {}) })
      .where(eq(users.id, me.id))
      .returning();
    return { user: publicUser(user!) };
  });

  app.post("/auth/change-password", async (req) => {
    const me = requireUser(req);
    const body = parse(z.object({ currentPassword: z.string(), newPassword: passwordField }), req.body);
    const [user] = await ctx.db.select().from(users).where(eq(users.id, me.id));
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw unprocessable("Current password is incorrect.", [{ path: "currentPassword", message: "Current password is incorrect." }]);
    }
    await ctx.db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, me.id));
    // Sign out other sessions.
    await ctx.db.delete(authSessions).where(and(eq(authSessions.userId, me.id), ne(authSessions.id, req.authSession!.id)));
    await audit(ctx.db, { actorId: me.id, action: "user.password_changed", entityType: "user", entityId: me.id, ip: req.ip });
    return { ok: true };
  });

  app.get("/auth/token-info", async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.query);
    const row = await findValidToken(ctx, token);
    if (!row) return { valid: false };
    return { valid: true, kind: row.token.kind, name: row.user.name, email: row.user.email };
  });

  app.post("/auth/activate", authRateLimit, async (req, reply) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password: passwordField }), req.body);
    const row = await findValidToken(ctx, body.token, "activation");
    if (!row) throw unprocessable("This activation link is invalid or has expired. Ask your administrator for a new one.");
    if (row.user.status === "deactivated") throw new AppError(403, "account_deactivated", "This account has been deactivated.");
    await ctx.db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.token.id));
    const [user] = await ctx.db
      .update(users)
      .set({ passwordHash: await hashPassword(body.password), status: "active" })
      .where(eq(users.id, row.user.id))
      .returning();
    await audit(ctx.db, { actorId: user!.id, action: "user.activated", entityType: "user", entityId: user!.id, ip: req.ip });
    const csrfToken = await startSession(ctx, req, reply, user!.id);
    return { user: publicUser(user!), csrfToken };
  });

  app.post("/auth/forgot-password", authRateLimit, async (req) => {
    const { email } = parse(z.object({ email: z.string().trim().max(320) }), req.body);
    if (!ctx.mailer.configured) {
      return {
        ok: true,
        emailConfigured: false,
        message: "Email delivery is not configured on this server. Ask your administrator for a password reset link.",
      };
    }
    const [user] = await ctx.db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
    if (user && user.status === "active") {
      const token = await issueToken(ctx.db, user.id, "password_reset");
      await ctx.mailer.send(
        user.email,
        "Reset your Campus LMS Lite password",
        `Use this link within 1 hour to choose a new password:\n\n${tokenUrl(ctx, "password_reset", token)}\n\nIf you did not ask for this, ignore this email.`,
      );
    }
    return { ok: true, emailConfigured: true, message: "If an account exists for that email, a reset link has been sent." };
  });

  app.post("/auth/reset-password", authRateLimit, async (req) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password: passwordField }), req.body);
    const row = await findValidToken(ctx, body.token, "password_reset");
    if (!row || row.user.status !== "active") throw unprocessable("This reset link is invalid or has expired.");
    await ctx.db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.token.id));
    await ctx.db.update(users).set({ passwordHash: await hashPassword(body.password) }).where(eq(users.id, row.user.id));
    await ctx.db.delete(authSessions).where(eq(authSessions.userId, row.user.id));
    await audit(ctx.db, { actorId: row.user.id, action: "user.password_reset", entityType: "user", entityId: row.user.id, ip: req.ip });
    return { ok: true };
  });
}
