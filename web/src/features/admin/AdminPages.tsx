import clsx from "clsx";
import { Copy, KeyRound, Pencil, Plus, Trash2, Upload, UserCheck, UserX } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router";
import { PageContainer } from "../../components/layout/AppShell";
import { statusTone } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, FormError, IconButton, Loadable, PageHeader, Pagination, SearchInput, Select, SelectField, Table, TextAreaField, TextField } from "../../components/ui";
import { api, ApiError, qs } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { formatDate, formatDateTime, fromLocalInput, relative, roleLabel, toLocalInput } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { AuditEvent, Course, Department, Paged, Term, User } from "../../lib/types";
import { CreateCourseDialog } from "../courses/CoursesPage";

export function AdminLayout() {
  const tabs = [
    { to: "/admin", label: "Users", end: true },
    { to: "/admin/courses", label: "Courses" },
    { to: "/admin/catalog", label: "Terms & departments" },
    { to: "/admin/audit", label: "Audit log" },
  ];
  return (
    <PageContainer>
      <PageHeader title="Administration" description="Manage people, courses and academic structure." />
      <nav aria-label="Administration" className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => clsx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", isActive ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-slate-900")}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </PageContainer>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const fb = useFeedback();
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        <input readOnly value={value} aria-label={label} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button
          variant="secondary"
          icon={<Copy className="size-4" />}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              fb.success("Copied to clipboard.");
            } catch {
              fb.info("Select the text and copy it manually.");
            }
          }}
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

const statusBadge = (s: User["status"]) => <Badge tone={s === "active" ? "green" : s === "pending" ? "amber" : "gray"}>{s}</Badge>;

// ====================================================================== users
export function AdminUsers() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const q = useApi<Paged<User>>(`/users${qs({ q: search, role, status, page, perPage: 20 })}`, { placeholderData: (p) => p });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput aria-label="Search users" placeholder="Search name or email" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="max-w-xs" />
        <Select aria-label="Filter by role" value={role} onChange={(e) => (setRole(e.target.value), setPage(1))}>
          <option value="">All roles</option>
          <option value="admin">Administrators</option>
          <option value="instructor">Instructors</option>
          <option value="student">Students</option>
        </Select>
        <Select aria-label="Filter by status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="pending">Pending activation</option>
          <option value="deactivated">Deactivated</option>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>Import CSV</Button>
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New user</Button>
        </div>
      </div>
      <Card>
        <Loadable query={q}>
          {(d) =>
            d.data.length === 0 ? (
              <EmptyState title="No users found" />
            ) : (
              <>
                <Table>
                  <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead>
                  <tbody>
                    {d.data.map((u) => (
                      <tr key={u.id}>
                        <td><Link to={`/admin/users/${u.id}`} className="font-medium hover:text-brand-700">{u.sortableName}</Link></td>
                        <td className="text-slate-600">{u.email}</td>
                        <td>{roleLabel(u.role)}</td>
                        <td>{statusBadge(u.status)}</td>
                        <td className="text-slate-500">{u.lastLoginAt ? relative(u.lastLoginAt) : "Never"}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Pagination page={d.meta.page} pageCount={d.meta.pageCount} total={d.meta.total} onPage={setPage} />
              </>
            )
          }
        </Loadable>
      </Card>
      {creating && <CreateUserDialog onClose={() => setCreating(false)} />}
      {importing && <ImportUsersDialog onClose={() => setImporting(false)} />}
    </>
  );
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const invalidate = useInvalidate();
  const [f, setF] = useState({ name: "", email: "", role: "student", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ user: User; activationUrl: string | null; emailSent: boolean } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<typeof result>("/users", { ...f, password: f.password || undefined });
      setResult(r);
      await invalidate("/users", "/dashboard");
    } catch (err) {
      setError(err);
    }
  };
  const fe = error instanceof ApiError ? error.fieldErrors() : {};
  return (
    <Dialog open onClose={onClose} title="New user" footer={result ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="new-user">Create user</Button></>}>
      {result ? (
        <div className="space-y-4 text-sm">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">Created {result.user.name} ({result.user.email}).</p>
          {result.activationUrl && (
            <>
              <p className="text-slate-600">{result.emailSent ? "An activation email was sent. You can also share this link:" : "Email is not configured, so no email was sent. Share this one-time activation link with the user securely (valid 7 days):"}</p>
              <CopyField label="Activation link" value={result.activationUrl} />
            </>
          )}
        </div>
      ) : (
        <form id="new-user" onSubmit={submit} className="space-y-4">
          {!Object.keys(fe).length && <FormError error={error} />}
          <TextField label="Full name" required value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} error={fe.name} />
          <TextField label="Email" type="email" required value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} error={fe.email} />
          <SelectField label="Platform role" value={f.role} onChange={(e) => setF((x) => ({ ...x, role: e.target.value }))} hint="Course roles (teacher, TA, student) are set per course on its People page.">
            <option value="student">Student</option>
            <option value="instructor">Instructor</option>
            <option value="admin">Administrator</option>
          </SelectField>
          <TextField label="Initial password (optional)" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF((x) => ({ ...x, password: e.target.value }))} hint="Leave empty to generate an activation link so the user chooses their own password." error={fe.password} />
        </form>
      )}
    </Dialog>
  );
}

function ImportUsersDialog({ onClose }: { onClose: () => void }) {
  const invalidate = useInvalidate();
  const [csv, setCsv] = useState("name,email,role\n");
  const [results, setResults] = useState<{ row: number; email: string; status: string; message?: string; activationUrl?: string | null }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ results: typeof results }>("/users/import", { csv });
      setResults(r.results);
      await invalidate("/users", "/dashboard");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const linksCsv = results?.filter((r) => r.activationUrl).map((r) => `${r.email},${r.activationUrl}`).join("\n");
  return (
    <Dialog open onClose={onClose} size="lg" title="Import users from CSV" footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{!results && <Button onClick={() => void run()} loading={busy}>Import</Button>}</>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Columns: <code>name</code>, <code>email</code>, <code>role</code> (student, instructor or admin). New users get activation links; existing emails are skipped.</p>
        {!results && (
          <>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-brand-700">
              <Upload className="size-4" aria-hidden /> Load a .csv file
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => e.target.files?.[0] && setCsv(await e.target.files[0].text())} />
            </label>
            <TextAreaField label="CSV content" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} />
          </>
        )}
        <FormError error={error} />
        {results && (
          <>
            <p className="text-sm font-medium">
              {results.filter((r) => r.status === "created").length} created · {results.filter((r) => r.status === "skipped").length} skipped · {results.filter((r) => r.status === "error").length} errors
            </p>
            <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm">
              {results.map((r) => (
                <li key={r.row} className="flex items-center gap-2 px-3 py-1.5">
                  <Badge tone={r.status === "created" ? "green" : r.status === "skipped" ? "gray" : "red"}>{r.status}</Badge>
                  Row {r.row}: {r.email} {r.message && <span className="text-slate-500">— {r.message}</span>}
                </li>
              ))}
            </ul>
            {linksCsv && <TextAreaField label="Activation links (email,link) — share securely" rows={4} readOnly value={linksCsv} />}
          </>
        )}
      </div>
    </Dialog>
  );
}

export function AdminUserDetail() {
  const { userId } = useParams();
  const me = useUser();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const url = `/users/${userId}`;
  const q = useApi<{ user: User; enrollments: { id: string; role: string; status: string; courseId: string; courseName: string; courseCode: string }[] }>(url);
  const [f, setF] = useState({ name: "", email: "", role: "student" });
  const [error, setError] = useState<unknown>(null);
  const [link, setLink] = useState<{ label: string; url: string } | null>(null);
  useEffect(() => {
    if (q.data) setF({ name: q.data.user.name, email: q.data.user.email, role: q.data.user.role });
  }, [q.data]);
  const refresh = () => invalidate(url, "/users", "/dashboard");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.patch(url, f);
      await refresh();
      fb.success("User updated.");
    } catch (err) {
      setError(err);
    }
  };
  const setStatus = async (status: "active" | "deactivated") => {
    if (status === "deactivated" && !(await fb.confirm({ title: "Deactivate this account?", message: "They are signed out immediately and cannot sign in. Their enrollments, submissions and grades are kept.", confirmLabel: "Deactivate", danger: true }))) return;
    try {
      await api.patch(url, { status });
      await refresh();
      fb.success(status === "active" ? "Account reactivated." : "Account deactivated.");
    } catch (err) {
      fb.error(err);
    }
  };
  const issue = async (kind: "activation-link" | "reset-link") => {
    try {
      const r = await api.post<{ url: string; expiresInHours: number }>(`${url}/${kind}`);
      setLink({ label: kind === "activation-link" ? `Activation link (valid ${r.expiresInHours / 24} days)` : `Password reset link (valid ${r.expiresInHours} hour)`, url: r.url });
    } catch (err) {
      fb.error(err);
    }
  };
  return (
    <Loadable query={q}>
      {({ user, enrollments }) => (
        <div className="space-y-6">
          <Link to="/admin" className="text-sm text-brand-700 hover:underline">← All users</Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">{user.name}</h2>
            {statusBadge(user.status)}
            <span className="text-sm text-slate-500">Created {formatDate(user.createdAt)} · Last sign-in {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "never"}</span>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Account" />
              <form onSubmit={save} className="space-y-4 px-5 py-4">
                <FormError error={error} />
                <TextField label="Full name" required value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />
                <TextField label="Email" type="email" required value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} />
                <SelectField label="Platform role" value={f.role} disabled={user.id === me.id} onChange={(e) => setF((x) => ({ ...x, role: e.target.value }))}>
                  <option value="student">Student</option>
                  <option value="instructor">Instructor</option>
                  <option value="admin">Administrator</option>
                </SelectField>
                <div className="flex justify-end"><Button type="submit">Save</Button></div>
              </form>
            </Card>
            <Card>
              <CardHeader title="Access" />
              <div className="space-y-4 px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  {user.status === "pending" && <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => void issue("activation-link")}>New activation link</Button>}
                  {user.status === "active" && <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => void issue("reset-link")}>Password reset link</Button>}
                  {user.status === "active" && user.id !== me.id && <Button variant="danger" icon={<UserX className="size-4" />} onClick={() => void setStatus("deactivated")}>Deactivate</Button>}
                  {user.status === "deactivated" && <Button icon={<UserCheck className="size-4" />} onClick={() => void setStatus("active")}>Reactivate</Button>}
                </div>
                {link && <CopyField label={link.label} value={link.url} />}
                <p className="text-xs text-slate-500">Links are single-use. Issuing a new link invalidates the previous one. All of these actions are recorded in the audit log.</p>
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title="Enrollments" />
            {enrollments.length === 0 ? (
              <EmptyState title="Not enrolled in any course" />
            ) : (
              <Table>
                <thead><tr><th>Course</th><th>Role</th><th>Status</th></tr></thead>
                <tbody>
                  {enrollments.map((e) => (
                    <tr key={e.id}>
                      <td><Link to={`/courses/${e.courseId}/people`} className="font-medium hover:text-brand-700">{e.courseCode}</Link> <span className="text-slate-500">{e.courseName}</span></td>
                      <td>{roleLabel(e.role)}</td>
                      <td><Badge tone={e.status === "active" ? "green" : "gray"}>{e.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </Loadable>
  );
}

// ====================================================================== courses
export function AdminCourses() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [termId, setTermId] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const terms = useApi<{ data: Term[] }>("/terms");
  const q = useApi<Paged<Course>>(`/courses${qs({ scope: "all", q: search, status, termId, page, perPage: 20 })}`, { placeholderData: (p) => p });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput aria-label="Search courses" placeholder="Search code or name" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="max-w-xs" />
        <Select aria-label="Filter by status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">Any status</option>
          <option value="published">Published</option>
          <option value="unpublished">Unpublished</option>
          <option value="archived">Archived</option>
        </Select>
        <Select aria-label="Filter by term" value={termId} onChange={(e) => (setTermId(e.target.value), setPage(1))}>
          <option value="">All terms</option>
          {terms.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Button className="ml-auto" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New course</Button>
      </div>
      <Card>
        <Loadable query={q}>
          {(d) =>
            d.data.length === 0 ? (
              <EmptyState title="No courses found" />
            ) : (
              <>
                <Table>
                  <thead><tr><th>Course</th><th>Term</th><th>Department</th><th>Teachers</th><th className="text-right">Students</th><th>Status</th></tr></thead>
                  <tbody>
                    {d.data.map((c) => (
                      <tr key={c.id}>
                        <td><Link to={`/courses/${c.id}`} className="font-medium hover:text-brand-700">{c.code}</Link> <span className="text-slate-500">{c.name}</span></td>
                        <td>{c.termName ?? "—"}</td>
                        <td>{c.departmentName ?? "—"}</td>
                        <td className="text-slate-600">{c.teachers.join(", ") || <span className="text-amber-700">None</span>}</td>
                        <td className="text-right">{c.studentCount}</td>
                        <td><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Pagination page={d.meta.page} pageCount={d.meta.pageCount} total={d.meta.total} onPage={setPage} />
              </>
            )
          }
        </Loadable>
      </Card>
      <CreateCourseDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

// ====================================================================== catalog
export function AdminCatalog() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <TermsCard />
      <DepartmentsCard />
    </div>
  );
}

function CatalogRow({ children, onEdit, onDelete, label }: { children: ReactNode; onEdit: () => void; onDelete: () => void; label: string }) {
  return (
    <li className="flex items-center gap-2 px-5 py-2.5 text-sm">
      <div className="min-w-0 flex-1">{children}</div>
      <IconButton label={`Edit ${label}`} onClick={onEdit}><Pencil className="size-4" /></IconButton>
      <IconButton label={`Delete ${label}`} onClick={onDelete}><Trash2 className="size-4" /></IconButton>
    </li>
  );
}

function TermsCard() {
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const q = useApi<{ data: Term[] }>("/terms");
  const [editing, setEditing] = useState<Term | "new" | null>(null);
  return (
    <Card>
      <CardHeader title="Academic terms" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Term</Button>} />
      <Loadable query={q}>
        {(d) => (
          <ul className="divide-y divide-slate-100">
            {d.data.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">No terms yet.</li>}
            {d.data.map((t) => (
              <CatalogRow
                key={t.id}
                label={t.name}
                onEdit={() => setEditing(t)}
                onDelete={async () => {
                  if (!(await fb.confirm({ title: `Delete ${t.name}?`, message: "Only terms with no courses can be deleted.", confirmLabel: "Delete", danger: true }))) return;
                  try {
                    await api.del(`/terms/${t.id}`);
                    await invalidate("/terms");
                  } catch (err) {
                    fb.error(err);
                  }
                }}
              >
                <span className="font-medium">{t.name}</span> <span className="text-slate-500">{t.startAt || t.endAt ? `${formatDate(t.startAt)} – ${formatDate(t.endAt)}` : ""}</span>
              </CatalogRow>
            ))}
          </ul>
        )}
      </Loadable>
      {editing && <TermDialog term={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TermDialog({ term, onClose }: { term: Term | null; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState(term?.name ?? "");
  const [startAt, setStartAt] = useState(toLocalInput(term?.startAt));
  const [endAt, setEndAt] = useState(toLocalInput(term?.endAt));
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name, startAt: fromLocalInput(startAt), endAt: fromLocalInput(endAt) };
    try {
      if (term) await api.patch(`/terms/${term.id}`, body);
      else await api.post("/terms", body);
      await invalidate("/terms", "/courses");
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Dialog open onClose={onClose} title={term ? "Edit term" : "New term"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="term-form">Save</Button></>}>
      <form id="term-form" onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <TextField label="Name" required placeholder="e.g. Fall 2026" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Starts" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          <TextField label="Ends" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </div>
      </form>
    </Dialog>
  );
}

function DepartmentsCard() {
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const q = useApi<{ data: Department[] }>("/departments");
  const [editing, setEditing] = useState<Department | "new" | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (editing && editing !== "new") {
      setName(editing.name);
      setCode(editing.code);
    } else {
      setName("");
      setCode("");
    }
    setError(null);
  }, [editing]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (editing && editing !== "new") await api.patch(`/departments/${editing.id}`, { name, code });
      else await api.post("/departments", { name, code });
      await invalidate("/departments", "/courses");
      setEditing(null);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Card>
      <CardHeader title="Departments & programs" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Department</Button>} />
      <Loadable query={q}>
        {(d) => (
          <ul className="divide-y divide-slate-100">
            {d.data.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">No departments yet.</li>}
            {d.data.map((x) => (
              <CatalogRow
                key={x.id}
                label={x.name}
                onEdit={() => setEditing(x)}
                onDelete={async () => {
                  if (!(await fb.confirm({ title: `Delete ${x.name}?`, message: "Only departments with no courses can be deleted.", confirmLabel: "Delete", danger: true }))) return;
                  try {
                    await api.del(`/departments/${x.id}`);
                    await invalidate("/departments");
                  } catch (err) {
                    fb.error(err);
                  }
                }}
              >
                <span className="font-medium">{x.name}</span> <span className="text-slate-500">{x.code}</span>
              </CatalogRow>
            ))}
          </ul>
        )}
      </Loadable>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== "new" ? "Edit department" : "New department"} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="dept-form">Save</Button></>}>
        <form id="dept-form" onSubmit={submit} className="space-y-4">
          <FormError error={error} />
          <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Code" required value={code} onChange={(e) => setCode(e.target.value)} />
        </form>
      </Dialog>
    </Card>
  );
}

// ====================================================================== audit
export function AdminAudit() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useApi<Paged<AuditEvent>>(`/admin/audit${qs({ q: search, page, perPage: 30 })}`, { placeholderData: (p) => p });
  return (
    <>
      <div className="mb-4">
        <SearchInput aria-label="Search audit log" placeholder="Search by action (grade, enrollment, user…) or person" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="max-w-md" />
      </div>
      <Card>
        <Loadable query={q}>
          {(d) =>
            d.data.length === 0 ? (
              <EmptyState title="No matching events" />
            ) : (
              <>
                <Table>
                  <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Course</th><th>Details</th></tr></thead>
                  <tbody>
                    {d.data.map((e) => (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap text-slate-500">{formatDateTime(e.createdAt)}</td>
                        <td>{e.actorName ?? "System"}</td>
                        <td><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{e.action}</code></td>
                        <td>{e.courseCode ?? "—"}</td>
                        <td className="max-w-xs truncate text-xs text-slate-500" title={JSON.stringify(e.metadata)}>{Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Pagination page={d.meta.page} pageCount={d.meta.pageCount} total={d.meta.total} onPage={setPage} />
              </>
            )
          }
        </Loadable>
      </Card>
    </>
  );
}
