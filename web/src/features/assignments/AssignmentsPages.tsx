import clsx from "clsx";
import { ClipboardCheck, Eye, EyeOff, FileQuestion, FileUp, Link2, MessagesSquare, NotebookPen, Search, Paperclip, Pencil, Plus, Send, Settings2, Trash2, Type } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { MarkdownEditor } from "../../components/ui/markdown-editor";
import { Badge, Button, Card, CardHeader, Checkbox, Dialog, EmptyState, FormError, IconButton, LinkButton, Loadable, PageHeader, RichContent, SearchInput, SelectField, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { formatBytes, formatDateTime, formatPoints, fromLocalInput, plural, relative, toLocalInput } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import { usePref } from "../../lib/ui-prefs";
import type { Assignment, AssignmentGroup, SubmissionDetail } from "../../lib/types";
import { ModuleNav } from "../content/ModuleNav";
import { SUBMISSION_TYPE_LABEL, SubmissionBadges } from "./shared";

// ====================================================================== list
type ShowBy = "type" | "date";

export function AssignmentsList() {
  const { course, base, permissions } = useCourse();
  const q = useApi<{ groups: AssignmentGroup[]; data: Assignment[] }>(`/courses/${course.id}/assignments`);
  const [groupDialog, setGroupDialog] = useState<AssignmentGroup | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [showBy, setShowBy] = usePref<ShowBy>("assignmentsShowBy", "type");
  const editable = permissions.canEditContent;

  const row = (a: Assignment) => {
    const href = a.quizId ? `${base}/quizzes/${a.quizId}` : a.discussionId ? `${base}/discussions/${a.discussionId}` : `${base}/assignments/${a.id}`;
    const Icon = a.quizId ? FileQuestion : a.discussionId ? MessagesSquare : NotebookPen;
    return (
      <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
        <Icon className={clsx("size-5 shrink-0", a.published ? "text-slate-600" : "text-slate-400")} aria-hidden />
        <div className="min-w-0 flex-1">
          <Link to={href} className="text-sm font-medium text-brand-700 hover:underline">
            {a.title}
          </Link>
          <div className="text-xs text-slate-500">
            {a.dueAt ? (
              <>
                Due <span className="font-medium text-slate-700">{formatDateTime(a.dueAt)}</span>
              </>
            ) : (
              "No due date"
            )}{" "}
            · {a.gradingType === "not_graded" ? "Not graded" : `${formatPoints(a.pointsPossible)} pts`}
            {a.quizId && " · Quiz"}
            {a.discussionId && " · Graded discussion"}
          </div>
        </div>
        {permissions.isStaff ? (
          <span className="flex flex-wrap gap-1">
            {a.published ? <Badge tone="green">Published</Badge> : <Badge tone="amber">Unpublished</Badge>}
            {!!a.needsGradingCount && (
              <Link to={`${base}/assignments/${a.id}/grade`} className="rounded-full">
                <Badge tone="violet">{a.needsGradingCount} to grade</Badge>
              </Link>
            )}
          </span>
        ) : (
          a.mySubmission && <SubmissionBadges cell={a.mySubmission} pointsPossible={a.pointsPossible} />
        )}
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Assignments"
        description={course.applyGroupWeights ? "Final grade is weighted by assignment group." : "Final grade is total points earned / total points possible."}
        actions={
          editable && (
            <>
              <Button variant="secondary" icon={<Settings2 className="size-4" />} onClick={() => setGroupDialog("new")}>
                Add group
              </Button>
              <LinkButton to={`${base}/assignments/new`} icon={<Plus className="size-4" />}>
                Assignment
              </LinkButton>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <SearchInput aria-label="Search assignments" placeholder="Search assignments" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div role="radiogroup" aria-label="Show assignments by" className="inline-flex rounded-control border border-slate-300 bg-white p-0.5 text-sm">
          {(["type", "date"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={showBy === v}
              onClick={() => setShowBy(v)}
              className={clsx("rounded px-3 py-1.5 font-medium", showBy === v ? "bg-brand-700 text-white" : "text-slate-700 hover:bg-slate-100")}
            >
              Show by {v}
            </button>
          ))}
        </div>
      </div>
      <Loadable query={q}>
        {(d) => {
          const term = search.trim().toLowerCase();
          const items = term ? d.data.filter((a) => a.title.toLowerCase().includes(term)) : d.data;
          if (d.data.length === 0 && !editable)
            return (
              <Card>
                <EmptyState icon={<NotebookPen className="size-6" />} title="No assignments yet" />
              </Card>
            );
          if (term && items.length === 0)
            return (
              <Card>
                <EmptyState
                  title={`No assignments match "${search}"`}
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setSearch("")}>
                      Clear search
                    </Button>
                  }
                />
              </Card>
            );
          if (showBy === "date") {
            const now = Date.now();
            const sorted = [...items].sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
            const sections: [string, Assignment[]][] = [
              ["Upcoming", sorted.filter((a) => a.dueAt && Date.parse(a.dueAt) >= now)],
              ["Undated", sorted.filter((a) => !a.dueAt)],
              ["Past", sorted.filter((a) => a.dueAt && Date.parse(a.dueAt) < now).reverse()],
            ];
            return (
              <div className="space-y-5">
                {sections
                  .filter(([, list]) => list.length)
                  .map(([title, list]) => (
                    <Card key={title}>
                      <CardHeader title={title} description={plural(list.length, "item")} />
                      <ul className="divide-y divide-line">{list.map(row)}</ul>
                    </Card>
                  ))}
              </div>
            );
          }
          return (
            <div className="space-y-5">
              {d.groups.map((g) => {
                const list = items.filter((a) => a.groupId === g.id);
                if (term && !list.length) return null;
                return (
                  <Card key={g.id}>
                    <CardHeader
                      title={g.name}
                      description={
                        [course.applyGroupWeights ? `${formatPoints(g.weight)}% of final grade` : null, g.dropLowest ? `drop lowest ${g.dropLowest}` : null, g.dropHighest ? `drop highest ${g.dropHighest}` : null].filter(Boolean).join(" · ") ||
                        undefined
                      }
                      actions={
                        editable && (
                          <IconButton label={`Edit group ${g.name}`} onClick={() => setGroupDialog(g)}>
                            <Pencil className="size-4" />
                          </IconButton>
                        )
                      }
                    />
                    {list.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">No assignments in this group.</p> : <ul className="divide-y divide-line">{list.map(row)}</ul>}
                  </Card>
                );
              })}
            </div>
          );
        }}
      </Loadable>
      {groupDialog && <GroupDialog group={groupDialog === "new" ? null : groupDialog} onClose={() => setGroupDialog(null)} />}
    </>
  );
}

function GroupDialog({ group, onClose }: { group: AssignmentGroup | null; onClose: () => void }) {
  const { course } = useCourse();
  const invalidate = useInvalidate();
  const fb = useFeedback();
  const [name, setName] = useState(group?.name ?? "");
  const [weight, setWeight] = useState(String(group?.weight ?? 0));
  const [dropLowest, setDropLowest] = useState(String(group?.dropLowest ?? 0));
  const [dropHighest, setDropHighest] = useState(String(group?.dropHighest ?? 0));
  const [error, setError] = useState<unknown>(null);
  const refresh = () => invalidate(`/courses/${course.id}/assignment`, `/courses/${course.id}/grades`, `/courses/${course.id}/gradebook`);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name, weight: Number(weight), dropLowest: Number(dropLowest), dropHighest: Number(dropHighest) };
    try {
      if (group) await api.patch(`/assignment-groups/${group.id}`, body);
      else await api.post(`/courses/${course.id}/assignment-groups`, body);
      await refresh();
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  const remove = async () => {
    if (!group || !(await fb.confirm({ title: `Delete "${group.name}"?`, message: "Its assignments move to the first remaining group.", confirmLabel: "Delete group", danger: true }))) return;
    try {
      await api.del(`/assignment-groups/${group.id}`);
      await refresh();
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={group ? "Edit assignment group" : "New assignment group"}
      footer={
        <>
          {group && (
            <Button variant="ghost" className="mr-auto text-red-700" onClick={() => void remove()}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="group-form">
            Save
          </Button>
        </>
      }
    >
      <form id="group-form" onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <TextField label="Group name" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Weight (% of final grade)" type="number" min={0} max={1000} step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} hint={course.applyGroupWeights ? "Used because weighting is on in course settings." : "Ignored until weighting is turned on in course settings."} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Drop lowest scores" type="number" min={0} max={50} value={dropLowest} onChange={(e) => setDropLowest(e.target.value)} />
          <TextField label="Drop highest scores" type="number" min={0} max={50} value={dropHighest} onChange={(e) => setDropHighest(e.target.value)} />
        </div>
      </form>
    </Dialog>
  );
}

// ====================================================================== view
export function AssignmentView() {
  const { assignmentId } = useParams();
  const { course, base, permissions } = useCourse();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const q = useApi<{ assignment: Assignment & { submissionCount?: number } }>(`/assignments/${assignmentId}`);
  useEffect(() => {
    if (q.isSuccess && permissions.role === "student") void invalidate(`/courses/${course.id}/modules`, `/courses/${course.id}/module-nav`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.isSuccess]);

  const post = async (hide: boolean) => {
    if (hide && !(await fb.confirm({ title: "Hide grades?", message: "Students will no longer see grades or feedback for this assignment until you release them again. Future grades will also wait for manual release.", confirmLabel: "Hide grades" }))) return;
    try {
      const r = await api.post<{ posted?: number; hidden?: number }>(`/assignments/${assignmentId}/${hide ? "hide-grades" : "post-grades"}`);
      await invalidate(`/assignments/${assignmentId}`, `/courses/${course.id}`);
      fb.success(hide ? `Grades hidden for ${plural(r.hidden ?? 0, "student")}.` : `Released grades to ${plural(r.posted ?? 0, "student")}.`);
    } catch (err) {
      fb.error(err);
    }
  };

  return (
    <Loadable query={q}>
      {({ assignment: a }) => (
        <article className="space-y-6">
          <PageHeader
            title={a.title}
            actions={
              permissions.isStaff && (
                <>
                  {!a.published && <Badge tone="amber">Draft</Badge>}
                  {permissions.canEditContent && !a.quizId && !a.discussionId && (
                    <LinkButton to={`${base}/assignments/${a.id}/edit`} variant="secondary" icon={<Pencil className="size-4" />}>
                      Edit
                    </LinkButton>
                  )}
                  {permissions.canGrade && (
                    <LinkButton to={`${base}/assignments/${a.id}/grade`} icon={<ClipboardCheck className="size-4" />}>
                      Grade submissions
                    </LinkButton>
                  )}
                </>
              )
            }
          />
          <Card className="grid gap-4 p-5 text-sm sm:grid-cols-4">
            <div>
              <div className="text-xs text-slate-500">Due</div>
              <div className="font-medium">{a.dueAt ? formatDateTime(a.dueAt) : "No due date"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Points</div>
              <div className="font-medium">{a.gradingType === "not_graded" ? "Not graded" : formatPoints(a.pointsPossible)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Submitting</div>
              <div className="font-medium">{a.submissionTypes.map((t) => SUBMISSION_TYPE_LABEL[t] ?? t).join(", ")}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Attempts</div>
              <div className="font-medium">{a.allowedAttempts ?? "Unlimited"}</div>
            </div>
            {(a.unlockAt || a.lockAt) && (
              <div className="sm:col-span-4 text-xs text-slate-500">
                Available {a.unlockAt ? `from ${formatDateTime(a.unlockAt)}` : "now"} {a.lockAt ? `until ${formatDateTime(a.lockAt)}` : ""}
              </div>
            )}
            {a.allowedExtensions.length > 0 && <div className="sm:col-span-4 text-xs text-slate-500">Accepted file types: {a.allowedExtensions.map((e) => `.${e}`).join(", ")}</div>}
          </Card>
          {a.quizId && (
            <Card className="p-5 text-sm">
              This assignment is a quiz. <Link className="font-medium text-brand-700 hover:underline" to={`${base}/quizzes/${a.quizId}`}>Open the quiz</Link>
            </Card>
          )}
          {a.discussionId && (
            <Card className="p-5 text-sm">
              This is a graded discussion — your post is your submission. <Link className="font-medium text-brand-700 hover:underline" to={`${base}/discussions/${a.discussionId}`}>Go to the discussion</Link>
            </Card>
          )}
          {a.descriptionHtml && (
            <Card className="p-6">
              <RichContent html={a.descriptionHtml} />
            </Card>
          )}
          {permissions.isStaff && permissions.canGrade && (
            <Card className="flex flex-wrap items-center gap-3 p-5 text-sm">
              <span className="mr-auto">
                {plural(a.submissionCount ?? 0, "submission record")} · Grades are released {a.postManually ? <strong>manually</strong> : <strong>automatically when graded</strong>}.
              </span>
              <Button variant="secondary" size="sm" icon={<Eye className="size-4" />} onClick={() => void post(false)}>
                Release grades
              </Button>
              <Button variant="ghost" size="sm" icon={<EyeOff className="size-4" />} onClick={() => void post(true)}>
                Hide grades
              </Button>
            </Card>
          )}
          {permissions.role === "student" && !a.quizId && <StudentSubmission assignment={a} />}
          <ModuleNav refId={a.id} />
        </article>
      )}
    </Loadable>
  );
}

function StudentSubmission({ assignment: a }: { assignment: Assignment }) {
  const { course, permissions } = useCourse();
  const user = useUser();
  const detail = useApi<SubmissionDetail>(`/assignments/${a.id}/submissions/${user.id}`);
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const onlineTypes = a.submissionTypes.filter((t) => ["online_text_entry", "online_url", "online_upload"].includes(t));
  const [type, setType] = useState(onlineTypes[0] ?? "");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");

  const refresh = () => invalidate(`/assignments/${a.id}`, `/courses/${course.id}`, "/dashboard");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let body: Record<string, unknown> = { submissionType: type };
      if (type === "online_text_entry") body = { ...body, body: text };
      if (type === "online_url") body = { ...body, url };
      if (type === "online_upload") {
        if (files.length === 0) throw new ApiError(422, "validation_error", "Choose at least one file.");
        const up = await api.upload<{ data: { id: string }[] }>(`/assignments/${a.id}/uploads`, files);
        body = { ...body, fileIds: up.data.map((f) => f.id) };
      }
      const r = await api.post<{ attempt: number; late: boolean }>(`/assignments/${a.id}/submit`, body);
      setText("");
      setUrl("");
      setFiles([]);
      await refresh();
      fb.success(`Attempt ${r.attempt} submitted${r.late ? " (late)" : ""}. Your instructor has been notified.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const addComment = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/assignments/${a.id}/submissions/${user.id}/comments`, { body: comment });
      setComment("");
      await refresh();
    } catch (err) {
      fb.error(err);
    }
  };

  return (
    <Loadable query={detail}>
      {(d) => (
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader title="Your submission" actions={<SubmissionBadges cell={d.submission} pointsPossible={a.pointsPossible} />} />
            <div className="space-y-5 px-5 py-4">
              {d.submission.score !== null && (
                <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  <div className="text-lg font-semibold">
                    {formatPoints(d.submission.score)} / {formatPoints(a.pointsPossible)}
                  </div>
                  {!!d.submission.pointsDeducted && <div>Late penalty: −{formatPoints(d.submission.pointsDeducted)} (graded {formatPoints(d.submission.enteredScore)} before penalty)</div>}
                  {d.submission.gradedAt && <div className="text-xs">Graded {relative(d.submission.gradedAt)}</div>}
                </div>
              )}
              {d.canSubmit && onlineTypes.length > 0 ? (
                <form onSubmit={submit} className="space-y-4">
                  <FormError error={error} />
                  {onlineTypes.length > 1 && (
                    <div role="radiogroup" aria-label="Submission type" className="flex flex-wrap gap-2">
                      {onlineTypes.map((t) => (
                        <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${type === t ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-300 bg-white"}`}>
                          {t === "online_text_entry" ? <Type className="size-4" /> : t === "online_url" ? <Link2 className="size-4" /> : <FileUp className="size-4" />}
                          {SUBMISSION_TYPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  )}
                  {type === "online_text_entry" && <MarkdownEditor label="Your answer" value={text} onChange={setText} rows={10} required />}
                  {type === "online_url" && <TextField label="Website URL" type="url" required placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />}
                  {type === "online_upload" && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium" htmlFor="sub-files">
                        Files
                      </label>
                      <input id="sub-files" type="file" multiple accept={a.allowedExtensions.length ? a.allowedExtensions.map((e) => `.${e}`).join(",") : undefined} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-medium file:text-brand-800" />
                      <p className="text-xs text-slate-500">{a.allowedExtensions.length ? `Accepted: ${a.allowedExtensions.map((e) => `.${e}`).join(", ")}` : "PDF, Office documents, images, text, ZIP and media are accepted."}</p>
                      {files.length > 0 && (
                        <ul className="text-xs text-slate-600">
                          {files.map((f) => (
                            <li key={f.name}>
                              {f.name} ({formatBytes(f.size)})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">
                      {a.allowedAttempts ? `Attempt ${d.submission.attempt + 1} of ${a.allowedAttempts + d.submission.extraAttempts}` : `Attempt ${d.submission.attempt + 1}`}
                    </span>
                    <Button type="submit" loading={busy} icon={<Send className="size-4" />}>
                      {d.submission.attempt > 0 ? "Resubmit" : "Submit assignment"}
                    </Button>
                  </div>
                </form>
              ) : (
                d.submitBlockReason && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{permissions.readOnly ? "This course is read-only." : d.submitBlockReason}</p>
              )}
              {d.attempts.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Submission history</h3>
                  <ol className="space-y-3">
                    {[...d.attempts].reverse().map((at) => (
                      <li key={at.attempt} className="rounded-lg border border-slate-200 p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <strong className="text-slate-700">Attempt {at.attempt}</strong> · {formatDateTime(at.submittedAt)} · {SUBMISSION_TYPE_LABEL[at.submissionType]}
                          {at.late && <Badge tone="amber">Late</Badge>}
                        </div>
                        {at.bodyHtml && <RichContent html={at.bodyHtml} className="text-sm" />}
                        {at.url && (
                          <a href={at.url} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-brand-700 underline">
                            {at.url}
                          </a>
                        )}
                        {at.files.map((f) => (
                          <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-brand-700 hover:underline">
                            <Paperclip className="size-3.5" aria-hidden /> {f.name} <span className="text-xs text-slate-500">({formatBytes(f.sizeBytes)})</span>
                          </a>
                        ))}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Comments" />
            <div className="space-y-3 px-5 py-4">
              {d.comments.length === 0 && <p className="text-sm text-slate-500">No comments yet. Feedback from your instructor appears here once released.</p>}
              {d.comments.map((c) => (
                <div key={c.id} className={`rounded-lg px-3 py-2 text-sm ${c.fromGrader ? "bg-brand-50" : "bg-slate-50"}`}>
                  <div className="mb-1 text-xs text-slate-500">
                    <strong className="text-slate-700">{c.authorName ?? "Unknown"}</strong> · {relative(c.createdAt)}
                  </div>
                  <RichContent html={c.body} />
                </div>
              ))}
              {!permissions.readOnly && (
                <form onSubmit={addComment} className="space-y-2">
                  <label htmlFor="new-comment" className="sr-only">
                    Add a comment
                  </label>
                  <textarea id="new-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ask a question or add a note for your instructor" className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <Button type="submit" size="sm" variant="secondary" disabled={!comment.trim()}>
                    Add comment
                  </Button>
                </form>
              )}
            </div>
          </Card>
        </div>
      )}
    </Loadable>
  );
}

// ====================================================================== editor
const typeOptions = ["online_text_entry", "online_url", "online_upload", "on_paper", "none"] as const;

export function AssignmentEditor() {
  const { assignmentId } = useParams();
  const { course, base } = useCourse();
  const navigate = useNavigate();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const existing = useApi<{ assignment: Assignment }>(assignmentId ? `/assignments/${assignmentId}` : null);
  const groups = useApi<{ data: AssignmentGroup[] }>(`/courses/${course.id}/assignment-groups`);
  const loaded = useRef(false);
  const [f, setF] = useState({
    title: "",
    description: "",
    pointsPossible: "100",
    gradingType: "points",
    submissionTypes: ["online_upload"] as string[],
    allowedExtensions: "",
    allowedAttempts: "",
    unlockAt: "",
    dueAt: "",
    lockAt: "",
    published: false,
    postManually: false,
    omitFromFinal: false,
    groupId: "",
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const a = existing.data?.assignment;
    if (a && !loaded.current) {
      loaded.current = true;
      setF({
        title: a.title,
        description: a.description ?? "",
        pointsPossible: String(a.pointsPossible),
        gradingType: a.gradingType,
        submissionTypes: a.submissionTypes,
        allowedExtensions: a.allowedExtensions.join(", "),
        allowedAttempts: a.allowedAttempts ? String(a.allowedAttempts) : "",
        unlockAt: toLocalInput(a.unlockAt),
        dueAt: toLocalInput(a.dueAt),
        lockAt: toLocalInput(a.lockAt),
        published: a.published,
        postManually: a.postManually,
        omitFromFinal: a.omitFromFinal,
        groupId: a.groupId ?? "",
      });
    }
  }, [existing.data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      title: f.title,
      description: f.description,
      pointsPossible: Number(f.pointsPossible || 0),
      gradingType: f.gradingType,
      submissionTypes: f.submissionTypes,
      allowedExtensions: f.allowedExtensions.split(/[\s,]+/).filter(Boolean),
      allowedAttempts: f.allowedAttempts ? Number(f.allowedAttempts) : null,
      unlockAt: fromLocalInput(f.unlockAt),
      dueAt: fromLocalInput(f.dueAt),
      lockAt: fromLocalInput(f.lockAt),
      published: f.published,
      postManually: f.postManually,
      omitFromFinal: f.omitFromFinal,
      groupId: f.groupId || null,
    };
    try {
      const r = assignmentId ? await api.patch<{ assignment: Assignment }>(`/assignments/${assignmentId}`, payload) : await api.post<{ assignment: Assignment }>(`/courses/${course.id}/assignments`, payload);
      await invalidate(`/assignments/${r.assignment.id}`, `/courses/${course.id}`, "/dashboard", "/calendar");
      fb.success("Assignment saved.");
      navigate(`${base}/assignments/${r.assignment.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!assignmentId || !(await fb.confirm({ title: "Delete assignment?", message: "This permanently deletes the assignment and all of its submissions and grades. This cannot be undone.", confirmLabel: "Delete assignment", danger: true }))) return;
    try {
      await api.del(`/assignments/${assignmentId}`);
      await invalidate(`/courses/${course.id}`, "/dashboard");
      navigate(`${base}/assignments`);
    } catch (err) {
      fb.error(err);
    }
  };

  const toggleType = (t: string) => {
    if (t === "on_paper" || t === "none") return set({ submissionTypes: [t] });
    const online = f.submissionTypes.filter((x) => x !== "on_paper" && x !== "none");
    const next = online.includes(t) ? online.filter((x) => x !== t) : [...online, t];
    set({ submissionTypes: next.length ? next : [t] });
  };

  if (assignmentId && existing.isPending) return <Loadable query={existing}>{() => null}</Loadable>;
  const fe = error instanceof ApiError ? error.fieldErrors() : {};
  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader title={assignmentId ? "Edit assignment" : "New assignment"} />
      <Card className="space-y-5 p-6">
        <FormError error={error} />
        <TextField label="Title" required value={f.title} onChange={(e) => set({ title: e.target.value })} error={fe.title} />
        <MarkdownEditor label="Instructions" value={f.description} onChange={(v) => set({ description: v })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Points" type="number" min={0} step="0.5" value={f.pointsPossible} onChange={(e) => set({ pointsPossible: e.target.value })} disabled={f.gradingType === "not_graded"} error={fe.pointsPossible} />
          <SelectField label="Display grade as" value={f.gradingType} onChange={(e) => set({ gradingType: e.target.value })}>
            <option value="points">Points</option>
            <option value="percent">Percentage</option>
            <option value="letter_grade">Letter grade</option>
            <option value="pass_fail">Complete / incomplete</option>
            <option value="not_graded">Not graded</option>
          </SelectField>
          <SelectField label="Assignment group" value={f.groupId} onChange={(e) => set({ groupId: e.target.value })}>
            <option value="">Default group</option>
            {groups.data?.data.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectField>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Submission type</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {typeOptions.map((t) => (
              <Checkbox key={t} label={SUBMISSION_TYPE_LABEL[t]} checked={f.submissionTypes.includes(t)} onChange={() => toggleType(t)} />
            ))}
          </div>
        </fieldset>
        {f.submissionTypes.includes("online_upload") && <TextField label="Allowed file extensions" placeholder="pdf, docx" value={f.allowedExtensions} onChange={(e) => set({ allowedExtensions: e.target.value })} hint="Leave empty to accept any platform-supported file type." error={fe.allowedExtensions} />}
        <TextField label="Allowed attempts" type="number" min={1} max={100} placeholder="Unlimited" value={f.allowedAttempts} onChange={(e) => set({ allowedAttempts: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Available from" type="datetime-local" value={f.unlockAt} onChange={(e) => set({ unlockAt: e.target.value })} />
          <TextField label="Due" type="datetime-local" value={f.dueAt} onChange={(e) => set({ dueAt: e.target.value })} />
          <TextField label="Available until" type="datetime-local" value={f.lockAt} onChange={(e) => set({ lockAt: e.target.value })} hint="No submissions after this." />
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Checkbox label="Published" checked={f.published} onChange={(e) => set({ published: e.target.checked })} />
          <Checkbox label="Release grades manually" hint="Grades stay hidden until you release them." checked={f.postManually} onChange={(e) => set({ postManually: e.target.checked })} />
          <Checkbox label="Don't count toward final grade" checked={f.omitFromFinal} onChange={(e) => set({ omitFromFinal: e.target.checked })} />
        </div>
      </Card>
      <div className="flex flex-wrap justify-between gap-2">
        {assignmentId ? (
          <Button variant="ghost" className="text-red-700" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save assignment
          </Button>
        </div>
      </div>
    </form>
  );
}
