import clsx from "clsx";
import { Badge, Table } from "../../components/ui";
import { formatPoints } from "../../lib/format";
import type { AssessedCriterion, Rubric, RubricAssessment, RubricCriterion, RubricLevel } from "../../lib/types";

/**
 * One row of a rubric, whether it has been marked or not. The blank rubric a student reads
 * before submitting and the marked one they read afterwards are the same table, so the two can
 * never drift apart in wording or order.
 */
export interface RubricRow {
  key: string;
  description: string;
  longDescription: string;
  pointsPossible: number | null;
  levels: RubricLevel[];
  awardedLevelId?: string | null;
  awardedPoints?: number | null;
}

export const rowsFromRubric = (criteria: RubricCriterion[]): RubricRow[] =>
  criteria.map((c) => ({
    key: c.id,
    description: c.description,
    longDescription: c.longDescription,
    pointsPossible: c.points,
    levels: c.levels,
  }));

export const rowsFromAssessment = (criteria: AssessedCriterion[]): RubricRow[] =>
  criteria.map((c) => ({
    key: c.criterionId,
    description: c.description,
    longDescription: c.longDescription,
    pointsPossible: c.pointsPossible,
    levels: c.levels,
    awardedLevelId: c.levelId,
    awardedPoints: c.points,
  }));

function LevelCell({ level, awarded }: { level: RubricLevel; awarded: boolean }) {
  return (
    <div
      className={clsx(
        "rounded-control border px-2 py-1 text-xs",
        awarded ? "border-brand-700 bg-brand-50 font-semibold text-brand-800" : "border-line text-slate-600",
      )}
    >
      <span>{level.description}</span>
      {level.points !== null && level.points !== undefined && (
        <span className="ml-1 text-slate-500">({formatPoints(level.points)})</span>
      )}
      {awarded && <span className="sr-only"> — awarded</span>}
    </div>
  );
}

/** A rubric, read-only. `marked` turns the awarded column on. */
export function RubricTable({ rows, marked = false }: { rows: RubricRow[]; marked?: boolean }) {
  const anyPoints = rows.some((r) => r.pointsPossible !== null && r.pointsPossible !== undefined);
  const total = rows.reduce((sum, r) => sum + (r.pointsPossible ?? 0), 0);
  const awarded = rows.reduce((sum, r) => sum + (r.awardedPoints ?? 0), 0);
  const anyAwarded = rows.some((r) => r.awardedPoints !== null && r.awardedPoints !== undefined);

  return (
    <Table>
      <thead>
        <tr>
          <th scope="col">Criterion</th>
          <th scope="col">Levels</th>
          {marked && <th scope="col">Awarded</th>}
          {anyPoints && <th scope="col">Out of</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="align-top">
              <div className="font-medium text-slate-900">{row.description}</div>
              {row.longDescription && <div className="mt-1 text-xs text-slate-600">{row.longDescription}</div>}
            </td>
            <td className="align-top">
              <div className="flex flex-wrap gap-1">
                {row.levels.length === 0 ? (
                  <span className="text-xs text-slate-500">No levels set</span>
                ) : (
                  row.levels.map((level) => (
                    <LevelCell key={level.id} level={level} awarded={row.awardedLevelId === level.id} />
                  ))
                )}
              </div>
            </td>
            {marked && (
              <td className="align-top tabular-nums">
                {row.awardedPoints === null || row.awardedPoints === undefined ? (
                  <Badge tone="amber">Not marked</Badge>
                ) : (
                  <span className="font-semibold">{formatPoints(row.awardedPoints)}</span>
                )}
              </td>
            )}
            {anyPoints && <td className="align-top tabular-nums text-slate-600">{formatPoints(row.pointsPossible)}</td>}
          </tr>
        ))}
      </tbody>
      {(anyPoints || anyAwarded) && (
        <tfoot>
          <tr>
            <td className="font-medium">Total</td>
            <td />
            {marked && <td className="font-semibold tabular-nums">{anyAwarded ? formatPoints(awarded) : "—"}</td>}
            {anyPoints && <td className="tabular-nums text-slate-600">{formatPoints(total)}</td>}
          </tr>
        </tfoot>
      )}
    </Table>
  );
}

/** The blank rubric attached to an assessment, as a student reads it before submitting. */
export function RubricPanel({ rubric }: { rubric: Rubric }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{rubric.title}</h3>
        {rubric.shared && <Badge tone="violet">College rubric</Badge>}
        {rubric.pointsPossible !== null && <Badge tone="brand">{formatPoints(rubric.pointsPossible)} points</Badge>}
      </div>
      {rubric.description && <p className="text-sm text-slate-600">{rubric.description}</p>}
      {rubric.criteria.length === 0 ? (
        <p className="text-sm text-slate-600">This rubric has no criteria yet.</p>
      ) : (
        <RubricTable rows={rowsFromRubric(rubric.criteria)} />
      )}
    </div>
  );
}

/** A marked rubric, as a student reads it once the grade is released. */
export function MarkedRubric({ assessment }: { assessment: RubricAssessment }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{assessment.rubricTitle}</h3>
        {assessment.total !== null && (
          <Badge tone="brand">
            {formatPoints(assessment.total)}
            {assessment.pointsPossible !== null && ` / ${formatPoints(assessment.pointsPossible)}`}
          </Badge>
        )}
        {!assessment.complete && <Badge tone="amber">Marking in progress</Badge>}
      </div>
      <RubricTable rows={rowsFromAssessment(assessment.criteria)} marked />
    </div>
  );
}
