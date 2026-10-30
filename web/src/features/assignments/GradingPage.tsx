import clsx from "clsx";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Paperclip, RotateCcw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { Badge, Button, Card, CardHeader, Checkbox, Dialog, EmptyState, FormError, LoadingState, Loadable, PageHeader, RichContent, Select, SelectField, TextAreaField, TextField } from "../../components/ui";
import { api } from "../../lib/api";
import { formatBytes, formatDateTime, formatPoints, plural, relative } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { Assignment, Cell, SubmissionDetail } from "../../lib/types";
import { SUBMISSION_TYPE_LABEL, SubmissionBadges } from "./shared";

type Row = Cell & { student: { id: string; name: string; sortableName: string } };

const GRADE_HINT: Record<string, string> = {
  points: "Points, e.g. 8.5 — or a percentage like 85%",
  percent: "Percentage, e.g. 85",
  letter_grade: "Letter (A, B+, …), points, or a percentage",
  pass_fail: "complete or incomplete",
  not_graded: "Not graded",
};

export function GradingPage() {
  const { assignmentId } = useParams();
  const { base, permissions } = useCourse();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("all");
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const assignment = useApi<{ assignment: Assignment }>(`/assignments/${assignmentId}`);
  const list = useApi<{ data: Row[]; summary: Record<string, number> }>(`/assignments/${assignmentId}/submissions?status=${filter}`, { placeholderData: (p) => p });
  const studentId = params.get("student") ?? list.data?.data[0]?.student.id ?? null;
  const rows = list.data?.data ?? [];
  const idx = rows.findIndex((r) => r.student.id === studentId);
  const go = (i: number) => {
    const r = rows[i];
    if (r) setParams({ student: r.student.id }, { replace: true });
  };

  if (!permissions.canGrade) return <EmptyState title="Only graders can open this page" />;
  if (assignment.isPending) return <LoadingState />;
  const a = assignment.data?.assignment;
  if (!a) return <Loadable query={assignment}>{() => null}</Loadable>;

  const release = async (hide: boolean) => {
    try {
      const r = await api.post<{ posted?: number; hidden?: number }>(`/assignments/${a.id}/${hide ? "hide-grades" : "post-grades"}`);
      await invalidate(`/assignments/${a.id}`);
      fb.success(hide ? `Hid grades for ${plural(r.hidden ?? 0, "student")}.` : `Released ${plural(r.posted ?? 0, "grade")}.`);
    } catch (err) {
      fb.error(err);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link to={`${base}/assignments/${a.id}`} className="hover:underline">← {a.title}</Link>}
        title="Grade submissions"
        description={`${formatPoints(a.pointsPossible)} points · Due ${a.dueAt ? formatDateTime(a.dueAt) : "—"} · Grades released ${a.postManually ? "manually" : "automatically"}`}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<Eye className="size-4" />} onClick={() => void release(false)}>
              Release grades
            </Button>
            <Button variant="ghost" size="sm" icon={<EyeOff className="size-4" />} onClick={() => void release(true)}>
              Hide
            </Button>
          </>
        }
      />
      {a.quizId && (
        <p className="mb-4 rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-900">
          This is a quiz: scores come from quiz attempts. Grade short answers from the <Link className="font-medium underline" to={`${base}/quizzes/${a.quizId}`}>quiz attempts list</Link>; a manual grade here will be replaced if attempts are regraded.
        </p>
      )}
      {list.data && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <Badge>{list.data.summary.total} students</Badge>
          <Badge tone="blue">{list.data.summary.submitted} submitted</Badge>
          <Badge tone="violet">{list.data.summary.needsGrading} need grading</Badge>
          <Badge tone="green">{list.data.summary.graded} graded</Badge>
          <Badge tone="gray">{list.data.summary.posted} released</Badge>
          {list.data.summary.missing! > 0 && <Badge tone="red">{list.data.summary.missing} missing</Badge>}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card>
          <div className="border-b border-slate-100 p-3">
            <Select aria-label="Filter students" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full">
              <option value="all">All students</option>
              <option value="needs_grading">Needs grading</option>
              <option value="graded">Graded</option>
              <option value="missing">Missing</option>
              <option value="late">Late</option>
              <option value="unsubmitted">Not submitted</option>
            </Select>
          </div>
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto" aria-label="Students">
            {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No students match.</li>}
            {rows.map((r) => (
              <li key={r.student.id}>
                <button type="button" onClick={() => setParams({ student: r.student.id }, { replace: true })} aria-current={r.student.id === studentId} className={clsx("w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50", r.student.id === studentId && "bg-brand-50")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.student.sortableName}</span>
                    {r.needsGrading && <span className="size-2 rounded-full bg-violet-500" role="img" aria-label="Needs grading" />}
                  </div>
                  <div className="mt-1">
                    <SubmissionBadges cell={r} pointsPossible={a.pointsPossible} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div>
          {studentId ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <Button variant="ghost" size="sm" icon={<ChevronLeft className="size-4" />} disabled={idx <= 0} onClick={() => go(idx - 1)}>
                  Previous
                </Button>
                <span className="text-sm text-slate-500">{idx >= 0 ? `${idx + 1} of ${rows.length}` : ""}</span>
                <Button variant="ghost" size="sm" disabled={idx < 0 || idx >= rows.length - 1} onClick={() => go(idx + 1)}>
                  Next <ChevronRight className="size-4" />
                </Button>
              </div>
              <StudentGrader key={studentId} assignment={a} studentId={studentId} />
            </>
          ) : (
            <Card>
              <EmptyState title="Select a student" />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function StudentGrader({ assignment: a, studentId }: { assignment: Assignment; studentId: string }) {
  const { course, permissions } = useCourse();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const url = `/assignments/${a.id}/submissions/${studentId}`;
  const q = useApi<SubmissionDetail>(url);
  const [grade, setGrade] = useState("");
  const [excused, setExcused] = useState(false);
  const [lateStatus, setLateStatus] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    const s = q.data?.submission;
    if (!s) return;
    setGrade(s.excused ? "" : s.enteredScore !== null ? String(s.enteredScore) : "");
    setExcused(s.excused);
    setLateStatus(s.latePolicyStatus ?? "");
  }, [q.data?.submission]);

  const refresh = () => invalidate(`/assignments/${a.id}`, `/courses/${course.id}`, "/dashboard");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put(`${url}/grade`, { grade: excused ? undefined : grade.trim() === "" ? null : grade, excused, latePolicyStatus: lateStatus || null, comment: comment || undefined });
      setComment("");
      await refresh();
      fb.success("Grade saved.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Loadable query={q}>
      {(d) => (
        <div className="grid gap-6 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader title={d.student.name} description={d.submission.submittedAt ? `Last submitted ${formatDateTime(d.submission.submittedAt)}` : "No submission yet"} actions={<SubmissionBadges cell={d.submission} pointsPossible={a.pointsPossible} />} />
            <div className="space-y-3 px-5 py-4">
              {d.attempts.length === 0 && <p className="text-sm text-slate-500">{a.submissionTypes.includes("on_paper") ? "Submitted on paper — enter the grade on the right." : "The student has not submitted anything yet."}</p>}
              {[...d.attempts].reverse().map((at) => (
                <section key={at.attempt} className="rounded-lg border border-slate-200 p-4" aria-label={`Attempt ${at.attempt}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <strong className="text-slate-800">Attempt {at.attempt}</strong> · {formatDateTime(at.submittedAt)} · {SUBMISSION_TYPE_LABEL[at.submissionType]}
                    {at.late && <Badge tone="amber">Late</Badge>}
                    {d.submission.gradedAttempt === at.attempt && <Badge tone="green">Graded</Badge>}
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
                </section>
              ))}
            </div>
          </Card>
          <div className="space-y-6 xl:col-span-2">
            <Card>
              <CardHeader title="Grade" />
              <form onSubmit={save} className="space-y-4 px-5 py-4">
                <FormError error={error} />
                <TextField label={`Grade (out of ${formatPoints(a.pointsPossible)})`} value={grade} onChange={(e) => setGrade(e.target.value)} disabled={excused || permissions.readOnly} hint={GRADE_HINT[a.gradingType]} />
                {d.submission.pointsDeducted ? (
                  <p className="text-xs text-amber-800">
                    Late penalty applied: −{formatPoints(d.submission.pointsDeducted)} → final {formatPoints(d.submission.score)}
                  </p>
                ) : null}
                <Checkbox label="Excuse this student" hint="Excused work doesn't count toward the grade." checked={excused} onChange={(e) => setExcused(e.target.checked)} />
                <SelectField label="Late / missing status" value={lateStatus} onChange={(e) => setLateStatus(e.target.value)} hint="Automatic uses the due date. 'None' waives any late penalty.">
                  <option value="">Automatic</option>
                  <option value="late">Mark late</option>
                  <option value="missing">Mark missing</option>
                  <option value="none">None (waive)</option>
                </SelectField>
                <TextAreaField label="Comment for the student (optional)" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} hint={a.postManually && !d.submission.posted ? "Visible to the student after you release grades." : undefined} />
                <div className="flex flex-wrap justify-between gap-2">
                  <Button variant="secondary" icon={<RotateCcw className="size-4" />} disabled={!d.submission.submittedAt || permissions.readOnly} onClick={() => setReturning(true)}>
                    Return for revision
                  </Button>
                  <Button type="submit" loading={busy} disabled={permissions.readOnly}>
                    Save grade
                  </Button>
                </div>
              </form>
            </Card>
            <Card>
              <CardHeader title="Comments" />
              <ul className="space-y-2 px-5 py-4">
                {d.comments.length === 0 && <li className="text-sm text-slate-500">No comments.</li>}
                {d.comments.map((c) => (
                  <li key={c.id} className={clsx("rounded-lg px-3 py-2 text-sm", c.fromGrader ? "bg-brand-50" : "bg-slate-50")}>
                    <div className="text-xs text-slate-500">
                      <strong className="text-slate-700">{c.authorName}</strong> · {relative(c.createdAt)} {c.attempt ? `· attempt ${c.attempt}` : ""}
                    </div>
                    <RichContent html={c.body} />
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          {returning && <ReturnDialog url={url} onClose={() => setReturning(false)} onDone={refresh} />}
        </div>
      )}
    </Loadable>
  );
}

function ReturnDialog({ url, onClose, onDone }: { url: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<unknown>(null);
  const fb = useFeedback();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`${url}/return`, { comment });
      await onDone();
      fb.success("Returned for revision. The student was notified and can resubmit.");
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Return for revision" description="The student can submit again (an extra attempt is granted if needed)." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="return-form">Return to student</Button></>}>
      <form id="return-form" onSubmit={submit} className="space-y-3">
        <FormError error={error} />
        <TextAreaField label="What should the student revise?" required rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
      </form>
    </Dialog>
  );
}
