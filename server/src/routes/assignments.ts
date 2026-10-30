import { and, asc, count, eq, max, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assignmentGroups, assignments, discussionTopics, moduleItems, quizzes, submissions } from "../db/schema.js";
import { conflict, notFound, unprocessable } from "../lib/errors.js";
import { definedOnly, idParams, optionalDate, parse, requireChanges, trimmed } from "../lib/http.js";
import { renderMarkdown } from "../lib/markdown.js";
import { audit } from "../services/audit.js";
import { cellFor, courseStudents, hideGrades, loadGradeData, postGrades } from "../services/grading.js";
import { courseMemberIds, notify } from "../services/notify.js";
import { contentEditor, courseAccess, requireStaff, requireUser } from "../services/policy.js";
import { assertContentUnlocked, recordContentView } from "../services/progress.js";
import type { AppContext } from "../types.js";

const STUDENT_SUBMISSION_TYPES = ["online_text_entry", "online_url", "online_upload", "on_paper", "none"] as const;

/** No defaults here: PATCH must only touch fields the caller sent. Create applies defaults. */
const assignmentFields = z
  .object({
    title: trimmed(1, 200),
    description: z.string().max(100_000),
    pointsPossible: z.number().min(0).max(100_000),
    gradingType: z.enum(["points", "percent", "pass_fail", "letter_grade", "not_graded"]),
    submissionTypes: z.array(z.enum(STUDENT_SUBMISSION_TYPES)).min(1).max(5),
    allowedExtensions: z
      .array(z.string().trim().toLowerCase().regex(/^\.?[a-z0-9]{1,8}$/, "Use extensions like pdf or docx"))
      .max(20)
      .transform((list) => [...new Set(list.map((e) => e.replace(/^\./, "")))]),
    allowedAttempts: z.number().int().min(1).max(100).nullable(),
    unlockAt: optionalDate,
    dueAt: optionalDate,
    lockAt: optionalDate,
    published: z.boolean(),
    postManually: z.boolean(),
    omitFromFinal: z.boolean(),
    groupId: z.uuid().nullable(),
  })
  .partial();
const assignmentCreate = assignmentFields.required({ title: true });

function checkDates(d: { unlockAt?: Date | null | undefined; dueAt?: Date | null | undefined; lockAt?: Date | null | undefined }) {
  if (d.unlockAt && d.dueAt && d.unlockAt > d.dueAt) throw unprocessable("The available-from date must be before the due date.");
  if (d.dueAt && d.lockAt && d.dueAt > d.lockAt) throw unprocessable("The available-until date must be after the due date.");
  if (d.unlockAt && d.lockAt && d.unlockAt > d.lockAt) throw unprocessable("The available-until date must be after the available-from date.");
}

function checkSubmissionTypes(types: readonly string[]) {
  const offline = types.filter((t) => t === "on_paper" || t === "none");
  if (offline.length && types.length > 1) throw unprocessable('"On paper" and "No submission" cannot be combined with other submission types.');
}

/** Student-safe view of an assignment. */
export function describeAssignment(a: typeof assignments.$inferSelect) {
  return {
    id: a.id,
    courseId: a.courseId,
    groupId: a.groupId,
    title: a.title,
    descriptionHtml: a.descriptionHtml,
    pointsPossible: a.pointsPossible,
    gradingType: a.gradingType,
    submissionTypes: a.submissionTypes,
    allowedExtensions: a.allowedExtensions,
    allowedAttempts: a.allowedAttempts,
    unlockAt: a.unlockAt,
    dueAt: a.dueAt,
    lockAt: a.lockAt,
    published: a.published,
    postManually: a.postManually,
    omitFromFinal: a.omitFromFinal,
  };
}

async function groupFor(ctx: AppContext, courseId: string, groupId: string | null | undefined) {
  if (groupId) {
    const [g] = await ctx.db.select().from(assignmentGroups).where(and(eq(assignmentGroups.id, groupId), eq(assignmentGroups.courseId, courseId)));
    if (!g) throw unprocessable("Unknown assignment group.");
    return g.id;
  }
  const [first] = await ctx.db.select().from(assignmentGroups).where(eq(assignmentGroups.courseId, courseId)).orderBy(asc(assignmentGroups.position)).limit(1);
  if (first) return first.id;
  const [created] = await ctx.db.insert(assignmentGroups).values({ courseId, name: "Assignments" }).returning();
  return created!.id;
}

export default async function assignmentRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  // ------------------------------------------------------------ groups
  app.get("/courses/:id/assignment-groups", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await courseAccess(ctx, user, id);
    return { data: await ctx.db.select().from(assignmentGroups).where(eq(assignmentGroups.courseId, id)).orderBy(asc(assignmentGroups.position), asc(assignmentGroups.name)) };
  });

  const groupBody = z.object({
    name: trimmed(1, 120),
    weight: z.number().min(0).max(1000).default(0),
    dropLowest: z.number().int().min(0).max(50).default(0),
    dropHighest: z.number().int().min(0).max(50).default(0),
    position: z.number().int().min(0).max(1000).optional(),
  });

  app.post("/courses/:id/assignment-groups", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await contentEditor(ctx, user, id);
    const body = parse(groupBody, req.body);
    const [{ pos } = { pos: 0 }] = await ctx.db.select({ pos: max(assignmentGroups.position) }).from(assignmentGroups).where(eq(assignmentGroups.courseId, id));
    const [group] = await ctx.db.insert(assignmentGroups).values({ ...body, courseId: id, position: body.position ?? (pos ?? 0) + 1 }).returning();
    reply.status(201);
    return { group };
  });

  async function loadGroup(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [group] = await ctx.db.select().from(assignmentGroups).where(eq(assignmentGroups.id, id));
    if (!group) throw notFound("Assignment group");
    const access = await contentEditor(ctx, user, group.courseId);
    return { user, group, access };
  }

  app.patch("/assignment-groups/:id", async (req) => {
    const { user, group } = await loadGroup(req);
    const body = requireChanges(parse(groupBody.partial(), req.body));
    const [updated] = await ctx.db.update(assignmentGroups).set(body).where(eq(assignmentGroups.id, group.id)).returning();
    await audit(ctx.db, { actorId: user.id, action: "assignment_group.updated", entityType: "assignment_group", entityId: group.id, courseId: group.courseId, metadata: { changes: body }, ip: req.ip });
    return { group: updated };
  });

  app.delete("/assignment-groups/:id", async (req) => {
    const { user, group } = await loadGroup(req);
    const others = await ctx.db
      .select()
      .from(assignmentGroups)
      .where(and(eq(assignmentGroups.courseId, group.courseId), ne(assignmentGroups.id, group.id)))
      .orderBy(asc(assignmentGroups.position));
    if (others.length === 0) throw conflict("A course needs at least one assignment group.");
    const { moveTo } = parse(z.object({ moveTo: z.uuid().optional() }), req.query);
    const target = moveTo ? others.find((g) => g.id === moveTo) : others[0];
    if (!target) throw unprocessable("Unknown destination group.");
    await ctx.db.update(assignments).set({ groupId: target.id }).where(eq(assignments.groupId, group.id));
    await ctx.db.delete(assignmentGroups).where(eq(assignmentGroups.id, group.id));
    await audit(ctx.db, { actorId: user.id, action: "assignment_group.deleted", entityType: "assignment_group", entityId: group.id, courseId: group.courseId, metadata: { movedTo: target.id }, ip: req.ip });
    return { ok: true };
  });

  // ------------------------------------------------------------ assignments
  app.get("/courses/:id/assignments", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    const now = new Date();
    if (access.isStaff) {
      const data = await loadGradeData(ctx, access.course, (await courseStudents(ctx, id)).map((s) => s.id), { includeUnpublished: true });
      const needs = new Map<string, number>();
      const submitted = new Map<string, number>();
      for (const s of data.submissions) {
        const a = data.assignments.find((x) => x.id === s.assignmentId)!;
        const c = cellFor(a, s, now, false);
        if (c.needsGrading) needs.set(a.id, (needs.get(a.id) ?? 0) + 1);
        if (s.submittedAt) submitted.set(a.id, (submitted.get(a.id) ?? 0) + 1);
      }
      const quizLinks = await ctx.db.select({ id: quizzes.id, assignmentId: quizzes.assignmentId }).from(quizzes).where(eq(quizzes.courseId, id));
      const discLinks = await ctx.db.select({ id: discussionTopics.id, assignmentId: discussionTopics.assignmentId }).from(discussionTopics).where(eq(discussionTopics.courseId, id));
      return {
        groups: data.groups,
        data: data.assignments.map((a) => ({
          ...describeAssignment(a),
          needsGradingCount: needs.get(a.id) ?? 0,
          submittedCount: submitted.get(a.id) ?? 0,
          quizId: quizLinks.find((q) => q.assignmentId === a.id)?.id ?? null,
          discussionId: discLinks.find((d) => d.assignmentId === a.id)?.id ?? null,
        })),
      };
    }
    const data = await loadGradeData(ctx, access.course, [user.id], { includeUnpublished: false });
    const quizLinks = await ctx.db.select({ id: quizzes.id, assignmentId: quizzes.assignmentId }).from(quizzes).where(and(eq(quizzes.courseId, id), eq(quizzes.published, true)));
    const discLinks = await ctx.db.select({ id: discussionTopics.id, assignmentId: discussionTopics.assignmentId }).from(discussionTopics).where(and(eq(discussionTopics.courseId, id), eq(discussionTopics.published, true)));
    return {
      groups: data.groups,
      data: data.assignments.map((a) => ({
        ...describeAssignment(a),
        quizId: quizLinks.find((q) => q.assignmentId === a.id)?.id ?? null,
        discussionId: discLinks.find((d) => d.assignmentId === a.id)?.id ?? null,
        mySubmission: cellFor(a, data.submissions.find((s) => s.assignmentId === a.id), now, true),
      })),
    };
  });

  app.post("/courses/:id/assignments", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await contentEditor(ctx, user, id);
    const input = parse(assignmentCreate, req.body);
    const body = {
      ...input,
      description: input.description ?? "",
      pointsPossible: input.pointsPossible ?? 100,
      gradingType: input.gradingType ?? "points",
      submissionTypes: input.submissionTypes ?? ["online_upload" as const],
      allowedExtensions: input.allowedExtensions ?? [],
      allowedAttempts: input.allowedAttempts ?? null,
      published: input.published ?? false,
      postManually: input.postManually ?? false,
      omitFromFinal: input.omitFromFinal ?? false,
    };
    checkDates(body);
    checkSubmissionTypes(body.submissionTypes);
    const groupId = await groupFor(ctx, id, body.groupId);
    const [assignment] = await ctx.db
      .insert(assignments)
      .values({
        courseId: id,
        groupId,
        title: body.title,
        descriptionMd: body.description,
        descriptionHtml: renderMarkdown(body.description),
        pointsPossible: body.gradingType === "not_graded" ? 0 : body.pointsPossible,
        gradingType: body.gradingType,
        submissionTypes: body.submissionTypes,
        allowedExtensions: body.allowedExtensions,
        allowedAttempts: body.allowedAttempts,
        unlockAt: body.unlockAt ?? null,
        dueAt: body.dueAt ?? null,
        lockAt: body.lockAt ?? null,
        published: body.published,
        postManually: body.postManually,
        omitFromFinal: body.omitFromFinal,
      })
      .returning();
    if (assignment!.published && access.course.status === "published") {
      await notify(ctx, await courseMemberIds(ctx, id), {
        type: "assignment",
        title: `New assignment: ${assignment!.title}`,
        body: assignment!.dueAt ? `Due ${assignment!.dueAt.toISOString()}` : "",
        link: `/courses/${id}/assignments/${assignment!.id}`,
        courseId: id,
      });
    }
    reply.status(201);
    return { assignment: describeAssignment(assignment!) };
  });

  async function load(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [assignment] = await ctx.db.select().from(assignments).where(eq(assignments.id, id));
    if (!assignment) throw notFound("Assignment");
    return { user, assignment };
  }

  app.get("/assignments/:id", async (req) => {
    const { user, assignment } = await load(req);
    const access = await courseAccess(ctx, user, assignment.courseId);
    const [quiz] = await ctx.db.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.assignmentId, assignment.id));
    const [discussion] = await ctx.db.select({ id: discussionTopics.id }).from(discussionTopics).where(eq(discussionTopics.assignmentId, assignment.id));
    const base = { ...describeAssignment(assignment), quizId: quiz?.id ?? null, discussionId: discussion?.id ?? null };
    if (access.isStaff) {
      const [{ n } = { n: 0 }] = await ctx.db.select({ n: count() }).from(submissions).where(eq(submissions.assignmentId, assignment.id));
      return { assignment: { ...base, description: assignment.descriptionMd, submissionCount: n }, permissions: { isStaff: true } };
    }
    if (!assignment.published) throw notFound("Assignment");
    await assertContentUnlocked(ctx, access, user.id, assignment.id);
    await recordContentView(ctx, access, user.id, assignment.id);
    return { assignment: base, permissions: { isStaff: false } };
  });

  app.patch("/assignments/:id", async (req) => {
    const { user, assignment } = await load(req);
    await contentEditor(ctx, user, assignment.courseId);
    const sent = requireChanges(parse(assignmentFields, req.body));
    const next = { ...assignment, ...sent };
    checkDates(next);
    if (sent.submissionTypes) {
      const linked = assignment.submissionTypes.some((t) => t === "online_quiz" || t === "discussion_topic");
      if (linked) throw unprocessable("Submission types of quiz and discussion assignments cannot be changed.");
      checkSubmissionTypes(sent.submissionTypes);
    }
    if (sent.published === false && assignment.published) {
      const [{ n } = { n: 0 }] = await ctx.db.select({ n: count() }).from(submissions).where(and(eq(submissions.assignmentId, assignment.id), ne(submissions.status, "unsubmitted")));
      if (n > 0) throw conflict("This assignment cannot be unpublished because students have already submitted work.");
    }
    const { description, groupId, ...rest } = sent;
    const [updated] = await ctx.db
      .update(assignments)
      .set({
        ...rest,
        ...(description !== undefined ? { descriptionMd: description, descriptionHtml: renderMarkdown(description) } : {}),
        ...(groupId !== undefined ? { groupId: await groupFor(ctx, assignment.courseId, groupId) } : {}),
        ...(rest.gradingType === "not_graded" ? { pointsPossible: 0 } : {}),
      })
      .where(eq(assignments.id, assignment.id))
      .returning();
    // Keep the linked quiz's dates/publish state in sync.
    const [quiz] = await ctx.db.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.assignmentId, assignment.id));
    const quizSync = definedOnly({ title: rest.title, dueAt: sent.dueAt, unlockAt: sent.unlockAt, lockAt: sent.lockAt, published: sent.published });
    if (quiz && Object.keys(quizSync).length) {
      await ctx.db.update(quizzes).set(quizSync).where(eq(quizzes.id, quiz.id));
    }
    if (sent.pointsPossible !== undefined && sent.pointsPossible !== assignment.pointsPossible) {
      await audit(ctx.db, { actorId: user.id, action: "assignment.points_changed", entityType: "assignment", entityId: assignment.id, courseId: assignment.courseId, metadata: { from: assignment.pointsPossible, to: sent.pointsPossible }, ip: req.ip });
    }
    return { assignment: { ...describeAssignment(updated!), description: updated!.descriptionMd } };
  });

  app.delete("/assignments/:id", async (req) => {
    const { user, assignment } = await load(req);
    await contentEditor(ctx, user, assignment.courseId);
    const [{ n } = { n: 0 }] = await ctx.db.select({ n: count() }).from(submissions).where(and(eq(submissions.assignmentId, assignment.id), ne(submissions.status, "unsubmitted")));
    await ctx.db.delete(moduleItems).where(and(eq(moduleItems.type, "assignment"), eq(moduleItems.refId, assignment.id)));
    await ctx.db.delete(assignments).where(eq(assignments.id, assignment.id));
    await audit(ctx.db, { actorId: user.id, action: "assignment.deleted", entityType: "assignment", entityId: assignment.id, courseId: assignment.courseId, metadata: { title: assignment.title, submissions: n }, ip: req.ip });
    return { ok: true };
  });

  app.post("/assignments/:id/post-grades", async (req) => {
    const { user, assignment } = await load(req);
    const access = await courseAccess(ctx, user, assignment.courseId);
    requireStaff(access);
    return { posted: await postGrades(ctx, access.course, assignment, user.id, req.ip) };
  });

  app.post("/assignments/:id/hide-grades", async (req) => {
    const { user, assignment } = await load(req);
    const access = await courseAccess(ctx, user, assignment.courseId);
    requireStaff(access);
    if (!assignment.postManually) {
      await ctx.db.update(assignments).set({ postManually: true }).where(eq(assignments.id, assignment.id));
    }
    return { hidden: await hideGrades(ctx, access.course, assignment, user.id, req.ip) };
  });
}
