import { and, asc, eq, ilike, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { enrollments, sections, users } from "../db/schema.js";
import { parseCsvObjects } from "../domain/csv.js";
import { conflict, forbidden, notFound, unprocessable } from "../lib/errors.js";
import { idParams, parse, requireChanges, trimmed } from "../lib/http.js";
import { audit } from "../services/audit.js";
import { notify } from "../services/notify.js";
import { courseAccess, requireManager, requireUser, requireWritable } from "../services/policy.js";
import type { AppContext, SessionUser } from "../types.js";

const roleEnum = z.enum(["teacher", "ta", "student"]);

async function defaultSection(ctx: AppContext, courseId: string) {
  const [s] = await ctx.db.select().from(sections).where(eq(sections.courseId, courseId)).orderBy(asc(sections.createdAt)).limit(1);
  return s?.id ?? null;
}

async function enrollOne(
  ctx: AppContext,
  actor: SessionUser,
  courseId: string,
  courseName: string,
  input: { email?: string | undefined; userId?: string | undefined; role: "teacher" | "ta" | "student"; sectionId?: string | null | undefined },
  ip: string,
) {
  const [user] = await ctx.db
    .select()
    .from(users)
    .where(
      and(
        eq(users.orgId, actor.orgId),
        input.userId ? eq(users.id, input.userId) : sql`lower(${users.email}) = ${(input.email ?? "").toLowerCase()}`,
      ),
    );
  if (!user) throw notFound("User");
  if (user.status === "deactivated") throw unprocessable(`${user.name}'s account is deactivated.`);
  if (input.role === "teacher" && user.role === "student") {
    throw unprocessable(`${user.name} is a student account and cannot be enrolled as a teacher.`);
  }
  const [existing] = await ctx.db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.userId, user.id)));
  if (existing) throw conflict(`${user.name} is already enrolled in this course.`);
  let sectionId = input.sectionId ?? null;
  if (sectionId) {
    const [s] = await ctx.db.select().from(sections).where(and(eq(sections.id, sectionId), eq(sections.courseId, courseId)));
    if (!s) throw unprocessable("Unknown section.");
  } else sectionId = await defaultSection(ctx, courseId);
  const [enrollment] = await ctx.db
    .insert(enrollments)
    .values({ courseId, userId: user.id, role: input.role, sectionId })
    .returning();
  await audit(ctx.db, {
    actorId: actor.id,
    action: "enrollment.created",
    entityType: "enrollment",
    entityId: enrollment!.id,
    courseId,
    metadata: { userId: user.id, role: input.role },
    ip,
  });
  await notify(ctx, [user.id], {
    type: "enrollment",
    title: `You were added to ${courseName}`,
    body: `Role: ${input.role === "ta" ? "teaching assistant" : input.role}`,
    link: `/courses/${courseId}`,
    courseId,
  });
  return { enrollment: enrollment!, user };
}

export default async function enrollmentRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get("/courses/:id/enrollments", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    const q = parse(z.object({ role: roleEnum.optional(), q: z.string().trim().max(100).optional() }), req.query);
    const rows = await ctx.db
      .select({
        id: enrollments.id,
        role: enrollments.role,
        status: enrollments.status,
        sectionId: enrollments.sectionId,
        sectionName: sections.name,
        lastActivityAt: enrollments.lastActivityAt,
        createdAt: enrollments.createdAt,
        userId: users.id,
        name: users.name,
        sortableName: users.sortableName,
        email: users.email,
      })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.userId))
      .leftJoin(sections, eq(sections.id, enrollments.sectionId))
      .where(
        and(
          eq(enrollments.courseId, id),
          q.role ? eq(enrollments.role, q.role) : undefined,
          q.q ? or(ilike(users.name, `%${q.q}%`), ilike(users.email, `%${q.q}%`)) : undefined,
          access.isStaff ? undefined : eq(enrollments.status, "active"),
        ),
      )
      .orderBy(asc(enrollments.role), asc(users.sortableName));
    // Students see a roster (names and roles) but not emails, activity or status.
    const data = access.isStaff
      ? rows
      : rows.map((r) => ({ id: r.id, role: r.role, userId: r.userId, name: r.name, sortableName: r.sortableName, sectionName: r.sectionName }));
    return { data };
  });

  app.get("/courses/:id/enrollment-candidates", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    requireManager(await courseAccess(ctx, user, id));
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    const rows = await ctx.db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.orgId, user.orgId),
          ne(users.status, "deactivated"),
          or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)),
          sql`not exists (select 1 from ${enrollments} where ${enrollments.courseId} = ${id} and ${enrollments.userId} = ${users.id})`,
        ),
      )
      .orderBy(asc(users.sortableName))
      .limit(10);
    return { data: rows };
  });

  app.post("/courses/:id/enrollments", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    requireManager(access);
    requireWritable(access);
    const body = parse(
      z
        .object({ email: z.email().optional(), userId: z.uuid().optional(), role: roleEnum, sectionId: z.uuid().nullable().optional() })
        .refine((b) => b.email || b.userId, { message: "Provide an email or a user." }),
      req.body,
    );
    const result = await enrollOne(ctx, user, id, access.course.name, body, req.ip);
    reply.status(201);
    return { enrollment: result.enrollment };
  });

  app.post("/courses/:id/enrollments/import", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    requireManager(access);
    requireWritable(access);
    const { csv } = parse(z.object({ csv: z.string().min(1).max(1_000_000) }), req.body);
    const rows = parseCsvObjects(csv);
    if (rows.length === 0) throw unprocessable("The CSV has no data rows. Expected columns: email,role");
    if (rows.length > 2000) throw unprocessable("Import at most 2000 enrollments at a time.");
    const sectionRows = await ctx.db.select().from(sections).where(eq(sections.courseId, id));
    const results: { row: number; email: string; status: "enrolled" | "skipped" | "error"; message?: string }[] = [];
    for (const [i, r] of rows.entries()) {
      const parsed = z
        .object({ email: z.email(), role: roleEnum.default("student"), section: z.string().optional() })
        .safeParse({ email: r.email, role: r.role || undefined, section: r.section || undefined });
      if (!parsed.success) {
        results.push({ row: i + 2, email: r.email ?? "", status: "error", message: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }
      const section = parsed.data.section ? sectionRows.find((s) => s.name.toLowerCase() === parsed.data.section!.toLowerCase()) : undefined;
      if (parsed.data.section && !section) {
        results.push({ row: i + 2, email: parsed.data.email, status: "error", message: `Unknown section "${parsed.data.section}"` });
        continue;
      }
      try {
        await enrollOne(ctx, user, id, access.course.name, { email: parsed.data.email, role: parsed.data.role, sectionId: section?.id }, req.ip);
        results.push({ row: i + 2, email: parsed.data.email, status: "enrolled" });
      } catch (err) {
        const e = err as { statusCode?: number; message: string };
        results.push({
          row: i + 2,
          email: parsed.data.email,
          status: e.statusCode === 409 ? "skipped" : "error",
          message: e.statusCode === 404 ? "No user with this email" : e.message,
        });
      }
    }
    return { results };
  });

  async function loadEnrollment(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [enrollment] = await ctx.db.select().from(enrollments).where(eq(enrollments.id, id));
    if (!enrollment) throw notFound("Enrollment");
    const access = await courseAccess(ctx, user, enrollment.courseId);
    requireManager(access);
    requireWritable(access);
    return { user, enrollment, access };
  }

  app.patch("/enrollments/:id", async (req) => {
    const { user, enrollment } = await loadEnrollment(req);
    const body = parse(
      z.object({
        role: roleEnum.optional(),
        status: z.enum(["active", "inactive", "completed"]).optional(),
        sectionId: z.uuid().nullable().optional(),
      }),
      req.body,
    );
    if (enrollment.userId === user.id && user.role !== "admin") throw forbidden("You cannot change your own enrollment.");
    if (body.sectionId) {
      const [s] = await ctx.db.select().from(sections).where(and(eq(sections.id, body.sectionId), eq(sections.courseId, enrollment.courseId)));
      if (!s) throw unprocessable("Unknown section.");
    }
    const [updated] = await ctx.db.update(enrollments).set(requireChanges(body)).where(eq(enrollments.id, enrollment.id)).returning();
    await audit(ctx.db, {
      actorId: user.id,
      action: "enrollment.updated",
      entityType: "enrollment",
      entityId: enrollment.id,
      courseId: enrollment.courseId,
      metadata: { userId: enrollment.userId, changes: body },
      ip: req.ip,
    });
    return { enrollment: updated };
  });

  app.delete("/enrollments/:id", async (req) => {
    const { user, enrollment } = await loadEnrollment(req);
    if (enrollment.userId === user.id && user.role !== "admin") throw forbidden("You cannot remove yourself from a course.");
    await ctx.db.delete(enrollments).where(eq(enrollments.id, enrollment.id));
    await audit(ctx.db, {
      actorId: user.id,
      action: "enrollment.removed",
      entityType: "enrollment",
      entityId: enrollment.id,
      courseId: enrollment.courseId,
      metadata: { userId: enrollment.userId, role: enrollment.role },
      ip: req.ip,
    });
    return { ok: true };
  });

  // ---- sections
  app.get("/courses/:id/sections", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await courseAccess(ctx, user, id);
    return { data: await ctx.db.select().from(sections).where(eq(sections.courseId, id)).orderBy(asc(sections.createdAt)) };
  });

  app.post("/courses/:id/sections", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    requireManager(access);
    requireWritable(access);
    const { name } = parse(z.object({ name: trimmed(1, 120) }), req.body);
    const [section] = await ctx.db.insert(sections).values({ courseId: id, name }).returning();
    reply.status(201);
    return { section };
  });

  app.patch("/sections/:id", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [section] = await ctx.db.select().from(sections).where(eq(sections.id, id));
    if (!section) throw notFound("Section");
    requireManager(await courseAccess(ctx, user, section.courseId));
    const { name } = parse(z.object({ name: trimmed(1, 120) }), req.body);
    const [updated] = await ctx.db.update(sections).set({ name }).where(eq(sections.id, id)).returning();
    return { section: updated };
  });

  app.delete("/sections/:id", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [section] = await ctx.db.select().from(sections).where(eq(sections.id, id));
    if (!section) throw notFound("Section");
    requireManager(await courseAccess(ctx, user, section.courseId));
    const remaining = await ctx.db.select({ id: sections.id }).from(sections).where(eq(sections.courseId, section.courseId));
    if (remaining.length <= 1) throw conflict("A course needs at least one section.");
    const fallback = remaining.find((s) => s.id !== id)!.id;
    await ctx.db.update(enrollments).set({ sectionId: fallback }).where(eq(enrollments.sectionId, id));
    await ctx.db.delete(sections).where(eq(sections.id, id));
    return { ok: true };
  });
}
