import { randomUUID } from "node:crypto";
import type { RubricCriterion, RubricScore } from "../db/schema.js";
import { round2 } from "./grading.js";

export interface RubricRatingInput {
  id?: string;
  description: string;
  longDescription?: string;
  points: number;
}
export interface RubricCriterionInput {
  id?: string;
  description: string;
  longDescription?: string;
  ratings: RubricRatingInput[];
}

/**
 * Validate and normalize rubric criteria. Keeps ids that are sent (so edits don't orphan scores),
 * assigns new ones, sorts ratings highest first and sets each criterion's points to its top rating.
 * Throws on invalid input.
 */
export function normalizeRubric(criteria: RubricCriterionInput[], newId: () => string = randomUUID): RubricCriterion[] {
  if (criteria.length === 0) throw new Error("Add at least one criterion.");
  const seen = new Set<string>();
  const unique = (id: string | undefined) => {
    const v = id && !seen.has(id) ? id : newId();
    seen.add(v);
    return v;
  };
  return criteria.map((c, i) => {
    const description = c.description.trim();
    if (!description) throw new Error(`Criterion ${i + 1} needs a description.`);
    if (c.ratings.length === 0) throw new Error(`"${description}" needs at least one rating.`);
    const ratings = c.ratings
      .map((r, j) => {
        if (!Number.isFinite(r.points) || r.points < 0) throw new Error(`Ratings in "${description}" need points of 0 or more.`);
        const label = r.description.trim();
        if (!label) throw new Error(`Rating ${j + 1} in "${description}" needs a description.`);
        return { id: unique(r.id), description: label, longDescription: (r.longDescription ?? "").trim(), points: round2(r.points) };
      })
      .sort((a, b) => b.points - a.points);
    return { id: unique(c.id), description, longDescription: (c.longDescription ?? "").trim(), points: ratings[0]!.points, ratings };
  });
}

export const rubricPossible = (criteria: RubricCriterion[]) => round2(criteria.reduce((sum, c) => sum + c.points, 0));

export interface ScoreInput {
  ratingId?: string | null;
  points?: number | null;
  comments?: string;
}

/**
 * Score an assessment against a rubric. A chosen rating supplies its points unless points are typed;
 * points are capped at the criterion's maximum. Unscored criteria count as 0 in the total.
 * Throws on unknown criteria or ratings.
 */
export function scoreAssessment(criteria: RubricCriterion[], input: Record<string, ScoreInput>) {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  for (const key of Object.keys(input)) if (!byId.has(key)) throw new Error("The assessment contains a criterion that isn't in this rubric.");
  const scores: Record<string, RubricScore> = {};
  let total = 0;
  for (const c of criteria) {
    const s = input[c.id];
    if (!s) continue;
    const rating = s.ratingId ? c.ratings.find((r) => r.id === s.ratingId) : undefined;
    if (s.ratingId && !rating) throw new Error(`Unknown rating for "${c.description}".`);
    let points = s.points ?? rating?.points ?? null;
    if (points !== null) {
      if (!Number.isFinite(points) || points < 0) throw new Error(`Points for "${c.description}" must be 0 or more.`);
      points = round2(Math.min(points, c.points));
      total += points;
    }
    const comments = (s.comments ?? "").trim();
    if (points === null && !rating && !comments) continue;
    scores[c.id] = { ratingId: rating?.id ?? null, points, comments };
  }
  return { scores, total: round2(total), possible: rubricPossible(criteria) };
}
