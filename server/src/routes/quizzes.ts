import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, isNotNull, lt, max, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assignmentGroups, assignments, moduleItems, quizAttempts, quizQuestions, quizzes, users, type QuizAnswerKey, type QuizChoice, type QuizResponse } from "../db/schema.js";
import { attemptDeadline, keptScore, scoreAttempt, type AnswerKey, type Response } from "../domain/quiz.js";
import { conflict, forbidden, notFound, unprocessable } from "../lib/errors.js";
import { definedOnly, idParams, optionalDate, parse, requireChanges, trimmed } from "../lib/http.js";
import { renderMarkdown } from "../lib/markdown.js";
import { audit } from "../services/audit.js";
import { courseMemberIds, notify } from "../services/notify.js";
import { contentEditor, courseAccess, requireUser, requireWritable } from "../services/policy.js";
import { assertContentUnlocked, recordContentView } from "../services/progress.js";
import {
  attemptVisibility,
  expireIfNeeded,
  finalizeAttempt,
  presentAttempt,
  questionsOf,
  syncQuizPoints,
  syncQuizSubmission,
  type Quiz,
} from "../services/quizzes.js";
import type { AppContext } from "../types.js";

const quizFields = z
  .object({
    title: trimmed(1, 200),
    description: z.string().max(100_000),
    quizType: z.enum(["graded", "practice"]),
    timeLimitMinutes: z.number().int().min(1).max(600).nullable(),
    allowedAttempts: z.number().int().min(1).max(100).nullable(),
    scoringPolicy: z.enum(["keep_highest", "keep_latest"]),
    shuffleAnswers: z.boolean(),
    hideResults: z.enum(["never", "always", "until_after_last_attempt"]),
    showCorrectAnswers: z.boolean(),
    showCorrectAnswersAt: optionalDate,
    unlockAt: optionalDate,
    dueAt: optionalDate,
    lockAt: optionalDate,
    published: z.boolean(),
    postManually: z.boolean(),
    groupId: z.uuid().nullable(),
  })
  .partial();

const choiceId = () => randomBytes(6).toString("base64url");

const questionBody = z.object({
  type: z.enum(["multiple_choice", "multiple_select", "true_false", "short_answer"]),
  prompt: z.string().trim().min(1, "Write the question.").max(20_000),
  points: z.number().min(0).max(1000).default(1),
  choices: z.array(z.object({ id: z.string().max(20).optional(), text: z.string().trim().min(1, "Choices cannot be blank.").max(2000) })).max(20).default([]),
  correctChoiceIndexes: z.array(z.number().int().min(0)).max(20).default([]),
  correctBoolean: z.boolean().optional(),
  acceptedAnswers: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  feedback: z.string().max(5000).default(""),
});

function buildQuestion(b: z.infer<typeof questionBody>): { choices: QuizChoice[]; answerKey: QuizAnswerKey } {
  switch (b.type) {
    case "multiple_choice":
    case "multiple_select": {
      if (b.choices.length < 2) throw unprocessable("Add at least two answer choices.");
      const choices = b.choices.map((c) => ({ id: c.id || choiceId(), text: c.text }));
      const idx = [...new Set(b.correctChoiceIndexes)].filter((i) => i < choices.length);
      if (b.type === "multiple_choice" && idx.length !== 1) throw unprocessable("Mark exactly one correct answer.");
      if (b.type === "multiple_select" && idx.length < 1) throw unprocessable("Mark at least one correct answer.");
      return { choices, answerKey: { kind: "choice", correctChoiceIds: idx.map((i) => choices[i]!.id) } };
    }
    case "true_false":
      if (b.correctBoolean === undefined) throw unprocessable("Choose whether the statement is true or false.");
      return {
        choices: [
          { id: "true", text: "True" },
          { id: "false", text: "False" },
        ],
        answerKey: { kind: "boolean", value: b.correctBoolean },
      };
    case "short_answer":
      return { choices: [], answerKey: { kind: "text", acceptedAnswers: b.acceptedAnswers } };
  }
}

function validResponse(type: string, value: unknown, choiceIds: string[]): QuizResponse {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "multiple_choice":
      return typeof value === "string" && choiceIds.includes(value) ? value : null;
    case "multiple_select":
      return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && choiceIds.includes(v)))] : null;
    case "true_false":
      return typeof value === "boolean" ? value : null;
    case "short_answer":
      return typeof value === "string" ? value.slice(0, 5000) : null;
    default:
      return null;
  }
}

/** Why a student can't start a new attempt right now (null = allowed). */
function startBlockReason(quiz: Quiz, used: number, now: Date): string | null {
  if (!quiz.published) return "This quiz is not available.";
  if (quiz.unlockAt && now < quiz.unlockAt) return `This quiz opens ${quiz.unlockAt.toISOString()}.`;
  if (quiz.lockAt && now >= quiz.lockAt) return "This quiz is closed.";
  if (quiz.allowedAttempts !== null && used >= quiz.allowedAttempts) return "You have used all allowed attempts.";
  return null;
}

function describeQuiz(q: Quiz, staff: boolean) {
  return {
    id: q.id,
    courseId: q.courseId,
    assignmentId: q.assignmentId,
    title: q.title,
    descriptionHtml: q.descriptionHtml,
    ...(staff ? { description: q.descriptionMd } : {}),
    quizType: q.quizType,
    timeLimitMinutes: q.timeLimitMinutes,
    allowedAttempts: q.allowedAttempts,
    scoringPolicy: q.scoringPolicy,
    shuffleAnswers: q.shuffleAnswers,
    hideResults: q.hideResults,
    showCorrectAnswers: q.showCorrectAnswers,
    showCorrectAnswersAt: q.showCorrectAnswersAt,
    unlockAt: q.unlockAt,
    dueAt: q.dueAt,
    lockAt: q.lockAt,
    published: q.published,
  };
}

export default async function quizRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  async function loadQuiz(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [quiz] = await ctx.db.select().from(quizzes).where(eq(quizzes.id, id));
    if (!quiz) throw notFound("Quiz");
    const access = await courseAccess(ctx, user, quiz.courseId);
    if (!access.isStaff && !quiz.published) throw notFound("Quiz");
    return { user, quiz, access };
  }

  async function myAttempts(quizId: string, userId: string) {
    return ctx.db.select().from(quizAttempts).where(and(eq(quizAttempts.quizId, quizId), eq(quizAttempts.userId, userId))).orderBy(asc(quizAttempts.attemptNumber));
  }

  // ------------------------------------------------------------ quizzes
  app.get("/courses/:id/quizzes", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    const rows = await ctx.db
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.courseId, id), access.isStaff ? undefined : eq(quizzes.published, true)))
      .orderBy(asc(quizzes.dueAt), asc(quizzes.title));
    const qCounts = await ctx.db
      .select({ quizId: quizQuestions.quizId, n: count(), points: sql<number>`coalesce(sum(${quizQuestions.points}), 0)::float8` })
      .from(quizQuestions)
      .innerJoin(quizzes, eq(quizzes.id, quizQuestions.quizId))
      .where(eq(quizzes.courseId, id))
      .groupBy(quizQuestions.quizId);
    const now = new Date();
    const data = [];
    for (const q of rows) {
      const counts = qCounts.find((c) => c.quizId === q.id);
      const base = { ...describeQuiz(q, access.isStaff), questionCount: counts?.n ?? 0, pointsPossible: Number(counts?.points ?? 0) };
      if (access.isStaff) {
        const attempts = await ctx.db.select({ status: quizAttempts.status }).from(quizAttempts).where(and(eq(quizAttempts.quizId, q.id), isNotNull(quizAttempts.submittedAt)));
        data.push({ ...base, submittedAttempts: attempts.length, pendingReview: attempts.filter((a) => a.status === "pending_review").length });
      } else {
        const mine = await myAttempts(q.id, user.id);
        const done = mine.filter((a) => a.submittedAt);
        const vis = await attemptVisibility(ctx, q, user.id, done.length, now);
        data.push({
          ...base,
          attemptsUsed: done.length,
          inProgressAttemptId: mine.find((a) => a.status === "in_progress" && (!a.expiresAt || a.expiresAt > now))?.id ?? null,
          keptScore: vis.scoreVisible ? keptScore(done, q.scoringPolicy) : null,
          startBlockReason: startBlockReason(q, done.length, now),
        });
      }
    }
    return { data };
  });

  app.post("/courses/:id/quizzes", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await contentEditor(ctx, user, id);
    const body = parse(quizFields.required({ title: true }), req.body);
    const quizType = body.quizType ?? "graded";
    if (body.unlockAt && body.dueAt && body.unlockAt > body.dueAt) throw unprocessable("The quiz must open before it is due.");
    if (body.dueAt && body.lockAt && body.dueAt > body.lockAt) throw unprocessable("The quiz must close after it is due.");
    const quiz = await ctx.db.transaction(async (tx) => {
      let assignmentId: string | null = null;
      if (quizType === "graded") {
        let groupId = body.groupId ?? null;
        if (groupId) {
          const [g] = await tx.select().from(assignmentGroups).where(and(eq(assignmentGroups.id, groupId), eq(assignmentGroups.courseId, id)));
          if (!g) throw unprocessable("Unknown assignment group.");
        } else {
          const [g] = await tx.select().from(assignmentGroups).where(eq(assignmentGroups.courseId, id)).orderBy(asc(assignmentGroups.position)).limit(1);
          groupId = g?.id ?? null;
        }
        const [a] = await tx
          .insert(assignments)
          .values({
            courseId: id,
            groupId,
            title: body.title,
            pointsPossible: 0,
            submissionTypes: ["online_quiz"],
            unlockAt: body.unlockAt ?? null,
            dueAt: body.dueAt ?? null,
            lockAt: body.lockAt ?? null,
            published: false,
            postManually: body.postManually ?? false,
          })
          .returning();
        assignmentId = a!.id;
      }
      const [q] = await tx
        .insert(quizzes)
        .values({
          courseId: id,
          assignmentId,
          title: body.title,
          descriptionMd: body.description ?? "",
          descriptionHtml: renderMarkdown(body.description ?? ""),
          quizType,
          timeLimitMinutes: body.timeLimitMinutes ?? null,
          allowedAttempts: body.allowedAttempts === undefined ? 1 : body.allowedAttempts,
          scoringPolicy: body.scoringPolicy ?? "keep_highest",
          shuffleAnswers: body.shuffleAnswers ?? false,
          hideResults: body.hideResults ?? "never",
          showCorrectAnswers: body.showCorrectAnswers ?? true,
          showCorrectAnswersAt: body.showCorrectAnswersAt ?? null,
          unlockAt: body.unlockAt ?? null,
          dueAt: body.dueAt ?? null,
          lockAt: body.lockAt ?? null,
          published: false, // publish after adding questions
        })
        .returning();
      return q!;
    });
    reply.status(201);
    return { quiz: describeQuiz(quiz, true) };
  });

  app.get("/quizzes/:id", async (req) => {
    const { user, quiz, access } = await loadQuiz(req);
    const qs = await questionsOf(ctx, quiz.id);
    const base = { ...describeQuiz(quiz, access.isStaff), questionCount: qs.length, pointsPossible: qs.reduce((s, q) => s + q.points, 0) };
    if (access.isStaff) {
      const [assignment] = quiz.assignmentId ? await ctx.db.select({ postManually: assignments.postManually, groupId: assignments.groupId }).from(assignments).where(eq(assignments.id, quiz.assignmentId)) : [];
      return { quiz: { ...base, postManually: assignment?.postManually ?? false, groupId: assignment?.groupId ?? null }, attempts: [], startBlockReason: null };
    }
    await assertContentUnlocked(ctx, access, user.id, quiz.id);
    await recordContentView(ctx, access, user.id, quiz.id);
    const now = new Date();
    let mine = await myAttempts(quiz.id, user.id);
    for (const a of mine) await expireIfNeeded(ctx, quiz, a, now);
    mine = await myAttempts(quiz.id, user.id);
    const done = mine.filter((a) => a.submittedAt);
    const vis = await attemptVisibility(ctx, quiz, user.id, done.length, now);
    return {
      quiz: base,
      attempts: mine.map((a) => ({
        id: a.id,
        attemptNumber: a.attemptNumber,
        status: a.status,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        expiresAt: a.expiresAt,
        score: vis.scoreVisible && a.submittedAt ? a.score : null,
        pointsPossible: a.pointsPossible,
      })),
      keptScore: vis.scoreVisible ? keptScore(done, quiz.scoringPolicy) : null,
      visibility: vis,
      startBlockReason: access.readOnly ? "This course is read-only." : startBlockReason(quiz, done.length, now),
    };
  });

  app.patch("/quizzes/:id", async (req) => {
    const { user, quiz, access } = await loadQuiz(req);
    await contentEditor(ctx, user, quiz.courseId);
    const body = requireChanges(parse(quizFields.omit({ quizType: true }), req.body));
    const next = { ...quiz, ...body };
    if (next.unlockAt && next.dueAt && next.unlockAt > next.dueAt) throw unprocessable("The quiz must open before it is due.");
    if (next.dueAt && next.lockAt && next.dueAt > next.lockAt) throw unprocessable("The quiz must close after it is due.");
    if (body.published === true && !quiz.published) {
      const [{ n } = { n: 0 }] = await ctx.db.select({ n: count() }).from(quizQuestions).where(eq(quizQuestions.quizId, quiz.id));
      if (n === 0) throw unprocessable("Add at least one question before publishing.");
    }
    if (body.published === false && quiz.published) {
      const [{ n } = { n: 0 }] = await ctx.db.select({ n: count() }).from(quizAttempts).where(eq(quizAttempts.quizId, quiz.id));
      if (n > 0) throw conflict("This quiz cannot be unpublished because students have already started it.");
    }
    const { description, postManually, groupId, ...rest } = body;
    const [updated] = await ctx.db
      .update(quizzes)
      .set({ ...rest, ...(description !== undefined ? { descriptionMd: description, descriptionHtml: renderMarkdown(description) } : {}) })
      .where(eq(quizzes.id, quiz.id))
      .returning();
    if (quiz.assignmentId) {
      const sync = definedOnly({ title: rest.title, dueAt: rest.dueAt, unlockAt: rest.unlockAt, lockAt: rest.lockAt, published: rest.published, postManually, groupId: groupId ?? undefined });
      if (Object.keys(sync).length) await ctx.db.update(assignments).set(sync).where(eq(assignments.id, quiz.assignmentId));
    }
    if (body.published === true && !quiz.published && access.course.status === "published") {
      await notify(ctx, await courseMemberIds(ctx, quiz.courseId), {
        type: "quiz",
        title: `New quiz: ${updated!.title}`,
        body: updated!.dueAt ? `Due ${updated!.dueAt.toISOString()}` : "",
        link: `/courses/${quiz.courseId}/quizzes/${quiz.id}`,
        courseId: quiz.courseId,
      });
    }
    return { quiz: describeQuiz(updated!, true) };
  });

  app.delete("/quizzes/:id", async (req) => {
    const { user, quiz } = await loadQuiz(req);
    await contentEditor(ctx, user, quiz.courseId);
    await ctx.db.delete(moduleItems).where(and(eq(moduleItems.type, "quiz"), eq(moduleItems.refId, quiz.id)));
    await ctx.db.delete(quizzes).where(eq(quizzes.id, quiz.id));
    if (quiz.assignmentId) await ctx.db.delete(assignments).where(eq(assignments.id, quiz.assignmentId));
    await audit(ctx.db, { actorId: user.id, action: "quiz.deleted", entityType: "quiz", entityId: quiz.id, courseId: quiz.courseId, metadata: { title: quiz.title }, ip: req.ip });
    return { ok: true };
  });

  // ------------------------------------------------------------ questions (staff only)
  app.get("/quizzes/:id/questions", async (req) => {
    const { quiz, access } = await loadQuiz(req);
    if (!access.isStaff) throw forbidden("Answer keys are only available to course staff.");
    return { data: await questionsOf(ctx, quiz.id) };
  });

  app.post("/quizzes/:id/questions", async (req, reply) => {
    const { user, quiz } = await loadQuiz(req);
    await contentEditor(ctx, user, quiz.courseId);
    const body = parse(questionBody, req.body);
    const built = buildQuestion(body);
    const [{ pos } = { pos: 0 }] = await ctx.db.select({ pos: max(quizQuestions.position) }).from(quizQuestions).where(eq(quizQuestions.quizId, quiz.id));
    const [question] = await ctx.db
      .insert(quizQuestions)
      .values({ quizId: quiz.id, position: (pos ?? 0) + 1, type: body.type, promptMd: body.prompt, promptHtml: renderMarkdown(body.prompt), points: body.points, feedback: body.feedback, ...built })
      .returning();
    await syncQuizPoints(ctx, quiz);
    reply.status(201);
    return { question };
  });

  async function loadQuestion(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [question] = await ctx.db.select().from(quizQuestions).where(eq(quizQuestions.id, id));
    if (!question) throw notFound("Question");
    const [quiz] = await ctx.db.select().from(quizzes).where(eq(quizzes.id, question.quizId));
    await contentEditor(ctx, user, quiz!.courseId);
    return { user, question, quiz: quiz! };
  }

  app.patch("/quiz-questions/:id", async (req) => {
    const { question, quiz } = await loadQuestion(req);
    const body = parse(questionBody, req.body);
    const built = buildQuestion(body);
    const [updated] = await ctx.db
      .update(quizQuestions)
      .set({ type: body.type, promptMd: body.prompt, promptHtml: renderMarkdown(body.prompt), points: body.points, feedback: body.feedback, ...built })
      .where(eq(quizQuestions.id, question.id))
      .returning();
    await syncQuizPoints(ctx, quiz);
    return { question: updated };
  });

  app.delete("/quiz-questions/:id", async (req) => {
    const { question, quiz } = await loadQuestion(req);
    await ctx.db.delete(quizQuestions).where(eq(quizQuestions.id, question.id));
    await syncQuizPoints(ctx, quiz);
    return { ok: true };
  });

  app.post("/quizzes/:id/questions/reorder", async (req) => {
    const { user, quiz } = await loadQuiz(req);
    await contentEditor(ctx, user, quiz.courseId);
    const { questionIds } = parse(z.object({ questionIds: z.array(z.uuid()).max(500) }), req.body);
    const existing = await questionsOf(ctx, quiz.id);
    if (existing.length !== questionIds.length || !existing.every((q) => questionIds.includes(q.id))) throw unprocessable("Provide every question exactly once.");
    for (const [i, qid] of questionIds.entries()) await ctx.db.update(quizQuestions).set({ position: i + 1 }).where(eq(quizQuestions.id, qid));
    return { ok: true };
  });

  /** Re-score submitted attempts with the current answer keys (manual scores are kept). */
  app.post("/quizzes/:id/regrade", async (req) => {
    const { user, quiz } = await loadQuiz(req);
    await contentEditor(ctx, user, quiz.courseId);
    const qs = await questionsOf(ctx, quiz.id);
    const attempts = await ctx.db.select().from(quizAttempts).where(and(eq(quizAttempts.quizId, quiz.id), isNotNull(quizAttempts.submittedAt)));
    const touched = new Set<string>();
    for (const a of attempts) {
      const scored = scoreAttempt(qs.map((q) => ({ id: q.id, type: q.type, points: q.points, answerKey: q.answerKey as AnswerKey })), a.answers as Record<string, Response>, a.results);
      await ctx.db
        .update(quizAttempts)
        .set({ results: scored.results, score: scored.score, pointsPossible: scored.pointsPossible, status: scored.needsReview ? "pending_review" : "graded" })
        .where(eq(quizAttempts.id, a.id));
      touched.add(a.userId);
    }
    for (const userId of touched) await syncQuizSubmission(ctx, quiz, userId, user.id);
    await audit(ctx.db, { actorId: user.id, action: "quiz.regraded", entityType: "quiz", entityId: quiz.id, courseId: quiz.courseId, metadata: { attempts: attempts.length }, ip: req.ip });
    return { regraded: attempts.length };
  });

  // ------------------------------------------------------------ attempts
  app.post("/quizzes/:id/attempts", async (req, reply) => {
    const { user, quiz, access } = await loadQuiz(req);
    if (access.role !== "student") throw forbidden("Only students take quizzes.");
    requireWritable(access);
    await assertContentUnlocked(ctx, access, user.id, quiz.id);
    const now = new Date();
    const mine = await myAttempts(quiz.id, user.id);
    for (const a of mine) {
      const current = await expireIfNeeded(ctx, quiz, a, now);
      if (current.status === "in_progress") {
        // Resume the open attempt rather than starting another.
        const qs = await questionsOf(ctx, quiz.id);
        return { attempt: presentAttempt(quiz, current, qs, { scoreVisible: false, responsesVisible: false, correctAnswersVisible: false }), resumed: true };
      }
    }
    const used = mine.length;
    const blocked = startBlockReason(quiz, used, now);
    if (blocked) throw forbidden(blocked);
    const qs = await questionsOf(ctx, quiz.id);
    if (qs.length === 0) throw unprocessable("This quiz has no questions yet.");
    const [attempt] = await ctx.db
      .insert(quizAttempts)
      .values({ quizId: quiz.id, userId: user.id, attemptNumber: used + 1, startedAt: now, expiresAt: attemptDeadline(now, quiz.timeLimitMinutes, quiz.lockAt) })
      .returning();
    reply.status(201);
    return { attempt: presentAttempt(quiz, attempt!, qs, { scoreVisible: false, responsesVisible: false, correctAnswersVisible: false }), resumed: false };
  });

  async function loadAttempt(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [attempt] = await ctx.db.select().from(quizAttempts).where(eq(quizAttempts.id, id));
    if (!attempt) throw notFound("Attempt");
    const [quiz] = await ctx.db.select().from(quizzes).where(eq(quizzes.id, attempt.quizId));
    const access = await courseAccess(ctx, user, quiz!.courseId);
    if (attempt.userId !== user.id && !access.canGrade) throw notFound("Attempt");
    return { user, attempt, quiz: quiz!, access };
  }

  async function presentFor(viewerIsGrader: boolean, quiz: Quiz, attemptId: string, userId: string) {
    const [attempt] = await ctx.db.select().from(quizAttempts).where(eq(quizAttempts.id, attemptId));
    const qs = await questionsOf(ctx, quiz.id);
    if (viewerIsGrader) {
      return { ...presentAttempt(quiz, attempt!, qs, { scoreVisible: true, responsesVisible: true, correctAnswersVisible: true }), results: attempt!.results };
    }
    const [{ n } = { n: 0 }] = await ctx.db.select({ n: count() }).from(quizAttempts).where(and(eq(quizAttempts.quizId, quiz.id), eq(quizAttempts.userId, userId), isNotNull(quizAttempts.submittedAt)));
    return presentAttempt(quiz, attempt!, qs, await attemptVisibility(ctx, quiz, userId, n));
  }

  app.get("/quiz-attempts/:id", async (req) => {
    const { user, attempt, quiz, access } = await loadAttempt(req);
    await expireIfNeeded(ctx, quiz, attempt);
    const [student] = await ctx.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, attempt.userId));
    return { attempt: await presentFor(access.canGrade && attempt.userId !== user.id, quiz, attempt.id, attempt.userId), student, quiz: describeQuiz(quiz, access.isStaff) };
  });

  const answersBody = z.object({ answers: z.record(z.string(), z.unknown()).default({}) });

  async function mergeAnswers(quiz: Quiz, current: Record<string, QuizResponse>, incoming: Record<string, unknown>) {
    const qs = await questionsOf(ctx, quiz.id);
    const merged = { ...current };
    for (const q of qs) {
      if (q.id in incoming) merged[q.id] = validResponse(q.type, incoming[q.id], q.choices.map((c) => c.id));
    }
    return merged;
  }

  app.put("/quiz-attempts/:id/answers", async (req) => {
    const { user, attempt, quiz, access } = await loadAttempt(req);
    if (attempt.userId !== user.id) throw forbidden();
    requireWritable(access);
    const current = await expireIfNeeded(ctx, quiz, attempt);
    if (current.status !== "in_progress") throw conflict("Time is up — this attempt has been submitted with your saved answers.");
    const { answers } = parse(answersBody, req.body);
    const merged = await mergeAnswers(quiz, attempt.answers, answers);
    await ctx.db.update(quizAttempts).set({ answers: merged }).where(eq(quizAttempts.id, attempt.id));
    return { savedAt: new Date().toISOString(), expiresAt: attempt.expiresAt };
  });

  app.post("/quiz-attempts/:id/submit", async (req) => {
    const { user, attempt, quiz, access } = await loadAttempt(req);
    if (attempt.userId !== user.id) throw forbidden();
    requireWritable(access);
    const now = new Date();
    let current = attempt;
    if (attempt.status === "in_progress" && (!attempt.expiresAt || attempt.expiresAt > now)) {
      // Answers sent with the final submit are accepted only while time remains.
      const { answers } = parse(answersBody, req.body ?? {});
      const merged = await mergeAnswers(quiz, attempt.answers, answers);
      [current] = await ctx.db.update(quizAttempts).set({ answers: merged }).where(eq(quizAttempts.id, attempt.id)).returning() as [typeof attempt];
    }
    await finalizeAttempt(ctx, quiz, current, now);
    return { attempt: await presentFor(false, quiz, attempt.id, user.id) };
  });

  app.get("/quizzes/:id/attempts", async (req) => {
    const { user, quiz, access } = await loadQuiz(req);
    const rows = await ctx.db
      .select({ attempt: quizAttempts, name: users.name, sortableName: users.sortableName })
      .from(quizAttempts)
      .innerJoin(users, eq(users.id, quizAttempts.userId))
      .where(and(eq(quizAttempts.quizId, quiz.id), access.canGrade ? undefined : eq(quizAttempts.userId, user.id)))
      .orderBy(asc(users.sortableName), desc(quizAttempts.attemptNumber));
    return {
      data: rows.map((r) => ({
        id: r.attempt.id,
        userId: r.attempt.userId,
        studentName: r.name,
        attemptNumber: r.attempt.attemptNumber,
        status: r.attempt.status,
        startedAt: r.attempt.startedAt,
        submittedAt: r.attempt.submittedAt,
        score: access.canGrade ? r.attempt.score : null,
        pointsPossible: r.attempt.pointsPossible,
      })),
    };
  });

  /** Manual grading of individual questions (short answers, or overrides). */
  app.put("/quiz-attempts/:id/grade", async (req) => {
    const { user, attempt, quiz, access } = await loadAttempt(req);
    if (!access.canGrade) throw forbidden();
    requireWritable(access);
    if (!attempt.submittedAt) throw unprocessable("This attempt has not been submitted yet.");
    const body = parse(
      z.object({
        scores: z.record(z.string(), z.number().min(0).nullable()).default({}),
        comments: z.record(z.string(), z.string().max(5000)).default({}),
      }),
      req.body,
    );
    const qs = await questionsOf(ctx, quiz.id);
    const results = { ...attempt.results };
    for (const q of qs) {
      const prev = results[q.id] ?? { auto: null, manual: null };
      const next = { ...prev };
      if (q.id in body.scores) {
        const v = body.scores[q.id]!;
        if (v !== null && v > q.points) throw unprocessable(`Question ${q.position} is worth at most ${q.points} points.`);
        next.manual = v;
      }
      if (q.id in body.comments) next.comment = body.comments[q.id]!;
      results[q.id] = next;
    }
    const scored = scoreAttempt(qs.map((q) => ({ id: q.id, type: q.type, points: q.points, answerKey: q.answerKey as AnswerKey })), attempt.answers as Record<string, Response>, results);
    await ctx.db
      .update(quizAttempts)
      .set({ results: scored.results, score: scored.score, status: scored.needsReview ? "pending_review" : "graded" })
      .where(eq(quizAttempts.id, attempt.id));
    await syncQuizSubmission(ctx, quiz, attempt.userId, user.id);
    await audit(ctx.db, { actorId: user.id, action: "quiz_attempt.graded", entityType: "quiz_attempt", entityId: attempt.id, courseId: quiz.courseId, metadata: { score: scored.score, studentId: attempt.userId }, ip: req.ip });
    return { attempt: await presentFor(true, quiz, attempt.id, attempt.userId) };
  });
}

/** Expire stale attempts for every quiz (called periodically by the server). */
export async function expireStaleAttempts(ctx: AppContext) {
  const stale = await ctx.db
    .select({ attempt: quizAttempts, quiz: quizzes })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
    .where(and(eq(quizAttempts.status, "in_progress"), lt(quizAttempts.expiresAt, new Date())));
  for (const s of stale) await finalizeAttempt(ctx, s.quiz, s.attempt);
  return stale.length;
}

