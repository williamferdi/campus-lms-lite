import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assignments, rubricAssessments, rubrics, type RubricCriterion } from "../db/schema.js";
import { normalizeRubric, rubricPossible, scoreAssessment } from "../domain/rubric.js";
import { conflict, forbidden, notFound, unprocessable } from "../lib/errors.js";
import { idParams, parse, requireChanges, trimmed } from "../lib/http.js";
import { audit } from "../services/audit.js";
import { assertStudentInCourse, getOrCreateSubmission } from "../services/grading.js";
import { contentEditor, courseAccess, requireStaff, requireUser, requireWritable } from "../services/policy.js";
import type { AppContext } from "../types.js";

const ratingInput = z.object({
  id: z.string().max(64).optional(),
  description: trimmed(1, 200),
  longDescription: z.string().max(2_000).optional(),
  points: z.number().min(0).max(100_000),
});
const criterionInput = z.object({
  id: z.string().max(64).optional(),
  description: trimmed(1, 500),
  longDescription: z.string().max(4_000).optional(),
  ratings: z.array(ratingInput).min(1).max(20),
});
const rubricFields = z
  .object({ title: trimmed(1, 200), criteria: z.array(criterionInput).min(1).max(50), freeFormComments: z.boolean() })
  .partial();
const rubricCreate = rubricFields.required({ title: true, criteria: true });

const assessmentInput = z.object({
  scores: z.record(
    z.string().max(64),
    z.object({ ratingId: z.string().max(64).nullable().optional(), points: z.number().min(0).max(100_000).nullable().optional(), comments: z.string().max(5_000).optional() }),
  ),
});

type Rubric = typeof rubrics.$inferSelect;

export const describeRubric = (r: Rubric) => ({
  id: r.id,
  courseId: r.courseId,
  title: r.title,
  criteria: r.criteria,
  freeFormComments: r.freeFormComments,
  possible: rubricPossible(r.criteria),
  updatedAt: r.updatedAt,
});

/** Throws 422 with the domain's message when criteria are invalid. */
function normalize(criteria: z.infer<typeof criterionInput>[]): RubricCriterion[] {
  try {
    return normalizeRubric(criteria);
  } catch (err) {
    throw unprocessable((err as Error).message);
  }
}

/** A rubric that may be attached to an assignment in this course. */
export async function rubricForCourse(ctx: AppContext, courseId: string, rubricId: string) {
  const [r] = await ctx.db.select().from(rubrics).where(eq(rubrics.id, rubricId));
  if (!r || r.courseId !== courseId) throw unprocessable("Choose a rubric from this course.");
  return r;
}

const assessedCount = async (ctx: AppContext, rubricId: string) =>
  (await ctx.db.select({ n: count() }).from(rubricAssessments).where(eq(rubricAssessments.rubricId, rubricId)))[0]?.n ?? 0;

export default async function rubricRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  async function loadRubric(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [rubric] = await ctx.db.select().from(rubrics).where(eq(rubrics.id, id));
    if (!rubric) throw notFound("Rubric");
    return { user, rubric };
  }

  app.get("/courses/:id/rubrics", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    requireStaff(await courseAccess(ctx, user, id));
    const list = await ctx.db.select().from(rubrics).where(eq(rubrics.courseId, id)).orderBy(asc(rubrics.title));
    const ids = list.map((r) => r.id);
    const usedBy = ids.length
      ? await ctx.db.select({ id: assignments.id, title: assignments.title, rubricId: assignments.rubricId }).from(assignments).where(inArray(assignments.rubricId, ids)).orderBy(asc(assignments.title))
      : [];
    const assessed = ids.length
      ? await ctx.db.select({ rubricId: rubricAssessments.rubricId, n: count() }).from(rubricAssessments).where(inArray(rubricAssessments.rubricId, ids)).groupBy(rubricAssessments.rubricId)
      : [];
    return {
      data: list.map((r) => ({
        ...describeRubric(r),
        usedBy: usedBy.filter((a) => a.rubricId === r.id).map((a) => ({ id: a.id, title: a.title })),
        assessmentCount: assessed.find((x) => x.rubricId === r.id)?.n ?? 0,
      })),
    };
  });

  app.post("/courses/:id/rubrics", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await contentEditor(ctx, user, id);
    const body = parse(rubricCreate, req.body);
    const [rubric] = await ctx.db
      .insert(rubrics)
      .values({ courseId: id, title: body.title, criteria: normalize(body.criteria), freeFormComments: body.freeFormComments ?? false, createdById: user.id })
      .returning();
    await audit(ctx.db, { actorId: user.id, action: "rubric.created", entityType: "rubric", entityId: rubric!.id, courseId: id, metadata: { title: rubric!.title }, ip: req.ip });
    reply.status(201);
    return { rubric: describeRubric(rubric!) };
  });

  app.get("/rubrics/:id", async (req) => {
    const { user, rubric } = await loadRubric(req);
    requireStaff(await courseAccess(ctx, user, rubric.courseId));
    return { rubric: describeRubric(rubric), assessmentCount: await assessedCount(ctx, rubric.id) };
  });

  app.patch("/rubrics/:id", async (req) => {
    const { user, rubric } = await loadRubric(req);
    await contentEditor(ctx, user, rubric.courseId);
    const sent = requireChanges(parse(rubricFields, req.body));
    const { criteria, ...rest } = sent;
    if (criteria) {
      const n = await assessedCount(ctx, rubric.id);
      if (n > 0) throw conflict(`This rubric has already been used to score ${n} submission${n === 1 ? "" : "s"}, so its criteria are locked. Duplicate it to make changes.`);
    }
    const [updated] = await ctx.db
      .update(rubrics)
      .set({ ...rest, ...(criteria ? { criteria: normalize(criteria) } : {}) })
      .where(eq(rubrics.id, rubric.id))
      .returning();
    await audit(ctx.db, { actorId: user.id, action: "rubric.updated", entityType: "rubric", entityId: rubric.id, courseId: rubric.courseId, metadata: { fields: Object.keys(sent) }, ip: req.ip });
    return { rubric: describeRubric(updated!) };
  });

  app.post("/rubrics/:id/duplicate", async (req, reply) => {
    const { user, rubric } = await loadRubric(req);
    await contentEditor(ctx, user, rubric.courseId);
    // Fresh ids so the copy's criteria are independent of the original's scores.
    const criteria = normalizeRubric(rubric.criteria.map((c) => ({ ...c, id: undefined, ratings: c.ratings.map((r) => ({ ...r, id: undefined })) })));
    const [copy] = await ctx.db
      .insert(rubrics)
      .values({ courseId: rubric.courseId, title: `${rubric.title} (copy)`.slice(0, 200), criteria, freeFormComments: rubric.freeFormComments, createdById: user.id })
      .returning();
    await audit(ctx.db, { actorId: user.id, action: "rubric.created", entityType: "rubric", entityId: copy!.id, courseId: rubric.courseId, metadata: { title: copy!.title, copiedFrom: rubric.id }, ip: req.ip });
    reply.status(201);
    return { rubric: describeRubric(copy!) };
  });

  app.delete("/rubrics/:id", async (req) => {
    const { user, rubric } = await loadRubric(req);
    await contentEditor(ctx, user, rubric.courseId);
    const [{ n: attached } = { n: 0 }] = await ctx.db.select({ n: count() }).from(assignments).where(eq(assignments.rubricId, rubric.id));
    if (attached > 0) throw conflict("Remove this rubric from its assignments before deleting it.");
    if ((await assessedCount(ctx, rubric.id)) > 0) throw conflict("This rubric has been used to score submissions and can't be deleted.");
    await ctx.db.delete(rubrics).where(eq(rubrics.id, rubric.id));
    await audit(ctx.db, { actorId: user.id, action: "rubric.deleted", entityType: "rubric", entityId: rubric.id, courseId: rubric.courseId, metadata: { title: rubric.title }, ip: req.ip });
    return { ok: true };
  });

  /** The rubric attached to an assignment (also a quiz's or graded discussion's). Students see published ones. */
  app.get("/assignments/:id/rubric", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [assignment] = await ctx.db.select().from(assignments).where(eq(assignments.id, id));
    if (!assignment) throw notFound("Assignment");
    const access = await courseAccess(ctx, user, assignment.courseId);
    if (!access.isStaff && !assignment.published) throw notFound("Assignment");
    const [rubric] = assignment.rubricId ? await ctx.db.select().from(rubrics).where(eq(rubrics.id, assignment.rubricId)) : [];
    return { rubric: rubric ? describeRubric(rubric) : null, useForGrading: assignment.rubricUseForGrading };
  });

  /** Save a grader's rubric scores. The grade itself is saved separately through the grade route. */
  app.put("/assignments/:id/submissions/:userId/rubric-assessment", async (req) => {
    const user = requireUser(req);
    const { id, userId } = parse(z.object({ id: z.uuid(), userId: z.uuid() }), req.params);
    const [assignment] = await ctx.db.select().from(assignments).where(eq(assignments.id, id));
    if (!assignment) throw notFound("Assignment");
    const access = await courseAccess(ctx, user, assignment.courseId);
    if (!access.canGrade) throw forbidden("Only graders can assess.");
    requireWritable(access);
    await assertStudentInCourse(ctx, assignment.courseId, userId);
    if (!assignment.rubricId) throw unprocessable("This assignment has no rubric.");
    const [rubric] = await ctx.db.select().from(rubrics).where(eq(rubrics.id, assignment.rubricId));
    const body = parse(assessmentInput, req.body);
    let result;
    try {
      result = scoreAssessment(rubric!.criteria, body.scores);
    } catch (err) {
      throw unprocessable((err as Error).message);
    }
    const sub = await getOrCreateSubmission(ctx, assignment.id, userId);
    const values = { rubricId: rubric!.id, assignmentId: assignment.id, submissionId: sub.id, assessorId: user.id, scores: result.scores, total: result.total };
    const [saved] = await ctx.db
      .insert(rubricAssessments)
      .values(values)
      .onConflictDoUpdate({ target: rubricAssessments.submissionId, set: { rubricId: values.rubricId, assessorId: user.id, scores: values.scores, total: values.total, updatedAt: new Date() } })
      .returning();
    await audit(ctx.db, { actorId: user.id, action: "rubric_assessment.saved", entityType: "submission", entityId: sub.id, courseId: assignment.courseId, metadata: { assignmentId: assignment.id, studentId: userId, rubricId: rubric!.id, total: result.total }, ip: req.ip });
    return { assessment: describeAssessment(saved!), possible: result.possible };
  });
}

export const describeAssessment = (a: typeof rubricAssessments.$inferSelect) => ({
  rubricId: a.rubricId,
  scores: a.scores,
  total: a.total,
  updatedAt: a.updatedAt,
});

/** The assessment for one submission, if it was made with the assignment's current rubric. */
export async function assessmentFor(ctx: AppContext, assignment: { rubricId: string | null }, submissionId: string) {
  if (!assignment.rubricId) return null;
  const [a] = await ctx.db
    .select()
    .from(rubricAssessments)
    .where(and(eq(rubricAssessments.submissionId, submissionId), eq(rubricAssessments.rubricId, assignment.rubricId)));
  return a ? describeAssessment(a) : null;
}
