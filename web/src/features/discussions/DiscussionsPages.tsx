import clsx from "clsx";
import { Lock, Megaphone, MessagesSquare, Pencil, Pin, Plus, Reply, Trash2, Unlock } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { MarkdownEditor } from "../../components/ui/markdown-editor";
import { Badge, Button, Card, Checkbox, EmptyState, FormError, LinkButton, Loadable, PageHeader, RichContent, SelectField, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatDateTime, fromLocalInput, plural, relative, toLocalInput } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { AssignmentGroup, Entry, Topic } from "../../lib/types";
import { ModuleNav } from "../content/ModuleNav";

type Kind = "discussion" | "announcement";
const path = (kind: Kind) => (kind === "announcement" ? "announcements" : "discussions");

export function TopicsList({ kind }: { kind: Kind }) {
  const { course, base, permissions } = useCourse();
  const q = useApi<{ data: Topic[] }>(`/courses/${course.id}/discussions?type=${kind}`);
  const title = kind === "announcement" ? "Announcements" : "Discussions";
  return (
    <>
      <PageHeader title={title} actions={permissions.canEditContent && <LinkButton to={`${base}/${path(kind)}/new`} icon={<Plus className="size-4" />}>{kind === "announcement" ? "Announcement" : "Discussion"}</LinkButton>} />
      <Card>
        <Loadable query={q}>
          {(d) =>
            d.data.length === 0 ? (
              <EmptyState icon={kind === "announcement" ? <Megaphone className="size-6" /> : <MessagesSquare className="size-6" />} title={`No ${title.toLowerCase()} yet`} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {d.data.map((t) => (
                  <li key={t.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {t.pinned && <Pin className="size-4 text-brand-700" aria-label="Pinned" />}
                      <Link to={`${base}/${path(kind)}/${t.id}`} className="font-medium hover:text-brand-700">
                        {t.title}
                      </Link>
                      {!t.published && <Badge tone="amber">Draft</Badge>}
                      {t.published && !t.postedAt && t.delayedPostAt && <Badge tone="blue">Scheduled {formatDateTime(t.delayedPostAt)}</Badge>}
                      {t.locked && <Badge><Lock className="size-3" /> Closed</Badge>}
                      {t.assignmentId && <Badge tone="violet">Graded</Badge>}
                    </div>
                    <RichContent html={t.bodyHtml} className="mt-1 line-clamp-2 text-sm text-slate-600" />
                    <div className="mt-1 text-xs text-slate-500">
                      {t.authorName} · {t.postedAt ? relative(t.postedAt) : "not posted"} · {plural(t.replyCount ?? 0, "reply", "replies")}
                      {t.lastReplyAt && ` · last reply ${relative(t.lastReplyAt)}`}
                    </div>
                  </li>
                ))}
              </ul>
            )
          }
        </Loadable>
      </Card>
    </>
  );
}

export function TopicEditor({ kind }: { kind: Kind }) {
  const { topicId } = useParams();
  const { course, base } = useCourse();
  const navigate = useNavigate();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const existing = useApi<{ topic: Topic & { bodyMd?: string } }>(topicId ? `/discussions/${topicId}` : null);
  const groups = useApi<{ data: AssignmentGroup[] }>(kind === "discussion" && !topicId ? `/courses/${course.id}/assignment-groups` : null);
  const loaded = useRef(false);
  const [f, setF] = useState({ title: "", body: "", published: true, delayedPostAt: "", locked: false, pinned: false, threaded: true, requireInitialPost: false, graded: false, points: "10", dueAt: "", groupId: "" });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = existing.data?.topic;
    if (t && !loaded.current) {
      loaded.current = true;
      setF((x) => ({ ...x, title: t.title, body: t.bodyMd ?? "", published: t.published, delayedPostAt: toLocalInput(t.delayedPostAt), locked: t.locked, pinned: t.pinned, threaded: t.threaded, requireInitialPost: t.requireInitialPost }));
    }
  }, [existing.data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const common = { title: f.title, body: f.body, published: f.published, delayedPostAt: fromLocalInput(f.delayedPostAt), locked: f.locked, pinned: f.pinned, threaded: f.threaded, requireInitialPost: f.requireInitialPost };
    try {
      const r = topicId
        ? await api.patch<{ topic: Topic }>(`/discussions/${topicId}`, common)
        : await api.post<{ topic: Topic }>(`/courses/${course.id}/discussions`, {
            ...common,
            isAnnouncement: kind === "announcement",
            graded: kind === "discussion" && f.graded ? { pointsPossible: Number(f.points), dueAt: fromLocalInput(f.dueAt), groupId: f.groupId || null } : null,
          });
      await invalidate(`/courses/${course.id}`, `/discussions/${r.topic.id}`, "/dashboard", "/notifications");
      fb.success(kind === "announcement" ? (r.topic.postedAt ? "Announcement posted. Students were notified." : "Announcement saved.") : "Discussion saved.");
      navigate(`${base}/${path(kind)}/${r.topic.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (topicId && existing.isPending) return <Loadable query={existing}>{() => null}</Loadable>;
  const fe = error instanceof ApiError ? error.fieldErrors() : {};
  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader title={`${topicId ? "Edit" : "New"} ${kind}`} />
      <Card className="space-y-5 p-6">
        <FormError error={error} />
        <TextField label="Title" required value={f.title} onChange={(e) => set({ title: e.target.value })} error={fe.title} />
        <MarkdownEditor label="Message" value={f.body} onChange={(v) => set({ body: v })} rows={8} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={kind === "announcement" ? "Post at (optional)" : "Make visible at (optional)"} type="datetime-local" value={f.delayedPostAt} onChange={(e) => set({ delayedPostAt: e.target.value })} hint="Leave empty to post immediately when published." />
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Checkbox label="Published" checked={f.published} onChange={(e) => set({ published: e.target.checked })} />
          <Checkbox label={kind === "announcement" ? "Don't allow replies" : "Closed for comments"} checked={f.locked} onChange={(e) => set({ locked: e.target.checked })} />
          <Checkbox label="Pin to top" checked={f.pinned} onChange={(e) => set({ pinned: e.target.checked })} />
          {kind === "discussion" && (
            <>
              <Checkbox label="Allow threaded replies" hint="Otherwise replies are one level deep." checked={f.threaded} onChange={(e) => set({ threaded: e.target.checked })} />
              <Checkbox label="Students must post before seeing replies" checked={f.requireInitialPost} onChange={(e) => set({ requireInitialPost: e.target.checked })} />
            </>
          )}
        </div>
        {kind === "discussion" && !topicId && (
          <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
            <Checkbox label="Graded discussion" hint="Creates a gradebook column; a student's first post counts as their submission." checked={f.graded} onChange={(e) => set({ graded: e.target.checked })} />
            {f.graded && (
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField label="Points" type="number" min={0} value={f.points} onChange={(e) => set({ points: e.target.value })} />
                <TextField label="Due" type="datetime-local" value={f.dueAt} onChange={(e) => set({ dueAt: e.target.value })} />
                <SelectField label="Assignment group" value={f.groupId} onChange={(e) => set({ groupId: e.target.value })}>
                  <option value="">Default</option>
                  {groups.data?.data.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </SelectField>
              </div>
            )}
          </fieldset>
        )}
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
        <Button type="submit" loading={busy}>{kind === "announcement" && !topicId ? "Post announcement" : "Save"}</Button>
      </div>
    </form>
  );
}

interface TopicResponse {
  topic: Topic & { bodyMd?: string };
  entries: Entry[];
  mustPostFirst: boolean;
  canReply: boolean;
  canModerate: boolean;
}

export function TopicView({ kind }: { kind: Kind }) {
  const { topicId } = useParams();
  const { course, base, permissions } = useCourse();
  const navigate = useNavigate();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const url = `/discussions/${topicId}`;
  const q = useApi<TopicResponse>(url);
  const refresh = () => invalidate(url, `/courses/${course.id}`);
  useEffect(() => {
    if (q.isSuccess && permissions.role === "student") void invalidate(`/courses/${course.id}/modules`, `/courses/${course.id}/module-nav`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.isSuccess]);

  const tree = useMemo(() => {
    const byParent = new Map<string | null, Entry[]>();
    for (const e of q.data?.entries ?? []) byParent.set(e.parentId, [...(byParent.get(e.parentId) ?? []), e]);
    return byParent;
  }, [q.data?.entries]);

  const moderate = async (patch: Record<string, unknown>, msg: string) => {
    try {
      await api.patch(url, patch);
      await refresh();
      fb.success(msg);
    } catch (err) {
      fb.error(err);
    }
  };

  return (
    <Loadable query={q}>
      {(d) => (
        <article className="space-y-5">
          <PageHeader
            eyebrow={<Link to={`${base}/${path(kind)}`} className="hover:underline">← {kind === "announcement" ? "Announcements" : "Discussions"}</Link>}
            title={d.topic.title}
            description={`${d.topic.authorName ?? "Unknown"} · ${d.topic.postedAt ? formatDateTime(d.topic.postedAt) : d.topic.delayedPostAt ? `scheduled for ${formatDateTime(d.topic.delayedPostAt)}` : "not posted"}`}
            actions={
              d.canModerate && (
                <>
                  <Button size="sm" variant="secondary" icon={d.topic.locked ? <Unlock className="size-4" /> : <Lock className="size-4" />} onClick={() => void moderate({ locked: !d.topic.locked }, d.topic.locked ? "Reopened for comments." : "Closed for comments.")}>
                    {d.topic.locked ? "Reopen" : "Close"}
                  </Button>
                  <Button size="sm" variant="secondary" icon={<Pin className="size-4" />} onClick={() => void moderate({ pinned: !d.topic.pinned }, d.topic.pinned ? "Unpinned." : "Pinned.")}>
                    {d.topic.pinned ? "Unpin" : "Pin"}
                  </Button>
                  <LinkButton size="sm" variant="secondary" to={`${base}/${path(kind)}/${d.topic.id}/edit`} icon={<Pencil className="size-4" />}>Edit</LinkButton>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-700"
                    icon={<Trash2 className="size-4" />}
                    onClick={async () => {
                      if (!(await fb.confirm({ title: "Delete this topic?", message: "All replies are deleted too." + (d.topic.assignmentId ? " Its gradebook column and grades are deleted." : ""), confirmLabel: "Delete", danger: true }))) return;
                      try {
                        await api.del(url);
                        await invalidate(`/courses/${course.id}`, "/dashboard");
                        navigate(`${base}/${path(kind)}`);
                      } catch (err) {
                        fb.error(err);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </>
              )
            }
          />
          <div className="flex flex-wrap gap-2">
            {!d.topic.published && <Badge tone="amber">Draft</Badge>}
            {d.topic.locked && <Badge><Lock className="size-3" /> Closed for comments</Badge>}
            {d.topic.assignmentId && <Link to={`${base}/assignments/${d.topic.assignmentId}`}><Badge tone="violet">Graded discussion</Badge></Link>}
          </div>
          <Card className="p-6">{d.topic.bodyHtml ? <RichContent html={d.topic.bodyHtml} /> : <p className="text-sm text-slate-500">No message.</p>}</Card>
          {d.canReply && <ReplyForm topicId={d.topic.id} parentId={null} onDone={refresh} label={kind === "announcement" ? "Reply" : "Post your response"} />}
          {d.mustPostFirst && <p className="rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900">Post your own response first to see what classmates wrote.</p>}
          <section aria-label="Replies" className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-600">{plural(d.entries.filter((e) => !e.deleted).length, "reply", "replies")}</h2>
            {(tree.get(null) ?? []).map((e) => (
              <EntryNode key={e.id} entry={e} tree={tree} depth={0} topic={d.topic} canReply={d.canReply && !d.mustPostFirst} onChange={refresh} />
            ))}
          </section>
          {kind === "discussion" && <ModuleNav refId={d.topic.id} />}
        </article>
      )}
    </Loadable>
  );
}

function EntryNode({ entry, tree, depth, topic, canReply, onChange }: { entry: Entry; tree: Map<string | null, Entry[]>; depth: number; topic: Topic; canReply: boolean; onChange: () => Promise<unknown> }) {
  const fb = useFeedback();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const children = tree.get(entry.id) ?? [];
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/discussion-entries/${entry.id}`, { body: text });
      setEditing(false);
      await onChange();
    } catch (err) {
      fb.error(err);
    }
  };
  return (
    <div className={clsx(depth > 0 && "border-l-2 border-slate-200 pl-4 sm:pl-6")}>
      <div className={clsx("rounded-xl border bg-white p-4", entry.deleted ? "border-dashed border-slate-200" : "border-slate-200 shadow-sm")}>
        {entry.deleted ? (
          <p className="text-sm italic text-slate-500">This post was removed.</p>
        ) : (
          <>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <strong className="text-sm text-slate-800">{entry.authorName}</strong>
              <span>{relative(entry.createdAt)}</span>
              {entry.editedAt && <span>(edited)</span>}
            </div>
            {editing ? (
              <form onSubmit={saveEdit} className="space-y-2">
                <textarea aria-label="Edit post" rows={3} value={text} onChange={(e) => setText(e.target.value)} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <Button type="submit" size="sm">Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </form>
            ) : (
              entry.bodyHtml && <RichContent html={entry.bodyHtml} className="text-sm" />
            )}
            <div className="mt-2 flex gap-1">
              {canReply && (topic.threaded || depth === 0) && (
                <Button size="sm" variant="ghost" icon={<Reply className="size-3.5" />} onClick={() => setReplying((r) => !r)}>Reply</Button>
              )}
              {entry.canEdit && !editing && (
                <>
                  <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => { setText(entry.bodyHtml?.replace(/<br\s*\/?>/g, "\n").replace(/<\/p><p>/g, "\n\n").replace(/<[^>]+>/g, "") ?? ""); setEditing(true); }}>Edit</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="size-3.5" />}
                    onClick={async () => {
                      if (!(await fb.confirm({ title: "Remove this post?", message: "The post is replaced with a 'removed' notice. Replies to it are kept.", confirmLabel: "Remove", danger: true }))) return;
                      try {
                        await api.del(`/discussion-entries/${entry.id}`);
                        await onChange();
                      } catch (err) {
                        fb.error(err);
                      }
                    }}
                  >
                    Remove
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {replying && (
        <div className="mt-2 pl-4">
          <ReplyForm topicId={topic.id} parentId={entry.id} onDone={async () => { setReplying(false); await onChange(); }} label="Reply" compact />
        </div>
      )}
      {children.length > 0 && (
        <div className="mt-2 space-y-2">
          {children.map((c) => (
            <EntryNode key={c.id} entry={c} tree={tree} depth={depth + 1} topic={topic} canReply={canReply} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReplyForm({ topicId, parentId, onDone, label, compact }: { topicId: string; parentId: string | null; onDone: () => Promise<unknown>; label: string; compact?: boolean }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/discussions/${topicId}/entries`, { body, parentId });
      setBody("");
      await onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className={clsx("space-y-2", !compact && "rounded-xl border border-slate-200 bg-white p-4 shadow-sm")}>
      <FormError error={error} />
      <label className="sr-only" htmlFor={`reply-${parentId ?? "root"}`}>{label}</label>
      <textarea id={`reply-${parentId ?? "root"}`} rows={compact ? 2 : 4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={`${label}…`} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none" />
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={busy} disabled={!body.trim()}>{label}</Button>
      </div>
    </form>
  );
}
