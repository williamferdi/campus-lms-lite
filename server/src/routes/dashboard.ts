import { and, count, desc, eq, gte, ilike, inArray, isNotNull, ne, or, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assignments, auditEvents, courses, discussionTopics, enrollments, quizzes, submissions, terms, users } from "../db/schema.js";
import { round2 } from "../domain/grading.js";
import { forbidden } from "../lib/errors.js";
import { idParams, paged, pagination, parse } from "../lib/http.js";
import { cellFor, courseStudents, loadGradeData, totalsFor } from "../services/grading.js";
import { courseAccess, requireAdmin, requireUser } from "../services/policy.js";
import { progressForUser, progressForUsers } from "../services/progress.js";
import type { AppContext, SessionUser } from "../types.js";
import { calendarItems } from "./calendar.js";
import { describeCourses } from "./courses.js";
import { releaseDueTopics } from "./discussions.js";

const DAY = 24 * 3600_000;
const avg = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Per-course statistics shared by the instructor dashboard, course stats page and admin report. */
export async function courseStats(ctx: AppContext, course: typeof courses.$inferSelect) {
  const students = await courseStudents(ctx, course.id);
  const ids = students.map((s) => s.id);
  const [{ result: progress }, data] = await Promise.all([
    progressForUsers(ctx, course.id, ids),
    loadGradeData(ctx, course, ids, { includeUnpublished: false }),
  ]);
  const now = new Date();
  const rows = students.map((s) => {
    const p = progress.get(s.id)!.overall;
    const totals = totalsFor(course, data, s.id, false);
    const cells = data.assignments.map((a) => cellFor(a, data.submissions.find((x) => x.userId === s.id && x.assignmentId === a.id), now, false));
    return {
      id: s.id,
      name: s.name,
      sortableName: s.sortableName,
      enrollmentStatus: s.enrollmentStatus,
      progressPercent: p.percent,
      requirementsCompleted: p.completed,
      requirementsTotal: p.required,
      currentScore: totals.current.percent,
      currentGrade: totals.current.letter,
      finalScore: totals.final.percent,
      missingCount: cells.filter((c) => c.missing).length,
      lateCount: cells.filter((c) => c.late).length,
    };
  });
  const assignmentStats = data.assignments.map((a) => {
    const subs = data.submissions.filter((s) => s.assignmentId === a.id);
    const scored = subs.filter((s) => s.score !== null && a.pointsPossible > 0).map((s) => (s.score! / a.pointsPossible) * 100);
    return {
      id: a.id,
      title: a.title,
      dueAt: a.dueAt,
      submittedCount: subs.filter((s) => s.submittedAt).length,
      gradedCount: subs.filter((s) => s.status === "graded").length,
      averagePercent: avg(scored),
    };
  });
  const withProgress = rows.filter((r) => r.progressPercent !== null);
  return {
    summary: {
      studentCount: rows.length,
      averageProgress: avg(withProgress.map((r) => r.progressPercent!)),
      completedCount: withProgress.filter((r) => r.progressPercent === 100).length,
      averageCurrentScore: avg(rows.filter((r) => r.currentScore !== null).map((r) => r.currentScore!)),
      missingSubmissions: rows.reduce((s, r) => s + r.missingCount, 0),
    },
    students: rows,
    assignments: assignmentStats,
  };
}

async function learningSection(ctx: AppContext, user: SessionUser, studentCourses: (typeof courses.$inferSelect)[]) {
  const now = new Date();
  const described = await describeCourses(ctx, studentCourses);
  const courseCards = [];
  const pending: unknown[] = [];
  for (const c of studentCourses) {
    const [{ progress }, data] = await Promise.all([progressForUser(ctx, c.id, user.id), loadGradeData(ctx, c, [user.id], { includeUnpublished: false })]);
    const totals = totalsFor(c, data, user.id, true);
    courseCards.push({ ...described.find((d) => d.id === c.id)!, progressPercent: progress.overall.percent, currentScore: totals.current.percent, currentGrade: totals.current.letter });
    if (c.status !== "published") continue;
    for (const a of data.assignments) {
      const cell = cellFor(a, data.submissions.find((s) => s.assignmentId === a.id), now, true);
      const online = a.submissionTypes.some((t) => ["online_text_entry", "online_url", "online_upload", "online_quiz", "discussion_topic"].includes(t));
      if (!online || cell.submittedAt || cell.excused || (a.lockAt && a.lockAt < now)) continue;
      pending.push({ id: a.id, title: a.title, courseId: c.id, courseCode: c.code, dueAt: a.dueAt, pointsPossible: a.pointsPossible, missing: cell.missing, link: `/courses/${c.id}/assignments/${a.id}` });
    }
  }
  const ids = studentCourses.filter((c) => c.status === "published").map((c) => c.id);
  const upcoming = (await calendarItems(ctx, user, now, new Date(now.getTime() + 14 * DAY), ids)).filter((i) => i.kind !== "event" || i.courseId);
  const subs = ids.length
    ? await ctx.db
        .select({ sub: submissions, title: assignments.title, courseId: assignments.courseId, pointsPossible: assignments.pointsPossible, gradingType: assignments.gradingType })
        .from(submissions)
        .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
        .where(and(eq(submissions.userId, user.id), inArray(assignments.courseId, ids), isNotNull(submissions.postedAt), gte(submissions.postedAt, new Date(now.getTime() - 30 * DAY))))
        .orderBy(desc(submissions.postedAt))
        .limit(8)
    : [];
  const mySubs = ids.length
    ? await ctx.db
        .select({ assignmentId: submissions.assignmentId, submittedAt: submissions.submittedAt })
        .from(submissions)
        .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
        .where(and(eq(submissions.userId, user.id), inArray(assignments.courseId, ids)))
    : [];
  const quizAssignment = ids.length ? await ctx.db.select({ id: quizzes.id, assignmentId: quizzes.assignmentId }).from(quizzes).where(inArray(quizzes.courseId, ids)) : [];
  const codes = new Map(studentCourses.map((c) => [c.id, c.code]));
  return {
    courses: courseCards,
    upcoming: upcoming.map((i) => {
      const assignmentId = i.kind === "quiz" ? quizAssignment.find((q) => q.id === i.id)?.assignmentId : i.id;
      return { ...i, submitted: !!mySubs.find((s) => s.assignmentId === assignmentId && s.submittedAt) };
    }),
    pending: (pending as { dueAt: Date | null }[]).sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity)).slice(0, 10),
    recentGrades: subs.map((r) => ({
      assignmentId: r.sub.assignmentId,
      title: r.title,
      courseId: r.courseId,
      courseCode: codes.get(r.courseId),
      score: r.sub.score,
      grade: r.sub.grade,
      excused: r.sub.excused,
      pointsPossible: r.pointsPossible,
      postedAt: r.sub.postedAt,
      link: `/courses/${r.courseId}/assignments/${r.sub.assignmentId}`,
    })),
  };
}

async function teachingSection(ctx: AppContext, user: SessionUser, teachingCourses: (typeof courses.$inferSelect)[]) {
  const now = new Date();
  const described = await describeCourses(ctx, teachingCourses);
  const cards = [];
  const toGrade: { assignmentId: string; title: string; courseId: string; courseCode: string; studentId: string; studentName: string; submittedAt: Date | null; link: string }[] = [];
  for (const c of teachingCourses) {
    const students = await courseStudents(ctx, c.id);
    const data = await loadGradeData(ctx, c, students.map((s) => s.id), { includeUnpublished: true });
    let needs = 0;
    for (const s of data.submissions) {
      const a = data.assignments.find((x) => x.id === s.assignmentId)!;
      if (cellFor(a, s, now, false).needsGrading) {
        needs++;
        toGrade.push({
          assignmentId: a.id,
          title: a.title,
          courseId: c.id,
          courseCode: c.code,
          studentId: s.userId,
          studentName: students.find((st) => st.id === s.userId)?.name ?? "Student",
          submittedAt: s.submittedAt,
          link: `/courses/${c.id}/assignments/${a.id}/grade?student=${s.userId}`,
        });
      }
    }
    const stats = await courseStats(ctx, c);
    cards.push({ ...described.find((d) => d.id === c.id)!, needsGradingCount: needs, ...stats.summary });
  }
  const ids = teachingCourses.map((c) => c.id);
  const upcoming = await calendarItems(ctx, user, now, new Date(now.getTime() + 14 * DAY), ids);
  return {
    courses: cards,
    needsGrading: toGrade.sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0)).slice(0, 15),
    recentSubmissions: [...toGrade]
      .sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0))
      .slice(0, 10),
    upcoming: upcoming.filter((i) => i.kind !== "event" || i.courseId),
  };
}

export async function adminSection(ctx: AppContext, user: SessionUser) {
  const orgFilter = eq(users.orgId, user.orgId);
  const [byRole, byStatus, courseStatus, enrollmentRoles, activeUsers, termRows, recentAudit] = await Promise.all([
    ctx.db.select({ role: users.role, n: count() }).from(users).where(orgFilter).groupBy(users.role),
    ctx.db.select({ status: users.status, n: count() }).from(users).where(orgFilter).groupBy(users.status),
    ctx.db.select({ status: courses.status, n: count() }).from(courses).where(eq(courses.orgId, user.orgId)).groupBy(courses.status),
    ctx.db
      .select({ role: enrollments.role, n: count() })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(and(eq(courses.orgId, user.orgId), eq(enrollments.status, "active")))
      .groupBy(enrollments.role),
    ctx.db.select({ n: count() }).from(users).where(and(orgFilter, gte(users.lastLoginAt, new Date(Date.now() - 7 * DAY)))),
    ctx.db.select().from(terms).where(eq(terms.orgId, user.orgId)),
    ctx.db
      .select({ event: auditEvents, actorName: users.name })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(10),
  ]);
  const published = await ctx.db.select().from(courses).where(and(eq(courses.orgId, user.orgId), eq(courses.status, "published"))).limit(50);
  const completion = [];
  for (const c of published) {
    const s = await courseStats(ctx, c);
    completion.push({ id: c.id, code: c.code, name: c.name, termName: termRows.find((t) => t.id === c.termId)?.name ?? null, ...s.summary });
  }
  const toMap = <K extends string>(rows: ({ n: number } & Record<string, unknown>)[], key: string) =>
    Object.fromEntries(rows.map((r) => [r[key] as K, r.n]));
  return {
    users: { byRole: toMap(byRole, "role"), byStatus: toMap(byStatus, "status"), activeLast7Days: activeUsers[0]?.n ?? 0 },
    courses: { byStatus: toMap(courseStatus, "status") },
    enrollments: { byRole: toMap(enrollmentRoles, "role") },
    terms: termRows.length,
    completion,
    recentAudit: recentAudit.map((r) => ({ ...r.event, actorName: r.actorName })),
  };
}

export default async function dashboardRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get("/dashboard", async (req) => {
    const user = requireUser(req);
    await releaseDueTopics(ctx);
    const mine = await ctx.db
      .select({ course: courses, role: enrollments.role })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(and(eq(enrollments.userId, user.id), ne(enrollments.status, "inactive")));
    const studentCourses = mine.filter((m) => m.role === "student" && m.course.status !== "unpublished").map((m) => m.course);
    const teachingCourses = mine.filter((m) => m.role !== "student" && m.course.status !== "archived").map((m) => m.course);
    const announceCourseIds = [...studentCourses, ...teachingCourses].map((c) => c.id);
    const recentAnnouncements = announceCourseIds.length
      ? await ctx.db
          .select({ id: discussionTopics.id, courseId: discussionTopics.courseId, title: discussionTopics.title, bodyHtml: discussionTopics.bodyHtml, postedAt: discussionTopics.postedAt, courseCode: courses.code })
          .from(discussionTopics)
          .innerJoin(courses, eq(courses.id, discussionTopics.courseId))
          .where(
            and(
              inArray(discussionTopics.courseId, announceCourseIds),
              eq(discussionTopics.isAnnouncement, true),
              eq(discussionTopics.published, true),
              isNotNull(discussionTopics.postedAt),
            ),
          )
          .orderBy(desc(discussionTopics.postedAt))
          .limit(5)
      : [];
    return {
      user: { id: user.id, name: user.name, role: user.role },
      announcements: recentAnnouncements,
      learning: studentCourses.length ? await learningSection(ctx, user, studentCourses) : null,
      teaching: teachingCourses.length ? await teachingSection(ctx, user, teachingCourses) : null,
      admin: user.role === "admin" ? await adminSection(ctx, user) : null,
    };
  });

  app.get("/courses/:id/stats", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    if (!access.isStaff) throw forbidden();
    const byRole = await ctx.db
      .select({ role: enrollments.role, status: enrollments.status, n: count() })
      .from(enrollments)
      .where(eq(enrollments.courseId, id))
      .groupBy(enrollments.role, enrollments.status);
    return { enrollments: byRole, ...(await courseStats(ctx, access.course)) };
  });

  app.get("/admin/audit", async (req) => {
    const admin = requireAdmin(req);
    const q = parse(pagination.extend({ action: z.string().max(100).optional(), q: z.string().max(100).optional() }), req.query);
    const filters: (SQL | undefined)[] = [or(eq(users.orgId, admin.orgId), eq(auditEvents.actorId, admin.id))];
    if (q.action) filters.push(ilike(auditEvents.action, `${q.action}%`));
    if (q.q) filters.push(or(ilike(users.name, `%${q.q}%`), ilike(auditEvents.action, `%${q.q}%`)));
    const where = and(...filters);
    const [{ total } = { total: 0 }] = await ctx.db.select({ total: count() }).from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorId)).where(where);
    const rows = await ctx.db
      .select({ event: auditEvents, actorName: users.name, courseCode: courses.code })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .leftJoin(courses, eq(courses.id, auditEvents.courseId))
      .where(where)
      .orderBy(desc(auditEvents.createdAt))
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage);
    return paged(rows.map((r) => ({ ...r.event, actorName: r.actorName, courseCode: r.courseCode })), total, q.page, q.perPage);
  });
}
