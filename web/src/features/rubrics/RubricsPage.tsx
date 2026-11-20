import { Copy, EllipsisVertical, Pencil, Plus, TableProperties, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { Badge, Button, Card, EmptyState, IconButton, Loadable, Menu, MenuItem, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { formatPoints, plural } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { Rubric, RubricListItem } from "../../lib/types";
import { RubricBuilder } from "./RubricBuilder";
import { RubricView } from "./RubricView";

/** Course rubric library: create, edit, copy and delete rubrics, and see where each is used. */
export function RubricsPage() {
  const { course, base, permissions } = useCourse();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const q = useApi<{ data: RubricListItem[] }>(`/courses/${course.id}/rubrics`);
  const [editing, setEditing] = useState<{ rubric?: Rubric; locked?: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => invalidate(`/courses/${course.id}/rubrics`);
  const canEdit = permissions.canEditContent && !permissions.readOnly;

  if (!permissions.isStaff) return <EmptyState title="Only course staff can manage rubrics" />;

  const duplicate = async (r: RubricListItem, thenEdit: boolean) => {
    try {
      const copy = await api.post<{ rubric: Rubric }>(`/rubrics/${r.id}/duplicate`);
      await refresh();
      if (thenEdit) setEditing({ rubric: copy.rubric });
      else fb.success(`Created “${copy.rubric.title}”.`);
    } catch (err) {
      fb.error(err);
    }
  };

  const remove = async (r: RubricListItem) => {
    if (!(await fb.confirm({ title: `Delete “${r.title}”?`, message: "This permanently deletes the rubric. It can't be undone.", confirmLabel: "Delete rubric", danger: true }))) return;
    try {
      await api.del(`/rubrics/${r.id}`);
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
        description="Reusable scoring guides for assignments, quizzes and graded discussions."
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing({})}>
              Rubric
            </Button>
          )
        }
      />
      <Loadable query={q} label="Loading rubrics…">
        {(d) =>
          d.data.length === 0 ? (
            <Card>
              <EmptyState icon={<TableProperties className="size-6" />} title="No rubrics yet" description="Create a rubric, then attach it from an assignment, quiz settings or a graded discussion." />
            </Card>
          ) : (
            <ul className="space-y-4">
              {d.data.map((r) => {
                const locked = r.assessmentCount > 0;
                return (
                  <li key={r.id}>
                    <Card>
                      <div className="flex flex-wrap items-start gap-3 px-5 py-4">
                        <div className="min-w-0 flex-1">
                          <h2 className="text-base font-semibold">{r.title}</h2>
                          <p className="text-sm text-slate-600">
                            {plural(r.criteria.length, "criterion", "criteria")} · {formatPoints(r.possible)} pts
                            {locked && ` · used to score ${plural(r.assessmentCount, "submission")}`}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            {r.usedBy.length === 0 ? (
                              "Not attached to anything yet."
                            ) : (
                              <>
                                Used by{" "}
                                {r.usedBy.map((a, i) => (
                                  <span key={a.id}>
                                    {i > 0 && ", "}
                                    <Link to={`${base}/assignments/${a.id}`} className="text-brand-700 hover:underline">
                                      {a.title}
                                    </Link>
                                  </span>
                                ))}
                              </>
                            )}
                          </p>
                        </div>
                        {locked && <Badge tone="amber">Criteria locked</Badge>}
                        <Button variant="ghost" size="sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                          {open === r.id ? "Hide" : "Preview"}
                        </Button>
                        {canEdit && (
                          <Menu trigger={<IconButton label={`Actions for ${r.title}`}><EllipsisVertical className="size-4" /></IconButton>} label={`Actions for ${r.title}`}>
                            {locked ? (
                              <>
                                <MenuItem icon={<Pencil />} onSelect={() => setEditing({ rubric: r, locked: true })}>
                                  Rename
                                </MenuItem>
                                <MenuItem icon={<Copy />} onSelect={() => void duplicate(r, true)}>
                                  Edit a copy
                                </MenuItem>
                              </>
                            ) : (
                              <MenuItem icon={<Pencil />} onSelect={() => setEditing({ rubric: r })}>
                                Edit
                              </MenuItem>
                            )}
                            <MenuItem icon={<Copy />} onSelect={() => void duplicate(r, false)}>
                              Duplicate
                            </MenuItem>
                            <MenuItem icon={<Trash2 />} danger disabled={locked || r.usedBy.length > 0} onSelect={() => void remove(r)}>
                              Delete
                            </MenuItem>
                          </Menu>
                        )}
                      </div>
                      {open === r.id && (
                        <div className="border-t border-line px-5 py-4">
                          <RubricView rubric={r} />
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )
        }
      </Loadable>
      {editing && (
        <RubricBuilder
          courseId={course.id}
          rubric={editing.rubric}
          locked={editing.locked}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
            fb.success("Rubric saved.");
          }}
        />
      )}
    </>
  );
}
