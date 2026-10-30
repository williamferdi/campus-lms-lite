import { Download, FileText, Home, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { MarkdownEditor } from "../../components/ui/markdown-editor";
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, FormError, IconButton, LinkButton, Loadable, PageHeader, RichContent, Table, TextField } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatBytes, formatDateTime } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { CourseFile, Page, PageSummary } from "../../lib/types";
import { ModuleNav } from "./ModuleNav";

export function PagesList() {
  const { course, base, permissions } = useCourse();
  const q = useApi<{ data: PageSummary[] }>(`/courses/${course.id}/pages`);
  return (
    <>
      <PageHeader title="Pages" actions={permissions.canEditContent && <LinkButton to={`${base}/pages/new`} icon={<Plus className="size-4" />}>New page</LinkButton>} />
      <Card>
        <Loadable query={q}>
          {(d) =>
            d.data.length === 0 ? (
              <EmptyState icon={<FileText className="size-6" />} title="No pages yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Last edited</th>
                    {permissions.isStaff && <th>Status</th>}
                  </tr>
                </thead>
                <tbody>
                  {d.data.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`${base}/pages/${p.id}`} className="font-medium hover:text-brand-700">
                          {p.title}
                        </Link>
                        {p.isFrontPage && (
                          <Badge tone="brand" className="ml-2">
                            <Home className="size-3" aria-hidden /> Front page
                          </Badge>
                        )}
                      </td>
                      <td className="text-slate-500">{formatDateTime(p.updatedAt)}</td>
                      {permissions.isStaff && <td>{p.published ? <Badge tone="green">Published</Badge> : <Badge tone="amber">Draft</Badge>}</td>}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          }
        </Loadable>
      </Card>
    </>
  );
}

export function PageView() {
  const { pageId } = useParams();
  const { base, permissions, course } = useCourse();
  const invalidate = useInvalidate();
  const q = useApi<{ page: Page }>(`/pages/${pageId}`);
  useEffect(() => {
    // Viewing may complete a module requirement.
    if (q.isSuccess && permissions.role === "student") void invalidate(`/courses/${course.id}/modules`, `/courses/${course.id}/module-nav`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.isSuccess]);
  return (
    <Loadable query={q}>
      {({ page }) => (
        <article>
          <PageHeader
            title={page.title}
            description={`Last edited ${formatDateTime(page.updatedAt)}${page.updatedBy ? ` by ${page.updatedBy}` : ""}`}
            actions={
              permissions.canEditContent && (
                <>
                  {!page.published && <Badge tone="amber">Draft</Badge>}
                  <LinkButton to={`${base}/pages/${page.id}/edit`} variant="secondary" icon={<Pencil className="size-4" />}>
                    Edit
                  </LinkButton>
                </>
              )
            }
          />
          <Card className="p-6">{page.bodyHtml ? <RichContent html={page.bodyHtml} /> : <p className="text-sm text-slate-500">This page is empty.</p>}</Card>
          <ModuleNav refId={page.id} />
        </article>
      )}
    </Loadable>
  );
}

export function PageEditor() {
  const { pageId } = useParams();
  const { course, base } = useCourse();
  const navigate = useNavigate();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const existing = useApi<{ page: Page }>(pageId ? `/pages/${pageId}` : null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [published, setPublished] = useState(false);
  const [isFrontPage, setIsFrontPage] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (existing.data && !loaded.current) {
      loaded.current = true;
      setTitle(existing.data.page.title);
      setBody(existing.data.page.body ?? "");
      setPublished(existing.data.page.published);
      setIsFrontPage(existing.data.page.isFrontPage);
    }
  }, [existing.data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { title, body, published, isFrontPage };
      const r = pageId ? await api.patch<{ page: Page }>(`/pages/${pageId}`, payload) : await api.post<{ page: Page }>(`/courses/${course.id}/pages`, payload);
      await invalidate(`/pages/${r.page.id}`, `/courses/${course.id}/pages`, `/courses/${course.id}/front-page`, `/courses/${course.id}/modules`);
      fb.success("Page saved.");
      navigate(`${base}/pages/${r.page.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pageId || !(await fb.confirm({ title: "Delete page?", message: "This permanently deletes the page and removes it from modules.", danger: true, confirmLabel: "Delete page" }))) return;
    try {
      await api.del(`/pages/${pageId}`);
      await invalidate(`/courses/${course.id}/pages`, `/courses/${course.id}/modules`);
      navigate(`${base}/pages`);
    } catch (err) {
      fb.error(err);
    }
  };

  if (pageId && existing.isPending) return <Loadable query={existing}>{() => null}</Loadable>;
  const fieldErrors = error instanceof ApiError ? error.fieldErrors() : {};
  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader title={pageId ? "Edit page" : "New page"} />
      <Card className="space-y-5 p-6">
        {!Object.keys(fieldErrors).length && <FormError error={error} />}
        <TextField label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} error={fieldErrors.title} />
        <MarkdownEditor label="Content" value={body} onChange={setBody} rows={16} />
        <div className="flex flex-wrap gap-6">
          <Checkbox label="Published" hint="Visible to students." checked={published || isFrontPage} disabled={isFrontPage} onChange={(e) => setPublished(e.target.checked)} />
          <Checkbox label="Use as course front page" hint="Shown on the course home." checked={isFrontPage} onChange={(e) => setIsFrontPage(e.target.checked)} />
        </div>
      </Card>
      <div className="flex flex-wrap justify-between gap-2">
        {pageId ? (
          <Button variant="ghost" className="text-red-700" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
            Delete page
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save page
          </Button>
        </div>
      </div>
    </form>
  );
}

export function FilesPage() {
  const { course, permissions } = useCourse();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const q = useApi<{ data: CourseFile[] }>(`/courses/${course.id}/files`);
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState<CourseFile | null>(null);
  const refresh = () => invalidate(`/courses/${course.id}/files`, `/courses/${course.id}/modules`);
  const editable = permissions.canEditContent;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      await api.upload(`/courses/${course.id}/files`, files);
      await refresh();
      fb.success(`Uploaded ${files.length} file(s). They are unpublished until you publish them.`);
    } catch (err) {
      fb.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Files"
        description={editable ? "Files are private: only enrolled users can download published files." : undefined}
        actions={
          editable && (
            <label className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-800 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600 ${uploading ? "opacity-60" : ""}`}>
              <Upload className="size-4" aria-hidden /> {uploading ? "Uploading…" : "Upload files"}
              <input type="file" multiple className="sr-only" disabled={uploading} onChange={(e) => void upload(e.target.files).finally(() => (e.target.value = ""))} />
            </label>
          )
        }
      />
      <Card>
        <Loadable query={q}>
          {(d) =>
            d.data.length === 0 ? (
              <EmptyState title="No files" description={editable ? "Upload documents, slides, images or media (PDF, Office, images, MP4, MP3, ZIP)." : undefined} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Uploaded</th>
                    {editable && <th>Status</th>}
                    {editable && <th className="sr-only">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {d.data.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-medium hover:text-brand-700">
                          <Download className="size-4 text-slate-400" aria-hidden />
                          {f.name}
                        </a>
                      </td>
                      <td className="text-slate-500">{formatBytes(f.sizeBytes)}</td>
                      <td className="text-slate-500">{formatDateTime(f.createdAt)}</td>
                      {editable && (
                        <td>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await api.patch(`/files/${f.id}`, { published: !f.published });
                                await refresh();
                              } catch (err) {
                                fb.error(err);
                              }
                            }}
                            aria-label={f.published ? `Unpublish ${f.name}` : `Publish ${f.name}`}
                          >
                            {f.published ? <Badge tone="green">Published</Badge> : <Badge tone="amber">Unpublished</Badge>}
                          </button>
                        </td>
                      )}
                      {editable && (
                        <td className="text-right whitespace-nowrap">
                          <IconButton label={`Rename ${f.name}`} onClick={() => setRenaming(f)}>
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton
                            label={`Delete ${f.name}`}
                            onClick={async () => {
                              if (!(await fb.confirm({ title: `Delete ${f.name}?`, message: "The file is permanently deleted and removed from modules.", confirmLabel: "Delete", danger: true }))) return;
                              try {
                                await api.del(`/files/${f.id}`);
                                await refresh();
                              } catch (err) {
                                fb.error(err);
                              }
                            }}
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          }
        </Loadable>
      </Card>
      {renaming && <RenameDialog file={renaming} onClose={() => setRenaming(null)} onDone={refresh} />}
    </>
  );
}

function RenameDialog({ file, onClose, onDone }: { file: CourseFile; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [name, setName] = useState(file.name);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/files/${file.id}`, { name });
      await onDone();
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Rename file" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="rename-file">Rename</Button></>}>
      <form id="rename-file" onSubmit={submit} className="space-y-3">
        <FormError error={error} />
        <TextField label="File name" required value={name} onChange={(e) => setName(e.target.value)} />
      </form>
    </Dialog>
  );
}
