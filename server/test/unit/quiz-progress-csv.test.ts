import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvObjects, toCsv } from "../../src/domain/csv.js";
import { computeProgress, type ProgressFacts, type ProgressItem, type ProgressModule } from "../../src/domain/progress.js";
import { attemptDeadline, autoScore, keptScore, resultVisibility, scoreAttempt, type ScorableQuestion } from "../../src/domain/quiz.js";

const mc: ScorableQuestion = { id: "q1", type: "multiple_choice", points: 2, answerKey: { kind: "choice", correctChoiceIds: ["b"] } };
const ms: ScorableQuestion = { id: "q2", type: "multiple_select", points: 3, answerKey: { kind: "choice", correctChoiceIds: ["a", "c"] } };
const tf: ScorableQuestion = { id: "q3", type: "true_false", points: 1, answerKey: { kind: "boolean", value: false } };
const saKey: ScorableQuestion = { id: "q4", type: "short_answer", points: 2, answerKey: { kind: "text", acceptedAnswers: ["Photosynthesis"] } };
const saOpen: ScorableQuestion = { id: "q5", type: "short_answer", points: 4, answerKey: { kind: "text", acceptedAnswers: [] } };

describe("quiz auto scoring", () => {
  it("scores objective questions", () => {
    expect(autoScore(mc, "b")).toBe(2);
    expect(autoScore(mc, "a")).toBe(0);
    expect(autoScore(mc, null)).toBe(0);
    expect(autoScore(ms, ["c", "a"])).toBe(3);
    expect(autoScore(ms, ["a"])).toBe(0);
    expect(autoScore(ms, ["a", "b", "c"])).toBe(0);
    expect(autoScore(tf, false)).toBe(1);
    expect(autoScore(tf, "false")).toBe(0);
  });

  it("short answers match accepted answers case/space-insensitively or need review", () => {
    expect(autoScore(saKey, "  photosynthesis ")).toBe(2);
    expect(autoScore(saKey, "respiration")).toBe(0);
    expect(autoScore(saOpen, "An essay")).toBeNull();
    expect(autoScore(saOpen, "   ")).toBe(0);
  });

  it("scoreAttempt sums points, flags manual review and keeps manual overrides", () => {
    const qs = [mc, ms, tf, saOpen];
    const first = scoreAttempt(qs, { q1: "b", q2: ["a", "c"], q3: true, q5: "essay" });
    expect(first).toMatchObject({ score: 5, pointsPossible: 10, needsReview: true });
    const regraded = scoreAttempt(qs, { q1: "b", q2: ["a", "c"], q3: true, q5: "essay" }, { q5: { auto: null, manual: 3 } });
    expect(regraded).toMatchObject({ score: 8, needsReview: false });
  });

  it("keeps highest or latest attempt", () => {
    const attempts = [
      { attemptNumber: 1, score: 8, submittedAt: new Date() },
      { attemptNumber: 2, score: 5, submittedAt: new Date() },
      { attemptNumber: 3, score: null, submittedAt: null },
    ];
    expect(keptScore(attempts, "keep_highest")).toBe(8);
    expect(keptScore(attempts, "keep_latest")).toBe(5);
    expect(keptScore([], "keep_highest")).toBeNull();
  });

  it("applies result visibility policy", () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const base = { hideResults: "never" as const, showCorrectAnswers: true, showCorrectAnswersAt: null, allowedAttempts: 2 };
    expect(resultVisibility(base, 1, now)).toEqual({ showResponses: true, showCorrectAnswers: true });
    expect(resultVisibility({ ...base, hideResults: "always" }, 1, now)).toEqual({ showResponses: false, showCorrectAnswers: false });
    expect(resultVisibility({ ...base, hideResults: "until_after_last_attempt" }, 1, now).showResponses).toBe(false);
    expect(resultVisibility({ ...base, hideResults: "until_after_last_attempt" }, 2, now).showResponses).toBe(true);
    expect(resultVisibility({ ...base, showCorrectAnswersAt: new Date("2026-06-01") }, 1, now).showCorrectAnswers).toBe(false);
  });

  it("computes the attempt deadline from time limit and lock date", () => {
    const start = new Date("2026-05-01T10:00:00Z");
    expect(attemptDeadline(start, 30, null)?.toISOString()).toBe("2026-05-01T10:30:00.000Z");
    expect(attemptDeadline(start, 30, new Date("2026-05-01T10:10:00Z"))?.toISOString()).toBe("2026-05-01T10:10:00.000Z");
    expect(attemptDeadline(start, null, null)).toBeNull();
  });
});

describe("module progress", () => {
  const modules: ProgressModule[] = [
    { id: "m1", position: 1, unlockAt: null, requireSequential: true, prerequisiteIds: [] },
    { id: "m2", position: 2, unlockAt: null, requireSequential: false, prerequisiteIds: ["m1"] },
    { id: "m3", position: 3, unlockAt: new Date("2030-01-01"), requireSequential: false, prerequisiteIds: [] },
  ];
  const items: ProgressItem[] = [
    { id: "i1", moduleId: "m1", position: 1, requirement: "must_view", minScore: null, refId: "page1" },
    { id: "i2", moduleId: "m1", position: 2, requirement: "must_submit", minScore: null, refId: "asg1" },
    { id: "i3", moduleId: "m1", position: 3, requirement: "min_score", minScore: 7, refId: "quiz1" },
    { id: "i4", moduleId: "m2", position: 1, requirement: "must_mark_done", minScore: null, refId: "page2" },
    { id: "i5", moduleId: "m2", position: 2, requirement: "none", minScore: null, refId: null },
    { id: "i6", moduleId: "m3", position: 1, requirement: "must_contribute", minScore: null, refId: "disc1" },
  ];
  const empty = (): ProgressFacts => ({ viewed: new Set(), markedDone: new Set(), submitted: new Set(), contributed: new Set(), scores: new Map() });
  const now = new Date("2026-05-01");

  it("locks by prerequisite, unlock date and sequential order", () => {
    const r = computeProgress(modules, items, empty(), now);
    expect(r.modules.get("m1")?.state).toBe("unlocked");
    expect(r.items.get("i1")?.locked).toBe(false);
    expect(r.items.get("i2")?.locked).toBe(true);
    expect(r.modules.get("m2")?.state).toBe("locked");
    expect(r.modules.get("m3")?.state).toBe("locked");
    expect(r.overall).toEqual({ required: 5, completed: 0, percent: 0 });
  });

  it("completes modules and unlocks dependents", () => {
    const facts = empty();
    facts.viewed.add("i1");
    facts.submitted.add("asg1");
    facts.scores.set("quiz1", 8);
    facts.markedDone.add("i4");
    const r = computeProgress(modules, items, facts, now);
    expect(r.modules.get("m1")?.state).toBe("completed");
    expect(r.modules.get("m2")?.state).toBe("completed");
    expect(r.items.get("i3")?.completed).toBe(true);
    expect(r.overall.percent).toBe(80);
  });

  it("min_score is not met below threshold; started state after partial work", () => {
    const facts = empty();
    facts.viewed.add("i1");
    facts.scores.set("quiz1", 6);
    const r = computeProgress(modules, items, facts, now);
    expect(r.modules.get("m1")?.state).toBe("started");
    expect(r.items.get("i3")?.completed).toBe(false);
  });
});

describe("csv", () => {
  it("round-trips quoted fields and defuses formulas", () => {
    const text = toCsv([["name", "note"], ['Smith, "Jo"', "=SUM(A1)"], ["Neg", "-5"]]);
    expect(text).toBe('name,note\r\n"Smith, ""Jo""",\'=SUM(A1)\r\nNeg,-5\r\n');
    expect(parseCsv(text)[1]).toEqual(['Smith, "Jo"', "'=SUM(A1)"]);
  });
  it("parses objects with header normalization and BOM", () => {
    expect(parseCsvObjects("﻿Email, Role\nA@x.edu,student\n\n")).toEqual([{ email: "A@x.edu", role: "student" }]);
  });
});
