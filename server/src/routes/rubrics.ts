import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assignments, rubricCriteria, rubrics, type RubricLevel } from "../db/schema.js";
import { conflict, notFound } from "../lib/errors.js";
import { idParams, parse, queryBool, requireChanges, trimmed } from "../lib/http.js";
import { audit } from "../services/audit.js";
import { assertStudentInCourse } from "../services/grading.js";
import {
  addCriterion,
  assessmentCount,
  attachRubric,
  copyRubric,
  createRubric,
  criteriaByRubric,
  criteriaOf,
  describeAssessment,
  describeRubric,
  detachRubric,
  gradingBlockedReason,
  listForCourse,
  listShared,
  loadRubric,
  reorderCriteria,
  requireRubricEditor,
  rubricInUse,
  saveAssessment,
} from "../services/rubrics.js";
import {
  contentEditor,
  courseAccess,
  requireAdmin,
  requireStaff,
  requireUser,
  requireWritable,
} from "../services/policy.js";
import type { AppContext } from "../types.js";

/** Levels carry ids because a recorded mark names the level it was given. */
const levelInput = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  description: trimmed(1, 400),
  points: z.number().min(0).max(100_000),
});

const criterionFields = z
  .object({
    description: trimmed(1, 500),
    longDescription: z.string().max(10_000),
    points: z.number().min(0).max(100_000),
    levels: z.array(levelInput).max(20),
  })
  .partial();
const criterionCreate = criterionFields.required({ description: true });

const rubricFields = z
  .object({ title: trimmed(1, 200), description: z.string().max(10_000) })
  .partial();
const rubricCreate = rubricFields.required({ title: true });

/** Mint ids for new levels, keep them for existing ones. Same idiom as quiz choices. */
function withLevelIds(levels: z.infer<typeof levelInput>[]): RubricLevel[] {
  const seen = new Set<string>();
  return levels.map((l) => {
    let id = l.id ?? randomBytes(6).toString("base64url");
    if (seen.has(id)) id = randomBytes(6).toString("base64url");
    seen.add(id);
    return { id, description: l.description, points: l.points };
  });
}

export default async function rubricRoutes(app: FastifyInstance) {
  const ctx: AppContext = app.ctx;

  // ------------------------------------------------------------- the library

  app.get("/courses/:id/rubrics", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    requireStaff(access);
    const list = await listForCourse(ctx, access);
    const criteria = await criteriaByRubric(
      ctx,
      list.map((r) => r.id),
    );
    return { data: list.map((r) => describeRubric(r, criteria.get(r.id) ?? [])) };
  });

  app.post("/courses/:id/rubrics", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await contentEditor(ctx, user, id);
    const body = parse(rubricCreate, req.body);
    // The tenant comes from the course, never from the request.
    const rubric = await createRubric(ctx, {
      orgId: access.course.orgId,
      courseId: access.course.id,
      title: body.title,
      description: body.description,
    });
    await audit(ctx.db, {
      actorId: user.id,
      action: "rubric.created",
      entityType: "rubric",
      entityId: rubric.id,
      courseId: access.course.id,
      metadata: { title: rubric.title },
      ip: req.ip,
    });
    reply.status(201);
    return { rubric: describeRubric(rubric, []), canEdit: true };
  });

  /** The shared library: usable by every teacher, maintained by the academic office. */
  app.get("/rubrics", async (req) => {
    const user = requireAdmin(req);
    const list = await listShared(ctx, user);
    const criteria = await criteriaByRubric(
      ctx,
      list.map((r) => r.id),
    );
    return { data: list.map((r) => describeRubric(r, criteria.get(r.id) ?? [])) };
  });

  app.post("/rubrics", async (req, reply) => {
    const user = requireAdmin(req);
    const body = parse(rubricCreate, req.body);
    const rubric = await createRubric(ctx, {
      orgId: user.orgId,
      courseId: null,
      title: body.title,
      description: body.description,
    });
    await audit(ctx.db, {
      actorId: user.id,
      action: "rubric.created",
      entityType: "rubric",
      entityId: rubric.id,
      metadata: { title: rubric.title, shared: true },
      ip: req.ip,
    });
    reply.status(201);
    return { rubric: describeRubric(rubric, []), canEdit: true };
  });

  async function load(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const { rubric, canEdit } = await loadRubric(ctx, user, id);
    return { user, rubric, canEdit };
  }

  app.get("/rubrics/:id", async (req) => {
    const { rubric, canEdit } = await load(req);
    const criteria = await criteriaOf(ctx, rubric.id);
    return {
      rubric: describeRubric(rubric, criteria),
      canEdit,
      usedBy: await rubricInUse(ctx, rubric.id),
    };
  });

  app.patch("/rubrics/:id", async (req) => {
    const { user, rubric, canEdit } = await load(req);
    requireRubricEditor(rubric, canEdit);
    const body = requireChanges(parse(rubricFields, req.body));
    const [updated] = await ctx.db
      .update(rubrics)
      .set(body)
      .where(eq(rubrics.id, rubric.id))
      .returning();
    await audit(ctx.db, {
      actorId: user.id,
      action: "rubric.updated",
      entityType: "rubric",
      entityId: rubric.id,
      courseId: rubric.courseId,
      metadata: { changes: body },
      ip: req.ip,
    });
    return { rubric: describeRubric(updated!, await criteriaOf(ctx, rubric.id)) };
  });

  /**
   * Deleting a rubric that is attached is refused, naming the assessments using it. Deleting one
   * that has only been *used to mark* is allowed: every assessment carries its own copy of the
   * criteria, so the marking it produced stands on its own.
   */
  app.delete("/rubrics/:id", async (req) => {
    const { user, rubric, canEdit } = await load(req);
    requireRubricEditor(rubric, canEdit);
    const used = await rubricInUse(ctx, rubric.id);
    if (used.length) {
      throw conflict(
        `This rubric is attached to ${used.length} assessment(s): ${used.map((u) => u.title).join(", ")}. Detach it first.`,
      );
    }
    const marks = await assessmentCount(ctx, rubric.id);
    await ctx.db.delete(rubrics).where(eq(rubrics.id, rubric.id));
    await audit(ctx.db, {
      actorId: user.id,
      action: "rubric.deleted",
      entityType: "rubric",
      entityId: rubric.id,
      courseId: rubric.courseId,
      metadata: { title: rubric.title, keptAssessments: marks },
      ip: req.ip,
    });
    return { ok: true, keptAssessments: marks };
  });

  /** Take an editable copy into a course, rather than editing a shared original. */
  app.post("/rubrics/:id/copy", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({ courseId: z.uuid(), title: trimmed(1, 200).optional() }),
      req.body,
    );
    // The target course first, so its staff -- a TA included -- may copy a shared rubric in.
    const access = await contentEditor(ctx, user, body.courseId);
    const { rubric } = await loadRubric(ctx, user, id, { viaCourse: access });
    if (rubric.orgId !== access.course.orgId) throw notFound("Rubric");
    const copy = await copyRubric(
      ctx,
      rubric,
      { orgId: access.course.orgId, courseId: access.course.id },
      body.title,
    );
    await audit(ctx.db, {
      actorId: user.id,
      action: "rubric.copied",
      entityType: "rubric",
      entityId: copy.id,
      courseId: access.course.id,
      metadata: { from: rubric.id, sharedSource: rubric.courseId === null },
      ip: req.ip,
    });
    reply.status(201);
    return { rubric: describeRubric(copy, await criteriaOf(ctx, copy.id)), canEdit: true };
  });

  // ------------------------------------------------------------- criteria

  app.post("/rubrics/:id/criteria", async (req, reply) => {
    const { rubric, canEdit } = await load(req);
    requireRubricEditor(rubric, canEdit);
    const body = parse(criterionCreate, req.body);
    const criterion = await addCriterion(ctx, rubric.id, {
      description: body.description,
      longDescription: body.longDescription,
      points: body.points ?? 0,
      levels: withLevelIds(body.levels ?? []),
    });
    reply.status(201);
    return { criterion };
  });

  async function loadCriterion(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [criterion] = await ctx.db
      .select()
      .from(rubricCriteria)
      .where(eq(rubricCriteria.id, id));
    if (!criterion) throw notFound("Criterion");
    const { rubric, canEdit } = await loadRubric(ctx, user, criterion.rubricId);
    requireRubricEditor(rubric, canEdit);
    return { user, rubric, criterion };
  }

  app.patch("/rubric-criteria/:id", async (req) => {
    const { criterion } = await loadCriterion(req);
    const sent = requireChanges(parse(criterionFields, req.body));
    const { levels, ...rest } = sent;
    const [updated] = await ctx.db
      .update(rubricCriteria)
      .set({ ...rest, ...(levels !== undefined ? { levels: withLevelIds(levels) } : {}) })
      .where(eq(rubricCriteria.id, criterion.id))
      .returning();
    return { criterion: updated };
  });

  app.delete("/rubric-criteria/:id", async (req) => {
    const { rubric, criterion } = await loadCriterion(req);
    await ctx.db.delete(rubricCriteria).where(eq(rubricCriteria.id, criterion.id));
    // Close the gap so positions stay 1..n, as they are everywhere else.
    const remaining = await criteriaOf(ctx, rubric.id);
    await reorderCriteria(
      ctx,
      rubric.id,
      remaining.map((c) => c.id),
    );
    return { ok: true };
  });

  app.post("/rubrics/:id/criteria/reorder", async (req) => {
    const { rubric, canEdit } = await load(req);
    requireRubricEditor(rubric, canEdit);
    const body = parse(z.object({ criterionIds: z.array(z.uuid()).max(200) }), req.body);
    await reorderCriteria(ctx, rubric.id, body.criterionIds);
    return { data: await criteriaOf(ctx, rubric.id) };
  });

  // ------------------------------------------------------------- attaching

  async function loadAssignment(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [assignment] = await ctx.db.select().from(assignments).where(eq(assignments.id, id));
    if (!assignment) throw notFound("Assignment");
    const access = await courseAccess(ctx, user, assignment.courseId);
    return { user, assignment, access };
  }

  app.put("/assignments/:id/rubric", async (req) => {
    const { user, assignment, access } = await loadAssignment(req);
    if (!access.canEditContent) throw notFound("Assignment");
    requireWritable(access);
    const body = parse(
      z.object({
        rubricId: z.uuid(),
        useForGrading: z.boolean().default(true),
        hidePoints: z.boolean().default(false),
      }),
      req.body,
    );
    const { rubric } = await loadRubric(ctx, user, body.rubricId, { viaCourse: access });
    const result = await attachRubric(ctx, {
      user,
      access,
      assignment,
      rubric,
      useForGrading: body.useForGrading,
      hidePoints: body.hidePoints,
      ip: req.ip,
    });
    return {
      attachment: result.attachment,
      pointsMismatch: result.pointsMismatch,
      gradingBlocked: await gradingBlockedReason(ctx, assignment),
    };
  });

  /**
   * Detaching never changes a mark. Marks already given against the rubric survive, which is
   * why this refuses without `force` once there are any: silently orphaning released marks is
   * exactly what the snapshot exists to prevent, so the caller confirms it.
   */
  app.delete("/assignments/:id/rubric", async (req) => {
    const { user, assignment, access } = await loadAssignment(req);
    if (!access.canEditContent) throw notFound("Assignment");
    requireWritable(access);
    const { force } = parse(z.object({ force: queryBool.optional() }), req.query);
    const result = await detachRubric(ctx, { user, assignment, force, ip: req.ip });
    if (!result.detached) throw notFound("Rubric");
    return result;
  });

  // ------------------------------------------------------------- marking

  app.put("/assignments/:id/submissions/:userId/rubric-assessment", async (req) => {
    const { user, assignment, access } = await loadAssignment(req);
    const { userId } = parse(z.object({ id: z.uuid(), userId: z.uuid() }), req.params);
    if (!access.canGrade) throw notFound("Assignment");
    requireWritable(access);
    await assertStudentInCourse(ctx, assignment.courseId, userId);
    const body = parse(
      z.object({
        awards: z
          .array(
            z.object({
              criterionId: z.uuid(),
              points: z.number().min(0).max(100_000).nullable().optional(),
              levelId: z.string().max(64).nullable().optional(),
            }),
          )
          .max(200),
      }),
      req.body,
    );
    const result = await saveAssessment(ctx, {
      user,
      access,
      assignment,
      studentId: userId,
      awards: body.awards,
      ip: req.ip,
    });
    return {
      assessment: describeAssessment(result.assessment, undefined, { hidePoints: false }),
      graded: result.graded,
      gradingBlocked: result.blocked,
    };
  });
}
