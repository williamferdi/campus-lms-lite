import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { assignments, courses, quizAttempts, quizQuestions, quizzes, submissions } from "../db/schema.js";
import { keptScore, resultVisibility, scoreAttempt, type AnswerKey, type Response } from "../domain/quiz.js";
import type { AppContext } from "../types.js";
import { getOrCreateSubmission, setGrade } from "./grading.js";

export type Quiz = typeof quizzes.$inferSelect;
export type Question = typeof quizQuestions.$inferSelect;
export type Attempt = typeof quizAttempts.$inferSelect;

export async function questionsOf(ctx: AppContext, quizId: string) {
  return ctx.db.select().from(quizQuestions).where(eq(quizQuestions.quizId, quizId)).orderBy(asc(quizQuestions.position));
}

const scorable = (qs: Question[]) => qs.map((q) => ({ id: q.id, type: q.type, points: q.points, answerKey: q.answerKey as AnswerKey }));

/** Deterministic per-attempt shuffle so a refresh shows the same order. */
function shuffled<T>(items: T[], seed: string): T[] {
  return items
    .map((item, i) => ({ item, k: createHash("sha256").update(`${seed}:${i}`).digest("hex") }))
    .sort((a, b) => a.k.localeCompare(b.k))
    .map((x) => x.item);
}

/** Questions as a student taking the quiz sees them: never includes answer keys or feedback. */
export function studentQuestions(quiz: Quiz, qs: Question[], attemptId: string) {
  return qs.map((q) => ({
    id: q.id,
    position: q.position,
    type: q.type,
    promptHtml: q.promptHtml,
    points: q.points,
    choices: quiz.shuffleAnswers && q.type !== "true_false" ? shuffled(q.choices, `${attemptId}:${q.id}`) : q.choices,
  }));
}

/** Finalize an attempt: score it, set status, and push the result to the gradebook. */
export async function finalizeAttempt(ctx: AppContext, quiz: Quiz, attempt: Attempt, now = new Date()): Promise<Attempt> {
  if (attempt.submittedAt) return attempt;
  const qs = await questionsOf(ctx, quiz.id);
  const scored = scoreAttempt(scorable(qs), attempt.answers as Record<string, Response>, attempt.results);
  const submittedAt = attempt.expiresAt && attempt.expiresAt < now ? attempt.expiresAt : now;
  const [updated] = await ctx.db
    .update(quizAttempts)
    .set({
      submittedAt,
      results: scored.results,
      score: scored.score,
      pointsPossible: scored.pointsPossible,
      status: scored.needsReview ? "pending_review" : "graded",
    })
    .where(and(eq(quizAttempts.id, attempt.id), eq(quizAttempts.status, "in_progress")))
    .returning();
  if (!updated) {
    const [current] = await ctx.db.select().from(quizAttempts).where(eq(quizAttempts.id, attempt.id));
    return current!;
  }
  await syncQuizSubmission(ctx, quiz, attempt.userId, null);
  return updated;
}

/** Auto-submit an in-progress attempt whose deadline has passed. */
export async function expireIfNeeded(ctx: AppContext, quiz: Quiz, attempt: Attempt, now = new Date()) {
  if (attempt.status === "in_progress" && attempt.expiresAt && attempt.expiresAt <= now) {
    return finalizeAttempt(ctx, quiz, attempt, now);
  }
  return attempt;
}

/**
 * Mirror quiz attempts into the linked assignment's submission so the gradebook, posting policy,
 * late policy and notifications behave exactly like other assignments.
 */
export async function syncQuizSubmission(ctx: AppContext, quiz: Quiz, userId: string, graderId: string | null) {
  if (!quiz.assignmentId) return;
  const [assignment] = await ctx.db.select().from(assignments).where(eq(assignments.id, quiz.assignmentId));
  const [course] = await ctx.db.select().from(courses).where(eq(courses.id, quiz.courseId));
  if (!assignment || !course) return;
  const attempts = await ctx.db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.quizId, quiz.id), eq(quizAttempts.userId, userId), isNotNull(quizAttempts.submittedAt)));
  if (attempts.length === 0) return;
  const sub = await getOrCreateSubmission(ctx, assignment.id, userId);
  const latest = attempts.reduce((a, b) => (b.submittedAt! > a.submittedAt! ? b : a));
  const pending = attempts.some((a) => a.status === "pending_review");
  await ctx.db
    .update(submissions)
    .set({
      attempt: attempts.length,
      submittedAt: latest.submittedAt,
      submissionType: "online_quiz",
      ...(pending ? { status: "pending_review" as const } : {}),
    })
    .where(eq(submissions.id, sub.id));
  if (pending) return;
  const kept = keptScore(attempts, quiz.scoringPolicy);
  await setGrade(ctx, {
    course,
    assignment,
    studentId: userId,
    graderId,
    change: { score: kept },
    source: "quiz",
  });
}

/** What a student may see about a submitted attempt. */
export async function attemptVisibility(ctx: AppContext, quiz: Quiz, userId: string, attemptsUsed: number, now = new Date()) {
  let posted = true;
  if (quiz.assignmentId) {
    const [sub] = await ctx.db
      .select({ postedAt: submissions.postedAt })
      .from(submissions)
      .where(and(eq(submissions.assignmentId, quiz.assignmentId), eq(submissions.userId, userId)));
    posted = !!sub?.postedAt;
  }
  const rv = resultVisibility(
    {
      hideResults: quiz.hideResults,
      showCorrectAnswers: quiz.showCorrectAnswers,
      showCorrectAnswersAt: quiz.showCorrectAnswersAt,
      allowedAttempts: quiz.allowedAttempts,
    },
    attemptsUsed,
    now,
  );
  return {
    scoreVisible: posted,
    responsesVisible: posted && rv.showResponses,
    correctAnswersVisible: posted && rv.showCorrectAnswers,
  };
}

export function presentAttempt(
  quiz: Quiz,
  attempt: Attempt,
  qs: Question[],
  vis: { scoreVisible: boolean; responsesVisible: boolean; correctAnswersVisible: boolean },
) {
  const answers = attempt.answers as Record<string, Response>;
  return {
    id: attempt.id,
    quizId: attempt.quizId,
    userId: attempt.userId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    score: vis.scoreVisible && attempt.status !== "in_progress" ? attempt.score : null,
    pointsPossible: attempt.pointsPossible ?? qs.reduce((s, q) => s + q.points, 0),
    visibility: vis,
    questions: studentQuestions(quiz, qs, attempt.id).map((q) => {
      const original = qs.find((x) => x.id === q.id)!;
      const r = attempt.results[q.id];
      const earned = r ? (r.manual ?? r.auto) : null;
      return {
        ...q,
        answer: answers[q.id] ?? null,
        ...(vis.responsesVisible && attempt.status !== "in_progress"
          ? { earned, correct: earned === null ? null : earned >= q.points, comment: r?.comment ?? null, needsReview: earned === null }
          : {}),
        ...(vis.correctAnswersVisible && attempt.status !== "in_progress"
          ? { answerKey: original.answerKey, feedback: original.feedback }
          : {}),
      };
    }),
  };
}

/** Recalculate sums: keeps the linked assignment's points in step with the questions. */
export async function syncQuizPoints(ctx: AppContext, quiz: Quiz) {
  if (!quiz.assignmentId) return;
  const qs = await questionsOf(ctx, quiz.id);
  const total = Math.round(qs.reduce((s, q) => s + q.points, 0) * 100) / 100;
  await ctx.db.update(assignments).set({ pointsPossible: total }).where(eq(assignments.id, quiz.assignmentId));
}
