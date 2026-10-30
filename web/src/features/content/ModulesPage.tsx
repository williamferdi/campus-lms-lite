import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileQuestion,
  FileText,
  Heading,
  Layers,
  Link2,
  Lock,
  MessagesSquare,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, FormError, IconButton, Loadable, ProgressBar, SelectField, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatDateTime, formatPoints, fromLocalInput, toLocalInput } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import { usePref } from "../../lib/ui-prefs";
import type { ItemType, Module, ModuleItem, ModulesResponse, Requirement } from "../../lib/types";
import { itemHref } from "./ModuleNav";

const ITEM_ICON: Record<ItemType, ReactNode> = {
  page: <FileText className="size-4" aria-hidden />,
  assignment: <NotebookPen className="size-4" aria-hidden />,
  quiz: <FileQuestion className="size-4" aria-hidden />,
  discussion: <MessagesSquare className="size-4" aria-hidden />,
  file: <File className="size-4" aria-hidden />,
  link: <Link2 className="size-4" aria-hidden />,
  subheader: <Heading className="size-4" aria-hidden />,
};

const REQUIREMENT_LABEL: Record<Requirement, string> = {
  none: "No requirement",
  must_view: "View",
  must_mark_done: "Mark as done",
  must_submit: "Submit",
  min_score: "Score at least",
  must_contribute: "Contribute",
};

const ALLOWED: Record<ItemType, Requirement[]> = {
  page: ["none", "must_view", "must_mark_done"],
  assignment: ["none", "must_view", "must_mark_done", "must_submit", "min_score"],
  quiz: ["none", "must_view", "must_submit", "min_score"],
  discussion: ["none", "must_view", "must_contribute"],
  file: ["none", "must_view"],
  link: ["none", "must_view", "must_mark_done"],
  subheader: ["none"],
};

const requirementText = (i: ModuleItem) => (i.requirement === "min_score" ? `Score at least ${formatPoints(i.minScore)}` : REQUIREMENT_LABEL[i.requirement]);

const stateBadge = (m: Module) =>
  m.state === "completed" ? <Badge tone="green">Completed</Badge> : m.state === "started" ? <Badge tone="blue">In progress</Badge> : m.state === "locked" ? <Badge tone="gray"><Lock className="size-3" aria-hidden /> Locked</Badge> : null;

export function ModulesPage() {
  const { course, permissions } = useCourse();
  const q = useApi<ModulesResponse>(`/courses/${course.id}/modules`);
  const [editing, setEditing] = useState<Module | "new" | null>(null);
  const [addingTo, setAddingTo] = useState<Module | null>(null);
  const editable = permissions.canEditContent;
  // Collapsed module ids, remembered per course on this device.
  const [collapsedRaw, setCollapsedRaw] = usePref<string>(`modulesCollapsed.${course.id}`, "[]");
  const collapsed = new Set<string>(JSON.parse(collapsedRaw) as string[]);
  const setCollapsed = (ids: string[]) => setCollapsedRaw(JSON.stringify(ids));
  const toggle = (id: string) => setCollapsed(collapsed.has(id) ? [...collapsed].filter((x) => x !== id) : [...collapsed, id]);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    // Deep link from the dashboard's quick actions: ?new=module opens the New module dialog.
    if (editable && params.get("new") === "module") {
      setEditing("new");
      setParams({}, { replace: true });
    }
  }, [editable, params, setParams]);

  return (
    <Loadable query={q} label="Loading modules…">
      {(d) => (
        <div className="space-y-4">
          {d.progress && (
            <Card className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-48 flex-1">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium">Course progress</span>
                  <span>{d.progress.percent === null ? "No requirements" : `${d.progress.percent}%`}</span>
                </div>
                <ProgressBar value={d.progress.percent} label="Course progress" />
              </div>
              <span className="text-sm text-slate-600">
                {d.progress.completed} of {d.progress.required} requirements complete
              </span>
            </Card>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Modules</h2>
            <div className="flex flex-wrap gap-2">
              {d.modules.length > 0 && (
                collapsed.size >= d.modules.length ? (
                  <Button variant="secondary" icon={<ChevronsUpDown className="size-4" />} onClick={() => setCollapsed([])}>
                    Expand all
                  </Button>
                ) : (
                  <Button variant="secondary" icon={<ChevronsDownUp className="size-4" />} onClick={() => setCollapsed(d.modules.map((m) => m.id))}>
                    Collapse all
                  </Button>
                )
              )}
              {editable && (
                <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
                  Module
                </Button>
              )}
            </div>
          </div>
          {d.modules.length === 0 ? (
            <Card>
              <EmptyState icon={<Layers className="size-6" />} title="No modules yet" description={editable ? "Modules organize content into an ordered path. Create one to begin." : "Your instructor hasn't published any modules yet."} />
            </Card>
          ) : (
            d.modules.map((m, idx) => (
              <ModuleCard key={m.id} module={m} index={idx} modules={d.modules} editable={editable} collapsed={collapsed.has(m.id)} onToggle={() => toggle(m.id)} onEdit={() => setEditing(m)} onAddItem={() => setAddingTo(m)} />
            ))
          )}
          {editable && editing && <ModuleDialog module={editing === "new" ? null : editing} modules={d.modules} onClose={() => setEditing(null)} />}
          {editable && addingTo && <AddItemDialog module={addingTo} onClose={() => setAddingTo(null)} />}
        </div>
      )}
    </Loadable>
  );
}

function ModuleCard({ module: m, index, modules, editable, collapsed, onToggle, onEdit, onAddItem }: { module: Module; index: number; modules: Module[]; editable: boolean; collapsed: boolean; onToggle: () => void; onEdit: () => void; onAddItem: () => void }) {
  const { course, base } = useCourse();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const refresh = () => invalidate(`/courses/${course.id}/modules`, `/courses/${course.id}/module-nav`);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (err) {
      fb.error(err);
    }
  };
  const moveModule = (dir: -1 | 1) => {
    const ids = modules.map((x) => x.id);
    const j = index + dir;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    return run(() => api.post(`/courses/${course.id}/modules/reorder`, { moduleIds: ids }));
  };
  const moveItem = (i: number, dir: -1 | 1) => {
    const ids = m.items.map((x) => x.id);
    const j = i + dir;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    return run(() => api.post(`/modules/${m.id}/items/reorder`, { itemIds: ids }));
  };
  const prereqNames = m.prerequisiteIds.map((id) => modules.find((x) => x.id === id)?.title).filter(Boolean);

  return (
    <Card as="section" className={clsx("overflow-hidden", m.state === "locked" && "bg-slate-50")}>
      <div className={clsx("flex flex-wrap items-center gap-2 bg-slate-100 py-2 pl-2 pr-3", !collapsed && "border-b border-line")}>
        <h2 className="mr-auto min-w-0 text-base font-semibold">
          <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-controls={`module-${m.id}`} className="flex min-h-9 items-center gap-1.5 rounded-control px-1.5 text-left hover:bg-slate-200">
            {collapsed ? <ChevronRight className="size-5 shrink-0" aria-hidden /> : <ChevronDown className="size-5 shrink-0" aria-hidden />}
            {m.title}
          </button>
        </h2>
        {stateBadge(m)}
        {m.requiredCount !== undefined && m.requiredCount > 0 && (
          <span className="text-xs text-slate-600">
            {m.completedCount}/{m.requiredCount} done
          </span>
        )}
        {editable && (
          <div className="flex items-center gap-1">
            <Badge tone={m.published ? "green" : "amber"}>{m.published ? "Published" : "Draft"}</Badge>
            <IconButton label={m.published ? "Unpublish module" : "Publish module"} onClick={() => void run(() => api.patch(`/modules/${m.id}`, { published: !m.published }))}>
              {m.published ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </IconButton>
            <IconButton label="Move module up" disabled={index === 0} onClick={() => void moveModule(-1)}>
              <ArrowUp className="size-4" />
            </IconButton>
            <IconButton label="Move module down" disabled={index === modules.length - 1} onClick={() => void moveModule(1)}>
              <ArrowDown className="size-4" />
            </IconButton>
            <IconButton label="Edit module" onClick={onEdit}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton
              label="Delete module"
              onClick={async () => {
                if (await fb.confirm({ title: `Delete "${m.title}"?`, message: "The module and its item links are removed. The pages, assignments and other content stay in the course.", danger: true, confirmLabel: "Delete" }))
                  await run(() => api.del(`/modules/${m.id}`));
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        )}
      </div>
      <div id={`module-${m.id}`} hidden={collapsed}>
      {(m.lockedReason || prereqNames.length > 0 || m.unlockAt || m.requireSequential) && (
        <p className="border-b border-line bg-slate-50 px-5 py-2 text-xs text-slate-600">
          {m.lockedReason
            ? m.lockedReason.replace(/Unlocks (\S+)/, (_, d: string) => `Unlocks ${formatDateTime(d)}`)
            : [prereqNames.length ? `Prerequisites: ${prereqNames.join(", ")}` : null, m.unlockAt ? `Unlocks ${formatDateTime(m.unlockAt)}` : null, m.requireSequential ? "Items must be completed in order" : null].filter(Boolean).join(" · ")}
        </p>
      )}
      <ul className="divide-y divide-line">
        {m.items.length === 0 && <li className="px-5 py-4 text-sm text-slate-600">No items in this module yet.</li>}
        {m.items.map((item, i) => {
          if (item.type === "subheader")
            return (
              <li key={item.id} className="flex items-center gap-2 bg-slate-50/60 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <span className="flex-1">{item.title}</span>
                {editable && <ItemActions item={item} index={i} count={m.items.length} run={run} moveItem={moveItem} />}
              </li>
            );
          const href = itemHref(base, item);
          const locked = item.locked;
          const titleNode = locked ? (
            <span className="text-slate-600">{item.title}</span>
          ) : href.external ? (
            <a href={href.to} target="_blank" rel="noreferrer" className="font-medium hover:text-brand-700" onClick={() => setTimeout(() => void refresh(), 800)}>
              {item.title} <ExternalLink className="inline size-3" aria-label="(opens in new tab)" />
            </a>
          ) : (
            <Link to={href.to} className="font-medium text-brand-700 hover:underline">
              {item.title}
            </Link>
          );
          return (
            <li key={item.id} className="flex items-center gap-3 px-5 py-3" style={{ paddingLeft: `${1.25 + item.indent * 1.25}rem` }}>
              <span className={clsx("flex size-8 shrink-0 items-center justify-center", locked ? "text-slate-400" : "text-slate-600")}>{locked ? <Lock className="size-4" role="img" aria-label="Locked" /> : ITEM_ICON[item.type]}</span>
              <div className="min-w-0 flex-1 text-sm">
                {titleNode}
                <div className="flex flex-wrap gap-x-3 text-xs text-slate-600">
                  {item.dueAt && <span>Due {formatDateTime(item.dueAt)}</span>}
                  {item.pointsPossible !== null && item.type !== "page" && <span>{formatPoints(item.pointsPossible)} pts</span>}
                  {item.requirement !== "none" && <span>Requirement: {requirementText(item)}</span>}
                  {editable && !item.contentPublished && <span className="text-amber-700">Content is unpublished</span>}
                </div>
              </div>
              {item.completed !== undefined && item.requirement !== "none" && (item.completed ? <CheckCircle2 className="size-5 shrink-0 text-emerald-700" role="img" aria-label="Completed" /> : <Circle className="size-5 shrink-0 text-slate-400" role="img" aria-label="Not completed" />)}
              {editable && <ItemActions item={item} index={i} count={m.items.length} run={run} moveItem={moveItem} />}
            </li>
          );
        })}
      </ul>
      {editable && (
        <div className="border-t border-line px-5 py-2">
          <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={onAddItem}>
            Add item
          </Button>
        </div>
      )}
      </div>
    </Card>
  );
}

function ItemActions({ item, index, count, run, moveItem }: { item: ModuleItem; index: number; count: number; run: (fn: () => Promise<unknown>) => Promise<void>; moveItem: (i: number, d: -1 | 1) => Promise<void> }) {
  const fb = useFeedback();
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex shrink-0 items-center gap-0.5 normal-case">
      <IconButton label={item.published ? `Unpublish ${item.title}` : `Publish ${item.title}`} onClick={() => void run(() => api.patch(`/module-items/${item.id}`, { published: !item.published }))}>
        {item.published ? <Eye className="size-4 text-emerald-600" /> : <EyeOff className="size-4" />}
      </IconButton>
      <IconButton label="Move item up" disabled={index === 0} onClick={() => void moveItem(index, -1)}>
        <ArrowUp className="size-4" />
      </IconButton>
      <IconButton label="Move item down" disabled={index === count - 1} onClick={() => void moveItem(index, 1)}>
        <ArrowDown className="size-4" />
      </IconButton>
      <IconButton label={`Edit ${item.title}`} onClick={() => setEditing(true)}>
        <Pencil className="size-4" />
      </IconButton>
      <IconButton
        label={`Remove ${item.title} from module`}
        onClick={async () => {
          if (await fb.confirm({ title: "Remove from module?", message: "Only the module link is removed; the content itself is kept.", confirmLabel: "Remove", danger: true })) await run(() => api.del(`/module-items/${item.id}`));
        }}
      >
        <Trash2 className="size-4" />
      </IconButton>
      {editing && <EditItemDialog item={item} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditItemDialog({ item, onClose }: { item: ModuleItem; onClose: () => void }) {
  const { course } = useCourse();
  const invalidate = useInvalidate();
  const [title, setTitle] = useState(item.title);
  const [url, setUrl] = useState(item.url ?? "");
  const [requirement, setRequirement] = useState<Requirement>(item.requirement);
  const [minScore, setMinScore] = useState(item.minScore?.toString() ?? "");
  const [indent, setIndent] = useState(item.indent);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/module-items/${item.id}`, {
        ...(item.type === "link" || item.type === "subheader" ? { title } : {}),
        ...(item.type === "link" ? { url } : {}),
        requirement,
        minScore: requirement === "min_score" ? Number(minScore) : null,
        indent,
      });
      await invalidate(`/courses/${course.id}/modules`);
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Edit module item" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="edit-item">Save</Button></>}>
      <form id="edit-item" onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        {(item.type === "link" || item.type === "subheader") && <TextField label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} />}
        {item.type === "link" && <TextField label="URL" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />}
        <RequirementFields type={item.type} requirement={requirement} setRequirement={setRequirement} minScore={minScore} setMinScore={setMinScore} />
        <SelectField label="Indent" value={indent} onChange={(e) => setIndent(Number(e.target.value))}>
          {[0, 1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "None" : `Level ${n}`}
            </option>
          ))}
        </SelectField>
      </form>
    </Dialog>
  );
}

function RequirementFields({ type, requirement, setRequirement, minScore, setMinScore }: { type: ItemType; requirement: Requirement; setRequirement: (r: Requirement) => void; minScore: string; setMinScore: (s: string) => void }) {
  if (type === "subheader") return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField label="Completion requirement" value={requirement} onChange={(e) => setRequirement(e.target.value as Requirement)}>
        {ALLOWED[type].map((r) => (
          <option key={r} value={r}>
            {REQUIREMENT_LABEL[r]}
          </option>
        ))}
      </SelectField>
      {requirement === "min_score" && <TextField label="Minimum score (points)" type="number" min={0} step="0.5" required value={minScore} onChange={(e) => setMinScore(e.target.value)} />}
    </div>
  );
}

function ModuleDialog({ module: m, modules, onClose }: { module: Module | null; modules: Module[]; onClose: () => void }) {
  const { course } = useCourse();
  const invalidate = useInvalidate();
  const fb = useFeedback();
  const [title, setTitle] = useState(m?.title ?? "");
  const [unlockAt, setUnlockAt] = useState(toLocalInput(m?.unlockAt));
  const [requireSequential, setRequireSequential] = useState(m?.requireSequential ?? false);
  const [published, setPublished] = useState(m?.published ?? false);
  const [prereqs, setPrereqs] = useState<string[]>(m?.prerequisiteIds ?? []);
  const [error, setError] = useState<unknown>(null);
  const earlier = m ? modules.filter((x) => x.position < m.position) : modules;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { title, unlockAt: fromLocalInput(unlockAt), requireSequential, published, prerequisiteIds: prereqs };
    try {
      if (m) await api.patch(`/modules/${m.id}`, body);
      else await api.post(`/courses/${course.id}/modules`, body);
      await invalidate(`/courses/${course.id}/modules`);
      fb.success(m ? "Module updated." : "Module created.");
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Dialog open onClose={onClose} title={m ? "Edit module" : "New module"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="module-form">{m ? "Save" : "Create module"}</Button></>}>
      <form id="module-form" onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <TextField label="Module name" required value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField label="Lock until" type="datetime-local" value={unlockAt} onChange={(e) => setUnlockAt(e.target.value)} hint="Optional. Students can't open items before this time." />
        <Checkbox label="Students must complete items in order" checked={requireSequential} onChange={(e) => setRequireSequential(e.target.checked)} />
        <Checkbox label="Published" hint="Draft modules and their items are hidden from students." checked={published} onChange={(e) => setPublished(e.target.checked)} />
        {earlier.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Prerequisite modules</legend>
            <p className="text-xs text-slate-600">Students must complete these first. Only earlier modules can be prerequisites.</p>
            {earlier.map((x) => (
              <Checkbox key={x.id} label={x.title} checked={prereqs.includes(x.id)} onChange={(e) => setPrereqs((p) => (e.target.checked ? [...p, x.id] : p.filter((id) => id !== x.id)))} />
            ))}
          </fieldset>
        )}
      </form>
    </Dialog>
  );
}

function AddItemDialog({ module: m, onClose }: { module: Module; onClose: () => void }) {
  const { course } = useCourse();
  const invalidate = useInvalidate();
  const [type, setType] = useState<ItemType>("page");
  const [refId, setRefId] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [requirement, setRequirement] = useState<Requirement>("none");
  const [minScore, setMinScore] = useState("");
  const [published, setPublished] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const sources: Partial<Record<ItemType, string>> = {
    page: `/courses/${course.id}/pages`,
    assignment: `/courses/${course.id}/assignments`,
    quiz: `/courses/${course.id}/quizzes`,
    discussion: `/courses/${course.id}/discussions`,
    file: `/courses/${course.id}/files`,
  };
  const list = useApi<{ data: { id: string; title?: string; name?: string; quizId?: string | null; discussionId?: string | null }[] }>(sources[type] ?? null);
  // Quiz and graded-discussion assignments are added as the quiz/discussion itself.
  const options = (list.data?.data ?? []).filter((o) => type !== "assignment" || (!o.quizId && !o.discussionId));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/modules/${m.id}/items`, {
        type,
        refId: refId || null,
        title,
        url,
        requirement,
        minScore: requirement === "min_score" ? Number(minScore) : null,
        published,
      });
      await invalidate(`/courses/${course.id}/modules`);
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  const fieldErrors = error instanceof ApiError ? error.fieldErrors() : {};
  return (
    <Dialog open onClose={onClose} title={`Add to "${m.title}"`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="add-item">Add item</Button></>}>
      <form id="add-item" onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <SelectField
          label="Item type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as ItemType);
            setRefId("");
            setRequirement("none");
          }}
        >
          <option value="page">Page</option>
          <option value="assignment">Assignment</option>
          <option value="quiz">Quiz</option>
          <option value="discussion">Discussion</option>
          <option value="file">File</option>
          <option value="link">External link or video</option>
          <option value="subheader">Text sub-heading</option>
        </SelectField>
        {sources[type] && (
          <SelectField label={`Choose ${type}`} required value={refId} onChange={(e) => setRefId(e.target.value)} error={fieldErrors.refId} hint={options.length === 0 ? `No ${type}s yet — create one first from the ${type === "file" ? "Files" : `${type[0]!.toUpperCase()}${type.slice(1)}s`} page.` : undefined}>
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title ?? o.name}
              </option>
            ))}
          </SelectField>
        )}
        {(type === "link" || type === "subheader") && <TextField label={type === "link" ? "Link title" : "Sub-heading text"} required value={title} onChange={(e) => setTitle(e.target.value)} />}
        {type === "link" && <TextField label="URL" type="url" required placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} hint="YouTube and Vimeo links are embedded as video players." />}
        <RequirementFields type={type} requirement={requirement} setRequirement={setRequirement} minScore={minScore} setMinScore={setMinScore} />
        <Checkbox label="Publish this item" checked={published} onChange={(e) => setPublished(e.target.checked)} />
      </form>
    </Dialog>
  );
}
