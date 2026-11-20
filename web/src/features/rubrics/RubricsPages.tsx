import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Ruler, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  FormError,
  IconButton,
  Loadable,
  PageHeader,
  Table,
  TextAreaField,
  TextField,
} from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatPoints } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { Rubric, RubricCriterion, RubricLevel } from "../../lib/types";

interface LevelDraft {
  id?: string;
  description: string;
  points: string;
}

const blankLevels = (): LevelDraft[] => [
  { description: "Excellent", points: "" },
  { description: "Adequate", points: "" },
  { description: "Not demonstrated", points: "0" },
];

// ====================================================================== list

/**
 * A course's marking schemes, with the college's shared ones underneath.
 *
 * A shared rubric is offered two ways on purpose: **Use** attaches the college's own, so a
 * later correction by the office reaches every course at once and "which assessments use this"
 * stays an answerable question; **Copy to course** forks an editable version for a teacher who
 * needs different words. Attaching were it to copy silently would make "maintained by the
 * office" meaningless.
 */
function RubricList({
  listUrl,
  base,
  courseId,
  canCreate,
}: {
  listUrl: string;
  base: string;
  courseId: string | null;
  canCreate: boolean;
}) {
  const q = useApi<{ data: Rubric[] }>(listUrl);
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const fb = useFeedback();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => invalidate(listUrl, "/rubrics", courseId ? `/courses/${courseId}` : "/rubrics");

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ rubric: Rubric }>(listUrl, { title: title.trim() });
      await refresh();
      setCreating(false);
      setTitle("");
      navigate(`${base}/${r.rubric.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const copyToCourse = async (rubric: Rubric) => {
    if (!courseId) return;
    try {
      const r = await api.post<{ rubric: Rubric }>(`/rubrics/${rubric.id}/copy`, { courseId });
      await refresh();
      fb.success(`Copied as "${r.rubric.title}".`);
      navigate(`${base}/${r.rubric.id}`);
    } catch (err) {
      fb.error(err);
    }
  };

  const remove = async (rubric: Rubric) => {
    const ok = await fb.confirm({
      title: "Delete this rubric?",
      message:
        "Marks already given against it are kept — each one holds its own copy of the criteria. The rubric itself cannot be recovered.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/rubrics/${rubric.id}`);
      await refresh();
      fb.success("Rubric deleted.");
    } catch (err) {
      fb.error(err);
    }
  };

  return (
    <>
      <PageHeader
        title="Rubrics"
        description="Marking schemes you can attach to an assignment, a quiz or a graded discussion, and reuse every term."
        actions={
          canCreate ? (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New rubric
            </Button>
          ) : null
        }
      />

      <Loadable query={q}>
        {(d) => {
          const own = d.data.filter((r) => !r.shared);
          const shared = d.data.filter((r) => r.shared);
          if (!d.data.length) {
            return (
              <EmptyState
                icon={<Ruler className="size-6" />}
                title="No rubrics yet"
                description="A rubric lists what you are marking against, so a mark explains itself and the next term's marking matches this one."
                action={
                  canCreate ? (
                    <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                      New rubric
                    </Button>
                  ) : undefined
                }
              />
            );
          }
          return (
            <div className="space-y-5">
              {(courseId ? own : d.data).length > 0 && (
                <Card>
                  <CardHeader title={courseId ? "This course's rubrics" : "Shared rubrics"} />
                  <RubricRows
                    rubrics={courseId ? own : d.data}
                    base={base}
                    onDelete={remove}
                    onCopy={null}
                  />
                </Card>
              )}
              {courseId && shared.length > 0 && (
                <Card>
                  <CardHeader
                    title="College rubrics"
                    description="Maintained by the academic office. Use one as it stands, or take a copy to adapt for this course."
                  />
                  <RubricRows rubrics={shared} base={base} onDelete={null} onCopy={copyToCourse} />
                </Card>
              )}
            </div>
          );
        }}
      </Loadable>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New rubric"
        description="Give it a name now; add the criteria next."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={busy} disabled={!title.trim()}>
              Create
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-3">
          <FormError error={error} />
          <TextField
            label="Name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Essay rubric"
            required
          />
        </form>
      </Dialog>
    </>
  );
}

function RubricRows({
  rubrics,
  base,
  onDelete,
  onCopy,
}: {
  rubrics: Rubric[];
  base: string;
  onDelete: ((r: Rubric) => void) | null;
  onCopy: ((r: Rubric) => void) | null;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <th scope="col">Rubric</th>
          <th scope="col">Criteria</th>
          <th scope="col">Points</th>
          <th scope="col">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rubrics.map((r) => (
          <tr key={r.id}>
            <td>
              <Link className="font-medium text-brand-700 hover:underline" to={`${base}/${r.id}`}>
                {r.title}
              </Link>
              {r.description && <div className="text-xs text-slate-600">{r.description}</div>}
            </td>
            <td className="tabular-nums">{r.criteria.length}</td>
            <td className="tabular-nums">{formatPoints(r.pointsPossible)}</td>
            <td>
              <div className="flex justify-end gap-1">
                {onCopy && (
                  <IconButton label={`Copy ${r.title} to this course`} onClick={() => onCopy(r)}>
                    <Copy className="size-4" />
                  </IconButton>
                )}
                {onDelete && (
                  <IconButton label={`Delete ${r.title}`} onClick={() => onDelete(r)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// ==================================================================== editor

function RubricEditorInner({ backTo }: { backTo: string }) {
  const { rubricId } = useParams<{ rubricId: string }>();
  const url = `/rubrics/${rubricId}`;
  const q = useApi<{ rubric: Rubric; canEdit: boolean; usedBy: { assignmentId: string; title: string }[] }>(url);
  const invalidate = useInvalidate();
  const fb = useFeedback();
  const loaded = useRef(false);
  const [f, setF] = useState({ title: "", description: "" });
  const [savingDetails, setSavingDetails] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<RubricCriterion | "new" | null>(null);

  useEffect(() => {
    if (loaded.current || !q.data) return;
    loaded.current = true;
    setF({ title: q.data.rubric.title, description: q.data.rubric.description });
  }, [q.data]);

  const refresh = () => invalidate(url, "/rubrics", "/courses");

  const saveDetails = async (e: FormEvent) => {
    e.preventDefault();
    setSavingDetails(true);
    setError(null);
    try {
      await api.patch(url, { title: f.title.trim(), description: f.description });
      await refresh();
      fb.success("Rubric saved.");
    } catch (err) {
      setError(err);
    } finally {
      setSavingDetails(false);
    }
  };

  const move = async (criteria: RubricCriterion[], index: number, dir: -1 | 1) => {
    const ids = criteria.map((c) => c.id);
    const j = index + dir;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    try {
      await api.post(`${url}/criteria/reorder`, { criterionIds: ids });
      await refresh();
    } catch (err) {
      fb.error(err);
    }
  };

  const removeCriterion = async (criterion: RubricCriterion) => {
    const ok = await fb.confirm({
      title: "Delete this criterion?",
      message: `"${criterion.description}" will be removed from the rubric. Marks already given keep their own copy.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/rubric-criteria/${criterion.id}`);
      await refresh();
    } catch (err) {
      fb.error(err);
    }
  };

  return (
    <Loadable query={q}>
      {(d) => (
        <>
          <PageHeader
            eyebrow={<Link to={backTo} className="hover:underline">Rubrics</Link>}
            title={d.rubric.title}
            description={
              d.rubric.shared
                ? "A college rubric. Any teacher may attach it; only the academic office may change it."
                : "Used by this course's assessments."
            }
            actions={<Badge tone="brand">{formatPoints(d.rubric.pointsPossible)} points</Badge>}
          />

          {!d.canEdit && (
            <p className="mb-4 rounded-panel bg-sky-50 px-4 py-2 text-sm text-sky-900">
              You can attach this rubric to your assessments, but only the academic office can change it — one
              teacher's edit would change how every course using it is marked. Take a copy if you need different
              wording.
            </p>
          )}

          {d.usedBy.length > 0 && (
            <p className="mb-4 text-sm text-slate-600">
              Attached to {d.usedBy.length} assessment{d.usedBy.length === 1 ? "" : "s"}:{" "}
              {d.usedBy.map((u) => u.title).join(", ")}. Editing it changes future marking only — marks already
              given keep the wording they were given against.
            </p>
          )}

          {d.canEdit && (
            <Card className="mb-5 space-y-4 p-6">
              <form onSubmit={saveDetails} className="space-y-4">
                <FormError error={error} />
                <TextField label="Name" value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} required />
                <TextAreaField
                  label="Description (optional)"
                  rows={2}
                  value={f.description}
                  onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))}
                  hint="Shown to students above the criteria."
                />
                <div className="flex justify-end">
                  <Button type="submit" loading={savingDetails} disabled={!f.title.trim()}>
                    Save
                  </Button>
                </div>
              </form>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Criteria"
              description="What the work is judged against, in the order a marker meets them."
              actions={
                d.canEdit ? (
                  <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
                    Add criterion
                  </Button>
                ) : null
              }
            />
            {d.rubric.criteria.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-slate-600">
                No criteria yet. A rubric needs at least one before it can mark anything.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {d.rubric.criteria.map((c, i) => (
                  <li key={c.id} className="px-6 py-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900">{c.description}</span>
                          <Badge tone="brand">{formatPoints(c.points)} pts</Badge>
                        </div>
                        {c.longDescription && <p className="mt-1 text-xs text-slate-600">{c.longDescription}</p>}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {c.levels.length === 0 ? (
                            <span className="text-xs text-slate-500">No levels — the marker types a number.</span>
                          ) : (
                            c.levels.map((l) => (
                              <span key={l.id} className="rounded-control border border-line px-2 py-0.5 text-xs text-slate-600">
                                {l.description} ({formatPoints(l.points)})
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                      {d.canEdit && (
                        <div className="flex shrink-0 gap-1">
                          <IconButton
                            label={`Move ${c.description} up`}
                            disabled={i === 0}
                            onClick={() => move(d.rubric.criteria, i, -1)}
                          >
                            <ArrowUp className="size-4" />
                          </IconButton>
                          <IconButton
                            label={`Move ${c.description} down`}
                            disabled={i === d.rubric.criteria.length - 1}
                            onClick={() => move(d.rubric.criteria, i, 1)}
                          >
                            <ArrowDown className="size-4" />
                          </IconButton>
                          <IconButton label={`Edit ${c.description}`} onClick={() => setEditing(c)}>
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton label={`Delete ${c.description}`} onClick={() => removeCriterion(c)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {editing && (
            <CriterionDialog
              rubricId={d.rubric.id}
              criterion={editing === "new" ? null : editing}
              onClose={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                await refresh();
              }}
            />
          )}
        </>
      )}
    </Loadable>
  );
}

function CriterionDialog({
  rubricId,
  criterion,
  onClose,
  onSaved,
}: {
  rubricId: string;
  criterion: RubricCriterion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(criterion?.description ?? "");
  const [longDescription, setLongDescription] = useState(criterion?.longDescription ?? "");
  const [points, setPoints] = useState(criterion ? String(criterion.points ?? 0) : "");
  const [levels, setLevels] = useState<LevelDraft[]>(
    criterion
      ? criterion.levels.map((l: RubricLevel) => ({ id: l.id, description: l.description, points: String(l.points ?? 0) }))
      : blankLevels(),
  );
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fe = error instanceof ApiError ? error.fieldErrors() : {};

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const cleaned = levels
      .filter((l) => l.description.trim() !== "")
      .map((l) => ({ ...(l.id ? { id: l.id } : {}), description: l.description.trim(), points: Number(l.points || 0) }));
    // Default the maximum to the top level, so the two cannot silently disagree.
    const top = cleaned.reduce((m, l) => Math.max(m, l.points), 0);
    const body = {
      description: description.trim(),
      longDescription,
      points: points.trim() === "" ? top : Number(points),
      levels: cleaned,
    };
    try {
      if (criterion) await api.patch(`/rubric-criteria/${criterion.id}`, body);
      else await api.post(`/rubrics/${rubricId}/criteria`, body);
      onSaved();
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
      size="lg"
      title={criterion ? "Edit criterion" : "Add criterion"}
      description="Levels give a marker something to click; the points are what the criterion is out of."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!description.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-4">
        <FormError error={error} />
        <TextField
          label="Criterion"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={fe.description}
          placeholder="Use of sources"
          required
        />
        <TextAreaField
          label="Guidance (optional)"
          rows={2}
          value={longDescription}
          onChange={(e) => setLongDescription(e.target.value)}
          hint="Shown with the criterion to students and markers."
        />
        <TextField
          label="Out of"
          type="number"
          min={0}
          step="0.5"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          error={fe.points}
          hint="Leave blank to use the highest level's points."
        />

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-slate-900">Levels</legend>
          {levels.map((l, i) => (
            <div key={l.id ?? i} className="flex items-center gap-2">
              <input
                aria-label={`Level ${i + 1} description`}
                value={l.description}
                onChange={(e) =>
                  setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                }
                className="min-w-0 flex-1 rounded-control border border-slate-300 px-3 py-1.5 text-sm"
                placeholder={`Level ${i + 1}`}
              />
              <input
                aria-label={`Level ${i + 1} points`}
                type="number"
                min={0}
                step="0.5"
                value={l.points}
                onChange={(e) => setLevels((ls) => ls.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)))}
                className="w-24 rounded-control border border-slate-300 px-3 py-1.5 text-sm tabular-nums"
              />
              <IconButton
                label={`Remove level ${i + 1}`}
                onClick={() => setLevels((ls) => ls.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() => setLevels((ls) => [...ls, { description: "", points: "" }])}
          >
            Add level
          </Button>
          <p className="text-xs text-slate-600">
            Leave the levels empty to have markers type a number instead.
          </p>
        </fieldset>
      </form>
    </Dialog>
  );
}

// =================================================================== exports

export function CourseRubrics() {
  const { course, base, permissions } = useCourse();
  return (
    <RubricList
      listUrl={`/courses/${course.id}/rubrics`}
      base={`${base}/rubrics`}
      courseId={course.id}
      canCreate={permissions.canEditContent}
    />
  );
}

export function CourseRubricEditor() {
  const { base } = useCourse();
  return <RubricEditorInner backTo={`${base}/rubrics`} />;
}

export function AdminRubrics() {
  return <RubricList listUrl="/rubrics" base="/admin/rubrics" courseId={null} canCreate />;
}

export function AdminRubricEditor() {
  return <RubricEditorInner backTo="/admin/rubrics" />;
}
