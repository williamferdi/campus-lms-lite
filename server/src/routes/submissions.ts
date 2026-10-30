import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assignments, files, submissionAttempts, submissionComments, submissions, users } from "../db/schema.js";
import { forbidden, notFound, unprocessable } from "../lib/errors.js";
import { idParams, parse } from "../lib/http.js";
import { renderMarkdown, renderPlainText } from "../lib/markdown.js";
import { audit } from "../services/audit.js";
import {
  assertStudentInCourse,
  cellFor,
  courseStudents,
  getOrCreateSubmission,
  setGrade,
  type Assignment,
  type Submission,
} from "../services/grading.js";
import { courseMemberIds, notify } from "../services/notify.js";
import { courseAccess, requireUser, requireWritable, type CourseAccess } from "../services/policy.js";
import { assertContentUnlocked } from "../services/progress.js";
import type { AppContext, SessionUser } from "../types.js";
import { describeFile, receiveUploads } from "./files.js";

const userParams = z.object({ id: z.uuid(), userId: z.uuid() });

/** Can this student submit right now? Returns null if yes, otherwise the reason. */
export function submitBlockReason(a: Assignment, sub: Submission | null, now: Date): string | null {
  if (!a.published) return "This assignment is not published.";
  const online = a.submissionTypes.filter((t) => ["online_text_entry", "online_url", "online_upload"].includes(t));
  if (online.length === 0) return a.submissionTypes.includes("on_paper") ? "This assignment is submitted on paper." : "This assignment does not accept online submissions.";
  if (a.unlockAt && now < a.unlockAt) return `Submissions open ${a.unlockAt.toISOString()}.`;
  if (a.lockAt && now > a.lockAt) return "This assignment is closed; the availability window has ended.";
  if (sub?.excused) return "You have been excused from this assignment.";
  const allowed = a.allowedAttempts === null ? null : a.allowedAttempts + (sub?.extraAttempts ?? 0);
  if (allowed !== null && (sub?.attempt ?? 0) >= allowed) return "You have used all allowed attempts.";
  return null;
}

async function loadComments(ctx: AppContext, submissionId: string) {
  return ctx.db
    .select({ id: submissionComments.id, body: submissionComments.body, attempt: submissionComments.attempt, fromGrader: submissionComments.fromGrader, createdAt: submissionComments.createdAt, authorId: submissionComments.authorId, authorName: users.name })
    .from(submissionComments)
    .leftJoin(users, eq(users.id, submissionComments.authorId))
    .where(eq(submissionComments.submissionId, submissionId))
    .orderBy(asc(submissionComments.createdAt));
}

/** Full submission detail. Student viewers only see posted grades and released grader comments. */
async function submissionDetail(ctx: AppContext, access: CourseAccess, a: Assignment, studentId: string, viewer: SessionUser) {
  const [sub] = await ctx.db.select().from(submissions).where(and(eq(submissions.assignmentId, a.id), eq(submissions.userId, studentId)));
  const asStudent = !access.canGrade;
  const now = new Date();
  const attempts = sub
    ? await ctx.db.select().from(submissionAttempts).where(eq(submissionAttempts.submissionId, sub.id)).orderBy(asc(submissionAttempts.attempt))
    : [];
  const fileIds = [...new Set(attempts.flatMap((x) => x.fileIds))];
  const fileRows = fileIds.length ? await ctx.db.select().from(files).where(inArray(files.id, fileIds)) : [];
  const released = !!sub && (!!sub.postedAt || sub.status === "returned" || !a.postManually);
  const comments = sub ? (await loadComments(ctx, sub.id)).filter((c) => !asStudent || !c.fromGrader || released) : [];
  const [student] = await ctx.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, studentId));
  return {
    student,
    submission: {
      ...cellFor(a, sub, now, asStudent),
      extraAttempts: sub?.extraAttempts ?? 0,
      gradedAttempt: asStudent && !sub?.postedAt ? null : (sub?.gradedAttempt ?? null),
      gradedAt: asStudent && !sub?.postedAt ? null : (sub?.gradedAt ?? null),
    },
    attempts: attempts.map((x) => ({
      attempt: x.attempt,
      submissionType: x.submissionType,
      bodyHtml: x.bodyHtml,
      url: x.url,
      late: x.late,
      submittedAt: x.submittedAt,
      files: x.fileIds.map((fid) => fileRows.find((f) => f.id === fid)).filter((f) => !!f).map((f) => describeFile(f!)),
    })),
    comments,
    canSubmit: viewer.id === studentId && access.role === "student" && !access.readOnly ? submitBlockReason(a, sub ?? null, now) === null : false,
    submitBlockReason: viewer.id === studentId ? submitBlockReason(a, sub ?? null, now) : null,
  };
}

export default async function submissionRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  async function loadAssignment(req: FastifyRequest, idKey: "id" = "id") {
    const user = requireUser(req);
    const params = req.params as Record<string, string>;
    const { id } = parse(idParams, { id: params[idKey] });
    const [assignment] = await ctx.db.select().from(assignments).where(eq(assignments.id, id));
    if (!assignment) throw notFound("Assignment");
    const access = await courseAccess(ctx, user, assignment.courseId);
    if (!access.isStaff && !assignment.published) throw notFound("Assignment");
    return { user, assignment, access };
  }

  /** Students upload files first, then reference them in a submission. */
  app.post("/assignments/:id/uploads", async (req, reply) => {
    const { user, assignment, access } = await loadAssignment(req);
    if (access.role !== "student") throw forbidden("Only students submit work.");
    requireWritable(access);
    if (!assignment.submissionTypes.includes("online_upload")) throw unprocessable("This assignment does not accept file uploads.");
    await assertContentUnlocked(ctx, access, user.id, assignment.id);
    const stored = await receiveUploads(ctx, req, { courseId: assignment.courseId, owner: user, purpose: "submission", allowedExtensions: assignment.allowedExtensions });
    reply.status(201);
    return { data: stored.map(describeFile) };
  });

  app.post("/assignments/:id/submit", async (req, reply) => {
    const { user, assignment, access } = await loadAssignment(req);
    if (access.role !== "student") throw forbidden("Only students submit work.");
    requireWritable(access);
    await assertContentUnlocked(ctx, access, user.id, assignment.id);
    const body = parse(
      z.object({
        submissionType: z.enum(["online_text_entry", "online_url", "online_upload"]),
        body: z.string().max(200_000).optional(),
        url: z.string().trim().max(2000).optional(),
        fileIds: z.array(z.uuid()).max(10).optional(),
      }),
      req.body,
    );
    if (!assignment.submissionTypes.includes(body.submissionType)) throw unprocessable("This submission type is not accepted for this assignment.");
    const now = new Date();
    const sub = await getOrCreateSubmission(ctx, assignment.id, user.id);
    const blocked = submitBlockReason(assignment, sub, now);
    if (blocked) throw forbidden(blocked);

    let bodyHtml: string | null = null;
    let url: string | null = null;
    let fileIds: string[] = [];
    if (body.submissionType === "online_text_entry") {
      const text = (body.body ?? "").trim();
      if (!text) throw unprocessable("Write something before submitting.");
      bodyHtml = renderMarkdown(text);
    } else if (body.submissionType === "online_url") {
      try {
        const u = new URL(body.url ?? "");
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
        url = u.toString();
      } catch {
        throw unprocessable("Enter a valid web address starting with http:// or https://");
      }
    } else {
      fileIds = [...new Set(body.fileIds ?? [])];
      if (fileIds.length === 0) throw unprocessable("Attach at least one file.");
      const owned = await ctx.db
        .select({ id: files.id })
        .from(files)
        .where(and(inArray(files.id, fileIds), eq(files.ownerId, user.id), eq(files.purpose, "submission"), eq(files.courseId, assignment.courseId)));
      if (owned.length !== fileIds.length) throw unprocessable("One or more attached files are invalid.");
    }

    const attempt = sub.attempt + 1;
    const late = !!assignment.dueAt && now > assignment.dueAt;
    await ctx.db.insert(submissionAttempts).values({ submissionId: sub.id, attempt, submissionType: body.submissionType, bodyHtml, url, fileIds, submittedAt: now, late });
    const [updated] = await ctx.db
      .update(submissions)
      .set({ attempt, submittedAt: now, submissionType: body.submissionType, bodyHtml, url, fileIds, status: "submitted" })
      .where(eq(submissions.id, sub.id))
      .returning();
    await notify(ctx, await courseMemberIds(ctx, assignment.courseId, ["teacher", "ta"]), {
      type: "submission",
      title: `New submission: ${assignment.title}`,
      body: `${user.name} submitted attempt ${attempt}${late ? " (late)" : ""}.`,
      link: `/courses/${assignment.courseId}/assignments/${assignment.id}/grade?student=${user.id}`,
      courseId: assignment.courseId,
    });
    reply.status(201);
    return { submission: cellFor(assignment, updated!, now, true), attempt, late };
  });

  /** Grader list of all students and their submission state. */
  app.get("/assignments/:id/submissions", async (req) => {
    const { assignment, access } = await loadAssignment(req);
    if (!access.canGrade) throw forbidden();
    const { status } = parse(z.object({ status: z.enum(["all", "needs_grading", "graded", "missing", "late", "unsubmitted"]).default("all") }), req.query);
    const students = await courseStudents(ctx, assignment.courseId);
    const subs = students.length
      ? await ctx.db.select().from(submissions).where(and(eq(submissions.assignmentId, assignment.id), inArray(submissions.userId, students.map((s) => s.id))))
      : [];
    const now = new Date();
    const rows = students.map((s) => ({ student: { id: s.id, name: s.name, sortableName: s.sortableName }, ...cellFor(assignment, subs.find((x) => x.userId === s.id), now, false) }));
    const filtered = rows.filter((r) => {
      switch (status) {
        case "needs_grading":
          return r.needsGrading;
        case "graded":
          return r.graded;
        case "missing":
          return r.missing;
        case "late":
          return r.late;
        case "unsubmitted":
          return !r.submittedAt;
        default:
          return true;
      }
    });
    return {
      data: filtered,
      summary: {
        total: rows.length,
        submitted: rows.filter((r) => r.submittedAt).length,
        needsGrading: rows.filter((r) => r.needsGrading).length,
        graded: rows.filter((r) => r.graded).length,
        posted: rows.filter((r) => r.posted).length,
        missing: rows.filter((r) => r.missing).length,
      },
    };
  });

  app.get("/assignments/:id/submissions/:userId", async (req) => {
    const { userId } = parse(userParams, req.params);
    const { user, assignment, access } = await loadAssignment(req);
    if (!access.canGrade && user.id !== userId) throw notFound("Submission");
    if (access.canGrade) await assertStudentInCourse(ctx, assignment.courseId, userId);
    return submissionDetail(ctx, access, assignment, userId, user);
  });

  app.put("/assignments/:id/submissions/:userId/grade", async (req) => {
    const { userId } = parse(userParams, req.params);
    const { user, assignment, access } = await loadAssignment(req);
    if (!access.canGrade) throw forbidden("Only graders can grade.");
    requireWritable(access);
    await assertStudentInCourse(ctx, assignment.courseId, userId);
    const body = parse(
      z.object({
        grade: z.string().max(40).nullable().optional(),
        excused: z.boolean().optional(),
        latePolicyStatus: z.enum(["late", "missing", "none"]).nullable().optional(),
        comment: z.string().max(10_000).optional(),
      }),
      req.body,
    );
    await setGrade(ctx, { course: access.course, assignment, studentId: userId, graderId: user.id, change: body, ip: req.ip });
    return submissionDetail(ctx, access, assignment, userId, user);
  });

  /** Return work for revision: grants another attempt and notifies the student. */
  app.post("/assignments/:id/submissions/:userId/return", async (req) => {
    const { userId } = parse(userParams, req.params);
    const { user, assignment, access } = await loadAssignment(req);
    if (!access.canGrade) throw forbidden("Only graders can return work.");
    requireWritable(access);
    await assertStudentInCourse(ctx, assignment.courseId, userId);
    const { comment } = parse(z.object({ comment: z.string().trim().min(1, "Explain what to revise.").max(10_000) }), req.body);
    const sub = await getOrCreateSubmission(ctx, assignment.id, userId);
    if (!sub.submittedAt) throw unprocessable("There is no submission to return.");
    const allowed = assignment.allowedAttempts === null ? null : assignment.allowedAttempts + sub.extraAttempts;
    const needsExtra = allowed !== null && sub.attempt >= allowed;
    await ctx.db
      .update(submissions)
      .set({ status: "returned", extraAttempts: needsExtra ? sub.extraAttempts + 1 : sub.extraAttempts })
      .where(eq(submissions.id, sub.id));
    await ctx.db.insert(submissionComments).values({ submissionId: sub.id, authorId: user.id, body: renderPlainText(comment), attempt: sub.attempt, fromGrader: true });
    await audit(ctx.db, { actorId: user.id, action: "submission.returned", entityType: "submission", entityId: sub.id, courseId: assignment.courseId, metadata: { assignmentId: assignment.id, studentId: userId }, ip: req.ip });
    await notify(ctx, [userId], {
      type: "feedback",
      title: `Revision requested: ${assignment.title}`,
      body: comment.slice(0, 300),
      link: `/courses/${assignment.courseId}/assignments/${assignment.id}`,
      courseId: assignment.courseId,
    });
    return submissionDetail(ctx, access, assignment, userId, user);
  });

  app.post("/assignments/:id/submissions/:userId/comments", async (req, reply) => {
    const { userId } = parse(userParams, req.params);
    const { user, assignment, access } = await loadAssignment(req);
    if (!access.canGrade && user.id !== userId) throw notFound("Submission");
    requireWritable(access);
    if (access.canGrade) await assertStudentInCourse(ctx, assignment.courseId, userId);
    const { body } = parse(z.object({ body: z.string().trim().min(1, "Write a comment.").max(10_000) }), req.body);
    const sub = await getOrCreateSubmission(ctx, assignment.id, userId);
    await ctx.db.insert(submissionComments).values({ submissionId: sub.id, authorId: user.id, body: renderPlainText(body), attempt: sub.attempt || null, fromGrader: access.canGrade });
    if (!access.canGrade) {
      await notify(ctx, await courseMemberIds(ctx, assignment.courseId, ["teacher", "ta"]), {
        type: "comment",
        title: `Comment on ${assignment.title}`,
        body: `${user.name}: ${body.slice(0, 200)}`,
        link: `/courses/${assignment.courseId}/assignments/${assignment.id}/grade?student=${userId}`,
        courseId: assignment.courseId,
      });
    } else if (sub.postedAt || !assignment.postManually) {
      await notify(ctx, [userId], {
        type: "comment",
        title: `New comment on ${assignment.title}`,
        body: body.slice(0, 200),
        link: `/courses/${assignment.courseId}/assignments/${assignment.id}`,
        courseId: assignment.courseId,
      });
    }
    reply.status(201);
    return submissionDetail(ctx, access, assignment, userId, user);
  });
}
