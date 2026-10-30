import { and, asc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assignments, calendarEvents, courses, enrollments, quizzes } from "../db/schema.js";
import { forbidden, notFound, unprocessable } from "../lib/errors.js";
import { idParams, parse, requireChanges, trimmed } from "../lib/http.js";
import { courseAccess, requireUser, requireWritable } from "../services/policy.js";
import type { AppContext, SessionUser } from "../types.js";

/** Courses whose calendar the user can see, with whether they are staff there. */
export async function calendarCourses(ctx: AppContext, user: SessionUser) {
  const rows = await ctx.db
    .select({ id: courses.id, code: courses.code, name: courses.name, status: courses.status, role: enrollments.role })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(and(eq(enrollments.userId, user.id), ne(enrollments.status, "inactive")));
  return rows
    .filter((r) => r.role !== "student" || r.status !== "unpublished")
    .map((r) => ({ ...r, isStaff: r.role !== "student" }));
}

export interface CalendarItem {
  id: string;
  kind: "event" | "assignment" | "quiz";
  title: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  courseId: string | null;
  courseCode: string | null;
  link: string | null;
  description: string;
  editable: boolean;
  pointsPossible?: number | null;
}

export async function calendarItems(ctx: AppContext, user: SessionUser, start: Date, end: Date, courseIds?: string[]): Promise<CalendarItem[]> {
  let visible = await calendarCourses(ctx, user);
  if (courseIds?.length) visible = visible.filter((c) => courseIds.includes(c.id));
  const ids = visible.map((c) => c.id);
  const staffIds = visible.filter((c) => c.isStaff).map((c) => c.id);
  const byId = new Map(visible.map((c) => [c.id, c]));
  const items: CalendarItem[] = [];

  if (ids.length) {
    const asg = await ctx.db
      .select()
      .from(assignments)
      .where(and(inArray(assignments.courseId, ids), gte(assignments.dueAt, start), lte(assignments.dueAt, end)));
    for (const a of asg) {
      if (a.submissionTypes.includes("online_quiz")) continue; // shown as the quiz itself
      const c = byId.get(a.courseId)!;
      if (!a.published && !c.isStaff) continue;
      items.push({ id: a.id, kind: "assignment", title: a.title, startAt: a.dueAt!, endAt: null, allDay: false, courseId: a.courseId, courseCode: c.code, link: `/courses/${a.courseId}/assignments/${a.id}`, description: "", editable: false, pointsPossible: a.pointsPossible });
    }
    const qz = await ctx.db.select().from(quizzes).where(and(inArray(quizzes.courseId, ids), gte(quizzes.dueAt, start), lte(quizzes.dueAt, end)));
    for (const q of qz) {
      const c = byId.get(q.courseId)!;
      if (!q.published && !c.isStaff) continue;
      items.push({ id: q.id, kind: "quiz", title: q.title, startAt: q.dueAt!, endAt: null, allDay: false, courseId: q.courseId, courseCode: c.code, link: `/courses/${q.courseId}/quizzes/${q.id}`, description: "", editable: false });
    }
  }
  const events = await ctx.db
    .select()
    .from(calendarEvents)
    .where(
      and(
        gte(calendarEvents.startAt, start),
        lte(calendarEvents.startAt, end),
        or(eq(calendarEvents.userId, user.id), ids.length ? and(inArray(calendarEvents.courseId, ids), isNull(calendarEvents.userId)) : undefined),
      ),
    )
    .orderBy(asc(calendarEvents.startAt));
  for (const e of events) {
    const c = e.courseId ? byId.get(e.courseId) : undefined;
    items.push({
      id: e.id,
      kind: "event",
      title: e.title,
      startAt: e.startAt,
      endAt: e.endAt,
      allDay: e.allDay,
      courseId: e.courseId,
      courseCode: c?.code ?? null,
      link: null,
      description: e.description,
      editable: e.userId === user.id || (!!e.courseId && staffIds.includes(e.courseId)),
    });
  }
  return items.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

const eventBody = z.object({
  title: trimmed(1, 200),
  description: z.string().max(5000).default(""),
  startAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  endAt: z.iso.datetime({ offset: true }).nullable().optional().transform((v) => (v ? new Date(v) : null)),
  allDay: z.boolean().default(false),
  courseId: z.uuid().nullable().optional(),
});

export default async function calendarRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get("/calendar", async (req) => {
    const user = requireUser(req);
    const q = parse(
      z.object({
        start: z.iso.datetime({ offset: true }),
        end: z.iso.datetime({ offset: true }),
        courseId: z.union([z.uuid(), z.array(z.uuid())]).optional(),
      }),
      req.query,
    );
    const start = new Date(q.start);
    const end = new Date(q.end);
    if (end <= start) throw unprocessable("The end of the range must be after the start.");
    if (end.getTime() - start.getTime() > 400 * 24 * 3600_000) throw unprocessable("Choose a range of at most about a year.");
    const ids = q.courseId ? (Array.isArray(q.courseId) ? q.courseId : [q.courseId]) : undefined;
    return { data: await calendarItems(ctx, user, start, end, ids), courses: await calendarCourses(ctx, user) };
  });

  app.post("/calendar-events", async (req, reply) => {
    const user = requireUser(req);
    const body = parse(eventBody, req.body);
    if (body.endAt && body.endAt < body.startAt) throw unprocessable("The event must end after it starts.");
    if (body.courseId) {
      const access = await courseAccess(ctx, user, body.courseId);
      if (!access.isStaff) throw forbidden("Only course staff can add course events.");
      requireWritable(access);
    }
    const [event] = await ctx.db
      .insert(calendarEvents)
      .values({ ...body, courseId: body.courseId ?? null, userId: body.courseId ? null : user.id, createdById: user.id })
      .returning();
    reply.status(201);
    return { event };
  });

  async function loadEvent(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [event] = await ctx.db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
    if (!event) throw notFound("Event");
    if (event.userId) {
      if (event.userId !== user.id) throw notFound("Event");
    } else if (event.courseId) {
      const access = await courseAccess(ctx, user, event.courseId);
      if (!access.isStaff) throw forbidden();
      requireWritable(access);
    }
    return { user, event };
  }

  app.patch("/calendar-events/:id", async (req) => {
    const { event } = await loadEvent(req);
    const body = requireChanges(parse(eventBody.omit({ courseId: true }).partial(), req.body));
    const start = body.startAt ?? event.startAt;
    const end = body.endAt === undefined ? event.endAt : body.endAt;
    if (end && end < start) throw unprocessable("The event must end after it starts.");
    const [updated] = await ctx.db.update(calendarEvents).set(body).where(eq(calendarEvents.id, event.id)).returning();
    return { event: updated };
  });

  app.delete("/calendar-events/:id", async (req) => {
    const { event } = await loadEvent(req);
    await ctx.db.delete(calendarEvents).where(eq(calendarEvents.id, event.id));
    return { ok: true };
  });
}
