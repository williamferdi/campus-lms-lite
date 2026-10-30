import { CalendarClock, Megaphone, Pencil } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { Card, CardHeader, EmptyState, LinkButton, Loadable, ProgressBar, RichContent } from "../../components/ui";
import { formatDateTime, relative } from "../../lib/format";
import { useApi } from "../../lib/query";
import type { CalendarItem, ModulesResponse, Topic } from "../../lib/types";

export function CourseHome() {
  const { course, permissions, base } = useCourse();
  const front = useApi<{ page: { id: string; title: string; bodyHtml: string; published: boolean } | null }>(`/courses/${course.id}/front-page`);
  const announcements = useApi<{ data: Topic[] }>(`/courses/${course.id}/discussions?type=announcement`);
  // Fix the window once per visit: a new timestamp on every render would change the query key and refetch forever.
  const [range] = useState(() => {
    const start = new Date();
    return { start: start.toISOString(), end: new Date(start.getTime() + 21 * 86400_000).toISOString() };
  });
  const upcoming = useApi<{ data: CalendarItem[] }>(`/calendar?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}&courseId=${course.id}`);
  const modules = useApi<ModulesResponse>(permissions.role === "student" ? `/courses/${course.id}/modules` : null);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <Loadable query={front}>
            {(d) =>
              d.page ? (
                <>
                  <CardHeader
                    title={d.page.title}
                    actions={permissions.canEditContent && <LinkButton to={`${base}/pages/${d.page.id}/edit`} size="sm" variant="secondary" icon={<Pencil className="size-3.5" />}>Edit</LinkButton>}
                  />
                  <div className="px-5 py-4">
                    <RichContent html={d.page.bodyHtml} />
                  </div>
                </>
              ) : (
                <div className="space-y-3 px-5 py-5">
                  <h2 className="text-base font-semibold">About this course</h2>
                  <p className="whitespace-pre-line text-sm text-slate-700">{course.description || "No description yet."}</p>
                  {permissions.canEditContent && (
                    <p className="text-sm text-slate-500">
                      Tip: create a page and mark it as the <Link className="font-medium text-brand-700 hover:underline" to={`${base}/pages/new`}>course front page</Link> to customize this area.
                    </p>
                  )}
                  <LinkButton to={`${base}/modules`} size="sm">
                    Go to modules
                  </LinkButton>
                </div>
              )
            }
          </Loadable>
        </Card>
        <Card>
          <CardHeader title="Latest announcements" actions={<Link to={`${base}/announcements`} className="text-sm font-medium text-brand-700 hover:underline">View all</Link>} />
          <Loadable query={announcements}>
            {(d) =>
              d.data.length === 0 ? (
                <EmptyState icon={<Megaphone className="size-6" />} title="No announcements yet" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {d.data.slice(0, 3).map((a) => (
                    <li key={a.id} className="px-5 py-4">
                      <Link to={`${base}/announcements/${a.id}`} className="font-medium hover:text-brand-700">
                        {a.title}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {a.authorName} · {a.postedAt ? relative(a.postedAt) : "Not yet posted"}
                      </div>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loadable>
        </Card>
      </div>
      <div className="space-y-6">
        {modules.data?.progress && (
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Your progress</h2>
            <div className="my-2 text-2xl font-semibold">{modules.data.progress.percent ?? 0}%</div>
            <ProgressBar value={modules.data.progress.percent} label="Course progress" />
            <p className="mt-2 text-xs text-slate-500">
              {modules.data.progress.completed} of {modules.data.progress.required} requirements complete
            </p>
          </Card>
        )}
        <Card>
          <CardHeader title="Coming up" description="Next 3 weeks" />
          <Loadable query={upcoming}>
            {(d) =>
              d.data.length === 0 ? (
                <EmptyState icon={<CalendarClock className="size-6" />} title="Nothing scheduled" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {d.data.map((i) => (
                    <li key={`${i.kind}-${i.id}`} className="px-5 py-3 text-sm">
                      {i.link ? (
                        <Link to={i.link} className="font-medium hover:text-brand-700">
                          {i.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{i.title}</span>
                      )}
                      <div className="text-xs text-slate-500">{formatDateTime(i.startAt)}</div>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loadable>
        </Card>
        <Card className="p-5 text-sm">
          <h2 className="font-semibold">Instructors</h2>
          <p className="mt-1 text-slate-600">{course.teachers.join(", ") || "Not assigned"}</p>
        </Card>
      </div>
    </div>
  );
}
