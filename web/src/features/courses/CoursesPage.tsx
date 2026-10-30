import { BookOpen, LayoutGrid, List, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { PageContainer } from "../../components/layout/AppShell";
import { statusTone } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { Badge, Button, Card, Dialog, EmptyState, FormError, Loadable, PageHeader, Pagination, SearchInput, Select, SelectField, Table, TextAreaField, TextField } from "../../components/ui";
import { api, ApiError, qs } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { fromLocalInput, roleLabel } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import { courseColor, usePref } from "../../lib/ui-prefs";
import type { Course, Department, Paged, Term } from "../../lib/types";

export function CourseFormFields({
  value,
  onChange,
  errors,
  terms,
  departments,
}: {
  value: { code: string; name: string; description: string; termId: string; departmentId: string; startAt: string; endAt: string };
  onChange: (v: Partial<typeof value>) => void;
  errors: Record<string, string>;
  terms: Term[];
  departments: Department[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label="Course code" required value={value.code} onChange={(e) => onChange({ code: e.target.value })} error={errors.code} placeholder="e.g. BIO101" />
      <TextField label="Course name" required value={value.name} onChange={(e) => onChange({ name: e.target.value })} error={errors.name} />
      <SelectField label="Academic term" value={value.termId} onChange={(e) => onChange({ termId: e.target.value })}>
        <option value="">No term</option>
        {terms.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Department / program" value={value.departmentId} onChange={(e) => onChange({ departmentId: e.target.value })}>
        <option value="">None</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>
      <TextField label="Starts" type="datetime-local" value={value.startAt} onChange={(e) => onChange({ startAt: e.target.value })} error={errors.startAt} />
      <TextField label="Ends" type="datetime-local" value={value.endAt} onChange={(e) => onChange({ endAt: e.target.value })} error={errors.endAt} />
      <TextAreaField className="sm:col-span-2" label="Description" value={value.description} onChange={(e) => onChange({ description: e.target.value })} rows={3} />
    </div>
  );
}

export const emptyCourseForm = { code: "", name: "", description: "", termId: "", departmentId: "", startAt: "", endAt: "" };
export const courseFormPayload = (v: typeof emptyCourseForm) => ({
  code: v.code,
  name: v.name,
  description: v.description,
  termId: v.termId || null,
  departmentId: v.departmentId || null,
  startAt: fromLocalInput(v.startAt),
  endAt: fromLocalInput(v.endAt),
});

export function CreateCourseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const terms = useApi<{ data: Term[] }>(open ? "/terms" : null);
  const departments = useApi<{ data: Department[] }>(open ? "/departments" : null);
  const [form, setForm] = useState(emptyCourseForm);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const fb = useFeedback();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ course: Course }>("/courses", courseFormPayload(form));
      await invalidate("/courses", "/dashboard");
      fb.success(`Created ${r.course.code}. It stays unpublished until you publish it.`);
      onClose();
      setForm(emptyCourseForm);
      navigate(`/courses/${r.course.id}/settings`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const fieldErrors = error instanceof ApiError ? error.fieldErrors() : {};
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create course"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-course" loading={busy}>
            Create course
          </Button>
        </>
      }
    >
      <form id="create-course" onSubmit={submit} className="space-y-4">
        {!Object.keys(fieldErrors).length && <FormError error={error} />}
        <CourseFormFields value={form} onChange={(v) => setForm((f) => ({ ...f, ...v }))} errors={fieldErrors} terms={terms.data?.data ?? []} departments={departments.data?.data ?? []} />
      </form>
    </Dialog>
  );
}

export function CoursesPage() {
  const user = useUser();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [termId, setTermId] = useState("");
  const [scope, setScope] = useState<"mine" | "all">(user.role === "admin" ? "all" : "mine");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [view, setView] = usePref<"cards" | "list">("coursesView", "list");
  const terms = useApi<{ data: Term[] }>("/terms");
  const q = useApi<Paged<Course>>(`/courses${qs({ q: search, status, termId, scope, page, perPage: 12 })}`, { placeholderData: (prev) => prev });
  const canCreate = user.role !== "student";

  return (
    <PageContainer>
      <PageHeader
        title={user.role === "admin" ? "All courses" : "My courses"}
        description={user.role === "admin" ? "All courses in your institution." : "Courses you teach or take."}
        actions={
          canCreate && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New course
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput aria-label="Search courses" placeholder="Search by name or code" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="max-w-xs" />
        {user.role !== "student" && (
          <Select aria-label="Filter by status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">Any status</option>
            <option value="published">Published</option>
            <option value="unpublished">Unpublished</option>
            <option value="archived">Archived</option>
          </Select>
        )}
        <Select aria-label="Filter by term" value={termId} onChange={(e) => (setTermId(e.target.value), setPage(1))}>
          <option value="">All terms</option>
          {terms.data?.data.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        {user.role === "admin" && (
          <Select aria-label="Scope" value={scope} onChange={(e) => (setScope(e.target.value as "mine" | "all"), setPage(1))}>
            <option value="all">All courses</option>
            <option value="mine">My enrollments</option>
          </Select>
        )}
        <div role="radiogroup" aria-label="Layout" className="ml-auto inline-flex rounded-control border border-slate-300 bg-white p-0.5">
          {([["list", List, "List view"], ["cards", LayoutGrid, "Card view"]] as const).map(([v, Icon, label]) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} aria-label={label} title={label} onClick={() => setView(v)} className={view === v ? "rounded bg-brand-700 p-1.5 text-white" : "rounded p-1.5 text-slate-600 hover:bg-slate-100"}>
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>
      </div>
      <Loadable query={q} label="Loading courses…">
        {(data) =>
          data.data.length === 0 ? (
            <Card>
              <EmptyState icon={<BookOpen className="size-6" />} title="No courses found" description={search || status || termId ? "Try clearing the filters." : canCreate ? "Create your first course to get started." : "You're not enrolled in any courses yet."} />
            </Card>
          ) : (
            <>
              {view === "list" ? (
                <Card>
                  <Table>
                    <thead>
                      <tr>
                        <th>Course</th>
                        <th>Term</th>
                        <th>Teacher</th>
                        <th>Enrolled as</th>
                        {user.role !== "student" && <th>Status</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <span className="flex items-center gap-2.5">
                              <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: courseColor(c.id) }} aria-hidden />
                              <Link to={`/courses/${c.id}`} className="font-medium text-brand-700 hover:underline">
                                {c.name}
                              </Link>
                            </span>
                            <span className="ml-5.5 block text-xs text-slate-500">{c.code}</span>
                          </td>
                          <td>{c.termName ?? "—"}</td>
                          <td>{c.teachers.join(", ") || "—"}</td>
                          <td>{c.role ? roleLabel(c.role) : "—"}</td>
                          {user.role !== "student" && (
                            <td>
                              <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.data.map((c) => (
                  <Link key={c.id} to={`/courses/${c.id}`} className="group flex flex-col overflow-hidden rounded-panel border border-line bg-white transition-shadow hover:shadow-md">
                    <div className="h-24 bg-cover bg-center" style={{ backgroundColor: courseColor(c.id), backgroundImage: c.imageUrl ? `url(${c.imageUrl})` : undefined }} aria-hidden />
                    <div className="flex flex-1 flex-col gap-1.5 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-brand-700">{c.code}</span>
                        {c.role !== "student" && <Badge tone={statusTone(c.status)}>{c.status}</Badge>}
                      </div>
                      <span className="font-semibold text-brand-700 group-hover:underline">{c.name}</span>
                      <span className="text-xs text-slate-500">
                        {[c.termName, c.departmentName].filter(Boolean).join(" · ") || "No term"}
                      </span>
                      <span className="mt-auto pt-2 text-xs text-slate-500">
                        {c.teachers.length ? c.teachers.join(", ") : "No teacher assigned"} · {c.studentCount} students
                        {c.role && ` · You: ${roleLabel(c.role)}`}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
              )}
              <Pagination page={data.meta.page} pageCount={data.meta.pageCount} total={data.meta.total} onPage={setPage} />
            </>
          )
        }
      </Loadable>
      {canCreate && <CreateCourseDialog open={creating} onClose={() => setCreating(false)} />}
    </PageContainer>
  );
}
