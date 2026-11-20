/**
 * Rubrics: the library, the attachment, and the marking.
 *
 * Three rules live here because the database cannot express them.
 *
 * 1. **`loadRubric` is the only place that reads the `rubrics` table**, and it always filters by
 *    the caller's organization. A course-scoped row launders its tenant through `courses`, which
 *    `policy.ts` checks; a *shared* rubric has no course, so nothing else would check it and a
 *    missing predicate would be a cross-tenant leak. No route may query `rubrics` for itself.
 * 2. **A shared rubric is changed only by an administrator.** It is usable by every teacher in
 *    the organization, so one teacher's edit would change how every course using it is marked.
 *    `org_id` is taken from the course or the caller, never from the request body, and
 *    `course_id` never changes after creation -- reuse is copying, not moving.
 * 3. **A rubric total reaches the gradebook only through `setGrade`.** Nothing here writes to
 *    `submissions`. That is what keeps the late policy, the posting gate, the audit trail and
 *    the registrar's export consistent, and it is why a half-marked rubric does not grade.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  assignmentRubrics,
  assignments,
  quizzes,
  rubricAssessments,
  rubricCriteria,
  rubrics,
  submissions,
  type RubricAssessmentCriterion,
  type RubricLevel,
} from "../db/schema.js";
import {
  applyAwards,
  assessmentTotal,
  criterionTotal,
  isComplete,
  pointsMismatch,
  snapshotFor,
  type CriterionAward,
  type ScorableCriterion,
} from "../domain/rubrics.js";
import { conflict, forbidden, notFound, unprocessable } from "../lib/errors.js";
import type { AppContext, SessionUser } from "../types.js";
import { audit } from "./audit.js";
import { getOrCreateSubmission, setGrade, type Assignment } from "./grading.js";
import { courseAccess, requireStaff, type CourseAccess } from "./policy.js";

export type Rubric = typeof rubrics.$inferSelect;
export type RubricCriterion = typeof rubricCriteria.$inferSelect;
export type AssignmentRubric = typeof assignmentRubrics.$inferSelect;
export type RubricAssessment = typeof rubricAssessments.$inferSelect;

// --------------------------------------------------------------- reading

/** Criteria in the order a grader and a student see them. */
export async function criteriaOf(ctx: AppContext, rubricId: string): Promise<RubricCriterion[]> {
  return ctx.db
    .select()
    .from(rubricCriteria)
    .where(eq(rubricCriteria.rubricId, rubricId))
    .orderBy(asc(rubricCriteria.position));
}

/** Criteria for a whole library listing in one query, grouped by rubric. */
export async function criteriaByRubric(
  ctx: AppContext,
  rubricIds: string[],
): Promise<Map<string, RubricCriterion[]>> {
  const grouped = new Map<string, RubricCriterion[]>();
  if (!rubricIds.length) return grouped;
  const rows = await ctx.db
    .select()
    .from(rubricCriteria)
    .where(inArray(rubricCriteria.rubricId, rubricIds))
    .orderBy(asc(rubricCriteria.position));
  for (const row of rows) {
    const list = grouped.get(row.rubricId);
    if (list) list.push(row);
    else grouped.set(row.rubricId, [row]);
  }
  return grouped;
}

const scorable = (criteria: RubricCriterion[]): ScorableCriterion[] =>
  criteria.map((c) => ({
    id: c.id,
    position: c.position,
    description: c.description,
    longDescription: c.longDescription,
    points: c.points,
    levels: c.levels,
  }));

/**
 * The one way to reach a rubric. Answers 404 rather than 403 for anything the caller may not
 * see, so a rubric's existence is not disclosed -- the house convention.
 *
 * A shared rubric is read by any instructor or administrator, and by staff of a course the
 * caller has already been granted access to -- pass that access as `viaCourse`. A teaching
 * assistant's *platform* role is often `student` (they are a student who assists), so reading
 * the platform role alone would lock them out of the shared library they are entitled to use.
 * Either way, only an administrator may change a shared rubric.
 */
export async function loadRubric(
  ctx: AppContext,
  user: SessionUser,
  rubricId: string,
  options: { viaCourse?: CourseAccess } = {},
): Promise<{ rubric: Rubric; canEdit: boolean }> {
  const [rubric] = await ctx.db
    .select()
    .from(rubrics)
    .where(and(eq(rubrics.id, rubricId), eq(rubrics.orgId, user.orgId)));
  if (!rubric) throw notFound("Rubric");

  if (!rubric.courseId) {
    const staffElsewhere = options.viaCourse?.isStaff ?? false;
    if (!staffElsewhere && user.role === "student") throw notFound("Rubric");
    return { rubric, canEdit: user.role === "admin" };
  }

  const access = await courseAccess(ctx, user, rubric.courseId);
  requireStaff(access);
  return { rubric, canEdit: access.canEditContent && !access.readOnly };
}

/** Refuse a change to a rubric this caller may only use. */
export function requireRubricEditor(rubric: Rubric, canEdit: boolean): void {
  if (canEdit) return;
  throw forbidden(
    rubric.courseId
      ? "You do not have permission to do that."
      : "Only an administrator can change a shared rubric.",
  );
}

/** A course's own rubrics, then the shared ones any teacher may use. */
export async function listForCourse(ctx: AppContext, access: CourseAccess): Promise<Rubric[]> {
  return ctx.db
    .select()
    .from(rubrics)
    .where(
      and(
        eq(rubrics.orgId, access.course.orgId),
        or(eq(rubrics.courseId, access.course.id), isNull(rubrics.courseId)),
      ),
    )
    .orderBy(asc(rubrics.courseId), asc(rubrics.title));
}

/** Every shared rubric in the organization. The administrator's library. */
export async function listShared(ctx: AppContext, user: SessionUser): Promise<Rubric[]> {
  return ctx.db
    .select()
    .from(rubrics)
    .where(and(eq(rubrics.orgId, user.orgId), isNull(rubrics.courseId)))
    .orderBy(asc(rubrics.title));
}

// --------------------------------------------------------------- writing

export async function createRubric(
  ctx: AppContext,
  input: { orgId: string; courseId: string | null; title: string; description?: string },
): Promise<Rubric> {
  const [rubric] = await ctx.db
    .insert(rubrics)
    .values({
      orgId: input.orgId,
      courseId: input.courseId,
      title: input.title,
      description: input.description ?? "",
    })
    .returning();
  return rubric!;
}

/** The assignments currently marked by this rubric, by title. Empty means it is free to delete. */
export async function rubricInUse(
  ctx: AppContext,
  rubricId: string,
): Promise<{ assignmentId: string; title: string }[]> {
  return ctx.db
    .select({ assignmentId: assignments.id, title: assignments.title })
    .from(assignmentRubrics)
    .innerJoin(assignments, eq(assignments.id, assignmentRubrics.assignmentId))
    .where(eq(assignmentRubrics.rubricId, rubricId));
}

/** How many marks were given against this rubric. They survive it; attachments do not. */
export async function assessmentCount(ctx: AppContext, rubricId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(rubricAssessments)
    .where(eq(rubricAssessments.rubricId, rubricId));
  return row?.n ?? 0;
}

/**
 * Copy a rubric into a course, criteria and all, as an editable rubric of its own.
 *
 * This is the explicit alternative to using a shared original: a teacher who needs to change
 * the wording takes a copy rather than editing the college's. Marks already given are not
 * copied -- they belong to the submissions that earned them.
 */
export async function copyRubric(
  ctx: AppContext,
  source: Rubric,
  target: { orgId: string; courseId: string },
  title?: string,
): Promise<Rubric> {
  const criteria = await criteriaOf(ctx, source.id);
  return ctx.db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(rubrics)
      .values({
        orgId: target.orgId,
        courseId: target.courseId,
        title: title ?? `${source.title} (copy)`,
        description: source.description,
      })
      .returning();
    if (criteria.length) {
      await tx.insert(rubricCriteria).values(
        criteria.map((c, i) => ({
          rubricId: copy!.id,
          position: i + 1,
          description: c.description,
          longDescription: c.longDescription,
          points: c.points,
          levels: c.levels as RubricLevel[],
        })),
      );
    }
    return copy!;
  });
}

/** Append a criterion. Positions are 1-based and contiguous, as everywhere else. */
export async function addCriterion(
  ctx: AppContext,
  rubricId: string,
  input: { description: string; longDescription?: string; points: number; levels?: RubricLevel[] },
): Promise<RubricCriterion> {
  const [{ pos } = { pos: 0 }] = await ctx.db
    .select({ pos: sql<number>`coalesce(max(${rubricCriteria.position}), 0)::int` })
    .from(rubricCriteria)
    .where(eq(rubricCriteria.rubricId, rubricId));
  const [criterion] = await ctx.db
    .insert(rubricCriteria)
    .values({
      rubricId,
      position: (pos ?? 0) + 1,
      description: input.description,
      longDescription: input.longDescription ?? "",
      points: input.points,
      levels: input.levels ?? [],
    })
    .returning();
  return criterion!;
}

/** Reorder by naming every criterion exactly once, then renumbering 1..n. */
export async function reorderCriteria(
  ctx: AppContext,
  rubricId: string,
  criterionIds: string[],
): Promise<void> {
  const existing = await criteriaOf(ctx, rubricId);
  if (existing.length !== criterionIds.length || !existing.every((c) => criterionIds.includes(c.id))) {
    throw unprocessable("Provide every criterion exactly once.");
  }
  await ctx.db.transaction(async (tx) => {
    for (const [i, cid] of criterionIds.entries()) {
      await tx
        .update(rubricCriteria)
        .set({ position: i + 1 })
        .where(and(eq(rubricCriteria.id, cid), eq(rubricCriteria.rubricId, rubricId)));
    }
  });
}

// --------------------------------------------------------------- attaching

export async function attachmentFor(
  ctx: AppContext,
  assignmentId: string,
): Promise<AssignmentRubric | undefined> {
  const [attachment] = await ctx.db
    .select()
    .from(assignmentRubrics)
    .where(eq(assignmentRubrics.assignmentId, assignmentId));
  return attachment;
}

/**
 * Why this assessment's mark cannot come from a rubric, or null when it can.
 *
 * The quiz case is the one that matters. `syncQuizSubmission` re-runs `setGrade` with the
 * attempt score on every submission and every regrade, and `syncQuizPoints` owns
 * `points_possible`. A rubric total written there would be overwritten the next time a student
 * touched the quiz -- and because `setGrade` keeps `posted_at` once set, that overwrite would
 * silently rewrite an already released mark and notify the student again. So a quiz keeps its
 * questions as the mark, and a rubric on it is feedback.
 *
 * Keyed on the `quizzes.assignment_id` FK, not on `submission_types`: that array is plain text
 * a teacher can rewrite through `PATCH /assignments/:id`, while the FK is what the quiz sync
 * actually acts on.
 */
export async function gradingBlockedReason(
  ctx: AppContext,
  assignment: Assignment,
): Promise<string | null> {
  if (assignment.gradingType === "not_graded") {
    return "This assignment is not graded, so a rubric on it can only be feedback.";
  }
  const [quiz] = await ctx.db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(eq(quizzes.assignmentId, assignment.id));
  if (quiz) {
    return "A quiz scores this assignment from its questions, so a rubric on it can only be feedback.";
  }
  return null;
}

/**
 * Attach a rubric, or change how an attached one is used.
 *
 * A rubric whose criteria do not add up to the assignment's points is attached anyway and the
 * mismatch reported: a 40-point shared rubric on a 20-point assignment is a legitimate thing to
 * want, and correcting `points_possible` from here would silently re-weight every other course
 * using that rubric.
 */
export async function attachRubric(
  ctx: AppContext,
  args: {
    user: SessionUser;
    access: CourseAccess;
    assignment: Assignment;
    rubric: Rubric;
    useForGrading: boolean;
    hidePoints: boolean;
    ip?: string | null;
  },
): Promise<{ attachment: AssignmentRubric; pointsMismatch: ReturnType<typeof pointsMismatch> }> {
  const { assignment, rubric } = args;
  if (rubric.orgId !== args.access.course.orgId) throw notFound("Rubric");
  if (rubric.courseId && rubric.courseId !== assignment.courseId) throw notFound("Rubric");

  const useForGrading = args.useForGrading;
  if (useForGrading) {
    const blocked = await gradingBlockedReason(ctx, assignment);
    if (blocked) throw unprocessable(blocked);
  }

  const criteria = await criteriaOf(ctx, rubric.id);
  const [attachment] = await ctx.db
    .insert(assignmentRubrics)
    .values({
      assignmentId: assignment.id,
      rubricId: rubric.id,
      useForGrading,
      hidePoints: args.hidePoints,
    })
    .onConflictDoUpdate({
      target: assignmentRubrics.assignmentId,
      set: { rubricId: rubric.id, useForGrading, hidePoints: args.hidePoints, updatedAt: new Date() },
    })
    .returning();

  await audit(ctx.db, {
    actorId: args.user.id,
    action: "rubric.attached",
    entityType: "assignment",
    entityId: assignment.id,
    courseId: assignment.courseId,
    metadata: { rubricId: rubric.id, useForGrading, hidePoints: args.hidePoints },
    ip: args.ip,
  });

  return {
    attachment: attachment!,
    pointsMismatch: useForGrading ? pointsMismatch(criteria, assignment.pointsPossible) : null,
  };
}

// --------------------------------------------------------------- marking

export async function assessmentFor(
  ctx: AppContext,
  submissionId: string,
): Promise<RubricAssessment | undefined> {
  const [assessment] = await ctx.db
    .select()
    .from(rubricAssessments)
    .where(eq(rubricAssessments.submissionId, submissionId));
  return assessment;
}

export async function assessmentsForSubmissions(
  ctx: AppContext,
  submissionIds: string[],
): Promise<RubricAssessment[]> {
  if (!submissionIds.length) return [];
  return ctx.db
    .select()
    .from(rubricAssessments)
    .where(inArray(rubricAssessments.submissionId, submissionIds));
}

/**
 * Record one student's work judged against the attached rubric.
 *
 * The snapshot is built here from the live criteria; the request supplies only an award per
 * criterion. Trusting client-sent wording and maxima would let a stale or hostile client write
 * whatever it liked into a permanent grade record, and building it here turns "the rubric was
 * edited while I had this open" into a clean 422 instead of a fabricated mark.
 *
 * The grade moves only when the rubric is used for grading *and* every criterion has been
 * judged. A partial save is stored and shown, and leaves the mark alone.
 */
export async function saveAssessment(
  ctx: AppContext,
  args: {
    user: SessionUser;
    access: CourseAccess;
    assignment: Assignment;
    studentId: string;
    awards: CriterionAward[];
    ip?: string | null;
  },
): Promise<{ assessment: RubricAssessment; graded: boolean; blocked: string | null }> {
  const { assignment, studentId } = args;

  const attachment = await attachmentFor(ctx, assignment.id);
  if (!attachment) throw unprocessable("No rubric is attached to this assessment.");

  const [rubric] = await ctx.db.select().from(rubrics).where(eq(rubrics.id, attachment.rubricId));
  if (!rubric) throw unprocessable("The attached rubric no longer exists.");

  const submission = await getOrCreateSubmission(ctx, assignment.id, studentId);
  if (submission.excused) {
    throw unprocessable("This submission is excused. Remove the excusal before marking it.");
  }

  const criteria = await criteriaOf(ctx, rubric.id);
  if (!criteria.length) throw unprocessable("This rubric has no criteria yet.");

  let marked: RubricAssessmentCriterion[];
  try {
    marked = applyAwards(snapshotFor(scorable(criteria)), args.awards);
  } catch (err) {
    throw unprocessable((err as Error).message);
  }

  const total = assessmentTotal(marked);
  const complete = isComplete(marked);
  const possible = criterionTotal(criteria);

  const [assessment] = await ctx.db
    .insert(rubricAssessments)
    .values({
      submissionId: submission.id,
      rubricId: rubric.id,
      rubricTitle: rubric.title,
      assessorId: args.user.id,
      attempt: submission.attempt,
      total,
      pointsPossible: possible,
      criteria: marked,
    })
    .onConflictDoUpdate({
      target: rubricAssessments.submissionId,
      set: {
        rubricId: rubric.id,
        rubricTitle: rubric.title,
        assessorId: args.user.id,
        attempt: submission.attempt,
        total,
        pointsPossible: possible,
        criteria: marked,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Checked again here, not only on attach: a quiz can be linked to an assignment after a
  // rubric was attached to it.
  const blocked = attachment.useForGrading ? await gradingBlockedReason(ctx, assignment) : null;
  let graded = false;
  if (attachment.useForGrading && !blocked && complete && total !== submission.enteredScore) {
    await setGrade(ctx, {
      course: args.access.course,
      assignment,
      studentId,
      graderId: args.user.id,
      change: { score: total },
      ip: args.ip,
      source: "rubric",
    });
    graded = true;
  }

  await audit(ctx.db, {
    actorId: args.user.id,
    action: "rubric.assessed",
    entityType: "submission",
    entityId: submission.id,
    courseId: assignment.courseId,
    metadata: { rubricId: rubric.id, total, complete, graded },
    ip: args.ip,
  });

  return { assessment: assessment!, graded, blocked };
}

/**
 * What the client is told about an assessment.
 *
 * `overridden` is the honest answer to a question teachers will otherwise raise as a bug: the
 * gradebook and the grade box can both overwrite a rubric-derived score at any time, which is
 * legitimate, and leaves the stored total disagreeing with the mark on record.
 */
export function describeAssessment(
  assessment: RubricAssessment,
  submission: { enteredScore: number | null } | undefined,
  options: { hidePoints: boolean },
) {
  return {
    id: assessment.id,
    rubricId: assessment.rubricId,
    rubricTitle: assessment.rubricTitle,
    attempt: assessment.attempt,
    total: options.hidePoints ? null : assessment.total,
    pointsPossible: options.hidePoints ? null : assessment.pointsPossible,
    complete: assessment.criteria.every((c) => c.points !== null),
    overridden:
      submission !== undefined &&
      submission.enteredScore !== null &&
      assessment.total !== null &&
      submission.enteredScore !== assessment.total,
    criteria: assessment.criteria.map((c) => ({
      ...c,
      pointsPossible: options.hidePoints ? null : c.pointsPossible,
      points: options.hidePoints ? null : c.points,
      levels: options.hidePoints ? c.levels.map(({ points: _p, ...l }) => l) : c.levels,
    })),
    updatedAt: assessment.updatedAt,
  };
}

/** A rubric as a student or grader sees it before anything is marked. */
export function describeRubric(
  rubric: Rubric,
  criteria: RubricCriterion[],
  options: { hidePoints?: boolean } = {},
) {
  const hide = options.hidePoints ?? false;
  return {
    id: rubric.id,
    title: rubric.title,
    description: rubric.description,
    courseId: rubric.courseId,
    shared: rubric.courseId === null,
    pointsPossible: hide ? null : criterionTotal(criteria),
    criteria: criteria.map((c) => ({
      id: c.id,
      position: c.position,
      description: c.description,
      longDescription: c.longDescription,
      points: hide ? null : c.points,
      levels: hide ? c.levels.map(({ points: _p, ...l }) => l) : c.levels,
    })),
  };
}

/** The attached rubric, ready to send with an assignment. */
export async function rubricForAssignment(
  ctx: AppContext,
  assignmentId: string,
  options: { asStudent: boolean },
): Promise<
  | (ReturnType<typeof describeRubric> & { useForGrading: boolean; hidePoints: boolean })
  | null
> {
  const attachment = await attachmentFor(ctx, assignmentId);
  if (!attachment) return null;
  const [rubric] = await ctx.db.select().from(rubrics).where(eq(rubrics.id, attachment.rubricId));
  if (!rubric) return null;
  const criteria = await criteriaOf(ctx, rubric.id);
  // `hide_points` is stripped here, on the server, the way answer keys are -- not in React.
  const hidePoints = options.asStudent && attachment.hidePoints;
  return {
    ...describeRubric(rubric, criteria, { hidePoints }),
    useForGrading: attachment.useForGrading,
    hidePoints: attachment.hidePoints,
  };
}

/**
 * Detach, leaving every mark already given exactly as it stands.
 *
 * Refused without `force` once anybody has been marked: the marks survive, and a teacher
 * should be told that before the rubric disappears from the screen that explains them.
 * Zeroing or deleting them instead is exactly what the snapshot exists to prevent.
 */
export async function detachRubric(
  ctx: AppContext,
  args: { user: SessionUser; assignment: Assignment; force?: boolean; ip?: string | null },
): Promise<{ detached: boolean; keptAssessments: number }> {
  const attachment = await attachmentFor(ctx, args.assignment.id);
  if (!attachment) return { detached: false, keptAssessments: 0 };

  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(rubricAssessments)
    .innerJoin(submissions, eq(submissions.id, rubricAssessments.submissionId))
    .where(eq(submissions.assignmentId, args.assignment.id));
  const kept = row?.n ?? 0;
  if (kept > 0 && !args.force) {
    throw conflict(
      `${kept} student(s) have been marked against this rubric. Their marks are kept exactly as they are — confirm to detach it.`,
    );
  }

  await ctx.db.delete(assignmentRubrics).where(eq(assignmentRubrics.id, attachment.id));
  await audit(ctx.db, {
    actorId: args.user.id,
    action: "rubric.detached",
    entityType: "assignment",
    entityId: args.assignment.id,
    courseId: args.assignment.courseId,
    metadata: { rubricId: attachment.rubricId, keptAssessments: row?.n ?? 0 },
    ip: args.ip,
  });
  return { detached: true, keptAssessments: row?.n ?? 0 };
}
