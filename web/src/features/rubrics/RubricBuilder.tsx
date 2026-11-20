import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Checkbox, Dialog, FormError, IconButton, TextField } from "../../components/ui";
import { api } from "../../lib/api";
import { formatPoints } from "../../lib/format";
import type { Rubric } from "../../lib/types";

interface DraftRating {
  key: number;
  id?: string;
  description: string;
  points: string;
}
interface DraftCriterion {
  key: number;
  id?: string;
  description: string;
  longDescription: string;
  ratings: DraftRating[];
}

let nextKey = 1;
const k = () => nextKey++;
const newCriterion = (): DraftCriterion => ({
  key: k(),
  description: "",
  longDescription: "",
  ratings: [
    { key: k(), description: "Full marks", points: "5" },
    { key: k(), description: "No marks", points: "0" },
  ],
});
const fromRubric = (r: Rubric): DraftCriterion[] =>
  r.criteria.map((c) => ({ key: k(), id: c.id, description: c.description, longDescription: c.longDescription, ratings: c.ratings.map((x) => ({ key: k(), id: x.id, description: x.description, points: String(x.points) })) }));

const pts = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? 0 : Math.max(0, Number(s)));
const move = <T,>(list: T[], i: number, d: -1 | 1) => {
  const next = [...list];
  [next[i], next[i + d]] = [next[i + d]!, next[i]!];
  return next;
};

/**
 * Create or edit a course rubric. A rubric already used to score work is `locked`: only its title and
 * comment setting can change, and criteria edits must be made on a copy.
 */
export function RubricBuilder({ courseId, rubric, locked, onClose, onSaved }: { courseId: string; rubric?: Rubric; locked?: boolean; onClose: () => void; onSaved: (r: Rubric) => void }) {
  const [title, setTitle] = useState(rubric?.title ?? "");
  const [freeForm, setFreeForm] = useState(rubric?.freeFormComments ?? false);
  const [criteria, setCriteria] = useState<DraftCriterion[]>(() => (rubric ? fromRubric(rubric) : [newCriterion()]));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const total = criteria.reduce((sum, c) => sum + Math.max(0, ...c.ratings.map((r) => pts(r.points))), 0);

  const setCriterion = (i: number, patch: Partial<DraftCriterion>) => setCriteria((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setRating = (i: number, ri: number, patch: Partial<DraftRating>) => setCriterion(i, { ratings: criteria[i]!.ratings.map((r, j) => (j === ri ? { ...r, ...patch } : r)) });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      title,
      freeFormComments: freeForm,
      ...(locked
        ? {}
        : {
            criteria: criteria.map((c) => ({
              id: c.id,
              description: c.description,
              longDescription: c.longDescription,
              ratings: c.ratings.map((r) => ({ id: r.id, description: r.description, points: pts(r.points) })),
            })),
          }),
    };
    try {
      const r = rubric ? await api.patch<{ rubric: Rubric }>(`/rubrics/${rubric.id}`, body) : await api.post<{ rubric: Rubric }>(`/courses/${courseId}/rubrics`, body);
      onSaved(r.rubric);
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
      size="xl"
      title={rubric ? "Edit rubric" : "New rubric"}
      description={`Total points: ${formatPoints(total)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="rubric-builder" loading={busy}>
            Save rubric
          </Button>
        </>
      }
    >
      <form id="rubric-builder" onSubmit={save} className="space-y-5">
        <FormError error={error} />
        <TextField label="Rubric title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        {locked && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            This rubric has already been used to score work, so its criteria are locked. You can rename it here; to change criteria, use “Edit a copy”.
          </p>
        )}
        <ol className="space-y-4">
          {criteria.map((c, i) => (
            <li key={c.key}>
              <fieldset className="space-y-3 rounded-lg border border-line p-4" disabled={locked}>
                <legend className="px-1 text-sm font-semibold">Criterion {i + 1}</legend>
                <div className="flex flex-wrap items-end gap-2">
                  <TextField className="min-w-0 flex-1" label="Description" required value={c.description} onChange={(e) => setCriterion(i, { description: e.target.value })} placeholder="e.g. Thesis statement" />
                  <div className="flex gap-1 pb-1">
                    <IconButton label={`Move criterion ${i + 1} up`} disabled={i === 0} onClick={() => setCriteria((l) => move(l, i, -1))}>
                      <ArrowUp className="size-4" />
                    </IconButton>
                    <IconButton label={`Move criterion ${i + 1} down`} disabled={i === criteria.length - 1} onClick={() => setCriteria((l) => move(l, i, 1))}>
                      <ArrowDown className="size-4" />
                    </IconButton>
                    <IconButton label={`Remove criterion ${i + 1}`} disabled={criteria.length === 1} onClick={() => setCriteria((l) => l.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                <TextField label="Details for students (optional)" value={c.longDescription} onChange={(e) => setCriterion(i, { longDescription: e.target.value })} />
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-700">Rating levels (the highest is the criterion's points)</p>
                  <ul className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]">
                    {c.ratings.map((r, ri) => (
                      <li key={r.key} className="space-y-2 rounded-control border border-slate-200 bg-slate-50 p-2">
                        <div className="flex items-end gap-1">
                          <TextField className="w-24" label="Points" type="number" min={0} step="0.5" required value={r.points} onChange={(e) => setRating(i, ri, { points: e.target.value })} />
                          <IconButton label={`Remove rating ${ri + 1} from criterion ${i + 1}`} className="mb-1 ml-auto" disabled={c.ratings.length === 1} onClick={() => setCriterion(i, { ratings: c.ratings.filter((_, j) => j !== ri) })}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                        <TextField label="Rating description" required value={r.description} onChange={(e) => setRating(i, ri, { description: e.target.value })} />
                      </li>
                    ))}
                  </ul>
                  <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setCriterion(i, { ratings: [...c.ratings, { key: k(), description: "", points: "0" }] })}>
                    Add rating
                  </Button>
                </div>
              </fieldset>
            </li>
          ))}
        </ol>
        {!locked && (
          <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setCriteria((l) => [...l, newCriterion()])}>
            Add criterion
          </Button>
        )}
        <Checkbox label="Allow free-form comments" hint="Graders can comment on each criterion without choosing a rating." checked={freeForm} onChange={(e) => setFreeForm(e.target.checked)} />
      </form>
    </Dialog>
  );
}
