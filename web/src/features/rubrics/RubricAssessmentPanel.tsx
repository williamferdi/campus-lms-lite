import clsx from "clsx";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, FormError } from "../../components/ui";
import { useFeedback } from "../../components/ui/feedback";
import { api } from "../../lib/api";
import { formatPoints } from "../../lib/format";
import { useInvalidate } from "../../lib/query";
import type { AttachedRubric, RubricAssessment } from "../../lib/types";

interface Award {
  points: string;
  levelId: string | null;
}

const seed = (rubric: AttachedRubric, assessment: RubricAssessment | null): Record<string, Award> => {
  const out: Record<string, Award> = {};
  for (const c of rubric.criteria) {
    const prior = assessment?.criteria.find((x) => x.criterionId === c.id);
    out[c.id] = {
      points: prior && prior.points !== null ? String(prior.points) : "",
      levelId: prior?.levelId ?? null,
    };
  }
  return out;
};

/**
 * Mark one student against the attached rubric.
 *
 * One Save, deliberately: each save that completes the rubric is a grade, and a grade on an
 * assessment that posts automatically notifies the student. Saving per keystroke would send
 * them "Grade: 4", then 11, then 17.
 */
export function RubricAssessmentPanel({
  assignmentId,
  studentId,
  pointsPossible,
  rubric,
  assessment,
  attempt,
  readOnly,
  onSaved,
}: {
  assignmentId: string;
  studentId: string;
  pointsPossible: number;
  rubric: AttachedRubric;
  assessment: RubricAssessment | null;
  attempt: number | null;
  readOnly: boolean;
  onSaved: () => Promise<unknown> | void;
}) {
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const [awards, setAwards] = useState<Record<string, Award>>(() => seed(rubric, assessment));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (criterionId: string, next: Partial<Award>) =>
    setAwards((prev) => ({ ...prev, [criterionId]: { ...prev[criterionId]!, ...next } }));

  const total = rubric.criteria.reduce((sum, c) => {
    const raw = awards[c.id]?.points ?? "";
    const n = raw.trim() === "" ? 0 : Number(raw);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  const complete = rubric.criteria.every((c) => (awards[c.id]?.points ?? "").trim() !== "");

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/assignments/${assignmentId}/submissions/${studentId}/rubric-assessment`, {
        awards: rubric.criteria.map((c) => {
          const award = awards[c.id]!;
          const raw = award.points.trim();
          return {
            criterionId: c.id,
            points: raw === "" ? null : Number(raw),
            levelId: award.levelId,
          };
        }),
      });
      await invalidate(`/assignments/${assignmentId}`, "/courses");
      await onSaved();
      fb.success(complete ? "Rubric saved and the mark updated." : "Rubric saved. The mark is unchanged until every criterion is marked.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={rubric.title}
        description={
          rubric.useForGrading
            ? "The points below add up to the mark."
            : "Feedback only — enter the mark in the grade box."
        }
        actions={
          <Badge tone={complete ? "brand" : "amber"}>
            {formatPoints(total)} / {formatPoints(pointsPossible)}
          </Badge>
        }
      />
      <div className="space-y-4 px-6 pb-6">
        <FormError error={error} />

        {assessment?.overridden && (
          <p className="rounded-panel bg-amber-50 px-4 py-2 text-sm text-amber-900">
            The mark on record was changed by hand after this rubric was filled in, so it no longer matches the
            total below. Saving the rubric again will set the mark back to the rubric's total.
          </p>
        )}
        {assessment && attempt !== null && assessment.attempt !== null && assessment.attempt !== attempt && (
          <p className="text-xs text-slate-600">Marked against attempt {assessment.attempt}; the student is now on attempt {attempt}.</p>
        )}
        {total > pointsPossible && (
          <p className="text-xs text-amber-800">
            That is more than the assessment is out of, so it will read as over 100%. Allowed, in case you mean it
            as extra credit.
          </p>
        )}

        <ul className="space-y-4">
          {rubric.criteria.map((c) => {
            const award = awards[c.id]!;
            return (
              <li key={c.id} className="space-y-2 border-b border-line pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-900">{c.description}</span>
                  <span className="text-xs text-slate-600">out of {formatPoints(c.points)}</span>
                </div>
                {c.longDescription && <p className="text-xs text-slate-600">{c.longDescription}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  {c.levels.map((level) => (
                    <button
                      key={level.id}
                      type="button"
                      disabled={readOnly}
                      aria-pressed={award.levelId === level.id}
                      onClick={() =>
                        set(c.id, {
                          levelId: level.id,
                          points: level.points === null || level.points === undefined ? award.points : String(level.points),
                        })
                      }
                      className={clsx(
                        "rounded-control border px-2 py-1 text-xs transition-colors",
                        award.levelId === level.id
                          ? "border-brand-700 bg-brand-50 font-semibold text-brand-800"
                          : "border-line text-slate-700 hover:border-slate-400",
                        readOnly && "cursor-not-allowed opacity-60",
                      )}
                    >
                      {level.description}
                      {level.points !== null && level.points !== undefined && (
                        <span className="ml-1 text-slate-500">({formatPoints(level.points)})</span>
                      )}
                    </button>
                  ))}
                  <input
                    aria-label={`Points for ${c.description}`}
                    type="number"
                    min={0}
                    step="0.5"
                    disabled={readOnly}
                    value={award.points}
                    onChange={(e) => set(c.id, { points: e.target.value, levelId: null })}
                    className="w-24 rounded-control border border-slate-300 px-3 py-1.5 text-sm tabular-nums"
                    placeholder="—"
                  />
                  {award.points !== "" && !readOnly && (
                    <Button variant="ghost" size="sm" onClick={() => set(c.id, { points: "", levelId: null })}>
                      Clear
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {!readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-600">
              {complete
                ? rubric.useForGrading
                  ? "Saving sets the mark from the total above."
                  : "Saving records the judgement; the mark stays as you entered it."
                : "Every criterion needs a mark before this becomes a grade."}
            </p>
            <Button onClick={save} loading={busy}>
              Save rubric
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
