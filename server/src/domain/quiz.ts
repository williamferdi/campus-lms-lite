/** Pure quiz scoring and result-visibility rules. */
import { round2 } from "./grading.js";

export type QuestionType = "multiple_choice" | "multiple_select" | "true_false" | "short_answer";
export type AnswerKey =
  | { kind: "choice"; correctChoiceIds: string[] }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; acceptedAnswers: string[] };
export type Response = string | string[] | boolean | null | undefined;

export interface ScorableQuestion {
  id: string;
  type: QuestionType;
  points: number;
  answerKey: AnswerKey;
}

export const normalizeText = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Auto-score one response. Returns `null` when the question needs manual grading
 * (short answer without accepted answers and a non-blank response).
 * Multiple select is all-or-nothing.
 */
export function autoScore(q: ScorableQuestion, response: Response): number | null {
  const key = q.answerKey;
  switch (q.type) {
    case "multiple_choice":
      return key.kind === "choice" && typeof response === "string" && key.correctChoiceIds.includes(response)
        ? q.points
        : 0;
    case "multiple_select": {
      if (key.kind !== "choice" || !Array.isArray(response)) return 0;
      const want = new Set(key.correctChoiceIds);
      const got = new Set(response);
      const exact = want.size === got.size && [...want].every((id) => got.has(id));
      return exact ? q.points : 0;
    }
    case "true_false":
      return key.kind === "boolean" && typeof response === "boolean" && response === key.value ? q.points : 0;
    case "short_answer": {
      const text = typeof response === "string" ? normalizeText(response) : "";
      if (text === "") return 0;
      if (key.kind !== "text" || key.acceptedAnswers.length === 0) return null;
      return key.acceptedAnswers.some((a) => normalizeText(a) === text) ? q.points : 0;
    }
  }
}

export type QuestionResult = { auto: number | null; manual: number | null; comment?: string };

export function scoreAttempt(
  questions: ScorableQuestion[],
  answers: Record<string, Response>,
  previous: Record<string, QuestionResult> = {},
): { results: Record<string, QuestionResult>; score: number; pointsPossible: number; needsReview: boolean } {
  const results: Record<string, QuestionResult> = {};
  let score = 0;
  let needsReview = false;
  for (const q of questions) {
    const auto = autoScore(q, answers[q.id]);
    const prev = previous[q.id];
    const r: QuestionResult = { auto, manual: prev?.manual ?? null };
    if (prev?.comment) r.comment = prev.comment;
    results[q.id] = r;
    const effective = r.manual ?? r.auto;
    if (effective === null) needsReview = true;
    else score += effective;
  }
  return {
    results,
    score: round2(score),
    pointsPossible: round2(questions.reduce((s, q) => s + q.points, 0)),
    needsReview,
  };
}

export function keptScore(
  attempts: { attemptNumber: number; score: number | null; submittedAt: Date | null }[],
  policy: "keep_highest" | "keep_latest",
): number | null {
  const done = attempts.filter((a) => a.submittedAt && a.score !== null);
  if (done.length === 0) return null;
  if (policy === "keep_latest") {
    return done.reduce((a, b) => (b.attemptNumber > a.attemptNumber ? b : a)).score;
  }
  return Math.max(...done.map((a) => a.score as number));
}

export interface ResultPolicy {
  hideResults: "never" | "always" | "until_after_last_attempt";
  showCorrectAnswers: boolean;
  showCorrectAnswersAt: Date | null;
  allowedAttempts: number | null;
}

export function resultVisibility(policy: ResultPolicy, attemptsUsed: number, now: Date) {
  let showResponses = true;
  if (policy.hideResults === "always") showResponses = false;
  if (policy.hideResults === "until_after_last_attempt") {
    showResponses = policy.allowedAttempts !== null && attemptsUsed >= policy.allowedAttempts;
  }
  const showCorrect =
    showResponses &&
    policy.showCorrectAnswers &&
    (!policy.showCorrectAnswersAt || now.getTime() >= policy.showCorrectAnswersAt.getTime());
  return { showResponses, showCorrectAnswers: showCorrect };
}

/** Server-side deadline for an attempt: earlier of time limit and quiz lock date. */
export function attemptDeadline(startedAt: Date, timeLimitMinutes: number | null, lockAt: Date | null): Date | null {
  const byLimit = timeLimitMinutes ? new Date(startedAt.getTime() + timeLimitMinutes * 60_000) : null;
  if (byLimit && lockAt) return byLimit < lockAt ? byLimit : lockAt;
  return byLimit ?? lockAt;
}
