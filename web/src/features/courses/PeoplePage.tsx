import { Trash2, Upload, UserPlus, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { Badge, Button, Card, Dialog, EmptyState, FormError, IconButton, Loadable, SearchInput, Select, SelectField, Table, TextAreaField, TextField } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { relative, roleLabel } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { Enrollment, Section } from "../../lib/types";

export function PeoplePage() {
  const { course, permissions } = useCourse();
  const me = useUser();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const q = useApi<{ data: Enrollment[] }>(`/courses/${course.id}/enrollments${qs({ q: search, role })}`, { placeholderData: (p) => p });
  const sections = useApi<{ data: Section[] }>(permissions.isStaff ? `/courses/${course.id}/sections` : null);
  const canManage = permissions.canManage && !permissions.readOnly;
  const refresh = () => invalidate(`/courses/${course.id}/enrollments`, `/courses/${course.id}`);

  const update = async (e: Enrollment, patch: Record<string, unknown>) => {
    try {
      await api.patch(`/enrollments/${e.id}`, patch);
      await refresh();
      fb.success(`Updated ${e.name}.`);
    } catch (err) {
      fb.error(err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput aria-label="Search people" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          <option value="teacher">Teachers</option>
          <option value="ta">Teaching assistants</option>
          <option value="student">Students</option>
        </Select>
        {canManage && (
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
              Import CSV
            </Button>
            <Button icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
              Add people
            </Button>
          </div>
        )}
      </div>
      <Card>
        <Loadable query={q}>
          {(d) =>
            d.data.length === 0 ? (
              <EmptyState icon={<Users className="size-6" />} title="No people found" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Name</th>
                    {permissions.isStaff && <th>Email</th>}
                    <th>Role</th>
                    <th>Section</th>
                    {permissions.isStaff && <th>Status</th>}
                    {permissions.isStaff && <th>Last activity</th>}
                    {canManage && <th className="sr-only">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {d.data.map((e) => {
                    const self = e.userId === me.id && me.role !== "admin";
                    return (
                      <tr key={e.id}>
                        <td className="font-medium">{e.name}</td>
                        {permissions.isStaff && <td className="text-slate-600">{e.email}</td>}
                        <td>
                          {canManage && !self ? (
                            <Select aria-label={`Role for ${e.name}`} value={e.role} onChange={(ev) => void update(e, { role: ev.target.value })} className="h-8 py-0 text-xs">
                              <option value="student">Student</option>
                              <option value="ta">Teaching assistant</option>
                              <option value="teacher">Teacher</option>
                            </Select>
                          ) : (
                            roleLabel(e.role)
                          )}
                        </td>
                        <td>
                          {canManage && sections.data ? (
                            <Select aria-label={`Section for ${e.name}`} value={e.sectionId ?? ""} onChange={(ev) => void update(e, { sectionId: ev.target.value || null })} className="h-8 py-0 text-xs">
                              {sections.data.data.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <span className="text-slate-600">{e.sectionName ?? "—"}</span>
                          )}
                        </td>
                        {permissions.isStaff && (
                          <td>
                            {canManage && !self ? (
                              <Select aria-label={`Enrollment status for ${e.name}`} value={e.status} onChange={(ev) => void update(e, { status: ev.target.value })} className="h-8 py-0 text-xs">
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                                <option value="completed">Completed</option>
                              </Select>
                            ) : (
                              <Badge tone={e.status === "active" ? "green" : "gray"}>{e.status}</Badge>
                            )}
                          </td>
                        )}
                        {permissions.isStaff && <td className="text-slate-500">{e.lastActivityAt ? relative(e.lastActivityAt) : "Never"}</td>}
                        {canManage && (
                          <td className="text-right">
                            {!self && (
                              <IconButton
                                label={`Remove ${e.name}`}
                                onClick={async () => {
                                  if (!(await fb.confirm({ title: `Remove ${e.name}?`, message: "They lose access to the course. Their submissions and grades are kept and return if they are re-enrolled.", confirmLabel: "Remove", danger: true }))) return;
                                  try {
                                    await api.del(`/enrollments/${e.id}`);
                                    await refresh();
                                  } catch (err) {
                                    fb.error(err);
                                  }
                                }}
                              >
                                <Trash2 className="size-4" />
                              </IconButton>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )
          }
        </Loadable>
      </Card>
      {canManage && <AddPeopleDialog open={adding} onClose={() => setAdding(false)} sections={sections.data?.data ?? []} onDone={refresh} />}
      {canManage && <ImportDialog open={importing} onClose={() => setImporting(false)} onDone={refresh} />}
    </div>
  );
}

function AddPeopleDialog({ open, onClose, sections, onDone }: { open: boolean; onClose: () => void; sections: Section[]; onDone: () => Promise<unknown> }) {
  const { course } = useCourse();
  const fb = useFeedback();
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("student");
  const [sectionId, setSectionId] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const candidates = useApi<{ data: { id: string; name: string; email: string; role: string }[] }>(open && query.trim().length >= 2 ? `/courses/${course.id}/enrollment-candidates?q=${encodeURIComponent(query.trim())}` : null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/courses/${course.id}/enrollments`, { email, role, sectionId: sectionId || null });
      await onDone();
      fb.success(`Enrolled ${email}.`);
      setEmail("");
      setQuery("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add people"
      description="Find existing accounts by name or email. Administrators create new accounts."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
          <Button type="submit" form="add-people" loading={busy} disabled={!email}>
            Enroll
          </Button>
        </>
      }
    >
      <form id="add-people" onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <TextField label="Search users" placeholder="Type at least 2 characters" value={query} onChange={(e) => setQuery(e.target.value)} />
        {candidates.data && (
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200" aria-label="Matching users">
            {candidates.data.data.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No matching users who aren't already enrolled.</li>}
            {candidates.data.data.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setEmail(c.email)} className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${email === c.email ? "bg-brand-50" : ""}`}>
                  <span className="font-medium">{c.name}</span> <span className="text-slate-500">{c.email}</span> <span className="text-xs text-slate-400">({roleLabel(c.role)})</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <TextField label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Course role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="student">Student</option>
            <option value="ta">Teaching assistant</option>
            <option value="teacher">Teacher</option>
          </SelectField>
          <SelectField label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">Default section</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        </div>
      </form>
    </Dialog>
  );
}

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { course } = useCourse();
  const [csv, setCsv] = useState("email,role,section\n");
  const [results, setResults] = useState<{ row: number; email: string; status: string; message?: string }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ results: typeof results }>(`/courses/${course.id}/enrollments/import`, { csv });
      setResults(r.results);
      await onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={() => (setResults(null), onClose())}
      title="Import enrollments from CSV"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => (setResults(null), onClose())}>
            Close
          </Button>
          <Button onClick={() => void run()} loading={busy}>
            Import
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Columns: <code>email</code> (required), <code>role</code> (student, ta or teacher; default student), <code>section</code> (optional section name). Users must already have accounts.
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-brand-700">
          <Upload className="size-4" aria-hidden /> Load a .csv file
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => e.target.files?.[0] && setCsv(await e.target.files[0].text())} />
        </label>
        <TextAreaField label="CSV content" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono" />
        <FormError error={error} />
        {results && (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 text-sm">
            <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 font-medium">
              {results.filter((r) => r.status === "enrolled").length} enrolled · {results.filter((r) => r.status === "skipped").length} skipped · {results.filter((r) => r.status === "error").length} errors
            </p>
            <ul className="divide-y divide-slate-100">
              {results.map((r) => (
                <li key={r.row} className="flex items-center gap-2 px-3 py-1.5">
                  <Badge tone={r.status === "enrolled" ? "green" : r.status === "skipped" ? "gray" : "red"}>{r.status}</Badge>
                  <span>
                    Row {r.row}: {r.email} {r.message && <span className="text-slate-500">— {r.message}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
