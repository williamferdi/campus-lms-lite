import { and, asc, count, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authSessions, courses, enrollments, users } from "../db/schema.js";
import { parseCsvObjects } from "../domain/csv.js";
import { hashPassword, passwordProblems } from "../lib/crypto.js";
import { conflict, forbidden, notFound, unprocessable } from "../lib/errors.js";
import { idParams, paged, pagination, parse, requireChanges, trimmed } from "../lib/http.js";
import { audit } from "../services/audit.js";
import { requireAdmin } from "../services/policy.js";
import type { AppContext } from "../types.js";
import { issueToken, publicUser, sortableNameOf, tokenUrl } from "./auth.js";

const roleEnum = z.enum(["admin", "instructor", "student"]);
const emailField = z.email().max(320).transform((e) => e.trim());

async function emailTaken(ctx: AppContext, email: string, exceptId?: string) {
  const [row] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  return !!row && row.id !== exceptId;
}

async function createUser(
  ctx: AppContext,
  orgId: string,
  input: { name: string; email: string; role: "admin" | "instructor" | "student"; password?: string | undefined },
) {
  if (await emailTaken(ctx, input.email)) throw conflict(`A user with email ${input.email} already exists.`);
  const [user] = await ctx.db
    .insert(users)
    .values({
      orgId,
      name: input.name,
      sortableName: sortableNameOf(input.name),
      email: input.email,
      role: input.role,
      status: input.password ? "active" : "pending",
      passwordHash: input.password ? await hashPassword(input.password) : null,
    })
    .returning();
  let activationUrl: string | null = null;
  if (!input.password) {
    const token = await issueToken(ctx.db, user!.id, "activation");
    activationUrl = tokenUrl(ctx, "activation", token);
    await ctx.mailer.send(
      user!.email,
      "Activate your Campus LMS Lite account",
      `Hello ${user!.name},\n\nAn account has been created for you. Choose a password here (valid 7 days):\n\n${activationUrl}`,
    );
  }
  return { user: user!, activationUrl };
}

export default async function userRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get("/users", async (req) => {
    const admin = requireAdmin(req);
    const q = parse(
      pagination.extend({
        q: z.string().trim().max(100).optional(),
        role: roleEnum.optional(),
        status: z.enum(["pending", "active", "deactivated"]).optional(),
      }),
      req.query,
    );
    const filters: (SQL | undefined)[] = [eq(users.orgId, admin.orgId)];
    if (q.q) filters.push(or(ilike(users.name, `%${q.q}%`), ilike(users.email, `%${q.q}%`)));
    if (q.role) filters.push(eq(users.role, q.role));
    if (q.status) filters.push(eq(users.status, q.status));
    const where = and(...filters);
    const [{ total } = { total: 0 }] = await ctx.db.select({ total: count() }).from(users).where(where);
    const rows = await ctx.db
      .select()
      .from(users)
      .where(where)
      .orderBy(asc(users.sortableName))
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage);
    return paged(rows.map(publicUser), total, q.page, q.perPage);
  });

  app.post("/users", async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parse(
      z.object({
        name: trimmed(1, 120),
        email: emailField,
        role: roleEnum.default("student"),
        password: z
          .string()
          .optional()
          .refine((p) => !p || !passwordProblems(p), { message: "Password must be at least 10 characters with a letter and a number." }),
      }),
      req.body,
    );
    const result = await createUser(ctx, admin.orgId, body);
    await audit(ctx.db, { actorId: admin.id, action: "user.created", entityType: "user", entityId: result.user.id, metadata: { role: body.role }, ip: req.ip });
    reply.status(201);
    return { user: publicUser(result.user), activationUrl: result.activationUrl, emailSent: ctx.mailer.configured && !!result.activationUrl };
  });

  app.post("/users/import", async (req) => {
    const admin = requireAdmin(req);
    const { csv } = parse(z.object({ csv: z.string().min(1).max(1_000_000) }), req.body);
    const rows = parseCsvObjects(csv);
    if (rows.length === 0) throw unprocessable("The CSV has no data rows. Expected columns: name,email,role");
    if (rows.length > 2000) throw unprocessable("Import at most 2000 users at a time.");
    const results: { row: number; email: string; status: "created" | "skipped" | "error"; message?: string; activationUrl?: string | null }[] = [];
    for (const [i, r] of rows.entries()) {
      const parsed = z
        .object({ name: trimmed(1, 120), email: z.email(), role: roleEnum.default("student") })
        .safeParse({ name: r.name, email: r.email, role: r.role || undefined });
      if (!parsed.success) {
        results.push({ row: i + 2, email: r.email ?? "", status: "error", message: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }
      if (await emailTaken(ctx, parsed.data.email)) {
        results.push({ row: i + 2, email: parsed.data.email, status: "skipped", message: "Email already exists" });
        continue;
      }
      const created = await createUser(ctx, admin.orgId, parsed.data);
      results.push({ row: i + 2, email: parsed.data.email, status: "created", activationUrl: created.activationUrl });
    }
    await audit(ctx.db, {
      actorId: admin.id,
      action: "user.bulk_import",
      entityType: "user",
      metadata: { created: results.filter((r) => r.status === "created").length, total: rows.length },
      ip: req.ip,
    });
    return { results };
  });

  app.get("/users/:id", async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParams, req.params);
    const [user] = await ctx.db.select().from(users).where(and(eq(users.id, id), eq(users.orgId, admin.orgId)));
    if (!user) throw notFound("User");
    const userEnrollments = await ctx.db
      .select({
        id: enrollments.id,
        role: enrollments.role,
        status: enrollments.status,
        courseId: courses.id,
        courseName: courses.name,
        courseCode: courses.code,
      })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(eq(enrollments.userId, id))
      .orderBy(asc(courses.name));
    return { user: publicUser(user), enrollments: userEnrollments };
  });

  app.patch("/users/:id", async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        name: trimmed(1, 120).optional(),
        email: emailField.optional(),
        role: roleEnum.optional(),
        status: z.enum(["active", "deactivated"]).optional(),
      }),
      req.body,
    );
    requireChanges(body);
    const [existing] = await ctx.db.select().from(users).where(and(eq(users.id, id), eq(users.orgId, admin.orgId)));
    if (!existing) throw notFound("User");
    if (id === admin.id && (body.status === "deactivated" || (body.role && body.role !== "admin"))) {
      throw forbidden("You cannot deactivate or demote your own account.");
    }
    if (body.email && (await emailTaken(ctx, body.email, id))) throw conflict("That email is already in use.");
    if (body.status === "active" && existing.status === "pending") {
      throw unprocessable("Pending users become active by using their activation link.");
    }
    const [user] = await ctx.db
      .update(users)
      .set({ ...body, ...(body.name ? { sortableName: sortableNameOf(body.name) } : {}) })
      .where(eq(users.id, id))
      .returning();
    if (body.status === "deactivated") await ctx.db.delete(authSessions).where(eq(authSessions.userId, id));
    await audit(ctx.db, {
      actorId: admin.id,
      action: body.status === "deactivated" ? "user.deactivated" : body.status === "active" ? "user.reactivated" : "user.updated",
      entityType: "user",
      entityId: id,
      metadata: { changes: body },
      ip: req.ip,
    });
    return { user: publicUser(user!) };
  });

  app.post("/users/:id/activation-link", async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParams, req.params);
    const [user] = await ctx.db.select().from(users).where(and(eq(users.id, id), eq(users.orgId, admin.orgId)));
    if (!user) throw notFound("User");
    if (user.status !== "pending") throw unprocessable("Only pending users need an activation link.");
    const url = tokenUrl(ctx, "activation", await issueToken(ctx.db, id, "activation"));
    await audit(ctx.db, { actorId: admin.id, action: "user.activation_link_issued", entityType: "user", entityId: id, ip: req.ip });
    return { url, expiresInHours: 168 };
  });

  app.post("/users/:id/reset-link", async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParams, req.params);
    const [user] = await ctx.db.select().from(users).where(and(eq(users.id, id), eq(users.orgId, admin.orgId)));
    if (!user) throw notFound("User");
    if (user.status !== "active") throw unprocessable("Only active users can reset a password.");
    const url = tokenUrl(ctx, "password_reset", await issueToken(ctx.db, id, "password_reset"));
    await audit(ctx.db, { actorId: admin.id, action: "user.reset_link_issued", entityType: "user", entityId: id, ip: req.ip });
    return { url, expiresInHours: 1 };
  });
}
