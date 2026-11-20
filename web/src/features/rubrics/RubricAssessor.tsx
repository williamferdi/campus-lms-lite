import clsx from "clsx";
import { useId } from "react";
import { formatPoints } from "../../lib/format";
import type { Rubric, RubricScore } from "../../lib/types";

export type AssessmentDraft = Record<string, RubricScore>;

/** Same rules as the server: typed points override a rating, capped at the criterion maximum. */
export function draftTotal(rubric: Rubric, draft: AssessmentDraft): number {
  let total = 0;
  for (const c of rubric.criteria) {
    const p = draft[c.id]?.points;
    if (p != null && Number.isFinite(p)) total += Math.min(Math.max(p, 0), c.points);
  }
  return Math.round(total * 100) / 100;
}

/** The API body for a draft: only criteria that have a score, rating or comment. */
export function draftPayload(draft: AssessmentDraft) {
  return {
    scores: Object.fromEntries(
      Object.entries(draft)
        .filter(([, s]) => s.ratingId || s.points != null || s.comments.trim())
        .map(([id, s]) => [id, { ratingId: s.ratingId, points: s.points, comments: s.comments }]),
    ),
  };
}

/** Score a rubric: pick a rating per criterion (or type points) and add comments. */
export function RubricAssessor({ rubric, value, onChange, disabled }: { rubric: Rubric; value: AssessmentDraft; onChange: (next: AssessmentDraft) => void; disabled?: boolean }) {
  const uid = useId();
  const update = (criterionId: string, patch: Partial<RubricScore>) => {
    const prev = value[criterionId] ?? { ratingId: null, points: null, comments: "" };
    onChange({ ...value, [criterionId]: { ...prev, ...patch } });
  };
  return (
    // Container queries: the assessor sits in narrow side panels as well as full-width cards.
    <div className="@container space-y-4">
      {rubric.criteria.map((c, i) => {
        const s = value[c.id];
        const name = `${uid}-c${i}`;
        return (
          <fieldset key={c.id} className="min-w-0 rounded-lg border border-line p-3" disabled={disabled}>
            <legend className="px-1 text-sm font-semibold text-slate-900">{c.description}</legend>
            {c.longDescription && <p className="mb-2 whitespace-pre-line text-xs text-slate-600">{c.longDescription}</p>}
            <div className="grid gap-2 @sm:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]">
              {c.ratings.map((r) => {
                const checked = s?.ratingId === r.id;
                return (
                  <label
                    key={r.id}
                    className={clsx(
                      "flex cursor-pointer flex-col rounded-control border px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600",
                      checked ? "border-brand-600 bg-brand-50" : "border-slate-300 bg-white hover:bg-slate-50",
                    )}
                  >
                    <input type="radio" name={name} className="sr-only" checked={checked} onChange={() => update(c.id, { ratingId: r.id, points: r.points })} />
                    <span className="font-semibold text-slate-900">{formatPoints(r.points)} pts</span>
                    <span className="text-slate-700">{r.description}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-2 grid gap-2 @sm:grid-cols-[8rem_1fr]">
              <label className="text-xs font-medium text-slate-700">
                Points (max {formatPoints(c.points)})
                <input
                  type="number"
                  min={0}
                  max={c.points}
                  step="0.5"
                  value={s?.points ?? ""}
                  onChange={(e) => update(c.id, { points: e.target.value === "" ? null : Number(e.target.value), ratingId: c.ratings.find((r) => r.points === Number(e.target.value))?.id ?? null })}
                  className="mt-1 block w-full rounded-control border border-slate-300 bg-white px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs font-medium text-slate-700">
                Comment (optional)
                <input type="text" value={s?.comments ?? ""} onChange={(e) => update(c.id, { comments: e.target.value })} className="mt-1 block w-full rounded-control border border-slate-300 bg-white px-2 py-1.5 text-sm" />
              </label>
            </div>
          </fieldset>
        );
      })}
      <p className="text-right text-sm font-semibold" aria-live="polite">
        Rubric total: {formatPoints(draftTotal(rubric, value))} / {formatPoints(rubric.possible)} pts
      </p>
    </div>
  );
}
