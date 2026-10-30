import { Archive, Copy, Eye, EyeOff, ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { Badge, Button, Card, CardHeader, Checkbox, Dialog, FormError, IconButton, Loadable, SelectField, TextField, Table } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useUser } from "../../lib/auth";
import { formatDateTime, toLocalInput } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { AuditEvent, Course, Department, Paged, Section, Term } from "../../lib/types";
import { CourseFormFields, courseFormPayload, emptyCourseForm } from "./CoursesPage";

export function CourseSettings() {
  const { course, permissions } = useCourse();
  const user = useUser();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const terms = useApi<{ data: Term[] }>("/terms");
  const departments = useApi<{ data: Department[] }>("/departments");
  const [form, setForm] = useState(emptyCourseForm);
  const [detailsError, setDetailsError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [grading, setGrading] = useState({ applyGroupWeights: false, latePolicyEnabled: false, lateDeductionPercent: 10, lateFloorPercent: 50 });
  const [dupOpen, setDupOpen] = useState(false);

  useEffect(() => {
    setForm({
      code: course.code,
      name: course.name,
      description: course.description,
      termId: course.termId ?? "",
      departmentId: course.departmentId ?? "",
      startAt: toLocalInput(course.startAt),
      endAt: toLocalInput(course.endAt),
    });
    setGrading({
      applyGroupWeights: course.applyGroupWeights,
      latePolicyEnabled: course.latePolicyEnabled,
      lateDeductionPercent: course.lateDeductionPercent,
      lateFloorPercent: course.lateFloorPercent,
    });
  }, [course]);

  const refresh = () => invalidate(`/courses/${course.id}`, "/courses", "/dashboard");

  const saveDetails = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setDetailsError(null);
    try {
      await api.patch(`/courses/${course.id}`, courseFormPayload(form));
      await refresh();
      fb.success("Course details saved.");
    } catch (err) {
      setDetailsError(err);
    } finally {
      setSaving(false);
    }
  };

  const saveGrading = async () => {
    try {
      await api.patch(`/courses/${course.id}`, grading);
      await refresh();
      fb.success("Grading settings saved. Totals are recalculated automatically.");
    } catch (err) {
      fb.error(err);
    }
  };

  const setStatus = async (status: Course["status"]) => {
    const messages: Record<Course["status"], { title: string; message: string; label: string }> = {
      published: { title: "Publish course?", message: "Enrolled students will be able to open the course and its published content.", label: "Publish" },
      unpublished: { title: "Unpublish course?", message: "Students will lose access until it is published again. This is blocked once grades have been released.", label: "Unpublish" },
      archived: { title: "Archive course?", message: "The course becomes read-only for everyone. Only administrators can reopen it.", label: "Archive" },
    };
    const m = messages[status];
    if (!(await fb.confirm({ title: m.title, message: m.message, confirmLabel: m.label, danger: status !== "published" }))) return;
    try {
      await api.post(`/courses/${course.id}/status`, { status });
      await refresh();
      fb.success(`Course ${status}.`);
    } catch (err) {
      fb.error(err);
    }
  };

  const uploadImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      await api.upload(`/courses/${course.id}/image`, [file]);
      await refresh();
      fb.success("Course image updated.");
    } catch (err) {
      fb.error(err);
    }
  };

  const fieldErrors = detailsError instanceof ApiError ? detailsError.fieldErrors() : {};

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Status" description="Students only see published courses. Archived courses are read-only." />
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="text-sm">
            Current status: <Badge tone={course.status === "published" ? "green" : course.status === "archived" ? "gray" : "amber"}>{course.status}</Badge>
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {course.status !== "published" && (course.status !== "archived" || user.role === "admin") && (
              <Button icon={<Eye className="size-4" />} onClick={() => void setStatus("published")}>
                Publish
              </Button>
            )}
            {course.status === "published" && (
              <Button variant="secondary" icon={<EyeOff className="size-4" />} onClick={() => void setStatus("unpublished")}>
                Unpublish
              </Button>
            )}
            {course.status !== "archived" && (
              <Button variant="secondary" icon={<Archive className="size-4" />} onClick={() => void setStatus("archived")}>
                Archive
              </Button>
            )}
            {user.role !== "student" && (
              <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => setDupOpen(true)}>
                Duplicate
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Course details" />
        <form onSubmit={saveDetails} className="space-y-4 px-5 py-4">
          {!Object.keys(fieldErrors).length && <FormError error={detailsError} />}
          <CourseFormFields value={form} onChange={(v) => setForm((f) => ({ ...f, ...v }))} errors={fieldErrors} terms={terms.data?.data ?? []} departments={departments.data?.data ?? []} />
          <div className="flex justify-end">
            <Button type="submit" loading={saving} disabled={permissions.readOnly && user.role !== "admin"}>
              Save details
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Course image" description="Shown on course cards. PNG, JPEG, GIF or WebP." />
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <div className="h-20 w-36 rounded-lg bg-gradient-to-br from-brand-800 to-brand-500 bg-cover bg-center" style={course.imageUrl ? { backgroundImage: `url(${course.imageUrl})` } : undefined} role="img" aria-label="Current course image" />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 focus-within:outline-2 focus-within:outline-brand-600">
            <ImagePlus className="size-4" aria-hidden /> Upload image
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={(e) => void uploadImage(e.target.files?.[0])} />
          </label>
          {course.imageUrl && (
            <Button
              variant="ghost"
              onClick={async () => {
                await api.del(`/courses/${course.id}/image`);
                await refresh();
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Grading" description="How course totals are calculated." />
        <div className="space-y-4 px-5 py-4">
          <Checkbox label="Weight final grade by assignment group" hint="Set each group's weight on the Assignments page. Groups with no graded work are left out and the remaining weights re-normalize." checked={grading.applyGroupWeights} onChange={(e) => setGrading((g) => ({ ...g, applyGroupWeights: e.target.checked }))} />
          <Checkbox label="Automatically deduct points for late submissions" checked={grading.latePolicyEnabled} onChange={(e) => setGrading((g) => ({ ...g, latePolicyEnabled: e.target.checked }))} />
          {grading.latePolicyEnabled && (
            <div className="grid gap-4 pl-6 sm:grid-cols-2">
              <TextField label="Deduction per day late (%)" type="number" min={0} max={100} value={grading.lateDeductionPercent} onChange={(e) => setGrading((g) => ({ ...g, lateDeductionPercent: Number(e.target.value) }))} />
              <TextField label="Lowest possible grade for late work (%)" type="number" min={0} max={100} value={grading.lateFloorPercent} onChange={(e) => setGrading((g) => ({ ...g, lateFloorPercent: Number(e.target.value) }))} hint="Grades already below this are not raised." />
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => void saveGrading()}>Save grading settings</Button>
          </div>
        </div>
      </Card>

      <SectionsCard />
      <CourseAudit />
      <DuplicateDialog open={dupOpen} onClose={() => setDupOpen(false)} onDone={(id) => navigate(`/courses/${id}/settings`)} />
    </div>
  );
}

function SectionsCard() {
  const { course } = useCourse();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const q = useApi<{ data: Section[] }>(`/courses/${course.id}/sections`);
  const [name, setName] = useState("");
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/courses/${course.id}/sections`, { name });
      setName("");
      await invalidate(`/courses/${course.id}/sections`);
    } catch (err) {
      fb.error(err);
    }
  };
  return (
    <Card>
      <CardHeader title="Sections" description="Group students within the course (e.g. by cohort or meeting time)." />
      <Loadable query={q}>
        {(d) => (
          <ul className="divide-y divide-slate-100">
            {d.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span>{s.name}</span>
                <IconButton
                  label={`Delete section ${s.name}`}
                  disabled={d.data.length <= 1}
                  onClick={async () => {
                    if (!(await fb.confirm({ title: "Delete section?", message: "Students in it move to another section.", danger: true, confirmLabel: "Delete" }))) return;
                    try {
                      await api.del(`/sections/${s.id}`);
                      await invalidate(`/courses/${course.id}/sections`, `/courses/${course.id}/enrollments`);
                    } catch (err) {
                      fb.error(err);
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Loadable>
      <form onSubmit={add} className="flex gap-2 border-t border-slate-100 px-5 py-3">
        <input aria-label="New section name" placeholder="New section name" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <Button type="submit" variant="secondary" disabled={!name.trim()}>
          Add section
        </Button>
      </form>
    </Card>
  );
}

function CourseAudit() {
  const { course } = useCourse();
  const q = useApi<Paged<AuditEvent>>(`/courses/${course.id}/audit?perPage=15`);
  return (
    <Card>
      <CardHeader title="Recent activity log" description="Grading, enrollment and course changes are recorded for accountability." />
      <Loadable query={q}>
        {(d) => (
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {d.data.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-slate-500">{formatDateTime(e.createdAt)}</td>
                  <td>{e.actorName ?? "System"}</td>
                  <td>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{e.action}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Loadable>
    </Card>
  );
}

function DuplicateDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const { course } = useCourse();
  const terms = useApi<{ data: Term[] }>(open ? "/terms" : null);
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const [code, setCode] = useState(`${course.code}-COPY`);
  const [name, setName] = useState(`${course.name} (copy)`);
  const [termId, setTermId] = useState(course.termId ?? "");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ course: Course }>(`/courses/${course.id}/duplicate`, { code, name, termId: termId || null });
      await invalidate("/courses", "/dashboard");
      fb.success("Course duplicated. Content was copied; people, submissions and grades were not.");
      onClose();
      onDone(r.course.id);
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
      title="Duplicate course"
      description="Copies modules, pages, files, assignments, quizzes and discussion topics into a new unpublished course."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="dup-course" loading={busy}>
            Duplicate
          </Button>
        </>
      }
    >
      <form id="dup-course" onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <TextField label="New course code" required value={code} onChange={(e) => setCode(e.target.value)} />
        <TextField label="New course name" required value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField label="Term" value={termId} onChange={(e) => setTermId(e.target.value)}>
          <option value="">No term</option>
          {terms.data?.data.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
      </form>
    </Dialog>
  );
}
