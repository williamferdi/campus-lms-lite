import { Link } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { Badge, Card, CardHeader, EmptyState, Loadable, ProgressBar, StatCard, Table } from "../../components/ui";
import { formatDate, formatPercent } from "../../lib/format";
import { useApi } from "../../lib/query";

interface Stats {
  summary: { studentCount: number; averageProgress: number | null; completedCount: number; averageCurrentScore: number | null; missingSubmissions: number };
  students: { id: string; name: string; enrollmentStatus: string; progressPercent: number | null; requirementsCompleted: number; requirementsTotal: number; currentScore: number | null; currentGrade: string | null; finalScore: number | null; missingCount: number; lateCount: number }[];
  assignments: { id: string; title: string; dueAt: string | null; submittedCount: number; gradedCount: number; averagePercent: number | null }[];
}

export function StatsPage() {
  const { course, base, permissions } = useCourse();
  const q = useApi<Stats>(`/courses/${course.id}/stats`);
  return (
    <Loadable query={q} label="Calculating progress…">
      {(s) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Students" value={s.summary.studentCount} />
            <StatCard label="Average progress" value={formatPercent(s.summary.averageProgress)} hint={`${s.summary.completedCount} completed all requirements`} />
            <StatCard label="Average current score" value={formatPercent(s.summary.averageCurrentScore)} hint="Includes unreleased grades" />
            <StatCard label="Missing submissions" value={s.summary.missingSubmissions} />
          </div>
          <Card>
            <CardHeader title="Student progress" description="Module completion and grades (staff view, includes unreleased grades)." />
            {s.students.length === 0 ? (
              <EmptyState title="No students enrolled" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th className="w-48">Module progress</th>
                    <th className="text-right">Current</th>
                    <th className="text-right">Final</th>
                    <th className="text-right">Missing</th>
                    <th className="text-right">Late</th>
                  </tr>
                </thead>
                <tbody>
                  {s.students.map((st) => (
                    <tr key={st.id}>
                      <td>
                        {permissions.canGrade ? (
                          <Link to={`${base}/grades/${st.id}`} className="font-medium hover:text-brand-700">
                            {st.name}
                          </Link>
                        ) : (
                          st.name
                        )}
                        {st.enrollmentStatus !== "active" && <Badge className="ml-2">{st.enrollmentStatus}</Badge>}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <ProgressBar value={st.progressPercent} label={`${st.name} progress`} />
                          <span className="w-10 text-right text-xs text-slate-600">{st.progressPercent === null ? "—" : `${st.progressPercent}%`}</span>
                        </div>
                      </td>
                      <td className="text-right">{st.currentScore === null ? "—" : `${formatPercent(st.currentScore)} ${st.currentGrade}`}</td>
                      <td className="text-right">{formatPercent(st.finalScore)}</td>
                      <td className="text-right">{st.missingCount > 0 ? <Badge tone="red">{st.missingCount}</Badge> : 0}</td>
                      <td className="text-right">{st.lateCount > 0 ? <Badge tone="amber">{st.lateCount}</Badge> : 0}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Assignment completion" />
            <Table>
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Due</th>
                  <th className="text-right">Submitted</th>
                  <th className="text-right">Graded</th>
                  <th className="text-right">Average</th>
                </tr>
              </thead>
              <tbody>
                {s.assignments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={`${base}/assignments/${a.id}`} className="font-medium hover:text-brand-700">
                        {a.title}
                      </Link>
                    </td>
                    <td className="text-slate-600">{formatDate(a.dueAt)}</td>
                    <td className="text-right">
                      {a.submittedCount} / {s.summary.studentCount}
                    </td>
                    <td className="text-right">{a.gradedCount}</td>
                    <td className="text-right">{formatPercent(a.averagePercent)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </Loadable>
  );
}
