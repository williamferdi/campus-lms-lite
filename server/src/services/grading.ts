import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  assignmentGroups,
  assignments,
  courses,
  enrollments,
  submissionComments,
  submissions,
  users,
} from "../db/schema.js";
import {
  applyLatePolicy,
  computeCourseGrade,
  formatGrade,
  parseGradeInput,
  submissionFlags,
  type LatePolicyStatus,
} from "../domain/grading.js";
import { notFound, unprocessable } from "../lib/errors.js";
import { renderPlainText } from "../lib/markdown.js";
import type { AppContext } from "../types.js";
import { audit } from "./audit.js";
import { notify } from "./notify.js";

export type Assignment = typeof assignments.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
type Course = typeof courses.$inferSelect;

export function latePolicyOf(course: Course) {
  return {
    enabled: course.latePolicyEnabled,
    deductionPercent: course.lateDeductionPercent,
    floorPercent: course.lateFloorPercent,
  };
}

export async function getOrCreateSubmission(ctx: AppContext, assignmentId: string, userId: string): Promise<Submission> {
  const [existing] = await ctx.db
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.userId, userId)));
  if (existing) return existing;
  const [created] = await ctx.db
    .insert(submissions)
    .values({ assignmentId, userId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await ctx.db
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.userId, userId)));
  return again!;
}

export async function assertStudentInCourse(ctx: AppContext, courseId: string, userId: string) {
  const [e] = await ctx.db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.userId, userId), eq(enrollments.role, "student")));
  if (!e || e.status === "inactive") throw notFound("Student");
  return e;
}

export interface GradeChange {
  /** Grade as typed (points, %, letter, complete/incomplete). null clears the grade. Undefined leaves it. */
  grade?: string | null | undefined;
  /** Numeric score shortcut (used by quizzes). Takes precedence over `grade`. */
  score?: number | null | undefined;
  excused?: boolean | undefined;
  latePolicyStatus?: LatePolicyStatus | undefined;
  comment?: string | undefined;
}

/**
 * Apply a grade to one student's submission. Single entry point for manual grading, CSV import
 * and quiz scoring so late policy, posting policy, audit and notifications are always applied.
 */
export async function setGrade(
  ctx: AppContext,
  args: { course: Course; assignment: Assignment; studentId: string; graderId: string | null; change: GradeChange; ip?: string | null; source?: string },
): Promise<Submission> {
  const { course, assignment, studentId, change } = args;
  if (assignment.gradingType === "not_graded" && (change.grade || change.score !== undefined)) {
    throw unprocessable("This assignment is not graded.");
  }
  const sub = await getOrCreateSubmission(ctx, assignment.id, studentId);
  const before = { score: sub.score, excused: sub.excused, latePolicyStatus: sub.latePolicyStatus };

  const latePolicyStatus = change.latePolicyStatus === undefined ? sub.latePolicyStatus : change.latePolicyStatus;
  const excused = change.excused ?? sub.excused;

  let entered: number | null = sub.enteredScore;
  if (change.score !== undefined) entered = change.score;
  else if (change.grade !== undefined) {
    if (change.grade === null || change.grade.trim() === "") entered = null;
    else {
      try {
        entered = parseGradeInput(change.grade, assignment.gradingType, assignment.pointsPossible);
      } catch (err) {
        throw unprocessable((err as Error).message);
      }
    }
  }

  let score: number | null = null;
  let pointsDeducted: number | null = null;
  if (!excused && entered !== null) {
    const late = applyLatePolicy({
      enteredScore: entered,
      pointsPossible: assignment.pointsPossible,
      dueAt: assignment.dueAt,
      submittedAt: sub.submittedAt,
      policy: latePolicyOf(course),
      statusOverride: latePolicyStatus,
    });
    score = late.score;
    pointsDeducted = late.pointsDeducted;
  }

  const graded = excused || score !== null;
  const now = new Date();
  const status = graded ? "graded" : sub.submittedAt ? "submitted" : "unsubmitted";
  const postedAt = graded ? (sub.postedAt ?? (assignment.postManually ? null : now)) : sub.postedAt;

  const [updated] = await ctx.db
    .update(submissions)
    .set({
      enteredScore: excused ? null : entered,
      score: excused ? null : score,
      pointsDeducted: excused ? null : pointsDeducted,
      grade: excused ? "EX" : formatGrade(score, assignment.gradingType, assignment.pointsPossible),
      excused,
      latePolicyStatus,
      status,
      gradedAttempt: graded ? sub.attempt : null,
      graderId: graded ? args.graderId : null,
      gradedAt: graded ? now : null,
      postedAt,
    })
    .where(eq(submissions.id, sub.id))
    .returning();

  if (change.comment?.trim()) {
    await ctx.db.insert(submissionComments).values({
      submissionId: sub.id,
      authorId: args.graderId,
      body: renderPlainText(change.comment),
      attempt: sub.attempt || null,
      fromGrader: true,
    });
  }

  const changed = before.score !== updated!.score || before.excused !== updated!.excused || before.latePolicyStatus !== updated!.latePolicyStatus;
  if (changed) {
    await audit(ctx.db, {
      actorId: args.graderId,
      action: "grade.updated",
      entityType: "submission",
      entityId: sub.id,
      courseId: course.id,
      metadata: { assignmentId: assignment.id, studentId, before, after: { score: updated!.score, excused: updated!.excused, latePolicyStatus }, source: args.source ?? "manual" },
      ip: args.ip ?? null,
    });
  }
  if (updated!.postedAt && (changed || change.comment?.trim())) {
    await notify(ctx, [studentId], {
      type: "grade",
      title: `Feedback on ${assignment.title}`,
      body: updated!.excused ? "You were excused from this assignment." : `Grade: ${updated!.grade ?? "—"}`,
      link: `/courses/${course.id}/assignments/${assignment.id}`,
      courseId: course.id,
    });
  }
  return updated!;
}

/** Release (post) grades for an assignment so students can see them. */
export async function postGrades(ctx: AppContext, course: Course, assignment: Assignment, actorId: string, ip: string) {
  const now = new Date();
  const posted = await ctx.db
    .update(submissions)
    .set({ postedAt: now })
    .where(and(eq(submissions.assignmentId, assignment.id), eq(submissions.status, "graded"), isNull(submissions.postedAt)))
    .returning({ userId: submissions.userId });
  await audit(ctx.db, { actorId, action: "grades.posted", entityType: "assignment", entityId: assignment.id, courseId: course.id, metadata: { count: posted.length }, ip });
  await notify(ctx, posted.map((p) => p.userId), {
    type: "grade",
    title: `Grades released: ${assignment.title}`,
    body: "Your grade and feedback are now available.",
    link: `/courses/${course.id}/assignments/${assignment.id}`,
    courseId: course.id,
  });
  return posted.length;
}

export async function hideGrades(ctx: AppContext, course: Course, assignment: Assignment, actorId: string, ip: string) {
  const hidden = await ctx.db
    .update(submissions)
    .set({ postedAt: null })
    .where(eq(submissions.assignmentId, assignment.id))
    .returning({ id: submissions.id });
  await audit(ctx.db, { actorId, action: "grades.hidden", entityType: "assignment", entityId: assignment.id, courseId: course.id, metadata: { count: hidden.length }, ip });
  return hidden.length;
}

/** Load everything needed to show grades for a set of students in one course. */
export async function loadGradeData(ctx: AppContext, course: Course, studentIds: string[], opts: { includeUnpublished: boolean }) {
  const [groups, assignmentRows] = await Promise.all([
    ctx.db.select().from(assignmentGroups).where(eq(assignmentGroups.courseId, course.id)).orderBy(asc(assignmentGroups.position), asc(assignmentGroups.name)),
    ctx.db
      .select()
      .from(assignments)
      .where(and(eq(assignments.courseId, course.id), opts.includeUnpublished ? undefined : eq(assignments.published, true)))
      .orderBy(asc(assignments.dueAt), asc(assignments.position), asc(assignments.title)),
  ]);
  const subs =
    studentIds.length && assignmentRows.length
      ? await ctx.db
          .select()
          .from(submissions)
          .where(and(inArray(submissions.userId, studentIds), inArray(submissions.assignmentId, assignmentRows.map((a) => a.id))))
      : [];
  const groupOrder = new Map(groups.map((g, i) => [g.id, i]));
  assignmentRows.sort((a, b) => (groupOrder.get(a.groupId ?? "") ?? 999) - (groupOrder.get(b.groupId ?? "") ?? 999));
  return { groups, assignments: assignmentRows, submissions: subs };
}

export function cellFor(a: Assignment, s: Submission | undefined, now: Date, postedOnly: boolean) {
  const flags = submissionFlags(
    a,
    s ? { submittedAt: s.submittedAt, score: s.score, excused: s.excused, latePolicyStatus: s.latePolicyStatus } : null,
    now,
  );
  const visible = !postedOnly || !!s?.postedAt;
  const needsGrading =
    !!s && !s.excused && (s.status === "submitted" || s.status === "pending_review" || (s.status === "graded" && s.gradedAttempt !== s.attempt && s.attempt > 0));
  return {
    assignmentId: a.id,
    submissionId: s?.id ?? null,
    status: s?.status ?? "unsubmitted",
    submittedAt: s?.submittedAt ?? null,
    attempt: s?.attempt ?? 0,
    score: visible ? (s?.score ?? null) : null,
    enteredScore: visible ? (s?.enteredScore ?? null) : null,
    pointsDeducted: visible ? (s?.pointsDeducted ?? null) : null,
    grade: visible ? (s?.grade ?? null) : null,
    excused: visible ? (s?.excused ?? false) : false,
    posted: !!s?.postedAt,
    graded: s?.status === "graded",
    late: flags.late,
    missing: flags.missing,
    latePolicyStatus: s?.latePolicyStatus ?? null,
    needsGrading,
  };
}

export function totalsFor(course: Course, data: Awaited<ReturnType<typeof loadGradeData>>, studentId: string, postedOnly: boolean) {
  return computeCourseGrade(
    data.assignments.map((a) => ({
      id: a.id,
      groupId: a.groupId,
      pointsPossible: a.pointsPossible,
      gradingType: a.gradingType,
      omitFromFinal: a.omitFromFinal,
      published: a.published,
    })),
    data.submissions
      .filter((s) => s.userId === studentId)
      .map((s) => ({ assignmentId: s.assignmentId, score: s.score, excused: s.excused, postedAt: s.postedAt })),
    data.groups.map((g) => ({ id: g.id, name: g.name, weight: g.weight, dropLowest: g.dropLowest, dropHighest: g.dropHighest })),
    { applyGroupWeights: course.applyGroupWeights, postedOnly },
  );
}

export async function courseStudents(ctx: AppContext, courseId: string) {
  return ctx.db
    .select({ id: users.id, name: users.name, sortableName: users.sortableName, email: users.email, enrollmentStatus: enrollments.status, sectionId: enrollments.sectionId })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.role, "student"), ne(enrollments.status, "inactive")))
    .orderBy(asc(users.sortableName));
}
