import { Ruler } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useFeedback } from "../../components/ui/feedback";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Dialog,
  FormError,
  Loadable,
  SelectField,
} from "../../components/ui";
import { api } from "../../lib/api";
import { formatPoints } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { AttachedRubric, Rubric } from "../../lib/types";
import { RubricTable, rowsFromRubric } from "./RubricTable";

interface Mismatch {
  criterionTotal: number;
  pointsPossible: number;
}

/**
 * The rubric on one assessment, for staff. Works for an assignment, a quiz or a graded
 * discussion without knowing which: all three hang off an assignment row, and the rubric is
 * attached to that.
 */
export function RubricAttachment({
  assignmentId,
  courseId,
  base,
  rubric,
  canEdit,
  onChanged,
}: {
  assignmentId: string;
  courseId: string;
  base: string;
  rubric: AttachedRubric | null | undefined;
  canEdit: boolean;
  onChanged: () => Promise<unknown> | void;
}) {
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const [picking, setPicking] = useState(false);
  const [mismatch, setMismatch] = useState<Mismatch | null>(null);

  const detach = async () => {
    const ok = await fb.confirm({
      title: "Remove this rubric?",
      message:
        "Marks already given against it are kept exactly as they are — each one holds its own copy of the criteria. The rubric simply stops appearing on this assessment.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/assignments/${assignmentId}/rubric?force=true`);
      await invalidate(`/assignments/${assignmentId}`);
      await onChanged();
      setMismatch(null);
      fb.success("Rubric removed.");
    } catch (err) {
      fb.error(err);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Rubric"
        description={
          rubric
            ? rubric.useForGrading
              ? "The criterion points add up to the mark."
              : "Marking guidance and feedback. The mark is entered as usual."
            : "Attach a marking scheme so a mark explains itself."
        }
        actions={
          canEdit ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
                {rubric ? "Change" : "Attach a rubric"}
              </Button>
              {rubric && (
                <Button variant="ghost" size="sm" onClick={detach}>
                  Remove
                </Button>
              )}
            </div>
          ) : null
        }
      />
      <div className="px-6 pb-6">
        {!rubric ? (
          <p className="text-sm text-slate-600">
            No rubric attached.{" "}
            <Link className="text-brand-700 hover:underline" to={`${base}/rubrics`}>
              Browse this course's rubrics
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link className="font-medium text-brand-700 hover:underline" to={`${base}/rubrics/${rubric.id}`}>
                {rubric.title}
              </Link>
              {rubric.shared && <Badge tone="violet">College rubric</Badge>}
              {rubric.pointsPossible !== null && <Badge tone="brand">{formatPoints(rubric.pointsPossible)} points</Badge>}
              {!rubric.useForGrading && <Badge tone="amber">Feedback only</Badge>}
              {rubric.hidePoints && <Badge tone="gray">Points hidden from students</Badge>}
            </div>
            {mismatch && (
              <p className="rounded-panel bg-amber-50 px-4 py-2 text-sm text-amber-900">
                This rubric adds up to {formatPoints(mismatch.criterionTotal)} points, but the assessment is out of{" "}
                {formatPoints(mismatch.pointsPossible)}. Both are allowed — a mark above the total reads as over
                100%. Change the assessment's points if that is not what you meant.
              </p>
            )}
            <RubricTable rows={rowsFromRubric(rubric.criteria)} />
          </div>
        )}
      </div>

      {picking && (
        <PickRubricDialog
          assignmentId={assignmentId}
          courseId={courseId}
          current={rubric ?? null}
          onClose={() => setPicking(false)}
          onAttached={async (result) => {
            setPicking(false);
            setMismatch(result);
            await invalidate(`/assignments/${assignmentId}`);
            await onChanged();
          }}
        />
      )}
    </Card>
  );
}

function PickRubricDialog({
  assignmentId,
  courseId,
  current,
  onClose,
  onAttached,
}: {
  assignmentId: string;
  courseId: string;
  current: AttachedRubric | null;
  onClose: () => void;
  onAttached: (mismatch: Mismatch | null) => Promise<void>;
}) {
  const q = useApi<{ data: Rubric[] }>(`/courses/${courseId}/rubrics`);
  const [rubricId, setRubricId] = useState(current?.id ?? "");
  const [useForGrading, setUseForGrading] = useState(current?.useForGrading ?? true);
  const [hidePoints, setHidePoints] = useState(current?.hidePoints ?? false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const attach = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.put<{ pointsMismatch: Mismatch | null }>(`/assignments/${assignmentId}/rubric`, {
        rubricId,
        useForGrading,
        hidePoints,
      });
      await onAttached(r.pointsMismatch);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Attach a rubric"
      description="Pick one of this course's rubrics, or one of the college's."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={attach} loading={busy} disabled={!rubricId}>
            Attach
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError error={error} />
        <Loadable query={q}>
          {(d) =>
            d.data.length === 0 ? (
              <p className="text-sm text-slate-600">
                This course has no rubrics yet. Build one first, then come back.
              </p>
            ) : (
              <SelectField label="Rubric" value={rubricId} onChange={(e) => setRubricId(e.target.value)} required>
                <option value="">Choose a rubric…</option>
                {d.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                    {r.shared ? " (college)" : ""} — {formatPoints(r.pointsPossible)} points, {r.criteria.length}{" "}
                    criteria
                  </option>
                ))}
              </SelectField>
            )
          }
        </Loadable>
        <Checkbox
          label="Use it to work out the mark"
          hint="The criterion points add up to the score. Turn this off to use the rubric for feedback only. A quiz always scores from its own questions."
          checked={useForGrading}
          onChange={(e) => setUseForGrading(e.target.checked)}
        />
        <Checkbox
          label="Hide the points from students"
          hint="Students see the criteria and levels but no numbers."
          checked={hidePoints}
          onChange={(e) => setHidePoints(e.target.checked)}
        />
        <p className="flex items-start gap-2 text-xs text-slate-600">
          <Ruler className="mt-0.5 size-4 shrink-0" />
          Changing a rubric later never moves a mark already given: each mark keeps its own copy of the criteria it
          was judged against.
        </p>
      </div>
    </Dialog>
  );
}
