import { Copy, Pencil, Plus, TableProperties } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardHeader, Checkbox, SelectField } from "../../components/ui";
import { useFeedback } from "../../components/ui/feedback";
import { api } from "../../lib/api";
import { formatPoints } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { Assignment, Rubric, RubricListItem } from "../../lib/types";
import { RubricBuilder } from "./RubricBuilder";
import { RubricView } from "./RubricView";

type Target = Pick<Assignment, "id" | "courseId" | "rubricId" | "rubricUseForGrading" | "pointsPossible">;

/**
 * Attach a library rubric to an assignment (also a quiz's or graded discussion's). Changes save
 * immediately. Quiz rubrics are feedback only: the quiz score always comes from its questions.
 */
export function RubricAttachCard({ assignment: a, kind = "assignment", onPointsChange }: { assignment: Target; kind?: "assignment" | "quiz" | "discussion"; onPointsChange?: (points: number) => void }) {
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const library = useApi<{ data: RubricListItem[] }>(`/courses/${a.courseId}/rubrics`);
  const [rubricId, setRubricId] = useState(a.rubricId);
  const [useForGrading, setUseForGrading] = useState(a.rubricUseForGrading);
  const [points, setPoints] = useState(a.pointsPossible);
  const [editing, setEditing] = useState<{ rubric?: Rubric; locked?: boolean } | null>(null);
  const selected = library.data?.data.find((r) => r.id === rubricId) ?? null;
  const isQuiz = kind === "quiz";

  const patch = async (body: { rubricId?: string | null; rubricUseForGrading?: boolean; pointsPossible?: number }, done: string) => {
    // Show the choice at once; the server's answer (or the previous state on failure) follows.
    const before = { rubricId, useForGrading };
    if (body.rubricId !== undefined) setRubricId(body.rubricId);
    if (body.rubricUseForGrading !== undefined) setUseForGrading(body.rubricUseForGrading);
    try {
      const r = await api.patch<{ assignment: Assignment }>(`/assignments/${a.id}`, body);
      setRubricId(r.assignment.rubricId);
      setUseForGrading(r.assignment.rubricUseForGrading);
      setPoints(r.assignment.pointsPossible);
      await invalidate(`/assignments/${a.id}`, `/courses/${a.courseId}/rubrics`, `/courses/${a.courseId}/assignments`, `/courses/${a.courseId}/gradebook`);
      fb.success(done);
      return r.assignment;
    } catch (err) {
      setRubricId(before.rubricId);
      setUseForGrading(before.useForGrading);
      fb.error(err);
      return null;
    }
  };

  const onSaved = async (r: Rubric) => {
    setEditing(null);
    await invalidate(`/courses/${a.courseId}/rubrics`, `/assignments/${a.id}/rubric`);
    if (r.id !== rubricId) await patch({ rubricId: r.id }, `Rubric “${r.title}” attached.`);
    else fb.success("Rubric saved.");
  };

  const editCopy = async () => {
    if (!selected) return;
    try {
      const copy = await api.post<{ rubric: Rubric }>(`/rubrics/${selected.id}/duplicate`);
      await invalidate(`/courses/${a.courseId}/rubrics`);
      setEditing({ rubric: copy.rubric });
    } catch (err) {
      fb.error(err);
    }
  };

  const mismatch = !isQuiz && useForGrading && selected && selected.possible !== points;

  return (
    <Card>
      <CardHeader
        title="Rubric"
        description={isQuiz ? "Feedback only: the quiz score always comes from its questions." : "Students see the criteria before they submit, and their scores once grades are released."}
      />
      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            className="min-w-56 flex-1"
            label="Rubric"
            value={rubricId ?? ""}
            disabled={library.isPending}
            onChange={(e) => void patch({ rubricId: e.target.value || null }, e.target.value ? "Rubric attached." : "Rubric removed.")}
          >
            <option value="">No rubric</option>
            {library.data?.data.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} ({formatPoints(r.possible)} pts)
              </option>
            ))}
          </SelectField>
          <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setEditing({})}>
            New rubric
          </Button>
          {selected &&
            (selected.assessmentCount > 0 ? (
              <>
                <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing({ rubric: selected, locked: true })}>
                  Rename
                </Button>
                <Button variant="ghost" icon={<Copy className="size-4" />} onClick={() => void editCopy()}>
                  Edit a copy
                </Button>
              </>
            ) : (
              <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing({ rubric: selected })}>
                Edit
              </Button>
            ))}
        </div>
        {selected && !isQuiz && (
          <Checkbox
            label="Use this rubric for grading"
            hint="The rubric total fills the grade when you grade. You can still change the grade before saving."
            checked={useForGrading}
            onChange={(e) => void patch({ rubricUseForGrading: e.target.checked }, e.target.checked ? "The rubric total will fill the grade." : "The rubric is now feedback only.")}
          />
        )}
        {mismatch && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="mr-auto">
              The rubric is worth {formatPoints(selected.possible)} points but this {kind} is worth {formatPoints(points)}.
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const updated = await patch({ pointsPossible: selected.possible }, `Points set to ${formatPoints(selected.possible)}.`);
                if (updated) onPointsChange?.(updated.pointsPossible);
              }}
            >
              Set points to {formatPoints(selected.possible)}
            </Button>
          </div>
        )}
        {selected ? (
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-brand-700 hover:underline">
              <TableProperties className="size-4" aria-hidden /> Preview “{selected.title}”
            </summary>
            <RubricView rubric={selected} className="mt-3" />
          </details>
        ) : (
          <p className="text-sm text-slate-600">No rubric attached. Choose one from the course library or create a new one.</p>
        )}
      </div>
      {editing && <RubricBuilder courseId={a.courseId} rubric={editing.rubric} locked={editing.locked} onClose={() => setEditing(null)} onSaved={(r) => void onSaved(r)} />}
    </Card>
  );
}
