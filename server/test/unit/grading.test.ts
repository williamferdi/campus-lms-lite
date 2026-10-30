import { describe, expect, it } from "vitest";
import {
  applyDropRules,
  applyLatePolicy,
  computeCourseGrade,
  formatGrade,
  letterFor,
  parseGradeInput,
  round2,
  submissionFlags,
  type GradeAssignment,
  type GradeGroup,
  type GradeSubmission,
} from "../../src/domain/grading.js";

const a = (id: string, groupId: string | null, pointsPossible: number, extra: Partial<GradeAssignment> = {}): GradeAssignment => ({
  id,
  groupId,
  pointsPossible,
  gradingType: "points",
  omitFromFinal: false,
  published: true,
  ...extra,
});
const s = (assignmentId: string, score: number | null, extra: Partial<GradeSubmission> = {}): GradeSubmission => ({
  assignmentId,
  score,
  excused: false,
  postedAt: new Date("2026-01-01"),
  ...extra,
});
const g = (id: string, weight = 0, extra: Partial<GradeGroup> = {}): GradeGroup => ({
  id,
  name: id,
  weight,
  dropLowest: 0,
  dropHighest: 0,
  ...extra,
});
const opts = { applyGroupWeights: false, postedOnly: false };

describe("round2", () => {
  it("rounds half up without float artifacts", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(89.995)).toBe(90);
    expect(round2(2 / 3)).toBe(0.67);
    expect(round2(-1.005)).toBe(-1.01);
  });
});

describe("computeCourseGrade — unweighted", () => {
  const groups = [g("hw")];
  const assignments = [a("a1", "hw", 10), a("a2", "hw", 20), a("a3", "hw", 30)];

  it("current counts graded only; final counts ungraded as zero", () => {
    const r = computeCourseGrade(assignments, [s("a1", 8), s("a2", 15)], groups, opts);
    expect(r.current).toMatchObject({ earned: 23, possible: 30, percent: 76.67, letter: "C" });
    expect(r.final).toMatchObject({ earned: 23, possible: 60, percent: 38.33, letter: "F" });
  });

  it("excused work is removed from numerator and denominator", () => {
    const r = computeCourseGrade(assignments, [s("a1", 8), s("a2", null, { excused: true }), s("a3", 30)], groups, opts);
    expect(r.current).toMatchObject({ earned: 38, possible: 40, percent: 95 });
    expect(r.final).toMatchObject({ earned: 38, possible: 40, percent: 95 });
  });

  it("a zero score counts, unlike a missing grade in current", () => {
    const r = computeCourseGrade(assignments, [s("a1", 0)], groups, opts);
    expect(r.current).toMatchObject({ earned: 0, possible: 10, percent: 0 });
  });

  it("no graded work yields null percent and letter", () => {
    const r = computeCourseGrade(assignments, [], groups, opts);
    expect(r.current.percent).toBeNull();
    expect(r.current.letter).toBeNull();
    expect(r.final.percent).toBe(0);
  });

  it("postedOnly hides unposted scores from both totals", () => {
    const subs = [s("a1", 10), s("a2", 20, { postedAt: null })];
    const r = computeCourseGrade(assignments, subs, groups, { ...opts, postedOnly: true });
    expect(r.current).toMatchObject({ earned: 10, possible: 10, percent: 100 });
    expect(r.final).toMatchObject({ earned: 10, possible: 60 });
    const staff = computeCourseGrade(assignments, subs, groups, opts);
    expect(staff.current).toMatchObject({ earned: 30, possible: 30 });
  });

  it("ignores unpublished, not_graded and omitted assignments", () => {
    const list = [
      a("a1", "hw", 10),
      a("u", "hw", 100, { published: false }),
      a("n", "hw", 100, { gradingType: "not_graded" }),
      a("o", "hw", 100, { omitFromFinal: true }),
    ];
    const r = computeCourseGrade(list, [s("a1", 5), s("u", 0), s("n", 0), s("o", 0)], groups, opts);
    expect(r.final).toMatchObject({ earned: 5, possible: 10, percent: 50 });
  });

  it("zero-point assignments act as extra credit; scores above possible allowed", () => {
    const list = [a("a1", "hw", 10), a("bonus", "hw", 0)];
    const r = computeCourseGrade(list, [s("a1", 11), s("bonus", 2)], groups, opts);
    expect(r.current).toMatchObject({ earned: 13, possible: 10, percent: 130 });
  });

  it("assignments without a known group fall into an implicit group", () => {
    const r = computeCourseGrade([a("x", null, 10)], [s("x", 5)], [], opts);
    expect(r.groups).toHaveLength(1);
    expect(r.current.percent).toBe(50);
  });
});

describe("computeCourseGrade — weighted", () => {
  const groups = [g("hw", 40), g("exam", 60)];
  const assignments = [a("h1", "hw", 10), a("h2", "hw", 10), a("e1", "exam", 100)];

  it("weights group percentages", () => {
    const r = computeCourseGrade(assignments, [s("h1", 10), s("h2", 5), s("e1", 80)], groups, {
      applyGroupWeights: true,
      postedOnly: false,
    });
    // hw 75% * 40 + exam 80% * 60 = 30 + 48 = 78
    expect(r.current.percent).toBe(78);
    expect(r.current.letter).toBe("C+");
  });

  it("re-normalizes weights over groups with graded work (current)", () => {
    const r = computeCourseGrade(assignments, [s("h1", 9)], groups, { applyGroupWeights: true, postedOnly: false });
    expect(r.current.percent).toBe(90);
    // final: hw 9/20 = 45% * 40 + exam 0% * 60 = 18
    expect(r.final.percent).toBe(18);
  });

  it("returns null when all weights are zero", () => {
    const r = computeCourseGrade(assignments, [s("h1", 9)], [g("hw", 0), g("exam", 0)], {
      applyGroupWeights: true,
      postedOnly: false,
    });
    expect(r.current.percent).toBeNull();
  });
});

describe("drop rules", () => {
  it("drops the lowest percentage items and keeps at least one", () => {
    const items = [
      { assignmentId: "a", earned: 5, possible: 10 },
      { assignmentId: "b", earned: 9, possible: 10 },
      { assignmentId: "c", earned: 1, possible: 10 },
    ];
    expect(applyDropRules(items, 1, 0).droppedIds).toEqual(["c"]);
    expect(applyDropRules(items, 1, 1).droppedIds.sort()).toEqual(["b", "c"]);
    expect(applyDropRules(items, 10, 0).kept).toHaveLength(1);
  });

  it("is applied inside the course grade", () => {
    const groups = [g("q", 0, { dropLowest: 1 })];
    const list = [a("q1", "q", 10), a("q2", "q", 10), a("q3", "q", 10)];
    const r = computeCourseGrade(list, [s("q1", 2), s("q2", 8), s("q3", 10)], groups, opts);
    expect(r.current).toMatchObject({ earned: 18, possible: 20, percent: 90 });
    expect(r.groups[0]?.droppedAssignmentIds.current).toEqual(["q1"]);
  });
});

describe("late policy", () => {
  const due = new Date("2026-03-01T23:59:00Z");
  const policy = { enabled: true, deductionPercent: 10, floorPercent: 50 };

  it("deducts per started day late", () => {
    const r = applyLatePolicy({
      enteredScore: 90,
      pointsPossible: 100,
      dueAt: due,
      submittedAt: new Date("2026-03-03T10:00:00Z"),
      policy,
      statusOverride: null,
    });
    expect(r).toEqual({ score: 70, pointsDeducted: 20 });
  });

  it("never goes below the floor, but does not raise low scores", () => {
    const late = new Date("2026-03-20T00:00:00Z");
    expect(applyLatePolicy({ enteredScore: 90, pointsPossible: 100, dueAt: due, submittedAt: late, policy, statusOverride: null }).score).toBe(50);
    expect(applyLatePolicy({ enteredScore: 30, pointsPossible: 100, dueAt: due, submittedAt: late, policy, statusOverride: null }).score).toBe(30);
  });

  it("does nothing when disabled, on time, or overridden to none", () => {
    const late = new Date("2026-03-03T00:00:00Z");
    expect(applyLatePolicy({ enteredScore: 90, pointsPossible: 100, dueAt: due, submittedAt: late, policy: { ...policy, enabled: false }, statusOverride: null }).pointsDeducted).toBe(0);
    expect(applyLatePolicy({ enteredScore: 90, pointsPossible: 100, dueAt: due, submittedAt: due, policy, statusOverride: null }).pointsDeducted).toBe(0);
    expect(applyLatePolicy({ enteredScore: 90, pointsPossible: 100, dueAt: due, submittedAt: late, policy, statusOverride: "none" }).pointsDeducted).toBe(0);
  });
});

describe("submission flags", () => {
  const now = new Date("2026-03-10T00:00:00Z");
  const asg = { dueAt: new Date("2026-03-05T00:00:00Z"), submissionTypes: ["online_upload"] };

  it("missing when past due with no submission and no grade", () => {
    expect(submissionFlags(asg, null, now)).toEqual({ late: false, missing: true });
  });
  it("late when submitted after due", () => {
    expect(
      submissionFlags(asg, { submittedAt: new Date("2026-03-06T00:00:00Z"), score: null, excused: false, latePolicyStatus: null }, now),
    ).toEqual({ late: true, missing: false });
  });
  it("on-paper assignments are never missing; excused never flagged", () => {
    expect(submissionFlags({ ...asg, submissionTypes: ["on_paper"] }, null, now).missing).toBe(false);
    expect(submissionFlags(asg, { submittedAt: null, score: null, excused: true, latePolicyStatus: null }, now)).toEqual({ late: false, missing: false });
  });
  it("manual overrides win", () => {
    expect(submissionFlags(asg, { submittedAt: null, score: null, excused: false, latePolicyStatus: "none" }, now).missing).toBe(false);
  });
});

describe("grade input and display", () => {
  it("parses points, percentages, letters and pass/fail", () => {
    expect(parseGradeInput("8.5", "points", 10)).toBe(8.5);
    expect(parseGradeInput("85%", "points", 20)).toBe(17);
    expect(parseGradeInput("85", "percent", 20)).toBe(17);
    expect(parseGradeInput("A", "letter_grade", 50)).toBe(50);
    expect(parseGradeInput("B", "letter_grade", 100)).toBe(86.99);
    expect(parseGradeInput("complete", "pass_fail", 5)).toBe(5);
    expect(() => parseGradeInput("Z", "points", 10)).toThrow();
    expect(() => parseGradeInput("-1", "points", 10)).toThrow();
  });
  it("formats grades by grading type", () => {
    expect(formatGrade(17, "percent", 20)).toBe("85%");
    expect(formatGrade(17, "letter_grade", 20)).toBe("B");
    expect(formatGrade(5, "pass_fail", 5)).toBe("complete");
    expect(formatGrade(null, "points", 5)).toBeNull();
    expect(letterFor(59.99)).toBe("F");
    expect(letterFor(92.995)).toBe("A");
  });
});
