import clsx from "clsx";
import { Download, Eye, EyeOff, Info, MessageSquare, Upload } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, FormError, IconButton, Loadable, PageHeader, SearchInput, StatCard, Table, TextAreaField } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDate, formatPercent, formatPoints } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { AssignmentGroup, Cell, CourseGrade, ScoreSummary } from "../../lib/types";
import { SubmissionBadges } from "../assignments/shared";

export function GradesRoute() {
  const { permissions } = useCourse();
  return permissions.canGrade ? <Gradebook /> : <StudentGrades studentId="me" />;
}

export function StudentGradesRoute() {
  const { userId } = useParams();
  return <StudentGrades studentId={userId!} />;
}

// ====================================================================== instructor gradebook
interface GradebookData {
  course: { applyGroupWeights: boolean; latePolicyEnabled: boolean };
  groups: AssignmentGroup[];
  assignments: { id: string; title: string; groupId: string | null; pointsPossible: number; gradingType: string; dueAt: string | null; published: boolean; postManually: boolean; submissionTypes: string[] }[];
  students: { id: string; name: string; sortableName: string; email: string; enrollmentStatus: string; cells: Cell[]; totals: CourseGrade; postedTotals: CourseGrade }[];
}

function Gradebook() {
  const { course, base } = useCourse();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const url = `/courses/${course.id}/gradebook`;
  const q = useApi<GradebookData>(url);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const refresh = () => invalidate(url, `/courses/${course.id}`, "/dashboard");

  const saveCell = async (assignmentId: string, studentId: string, raw: string) => {
    const value = raw.trim();
    const body = value.toUpperCase() === "EX" ? { excused: true } : { grade: value === "" ? null : value, excused: false };
    try {
      await api.put(`/assignments/${assignmentId}/submissions/${studentId}/grade`, body);
      await refresh();
      return true;
    } catch (err) {
      fb.error(err);
      return false;
    }
  };

  const toggleRelease = async (a: GradebookData["assignments"][number], hide: boolean) => {
    try {
      await api.post(`/assignments/${a.id}/${hide ? "hide-grades" : "post-grades"}`);
      await refresh();
      fb.success(hide ? `Grades hidden for ${a.title}.` : `Grades released for ${a.title}.`);
    } catch (err) {
      fb.error(err);
    }
  };

  return (
    <>
      <PageHeader
        title="Gradebook"
        description="Click a cell to enter a grade (points, %, letter, or EX to excuse). Press Enter to save."
        actions={
          <>
            <a href={`/api/v1/courses/${course.id}/gradebook/export`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium shadow-sm hover:bg-slate-50">
              <Download className="size-4" aria-hidden /> Export CSV
            </a>
            <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
              Import CSV
            </Button>
          </>
        }
      />
      <Loadable query={q} label="Loading gradebook…">
        {(d) => {
          const students = d.students.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));
          if (d.students.length === 0) return <Card><EmptyState title="No students enrolled yet" /></Card>;
          return (
            <Card>
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
                <SearchInput aria-label="Search students" placeholder="Filter students" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
                <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-violet-100 ring-1 ring-violet-300" /> needs grading</span>
                  <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-red-50 ring-1 ring-red-300" /> missing</span>
                  <span className="inline-flex items-center gap-1"><span className="size-3 rounded bg-amber-50 ring-1 ring-amber-300" /> late</span>
                  <span className="inline-flex items-center gap-1"><EyeOff className="size-3" /> not released</span>
                </div>
              </div>
              <div className="max-h-[70vh] overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-20 bg-slate-50">
                    <tr>
                      <th scope="col" className="sticky left-0 z-30 min-w-44 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                        Student
                      </th>
                      {d.assignments.map((a) => (
                        <th key={a.id} scope="col" className="min-w-28 max-w-40 border-b border-slate-200 px-2 py-2 text-left align-bottom font-normal">
                          <Link to={`${base}/assignments/${a.id}/grade`} className="line-clamp-2 text-xs font-semibold text-slate-800 hover:text-brand-700" title={a.title}>
                            {a.title}
                          </Link>
                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                            {a.gradingType === "not_graded" ? "Not graded" : `${formatPoints(a.pointsPossible)} pts`}
                            {!a.published && <Badge tone="amber" className="px-1 py-0 text-[10px]">draft</Badge>}
                            <IconButton label={`Release grades for ${a.title}`} className="size-6" onClick={() => void toggleRelease(a, false)}>
                              <Eye className="size-3.5" />
                            </IconButton>
                            <IconButton label={`Hide grades for ${a.title}`} className="size-6" onClick={() => void toggleRelease(a, true)}>
                              <EyeOff className="size-3.5" />
                            </IconButton>
                          </div>
                        </th>
                      ))}
                      <th scope="col" className="min-w-24 border-b border-l border-slate-200 bg-slate-100 px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">
                        Current
                      </th>
                      <th scope="col" className="min-w-24 border-b border-slate-200 bg-slate-100 px-3 py-2 text-right text-xs font-semibold uppercase text-slate-600">
                        Final
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.id}>
                        <th scope="row" className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3 py-1.5 text-left font-medium">
                          <Link to={`${base}/grades/${s.id}`} className="hover:text-brand-700">
                            {s.sortableName}
                          </Link>
                          {s.enrollmentStatus !== "active" && <Badge className="ml-1">{s.enrollmentStatus}</Badge>}
                        </th>
                        {s.cells.map((c, i) => (
                          <GradeCell key={c.assignmentId} cell={c} assignment={d.assignments[i]!} studentName={s.name} onSave={(v) => saveCell(c.assignmentId, s.id, v)} />
                        ))}
                        <td className="border-b border-l border-slate-100 bg-slate-50 px-3 py-1.5 text-right font-semibold">
                          {formatPercent(s.totals.current.percent)} <span className="text-xs font-normal text-slate-500">{s.totals.current.letter}</span>
                        </td>
                        <td className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-right">{formatPercent(s.totals.final.percent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="flex items-start gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Current = graded work only. Final = ungraded work counts as zero. Excused work is ignored. {d.course.applyGroupWeights ? "Weighted by assignment group." : "Total points."} Totals here include unreleased grades; students only see released grades.
              </p>
            </Card>
          );
        }}
      </Loadable>
      {importing && <ImportGradesDialog onClose={() => setImporting(false)} onDone={refresh} />}
    </>
  );
}

function GradeCell({ cell, assignment, studentName, onSave }: { cell: Cell; assignment: GradebookData["assignments"][number]; studentName: string; onSave: (v: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const display = cell.excused ? "EX" : cell.score !== null ? formatPoints(cell.score) : cell.submittedAt ? "•" : "–";
  const start = () => {
    if (assignment.gradingType === "not_graded") return;
    setValue(cell.excused ? "EX" : cell.enteredScore !== null ? String(cell.enteredScore) : "");
    setEditing(true);
  };
  const onKey = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") setEditing(false);
    if (e.key === "Enter") {
      if (await onSave(value)) setEditing(false);
    }
  };
  return (
    <td
      className={clsx(
        "border-b border-slate-100 px-1 py-1 text-center",
        cell.needsGrading && "bg-violet-50",
        !cell.needsGrading && cell.missing && "bg-red-50",
        !cell.needsGrading && !cell.missing && cell.late && "bg-amber-50",
      )}
    >
      {editing ? (
        <input
          autoFocus
          aria-label={`Grade for ${studentName}, ${assignment.title}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => void onKey(e)}
          onBlur={() => setEditing(false)}
          className="w-20 rounded border border-brand-500 px-1.5 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      ) : (
        <button
          type="button"
          onClick={start}
          title={[cell.missing && "Missing", cell.late && "Late", cell.needsGrading && "Needs grading", cell.graded && !cell.posted && "Not released"].filter(Boolean).join(" · ") || undefined}
          aria-label={`${studentName}, ${assignment.title}: ${display === "–" ? "no grade" : display}. Edit grade`}
          className="inline-flex min-h-8 w-full items-center justify-center gap-1 rounded px-1.5 hover:bg-white hover:ring-1 hover:ring-slate-300"
        >
          {display}
          {cell.graded && !cell.posted && <EyeOff className="size-3 text-slate-400" aria-hidden />}
        </button>
      )}
    </td>
  );
}

function ImportGradesDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const { course } = useCourse();
  const fb = useFeedback();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{ changes: { email: string; assignment: string; from: string; to: string }[]; errors: { row: number; message: string }[]; ignoredColumns: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<NonNullable<typeof preview>>(`/courses/${course.id}/gradebook/import`, { csv, dryRun });
      if (dryRun) setPreview(r);
      else {
        await onDone();
        fb.success(`Imported ${r.changes.length} grade change(s).`);
        onClose();
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Import grades from CSV"
      description="Export the gradebook, edit scores in a spreadsheet, then import it. Use EX to excuse; blank cells are skipped."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {preview ? (
            <Button onClick={() => void run(false)} loading={busy} disabled={preview.changes.length === 0}>
              Apply {preview.changes.length} change(s)
            </Button>
          ) : (
            <Button onClick={() => void run(true)} loading={busy} disabled={!csv.trim()}>
              Preview changes
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-brand-700">
          <Upload className="size-4" aria-hidden /> Choose a .csv file
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setPreview(null); } }} />
        </label>
        <TextAreaField label="CSV content" rows={6} value={csv} onChange={(e) => (setCsv(e.target.value), setPreview(null))} />
        <FormError error={error} />
        {preview && (
          <div className="space-y-2 text-sm">
            <p className="font-medium">
              {preview.changes.length} change(s), {preview.errors.length} problem(s)
            </p>
            {preview.changes.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded border border-slate-200 text-xs">
                {preview.changes.map((c, i) => (
                  <li key={i} className="border-b border-slate-100 px-2 py-1 last:border-0">
                    {c.email} · {c.assignment}: {c.from} → <strong>{c.to}</strong>
                  </li>
                ))}
              </ul>
            )}
            {preview.errors.map((e, i) => (
              <p key={i} className="text-xs text-red-700">
                Row {e.row}: {e.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ====================================================================== student grades
interface StudentGradesData {
  student: { id: string; name: string };
  applyGroupWeights: boolean;
  groups: (AssignmentGroup & { grade: { current: ScoreSummary; final: ScoreSummary } | null })[];
  assignments: (Cell & { id: string; title: string; groupId: string | null; pointsPossible: number; gradingType: string; dueAt: string | null; omitFromFinal: boolean; commentCount: number; dropped: boolean })[];
  totals: { current: ScoreSummary; final: ScoreSummary };
}

function StudentGrades({ studentId }: { studentId: string }) {
  const { course, base, permissions } = useCourse();
  const q = useApi<StudentGradesData>(`/courses/${course.id}/grades/${studentId}`);
  return (
    <Loadable query={q}>
      {(d) => (
        <>
          <PageHeader title={permissions.canGrade ? `Grades for ${d.student.name}` : "My grades"} description={permissions.canGrade ? "Staff view — includes unreleased grades." : "Only grades your instructor has released are shown."} />
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <StatCard label="Current grade" value={d.totals.current.percent === null ? "—" : `${formatPercent(d.totals.current.percent)} · ${d.totals.current.letter}`} hint="Based on graded work only" />
            <StatCard label="Final grade (if nothing else is submitted)" value={formatPercent(d.totals.final.percent)} hint="Ungraded work counts as zero" />
          </div>
          <Card>
            <Table>
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th className="text-right">Score</th>
                  <th className="text-right">
                    <span className="sr-only">Comments</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.assignments.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState title="No assignments yet" />
                    </td>
                  </tr>
                )}
                {d.assignments.map((a) => (
                  <tr key={a.id} className={clsx(a.dropped && "opacity-60")}>
                    <td>
                      <Link to={permissions.canGrade ? `${base}/assignments/${a.id}/grade?student=${d.student.id}` : `${base}/assignments/${a.id}`} className="font-medium hover:text-brand-700">
                        {a.title}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {d.groups.find((g) => g.id === a.groupId)?.name}
                        {a.dropped && " · dropped"}
                        {a.omitFromFinal && " · not counted"}
                      </div>
                    </td>
                    <td className="text-slate-600">{formatDate(a.dueAt)}</td>
                    <td>
                      <SubmissionBadges cell={a} pointsPossible={a.pointsPossible} showScore={false} />
                    </td>
                    <td className="text-right font-medium">{a.excused ? "Excused" : a.score === null ? `– / ${formatPoints(a.pointsPossible)}` : `${formatPoints(a.score)} / ${formatPoints(a.pointsPossible)}`}</td>
                    <td className="text-right">
                      {a.commentCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500" title="Comments">
                          <MessageSquare className="size-3.5" aria-hidden />
                          {a.commentCount}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card className="mt-6">
            <CardHeader title="By assignment group" description={d.applyGroupWeights ? "The final grade is weighted by group." : "All points count equally."} />
            <Table>
              <thead>
                <tr>
                  <th>Group</th>
                  {d.applyGroupWeights && <th className="text-right">Weight</th>}
                  <th className="text-right">Current</th>
                  <th className="text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {d.groups.map((g) => (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    {d.applyGroupWeights && <td className="text-right">{formatPoints(g.weight)}%</td>}
                    <td className="text-right">{formatPercent(g.grade?.current.percent)}</td>
                    <td className="text-right text-slate-600">
                      {formatPoints(g.grade?.current.earned)} / {formatPoints(g.grade?.current.possible)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </Loadable>
  );
}
