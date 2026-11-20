import { describe, expect, it } from "vitest";
import { formatGrade } from "../../src/domain/grading.js";
import {
  applyAwards,
  assessmentTotal,
  criterionTotal,
  isComplete,
  pointsMismatch,
  snapshotFor,
  type ScorableCriterion,
} from "../../src/domain/rubrics.js";

const c = (id: string, points: number, extra: Partial<ScorableCriterion> = {}): ScorableCriterion => ({
  id,
  position: 1,
  description: `Criterion ${id}`,
  longDescription: "",
  points,
  levels: [
    { id: `${id}-full`, description: "Excellent", points },
    { id: `${id}-half`, description: "Adequate", points: points / 2 },
    { id: `${id}-none`, description: "Not shown", points: 0 },
  ],
  ...extra,
});

describe("criterionTotal", () => {
  it("adds the criteria up", () => {
    expect(criterionTotal([c("a", 10), c("b", 15)])).toBe(25);
  });

  it("rounds away float artifacts rather than storing them", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point. Stored raw in jsonb it
    // would disagree with the numeric(10,2) total for ever.
    expect(criterionTotal([c("a", 0.1), c("b", 0.2)])).toBe(0.3);
  });

  it("is zero for a rubric with no criteria", () => {
    expect(criterionTotal([])).toBe(0);
  });
});

describe("snapshotFor", () => {
  it("freezes the wording, the levels and the maximum, unmarked", () => {
    const [first] = snapshotFor([c("a", 10)]);
    expect(first).toMatchObject({
      criterionId: "a",
      description: "Criterion a",
      pointsPossible: 10,
      points: null,
      levelId: null,
    });
    expect(first!.levels).toHaveLength(3);
  });

  it("orders by position, not by the order the rows arrived in", () => {
    const snapshot = snapshotFor([
      c("b", 5, { position: 2 }),
      c("a", 5, { position: 1 }),
    ]);
    expect(snapshot.map((x) => x.criterionId)).toEqual(["a", "b"]);
  });
});

describe("applyAwards", () => {
  const snapshot = snapshotFor([c("a", 10, { position: 1 }), c("b", 20, { position: 2 })]);

  it("takes the points from the level the grader picked", () => {
    const marked = applyAwards(snapshot, [
      { criterionId: "a", levelId: "a-half" },
      { criterionId: "b", levelId: "b-full" },
    ]);
    expect(marked.map((x) => x.points)).toEqual([5, 20]);
    expect(marked.map((x) => x.levelId)).toEqual(["a-half", "b-full"]);
    expect(assessmentTotal(marked)).toBe(25);
  });

  it("lets an explicit score override the level it came from", () => {
    const marked = applyAwards(snapshot, [
      { criterionId: "a", levelId: "a-full", points: 7.5 },
      { criterionId: "b", points: 1 },
    ]);
    expect(marked[0]).toMatchObject({ points: 7.5, levelId: "a-full" });
    expect(marked[1]).toMatchObject({ points: 1, levelId: null });
  });

  it("treats an explicit null as not yet marked, and clears the level with it", () => {
    const marked = applyAwards(snapshot, [
      { criterionId: "a", levelId: "a-full", points: null },
      { criterionId: "b", points: 2 },
    ]);
    expect(marked[0]).toMatchObject({ points: null, levelId: null });
    expect(isComplete(marked)).toBe(false);
  });

  it("refuses awards that do not describe exactly this rubric", () => {
    expect(() => applyAwards(snapshot, [{ criterionId: "a", points: 1 }])).toThrow(/changed/i);
    expect(() =>
      applyAwards(snapshot, [
        { criterionId: "a", points: 1 },
        { criterionId: "b", points: 1 },
        { criterionId: "gone", points: 1 },
      ]),
    ).toThrow(/changed/i);
  });

  it("refuses the same criterion twice", () => {
    expect(() =>
      applyAwards(snapshot, [
        { criterionId: "a", points: 1 },
        { criterionId: "a", points: 2 },
        { criterionId: "b", points: 1 },
      ]),
    ).toThrow(/only once/i);
  });

  it("refuses a level that belongs to another criterion", () => {
    expect(() =>
      applyAwards(snapshot, [
        { criterionId: "a", levelId: "b-full" },
        { criterionId: "b", levelId: "b-full" },
      ]),
    ).toThrow(/unknown level/i);
  });

  it("refuses a negative or non-numeric score", () => {
    expect(() =>
      applyAwards(snapshot, [
        { criterionId: "a", points: -1 },
        { criterionId: "b", points: 1 },
      ]),
    ).toThrow(/negative/i);
    expect(() =>
      applyAwards(snapshot, [
        { criterionId: "a", points: Number.NaN },
        { criterionId: "b", points: 1 },
      ]),
    ).toThrow(/number/i);
  });

  it("allows a criterion above its own maximum, as typing one in the grade box does", () => {
    const marked = applyAwards(snapshot, [
      { criterionId: "a", points: 12 },
      { criterionId: "b", points: 20 },
    ]);
    expect(assessmentTotal(marked)).toBe(32);
  });
});

describe("isComplete", () => {
  const snapshot = snapshotFor([c("a", 10), c("b", 20)]);

  it("is true only when every criterion has been judged", () => {
    expect(isComplete(snapshot)).toBe(false);
    expect(
      isComplete(applyAwards(snapshot, [{ criterionId: "a", points: 1 }, { criterionId: "b", points: null }])),
    ).toBe(false);
    expect(
      isComplete(applyAwards(snapshot, [{ criterionId: "a", points: 1 }, { criterionId: "b", points: 0 }])),
    ).toBe(true);
  });

  it("counts a zero award as judged — it is a mark, not a blank", () => {
    expect(isComplete(applyAwards(snapshotFor([c("a", 10)]), [{ criterionId: "a", points: 0 }]))).toBe(true);
  });

  it("is false for a rubric with no criteria at all", () => {
    expect(isComplete([])).toBe(false);
  });
});

describe("pointsMismatch", () => {
  it("says nothing when the rubric adds up to the assignment", () => {
    expect(pointsMismatch([c("a", 10), c("b", 10)], 20)).toBeNull();
  });

  it("reports both figures without choosing between them", () => {
    // A 40-point shared rubric on a 20-point assignment is legitimate. It is reported so a
    // teacher can decide; it is never corrected, because the rubric may be in use elsewhere.
    expect(pointsMismatch([c("a", 20), c("b", 20)], 20)).toEqual({
      criterionTotal: 40,
      pointsPossible: 20,
    });
  });
});

describe("what a rubric total means once it reaches the gradebook", () => {
  // These pin behaviour that belongs to grading.ts but surprises people through a rubric,
  // so that a later change there cannot quietly alter what a rubric reports.
  it("a complete rubric short of full marks is 'incomplete' on a pass/fail assignment", () => {
    expect(formatGrade(18, "pass_fail", 20)).toBe("incomplete");
    expect(formatGrade(20, "pass_fail", 20)).toBe("complete");
  });

  it("a total above the assignment's points reads over 100%", () => {
    expect(formatGrade(40, "percent", 20)).toBe("200%");
  });

  it("a zero-point assignment keeps the raw total as extra credit", () => {
    expect(formatGrade(5, "points", 0)).toBe("5");
    expect(formatGrade(5, "letter_grade", 0)).toBeNull();
  });
});
