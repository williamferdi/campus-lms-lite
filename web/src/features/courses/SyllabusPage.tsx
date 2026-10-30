import { ClipboardList } from "lucide-react";
import { Link } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { Card, CardHeader, EmptyState, Loadable, PageHeader, Table } from "../../components/ui";
import { formatDate, formatPoints, formatTime } from "../../lib/format";
import { useApi } from "../../lib/query";
import type { Assignment, AssignmentGroup } from "../../lib/types";

/** Course description plus a dated summary of every assignment, quiz and graded discussion. */
export function SyllabusPage() {
  const { course, base, permissions } = useCourse();
  const q = useApi<{ groups: AssignmentGroup[]; data: Assignment[] }>(`/courses/${course.id}/assignments`);
  return (
    <>
      <PageHeader title="Syllabus" description="Course description and a dated summary of graded work." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Course description" actions={permissions.canManage && <Link to={`${base}/settings`} className="text-sm font-medium text-brand-700 hover:underline">Edit in Settings</Link>} />
          <p className="whitespace-pre-line px-5 py-4 text-sm leading-relaxed text-slate-700">{course.description || "No description has been added yet."}</p>
          <dl className="grid gap-x-6 gap-y-2 border-t border-line px-5 py-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Instructors</dt>
              <dd className="font-medium">{course.teachers.join(", ") || "Not assigned"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Term</dt>
              <dd className="font-medium">{course.termName ?? "No term"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Grading</dt>
              <dd className="font-medium">{course.applyGroupWeights ? "Weighted by assignment group" : "Total points"}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Course summary" />
          <Loadable query={q}>
            {(d) => {
              const items = [...d.data].sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
              if (!items.length) return <EmptyState icon={<ClipboardList className="size-6" />} title="No graded work yet" />;
              return (
                <Table className="[&_table]:min-w-0">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Details</th>
                      <th className="hidden text-right sm:table-cell">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => {
                      const href = a.quizId ? `${base}/quizzes/${a.quizId}` : a.discussionId ? `${base}/discussions/${a.discussionId}` : `${base}/assignments/${a.id}`;
                      return (
                        <tr key={a.id}>
                          <td className="whitespace-nowrap align-top font-medium">{a.dueAt ? formatDate(a.dueAt) : "Undated"}</td>
                          <td>
                            <Link to={href} className="font-medium text-brand-700 hover:underline">
                              {a.title}
                            </Link>
                            <span className="block text-xs text-slate-500">
                              {a.quizId ? "Quiz" : a.discussionId ? "Graded discussion" : "Assignment"}
                              {a.gradingType !== "not_graded" && ` · ${formatPoints(a.pointsPossible)} pts`}
                              {!a.published && " · Unpublished"}
                              <span className="sm:hidden">{a.dueAt && ` · due ${formatTime(a.dueAt)}`}</span>
                            </span>
                          </td>
                          <td className="hidden whitespace-nowrap text-right text-slate-600 sm:table-cell">{a.dueAt ? `due by ${formatTime(a.dueAt)}` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              );
            }}
          </Loadable>
        </Card>
      </div>
    </>
  );
}
