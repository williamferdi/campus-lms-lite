/**
 * Pure rubric arithmetic and the snapshot rules — no database access.
 *
 * Two rules live here because they are the two that must never drift:
 *
 * 1. **A mark is taken against a copy, not against the library.** `snapshotFor` freezes the
 *    wording, the levels and the maximum of every criterion, so editing a rubric afterwards
 *    cannot move a mark a student has already been told about, and a mark can still be
 *    re-opened after its rubric has been rewritten or deleted.
 * 2. **A half-marked rubric is not a grade.** `isComplete` is what the service asks before it
 *    lets a total reach `setGrade`. Pushing partial sums would post and notify a student on
 *    every save — "Grade: 4", then 11, then 17 — whenever the assignment posts automatically.
 *
 * Every total goes through `round2`: points arrive as JS floats (`numeric(10,2) mode:"number"`)
 * and jsonb numbers are JSON floats, so criteria of 0.1 and 0.2 would otherwise sum to
 * 0.30000000000000004 in the snapshot and disagree with the stored total.
 */
import { round2 } from "./grading.js";

export interface RubricLevel {
  id: string;
  description: string;
  points: number;
}

/** A criterion as the library holds it. */
export interface ScorableCriterion {
  id: string;
  position: number;
  description: string;
  longDescription: string;
  points: number;
  levels: RubricLevel[];
}

/** A criterion as a finished or half-finished assessment holds it. */
export interface AssessedCriterion {
  criterionId: string;
  position: number;
  description: string;
  longDescription: string;
  pointsPossible: number;
  levels: RubricLevel[];
  points: number | null;
  levelId: string | null;
}

/** What a grader sends: an award per criterion, and nothing else. */
export interface CriterionAward {
  criterionId: string;
  points?: number | null;
  levelId?: string | null;
}

/** What the rubric is out of. */
export function criterionTotal(criteria: { points: number }[]): number {
  return round2(criteria.reduce((sum, c) => sum + c.points, 0));
}

/**
 * The blank snapshot for a rubric, in criterion order. This is also what the student is shown
 * before submitting and what the grader fills in.
 */
export function snapshotFor(criteria: ScorableCriterion[]): AssessedCriterion[] {
  return [...criteria]
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      criterionId: c.id,
      position: c.position,
      description: c.description,
      longDescription: c.longDescription,
      pointsPossible: c.points,
      levels: c.levels,
      points: null,
      levelId: null,
    }));
}

/**
 * Lay a grader's awards over a snapshot.
 *
 * Throws when the awards do not describe exactly this rubric — the same contract as
 * `parseGradeInput`, so the caller turns it into a 422. That is the case where a rubric was
 * edited while somebody had the grading screen open: better a reload than a mark recorded
 * against criteria that no longer exist.
 *
 * Picking a level sets the points. An explicit `points` wins over the level it was picked
 * from, so a grader can award half of a level.
 */
export function applyAwards(
  snapshot: AssessedCriterion[],
  awards: CriterionAward[],
): AssessedCriterion[] {
  const seen = new Set<string>();
  const byId = new Map<string, CriterionAward>();
  for (const award of awards) {
    if (seen.has(award.criterionId)) {
      throw new Error("Each criterion may be awarded only once.");
    }
    seen.add(award.criterionId);
    byId.set(award.criterionId, award);
  }

  const expected = new Set(snapshot.map((c) => c.criterionId));
  const missing = [...expected].filter((cid) => !byId.has(cid));
  const unknown = [...byId.keys()].filter((cid) => !expected.has(cid));
  if (missing.length || unknown.length) {
    throw new Error("This rubric has changed. Reload before marking.");
  }

  return snapshot.map((criterion) => {
    const award = byId.get(criterion.criterionId)!;
    const level =
      award.levelId === null || award.levelId === undefined
        ? null
        : criterion.levels.find((l) => l.id === award.levelId);
    if (level === undefined) {
      throw new Error(`Unknown level for "${criterion.description}".`);
    }

    // An explicit null is "not marked yet", which clears the level with it; otherwise an
    // explicit score wins over the level it came from, and a bare level sets its own points.
    let points: number | null = null;
    let levelId: string | null = null;
    if (award.points === null) {
      points = null;
      levelId = null;
    } else if (award.points !== undefined) {
      if (!Number.isFinite(award.points)) throw new Error("A score must be a number.");
      if (award.points < 0) throw new Error("A score cannot be negative.");
      points = round2(award.points);
      levelId = level ? level.id : null;
    } else if (level) {
      points = round2(level.points);
      levelId = level.id;
    }

    return { ...criterion, points, levelId };
  });
}

/** What has been awarded so far. Unmarked criteria count as nothing. */
export function assessmentTotal(criteria: AssessedCriterion[]): number {
  return round2(criteria.reduce((sum, c) => sum + (c.points ?? 0), 0));
}

/** Has every criterion been judged? Only then may the total become a grade. */
export function isComplete(criteria: AssessedCriterion[]): boolean {
  return criteria.length > 0 && criteria.every((c) => c.points !== null);
}

/**
 * Does the rubric add up to what the assignment is out of?
 *
 * A mismatch is reported, never corrected: a shared rubric is used by many assignments, and
 * rewriting `points_possible` from here would silently re-weight somebody else's course.
 */
export function pointsMismatch(
  criteria: { points: number }[],
  pointsPossible: number,
): { criterionTotal: number; pointsPossible: number } | null {
  const total = criterionTotal(criteria);
  if (total === round2(pointsPossible)) return null;
  return { criterionTotal: total, pointsPossible: round2(pointsPossible) };
}
