import { describe, expect, it } from "vitest";
import { normalizeRubric, scoreAssessment } from "../../src/domain/rubric.js";

let n = 0;
const nextId = () => `id-${++n}`;

const essay = () =>
  normalizeRubric(
    [
      {
        description: "Thesis",
        ratings: [
          { description: "Missing", points: 0 },
          { description: "Clear", points: 5 },
          { description: "Partial", points: 3 },
        ],
      },
      { id: "keep-me", description: "Evidence", ratings: [{ id: "full", description: "Strong", points: 10 }, { description: "Weak", points: 4 }] },
    ],
    nextId,
  );

describe("normalizeRubric", () => {
  it("sorts ratings highest first, sets criterion points and keeps given ids", () => {
    const r = essay();
    expect(r[0]!.ratings.map((x) => x.points)).toEqual([5, 3, 0]);
    expect(r.map((c) => c.points)).toEqual([5, 10]);
    expect(r[1]!.id).toBe("keep-me");
    expect(r[1]!.ratings[0]!.id).toBe("full");
    expect(new Set(r.flatMap((c) => [c.id, ...c.ratings.map((x) => x.id)])).size).toBe(7);
  });

  it("rounds points to two decimals and trims text", () => {
    const [c] = normalizeRubric([{ description: "  Style  ", ratings: [{ description: " Good ", points: 2.345 }] }], nextId);
    expect(c).toMatchObject({ description: "Style", points: 2.35, ratings: [{ description: "Good", points: 2.35 }] });
  });

  it("replaces duplicate ids so every criterion and rating stays addressable", () => {
    const r = normalizeRubric(
      [
        { id: "x", description: "A", ratings: [{ id: "x", description: "a", points: 1 }] },
        { id: "x", description: "B", ratings: [{ description: "b", points: 1 }] },
      ],
      nextId,
    );
    const ids = r.flatMap((c) => [c.id, ...c.ratings.map((x) => x.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects empty or invalid rubrics", () => {
    expect(() => normalizeRubric([], nextId)).toThrow("at least one criterion");
    expect(() => normalizeRubric([{ description: " ", ratings: [{ description: "a", points: 1 }] }], nextId)).toThrow("needs a description");
    expect(() => normalizeRubric([{ description: "A", ratings: [] }], nextId)).toThrow("at least one rating");
    expect(() => normalizeRubric([{ description: "A", ratings: [{ description: "a", points: -1 }] }], nextId)).toThrow("0 or more");
    expect(() => normalizeRubric([{ description: "A", ratings: [{ description: "", points: 1 }] }], nextId)).toThrow("needs a description");
  });
});

describe("scoreAssessment", () => {
  it("uses a chosen rating's points, lets typed points override, and totals", () => {
    const r = essay();
    const thesis = r[0]!;
    const out = scoreAssessment(r, {
      [thesis.id]: { ratingId: thesis.ratings[1]!.id },
      "keep-me": { ratingId: "full", points: 8, comments: " Good sources " },
    });
    expect(out.scores[thesis.id]).toEqual({ ratingId: thesis.ratings[1]!.id, points: 3, comments: "" });
    expect(out.scores["keep-me"]).toEqual({ ratingId: "full", points: 8, comments: "Good sources" });
    expect(out).toMatchObject({ total: 11, possible: 15 });
  });

  it("caps points at the criterion maximum and counts unscored criteria as zero", () => {
    const r = essay();
    const out = scoreAssessment(r, { "keep-me": { points: 99 } });
    expect(out.scores["keep-me"]!.points).toBe(10);
    expect(out.total).toBe(10);
    expect(Object.keys(out.scores)).toEqual(["keep-me"]);
  });

  it("keeps comment-only entries without points", () => {
    const out = scoreAssessment(essay(), { "keep-me": { comments: "See me" } });
    expect(out.scores["keep-me"]).toEqual({ ratingId: null, points: null, comments: "See me" });
    expect(out.total).toBe(0);
  });

  it("rejects unknown criteria, unknown ratings and negative points", () => {
    const r = essay();
    expect(() => scoreAssessment(r, { nope: { points: 1 } })).toThrow("isn't in this rubric");
    expect(() => scoreAssessment(r, { "keep-me": { ratingId: "nope" } })).toThrow("Unknown rating");
    expect(() => scoreAssessment(r, { "keep-me": { points: -2 } })).toThrow("0 or more");
  });
});
