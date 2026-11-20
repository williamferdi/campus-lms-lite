import clsx from "clsx";
import { Check } from "lucide-react";
import { formatPoints } from "../../lib/format";
import type { Rubric, RubricAssessment } from "../../lib/types";

/**
 * Read-only rubric. Without an assessment it shows the criteria and point levels; with one it marks
 * the chosen ratings and shows points and comments.
 */
export function RubricView({ rubric, assessment, className }: { rubric: Rubric; assessment?: RubricAssessment | null; className?: string }) {
  return (
    <section aria-label={`Rubric: ${rubric.title}`} className={clsx("space-y-3", className)}>
      <ol className="space-y-3">
        {rubric.criteria.map((c) => {
          const score = assessment?.scores[c.id];
          return (
            <li key={c.id} className="rounded-lg border border-line">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-slate-50 px-4 py-2.5">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900">{c.description}</h3>
                  {c.longDescription && <p className="mt-0.5 whitespace-pre-line text-xs text-slate-600">{c.longDescription}</p>}
                </div>
                <span className="shrink-0 text-sm font-medium text-slate-700">
                  {assessment ? (
                    <>
                      {score?.points != null ? formatPoints(score.points) : "–"} / {formatPoints(c.points)} pts
                    </>
                  ) : (
                    `${formatPoints(c.points)} pts`
                  )}
                </span>
              </div>
              <ul className="grid gap-px bg-line sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
                {c.ratings.map((r) => {
                  const chosen = score?.ratingId === r.id;
                  return (
                    <li key={r.id} className={clsx("bg-white px-3 py-2.5 text-sm", chosen && "bg-brand-50 ring-2 ring-inset ring-brand-600")}>
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                        {chosen && <Check className="size-4 text-brand-700" aria-hidden />}
                        {formatPoints(r.points)} pts
                        {chosen && <span className="sr-only">(selected)</span>}
                      </div>
                      <div className="text-slate-700">{r.description}</div>
                      {r.longDescription && <div className="mt-0.5 whitespace-pre-line text-xs text-slate-600">{r.longDescription}</div>}
                    </li>
                  );
                })}
              </ul>
              {score?.comments && (
                <p className="border-t border-line px-4 py-2 text-sm text-slate-700">
                  <span className="font-medium">Comment:</span> <span className="whitespace-pre-line">{score.comments}</span>
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-right text-sm font-semibold text-slate-900">
        {assessment ? `Total: ${formatPoints(assessment.total)} / ${formatPoints(rubric.possible)} pts` : `Total points: ${formatPoints(rubric.possible)}`}
      </p>
    </section>
  );
}
