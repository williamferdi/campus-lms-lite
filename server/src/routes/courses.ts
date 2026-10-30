import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  assignmentGroups,
  assignments,
  courses,
  departments,
  enrollments,
  files,
  sections,
  submissions,
  terms,
  users,
} from "../db/schema.js";
import { sha256 } from "../lib/crypto.js";
import { conflict, forbidden, unprocessable } from "../lib/errors.js";
import { idParams, optionalDate, paged, pagination, parse, requireChanges, trimmed } from "../lib/http.js";
import { audit } from "../services/audit.js";
import { duplicateCourse } from "../services/duplicate.js";
import { courseAccess, requireManager, requireUser, type CourseAccess } from "../services/policy.js";
import { validateUpload } from "../services/uploads.js";
import type { AppContext } from "../types.js";

export const courseBody = z.object({
  code: trimmed(1, 40),
  name: trimmed(1, 200),
  description: z.string().max(5000).default(""),
  termId: z.uuid().nullable().optional(),
  departmentId: z.uuid().nullable().optional(),
  startAt: optionalDate,
  endAt: optionalDate,
});

const settingsBody = courseBody.partial().extend({
  applyGroupWeights: z.boolean().optional(),
  latePolicyEnabled: z.boolean().optional(),
  lateDeductionPercent: z.number().min(0).max(100).optional(),
  lateFloorPercent: z.number().min(0).max(100).optional(),
});

async function assertCatalogRefs(ctx: AppContext, orgId: string, termId?: string | null, departmentId?: string | null) {
  if (termId) {
    const [t] = await ctx.db.select({ id: terms.id }).from(terms).where(and(eq(terms.id, termId), eq(terms.orgId, orgId)));
    if (!t) throw unprocessable("Unknown term.");
  }
  if (departmentId) {
    const [d] = await ctx.db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.orgId, orgId)));
    if (!d) throw unprocessable("Unknown department.");
  }
}

/** Decorate course rows with term/department names, teachers and student counts. */
export async function describeCourses(ctx: AppContext, rows: (typeof courses.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const termIds = [...new Set(rows.map((r) => r.termId).filter((x): x is string => !!x))];
  const deptIds = [...new Set(rows.map((r) => r.departmentId).filter((x): x is string => !!x))];
  const [termRows, deptRows, staff, studentCounts] = await Promise.all([
    termIds.length ? ctx.db.select().from(terms).where(inArray(terms.id, termIds)) : [],
    deptIds.length ? ctx.db.select().from(departments).where(inArray(departments.id, deptIds)) : [],
    ctx.db
      .select({ courseId: enrollments.courseId, name: users.name, role: enrollments.role })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.userId))
      .where(and(inArray(enrollments.courseId, ids), eq(enrollments.role, "teacher"), eq(enrollments.status, "active")))
      .orderBy(asc(users.sortableName)),
    ctx.db
      .select({ courseId: enrollments.courseId, n: count() })
      .from(enrollments)
      .where(and(inArray(enrollments.courseId, ids), eq(enrollments.role, "student"), ne(enrollments.status, "inactive")))
      .groupBy(enrollments.courseId),
  ]);
  const termMap = new Map(termRows.map((t) => [t.id, t]));
  const deptMap = new Map(deptRows.map((d) => [d.id, d]));
  const countMap = new Map(studentCounts.map((c) => [c.courseId, c.n]));
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    status: c.status,
    startAt: c.startAt,
    endAt: c.endAt,
    termId: c.termId,
    termName: c.termId ? (termMap.get(c.termId)?.name ?? null) : null,
    departmentId: c.departmentId,
    departmentName: c.departmentId ? (deptMap.get(c.departmentId)?.name ?? null) : null,
    imageUrl: c.imageFileId ? `/api/v1/files/${c.imageFileId}/download` : null,
    teachers: staff.filter((s) => s.courseId === c.id).map((s) => s.name),
    studentCount: countMap.get(c.id) ?? 0,
    applyGroupWeights: c.applyGroupWeights,
    latePolicyEnabled: c.latePolicyEnabled,
    lateDeductionPercent: c.lateDeductionPercent,
    lateFloorPercent: c.lateFloorPercent,
    createdAt: c.createdAt,
  }));
}

export function permissionsOf(a: CourseAccess) {
  return {
    role: a.role,
    isStaff: a.isStaff,
    canManage: a.canManage,
    canEditContent: a.canEditContent && !a.readOnly,
    canGrade: a.canGrade,
    readOnly: a.readOnly,
  };
}

/** Create a course with its default section and assignment group. */
export async function createCourseRecord(
  ctx: AppContext,
  orgId: string,
  createdById: string,
  body: z.infer<typeof courseBody>,
) {
  const [course] = await ctx.db
    .insert(courses)
    .values({
      orgId,
      code: body.code,
      name: body.name,
      description: body.description,
      termId: body.termId ?? null,
      departmentId: body.departmentId ?? null,
      startAt: body.startAt ?? null,
      endAt: body.endAt ?? null,
      createdById,
    })
    .returning();
  await ctx.db.insert(sections).values({ courseId: course!.id, name: `${body.code} (default section)` });
  await ctx.db.insert(assignmentGroups).values({ courseId: course!.id, name: "Assignments", position: 0 });
  return course!;
}

export default async function courseRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get("/courses", async (req) => {
    const user = requireUser(req);
    const q = parse(
      pagination.extend({
        q: z.string().trim().max(100).optional(),
        status: z.enum(["unpublished", "published", "archived"]).optional(),
        termId: z.uuid().optional(),
        departmentId: z.uuid().optional(),
        scope: z.enum(["mine", "all"]).default("mine"),
      }),
      req.query,
    );
    const filters: (SQL | undefined)[] = [eq(courses.orgId, user.orgId)];
    if (q.q) filters.push(or(ilike(courses.name, `%${q.q}%`), ilike(courses.code, `%${q.q}%`)));
    if (q.status) filters.push(eq(courses.status, q.status));
    if (q.termId) filters.push(eq(courses.termId, q.termId));
    if (q.departmentId) filters.push(eq(courses.departmentId, q.departmentId));

    const roles = new Map<string, string>();
    if (q.scope === "mine" || user.role !== "admin") {
      const mine = await ctx.db
        .select({ courseId: enrollments.courseId, role: enrollments.role, status: enrollments.status })
        .from(enrollments)
        .where(and(eq(enrollments.userId, user.id), ne(enrollments.status, "inactive")));
      mine.forEach((m) => roles.set(m.courseId, m.role));
      const visible = mine.map((m) => m.courseId);
      if (visible.length === 0) return paged([], 0, q.page, q.perPage);
      filters.push(inArray(courses.id, visible));
      // Students never see unpublished courses.
      const studentIn = mine.filter((m) => m.role === "student").map((m) => m.courseId);
      if (studentIn.length) {
        filters.push(or(notInArray(courses.id, studentIn), ne(courses.status, "unpublished")));
      }
    }
    const where = and(...filters);
    const [{ total } = { total: 0 }] = await ctx.db.select({ total: count() }).from(courses).where(where);
    const rows = await ctx.db
      .select()
      .from(courses)
      .where(where)
      .orderBy(asc(sql`case ${courses.status} when 'published' then 0 when 'unpublished' then 1 else 2 end`), asc(courses.name))
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage);
    const described = await describeCourses(ctx, rows);
    return paged(
      described.map((c) => ({ ...c, role: roles.get(c.id) ?? "admin" })),
      total,
      q.page,
      q.perPage,
    );
  });

  app.post("/courses", async (req, reply) => {
    const user = requireUser(req);
    if (user.role === "student") throw forbidden("Only administrators and instructors can create courses.");
    const body = parse(courseBody, req.body);
    await assertCatalogRefs(ctx, user.orgId, body.termId, body.departmentId);
    const course = await createCourseRecord(ctx, user.orgId, user.id, body);
    if (user.role === "instructor") {
      const [section] = await ctx.db.select().from(sections).where(eq(sections.courseId, course.id));
      await ctx.db.insert(enrollments).values({ courseId: course.id, userId: user.id, role: "teacher", sectionId: section?.id ?? null });
    }
    await audit(ctx.db, { actorId: user.id, action: "course.created", entityType: "course", entityId: course.id, courseId: course.id, ip: req.ip });
    reply.status(201);
    return { course: (await describeCourses(ctx, [course]))[0] };
  });

  app.get("/courses/:id", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    if (access.enrollment) {
      await ctx.db.update(enrollments).set({ lastActivityAt: new Date() }).where(eq(enrollments.id, access.enrollment.id));
    }
    const [course] = await describeCourses(ctx, [access.course]);
    return { course, permissions: permissionsOf(access) };
  });

  app.patch("/courses/:id", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    requireManager(access);
    const body = requireChanges(parse(settingsBody, req.body));
    await assertCatalogRefs(ctx, user.orgId, body.termId, body.departmentId);
    const start = body.startAt === undefined ? access.course.startAt : body.startAt;
    const end = body.endAt === undefined ? access.course.endAt : body.endAt;
    if (start && end && start > end) throw unprocessable("The course must end after it starts.");
    const [updated] = await ctx.db.update(courses).set(body).where(eq(courses.id, id)).returning();
    await audit(ctx.db, { actorId: user.id, action: "course.updated", entityType: "course", entityId: id, courseId: id, metadata: { fields: Object.keys(body) }, ip: req.ip });
    return { course: (await describeCourses(ctx, [updated!]))[0] };
  });

  app.post("/courses/:id/status", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    requireManager(access);
    const { status } = parse(z.object({ status: z.enum(["unpublished", "published", "archived"]) }), req.body);
    const from = access.course.status;
    if (from === "archived" && status !== "archived" && access.role !== "admin") {
      throw forbidden("Only administrators can reopen an archived course.");
    }
    if (status === "unpublished" && from !== "unpublished") {
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: count() })
        .from(submissions)
        .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
        .where(and(eq(assignments.courseId, id), isNotNull(submissions.score), isNotNull(submissions.postedAt)));
      if (n > 0) throw conflict("This course cannot be unpublished because students have already received grades.");
    }
    const [updated] = await ctx.db.update(courses).set({ status }).where(eq(courses.id, id)).returning();
    await audit(ctx.db, { actorId: user.id, action: `course.${status}`, entityType: "course", entityId: id, courseId: id, metadata: { from }, ip: req.ip });
    return { course: (await describeCourses(ctx, [updated!]))[0] };
  });

  app.post("/courses/:id/duplicate", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    requireManager(access);
    if (user.role === "student") throw forbidden();
    const body = parse(
      z.object({ code: trimmed(1, 40), name: trimmed(1, 200), termId: z.uuid().nullable().optional() }),
      req.body,
    );
    await assertCatalogRefs(ctx, user.orgId, body.termId);
    const newId = await duplicateCourse(ctx, access.course, { ...body, createdById: user.id, enrollCreatorAsTeacher: user.role !== "admin" });
    await audit(ctx.db, { actorId: user.id, action: "course.duplicated", entityType: "course", entityId: newId, courseId: newId, metadata: { sourceCourseId: id }, ip: req.ip });
    const [created] = await ctx.db.select().from(courses).where(eq(courses.id, newId));
    reply.status(201);
    return { course: (await describeCourses(ctx, [created!]))[0] };
  });

  app.post("/courses/:id/image", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    requireManager(access);
    const part = await req.file();
    if (!part) throw unprocessable("Choose an image to upload.");
    const data = await part.toBuffer();
    const info = validateUpload(part.filename, data, [], { imagesOnly: true });
    const storageKey = randomUUID();
    await ctx.storage.put(storageKey, data);
    const [file] = await ctx.db
      .insert(files)
      .values({
        courseId: id,
        ownerId: user.id,
        purpose: "course_image",
        originalName: info.name,
        storageKey,
        mimeType: info.mimeType,
        sizeBytes: data.length,
        sha256: sha256(data),
        published: true,
      })
      .returning();
    await ctx.db.update(courses).set({ imageFileId: file!.id }).where(eq(courses.id, id));
    return { imageUrl: `/api/v1/files/${file!.id}/download` };
  });

  app.delete("/courses/:id/image", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    requireManager(await courseAccess(ctx, user, id));
    await ctx.db.update(courses).set({ imageFileId: null }).where(eq(courses.id, id));
    return { ok: true };
  });

  app.get("/courses/:id/audit", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    requireManager(await courseAccess(ctx, user, id));
    const q = parse(pagination, req.query);
    const { auditEvents } = await import("../db/schema.js");
    const where = eq(auditEvents.courseId, id);
    const [{ total } = { total: 0 }] = await ctx.db.select({ total: count() }).from(auditEvents).where(where);
    const rows = await ctx.db
      .select({ event: auditEvents, actorName: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(where)
      .orderBy(desc(auditEvents.createdAt))
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage);
    return paged(rows.map((r) => ({ ...r.event, actorName: r.actorName })), total, q.page, q.perPage);
  });
}
