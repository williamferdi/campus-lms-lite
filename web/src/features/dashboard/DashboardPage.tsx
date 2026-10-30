import clsx from "clsx";
import {
  AlertCircle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  EllipsisVertical,
  FileQuestion,
  FolderOpen,
  LayoutGrid,
  List,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  Plus,
  Users,
  Layers,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PageContainer } from "../../components/layout/AppShell";
import { Badge, Card, CardHeader, EmptyState, IconButton, Loadable, Menu, MenuItem, MenuLabel, MenuLinkItem, PageHeader, ProgressBar, RichContent, StatCard, Table, Tooltip } from "../../components/ui";
import { formatDate, formatDateTime, formatPercent, formatPoints, formatTime, relative } from "../../lib/format";
import { useApi } from "../../lib/query";
import type { AuditEvent, CalendarItem, Course } from "../../lib/types";
import { courseColor, usePref } from "../../lib/ui-prefs";

interface DashboardData {
  user: { name: string; role: string };
  announcements: { id: string; courseId: string; title: string; bodyHtml: string; postedAt: string; courseCode: string }[];
  learning: null | {
    courses: (Course & { progressPercent: number | null; currentScore: number | null; currentGrade: string | null })[];
    upcoming: (CalendarItem & { submitted: boolean })[];
    pending: { id: string; title: string; courseId: string; courseCode: string; dueAt: string | null; pointsPossible: number; missing: boolean; link: string }[];
    recentGrades: { assignmentId: string; title: string; courseCode: string; score: number | null; grade: string | null; excused: boolean; pointsPossible: number; postedAt: string; link: string }[];
  };
  teaching: null | {
    courses: (Course & { needsGradingCount: number; averageProgress: number | null; averageCurrentScore: number | null; completedCount: number; missingSubmissions: number })[];
    needsGrading: { assignmentId: string; title: string; courseCode: string; studentName: string; submittedAt: string | null; link: string }[];
    recentSubmissions: { assignmentId: string; title: string; courseCode: string; studentName: string; submittedAt: string | null; link: string }[];
    upcoming: CalendarItem[];
  };
  admin: null | {
    users: { byRole: Record<string, number>; byStatus: Record<string, number>; activeLast7Days: number };
    courses: { byStatus: Record<string, number> };
    enrollments: { byRole: Record<string, number> };
    terms: number;
    completion: { id: string; code: string; name: string; termName: string | null; studentCount: number; averageProgress: number | null; completedCount: number; averageCurrentScore: number | null }[];
    recentAudit: AuditEvent[];
  };
}

type View = "cards" | "list";
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------- course card
function CardLink({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <Tooltip label={label}>
      <Link to={to} aria-label={label} className="inline-flex size-10 items-center justify-center rounded-control text-slate-600 hover:bg-slate-100 hover:text-brand-700">
        <Icon className="size-5" aria-hidden />
      </Link>
    </Tooltip>
  );
}

function CourseCard({ course, badge, children, staff }: { course: Course; badge?: ReactNode; children?: ReactNode; staff?: boolean }) {
  const color = courseColor(course.id);
  const base = `/courses/${course.id}`;
  return (
    <article className="flex flex-col overflow-hidden rounded-panel border border-line bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-md">
      <Link to={base} tabIndex={-1} aria-hidden className="relative block h-28 bg-cover bg-center" style={{ backgroundColor: color, backgroundImage: course.imageUrl ? `linear-gradient(${color}cc, ${color}cc), url(${course.imageUrl})` : undefined }}>
        {badge && <span className="absolute right-2 top-2">{badge}</span>}
      </Link>
      <div className="flex flex-1 flex-col gap-1 px-4 pt-3">
        <h3 className="text-base font-semibold leading-snug">
          <Link to={base} className="hover:underline" style={{ color }}>
            {course.name}
          </Link>
        </h3>
        <p className="text-sm text-slate-600">{course.code}</p>
        <p className="text-xs text-slate-600">{course.termName ?? "No term"}</p>
        {children && <div className="mt-2 space-y-2">{children}</div>}
      </div>
      <nav aria-label={`${course.code} shortcuts`} className="mt-3 flex items-center gap-1 border-t border-line px-2 py-1">
        <CardLink to={`${base}/announcements`} icon={Megaphone} label={`${course.code} announcements`} />
        <CardLink to={`${base}/assignments`} icon={NotebookPen} label={`${course.code} assignments`} />
        <CardLink to={`${base}/discussions`} icon={MessagesSquare} label={`${course.code} discussions`} />
        <CardLink to={`${base}/files`} icon={FolderOpen} label={`${course.code} files`} />
        {staff && (
          <span className="ml-auto">
            <Menu trigger={<IconButton label={`${course.code} quick actions`}><EllipsisVertical className="size-4" /></IconButton>} label={`${course.code} quick actions`}>
              <MenuLabel>Create in {course.code}</MenuLabel>
              <MenuLinkItem to={`${base}/assignments/new`} icon={<Plus />}>New assignment</MenuLinkItem>
              <MenuLinkItem to={`${base}/modules?new=module`} icon={<Layers />}>New module</MenuLinkItem>
              <MenuLinkItem to={`${base}/announcements/new`} icon={<Megaphone />}>New announcement</MenuLinkItem>
              <MenuLinkItem to={`${base}/grades`} icon={<ClipboardCheck />}>Open gradebook</MenuLinkItem>
            </Menu>
          </span>
        )}
      </nav>
    </article>
  );
}

// ---------------------------------------------------------------- sidebar lists
function SidebarSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-1 flex items-center justify-between border-b border-line pb-1.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ItemIcon({ kind }: { kind: string }) {
  const Icon = kind === "quiz" ? FileQuestion : kind === "assignment" ? NotebookPen : CalendarClock;
  return <Icon className="mt-0.5 size-4 shrink-0 text-slate-600" aria-hidden />;
}

function UpcomingList({ items, showSubmitted, limit = 6 }: { items: (CalendarItem & { submitted?: boolean })[]; showSubmitted?: boolean; limit?: number }) {
  if (items.length === 0) return <p className="py-3 text-sm text-slate-600">Nothing in the next two weeks.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.slice(0, limit).map((i) => (
        <li key={`${i.kind}-${i.id}`} className="flex items-start gap-2.5 py-2.5">
          <ItemIcon kind={i.kind} />
          <div className="min-w-0 flex-1 text-sm">
            {i.link ? (
              <Link to={i.link} className="font-medium text-brand-700 hover:underline">
                {i.title}
              </Link>
            ) : (
              <span className="font-medium">{i.title}</span>
            )}
            <span className="block text-xs text-slate-600">
              {i.courseCode} · {formatDateTime(i.startAt)}
            </span>
          </div>
          {showSubmitted && i.kind !== "event" && (i.submitted ? <Badge tone="green">Submitted</Badge> : null)}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- page
export function DashboardPage() {
  const q = useApi<DashboardData>("/dashboard");
  const [view, setView] = usePref<View>("dashboardView", "cards");
  return (
    <PageContainer className="max-w-7xl">
      <Loadable query={q} label="Loading your dashboard…">
        {(d) => (
          <>
            <PageHeader
              title={`Welcome back, ${d.user.name.split(" ")[0]}`}
              description={view === "cards" ? "Your courses and what needs your attention." : "Everything coming up across your courses, by date."}
              actions={
                (d.learning || d.teaching) && (
                  <Menu trigger={<IconButton label="Dashboard options" size="md"><EllipsisVertical className="size-5" /></IconButton>} label="Dashboard options">
                    <MenuLabel>View</MenuLabel>
                    <MenuItem icon={<LayoutGrid />} onSelect={() => setView("cards")}>
                      Card view {view === "cards" && <span className="sr-only">(current)</span>}
                    </MenuItem>
                    <MenuItem icon={<List />} onSelect={() => setView("list")}>
                      List view {view === "list" && <span className="sr-only">(current)</span>}
                    </MenuItem>
                  </Menu>
                )
              }
            />
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
              <div className="min-w-0 space-y-10">
                {view === "list" && (d.learning || d.teaching) ? (
                  <AgendaView items={[...(d.learning?.upcoming ?? []), ...(d.teaching?.upcoming ?? [])]} />
                ) : (
                  <>
                    {d.teaching && <TeachingCards data={d.teaching} />}
                    {d.learning && <LearningCards data={d.learning} />}
                  </>
                )}
                {!d.admin && !d.teaching && !d.learning && (
                  <Card>
                    <EmptyState icon={<BookOpen className="size-6" />} title="You're not enrolled in any courses yet" description="When an administrator or instructor adds you to a course, it will appear here." />
                  </Card>
                )}
                {d.announcements.length > 0 && (
                  <section aria-labelledby="ann-h">
                    <h2 id="ann-h" className="mb-3 text-lg font-semibold">
                      Recent announcements
                    </h2>
                    <Card>
                      <ul className="divide-y divide-line">
                        {d.announcements.map((a) => (
                          <li key={a.id} className="px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                              <Megaphone className="size-3.5" aria-hidden /> {a.courseCode} · {relative(a.postedAt)}
                            </div>
                            <Link to={`/courses/${a.courseId}/announcements/${a.id}`} className="mt-1 block font-medium text-brand-700 hover:underline">
                              {a.title}
                            </Link>
                            <RichContent html={a.bodyHtml} className="mt-1 line-clamp-2 text-sm text-slate-600" />
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </section>
                )}
                {d.admin && <AdminSection data={d.admin} />}
              </div>
              {(d.learning || d.teaching) && (
                <aside aria-label="To do and upcoming" className="order-first space-y-8 lg:order-none">
                  {d.teaching && <TeachingSidebar data={d.teaching} />}
                  {d.learning && <LearningSidebar data={d.learning} />}
                </aside>
              )}
            </div>
          </>
        )}
      </Loadable>
    </PageContainer>
  );
}

function AgendaView({ items }: { items: (CalendarItem & { submitted?: boolean })[] }) {
  const sorted = [...items].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const byDay = new Map<string, typeof sorted>();
  for (const i of sorted) {
    const k = formatDate(i.startAt);
    byDay.set(k, [...(byDay.get(k) ?? []), i]);
  }
  if (!sorted.length) return <Card><EmptyState icon={<CalendarClock className="size-6" />} title="Nothing due in the next two weeks" /></Card>;
  return (
    <section aria-labelledby="agenda-h" className="space-y-4">
      <h2 id="agenda-h" className="text-lg font-semibold">
        Next 14 days
      </h2>
      {[...byDay.entries()].map(([day, list]) => (
        <Card key={day}>
          <h3 className="border-b border-line bg-slate-50 px-5 py-2 text-sm font-semibold">{day}</h3>
          <ul className="divide-y divide-line">
            {list.map((i) => (
              <li key={`${i.kind}-${i.id}`} className="flex items-start gap-3 px-5 py-3">
                <ItemIcon kind={i.kind} />
                <div className="min-w-0 flex-1 text-sm">
                  {i.link ? <Link to={i.link} className="font-medium text-brand-700 hover:underline">{i.title}</Link> : <span className="font-medium">{i.title}</span>}
                  <span className="block text-xs text-slate-600">
                    {i.courseCode} · {i.kind === "event" ? formatTime(i.startAt) : `Due ${formatTime(i.startAt)}`}
                  </span>
                </div>
                {i.kind !== "event" && i.submitted !== undefined && (i.submitted ? <Badge tone="green">Submitted</Badge> : <Badge tone="amber">To do</Badge>)}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </section>
  );
}

function LearningCards({ data }: { data: NonNullable<DashboardData["learning"]> }) {
  return (
    <section aria-labelledby="learning-h">
      <h2 id="learning-h" className="mb-3 text-lg font-semibold">
        My courses
      </h2>
      {data.courses.length === 0 ? (
        <Card><EmptyState icon={<BookOpen className="size-6" />} title="No current courses" /></Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {data.courses.map((c) => (
            <CourseCard key={c.id} course={c} badge={c.status === "archived" ? <Badge tone="gray">Concluded</Badge> : undefined}>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Progress</span>
                <span className="font-medium">{c.progressPercent === null ? "No requirements" : `${c.progressPercent}%`}</span>
              </div>
              <ProgressBar value={c.progressPercent} label={`${c.code} progress`} />
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Current grade</span>
                <span className="font-semibold">{c.currentScore === null ? "—" : `${c.currentGrade} (${formatPercent(c.currentScore)})`}</span>
              </div>
            </CourseCard>
          ))}
        </div>
      )}
    </section>
  );
}

function LearningSidebar({ data }: { data: NonNullable<DashboardData["learning"]> }) {
  return (
    <>
      <SidebarSection title="To do">
        {data.pending.length === 0 ? (
          <p className="flex items-center gap-2 py-3 text-sm text-slate-600">
            <CheckCircle2 className="size-4 text-emerald-700" aria-hidden /> You're all caught up.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.pending.map((p) => (
              <li key={p.id} className="flex items-start gap-2.5 py-2.5">
                <NotebookPen className="mt-0.5 size-4 shrink-0 text-slate-600" aria-hidden />
                <div className="min-w-0 flex-1 text-sm">
                  <Link to={p.link} className="font-medium text-brand-700 hover:underline">
                    {p.title}
                  </Link>
                  <span className="block text-xs text-slate-600">
                    {p.courseCode} · {formatPoints(p.pointsPossible)} pts · {p.dueAt ? formatDateTime(p.dueAt) : "No due date"}
                  </span>
                </div>
                {p.missing && <Badge tone="red">Missing</Badge>}
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>
      <SidebarSection title="Coming up" action={<Link to="/calendar" className="text-sm font-medium text-brand-700 hover:underline">View calendar</Link>}>
        <UpcomingList items={data.upcoming} showSubmitted />
      </SidebarSection>
      <SidebarSection title="Recent feedback">
        {data.recentGrades.length === 0 ? (
          <p className="py-3 text-sm text-slate-600">No grades released in the last 30 days.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.recentGrades.map((g) => (
              <li key={g.assignmentId} className="flex items-start gap-2.5 py-2.5 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Link to={g.link} className="font-medium text-brand-700 hover:underline">
                    {g.title}
                  </Link>
                  <span className="block text-xs text-slate-600">
                    {g.courseCode} · released {relative(g.postedAt)}
                  </span>
                </div>
                <span className="font-semibold whitespace-nowrap">{g.excused ? "Excused" : `${formatPoints(g.score)} / ${formatPoints(g.pointsPossible)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>
    </>
  );
}

function TeachingCards({ data }: { data: NonNullable<DashboardData["teaching"]> }) {
  return (
    <section aria-labelledby="teaching-h">
      <h2 id="teaching-h" className="mb-3 text-lg font-semibold">
        Courses I teach
      </h2>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {data.courses.map((c) => (
          <CourseCard key={c.id} course={c} staff badge={c.needsGradingCount > 0 ? <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-900 shadow">{c.needsGradingCount} to grade</span> : undefined}>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={c.status === "published" ? "green" : c.status === "archived" ? "gray" : "amber"}>{c.status}</Badge>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center text-xs text-slate-600">
              <div>
                <dt>Students</dt>
                <dd className="text-sm font-semibold text-slate-900">{c.studentCount}</dd>
              </div>
              <div>
                <dt>Avg progress</dt>
                <dd className="text-sm font-semibold text-slate-900">{formatPercent(c.averageProgress)}</dd>
              </div>
              <div>
                <dt>Avg score</dt>
                <dd className="text-sm font-semibold text-slate-900">{formatPercent(c.averageCurrentScore)}</dd>
              </div>
            </dl>
          </CourseCard>
        ))}
      </div>
    </section>
  );
}

function TeachingSidebar({ data }: { data: NonNullable<DashboardData["teaching"]> }) {
  return (
    <>
      <SidebarSection title="To grade">
        {data.needsGrading.length === 0 ? (
          <p className="flex items-center gap-2 py-3 text-sm text-slate-600">
            <ClipboardCheck className="size-4 text-emerald-700" aria-hidden /> Nothing waiting to be graded.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.needsGrading.map((g) => (
              <li key={`${g.assignmentId}-${g.studentName}`} className="flex gap-2.5 py-2.5 text-sm">
                <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-slate-600" aria-hidden />
                <div className="min-w-0">
                  <Link to={g.link} className="font-medium text-brand-700 hover:underline">
                    Grade {g.title}
                  </Link>
                  <span className="block text-xs text-slate-600">
                    {g.studentName} · {g.courseCode} · submitted {relative(g.submittedAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SidebarSection>
      {data.recentSubmissions.length > 0 && (
        <SidebarSection title="Recent submissions">
          <ul className="divide-y divide-line">
            {data.recentSubmissions.slice(0, 5).map((s) => (
              <li key={`${s.assignmentId}-${s.studentName}-${s.submittedAt}`} className="py-2.5 text-sm">
                <Link to={s.link} className="font-medium text-brand-700 hover:underline">
                  {s.title}
                </Link>
                <span className="block text-xs text-slate-600">
                  {s.studentName} · {s.courseCode} · {relative(s.submittedAt)}
                </span>
              </li>
            ))}
          </ul>
        </SidebarSection>
      )}
      <SidebarSection title="Coming up" action={<Link to="/calendar" className="text-sm font-medium text-brand-700 hover:underline">View calendar</Link>}>
        <UpcomingList items={data.upcoming} />
      </SidebarSection>
    </>
  );
}

function AdminSection({ data }: { data: NonNullable<DashboardData["admin"]> }) {
  return (
    <section aria-labelledby="admin-h" className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 id="admin-h" className="text-lg font-semibold">
          Platform overview
        </h2>
        <Link to="/admin" className="text-sm font-medium text-brand-700 hover:underline">
          Administration
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Users" value={sum(data.users.byRole)} hint={`${data.users.byRole.student ?? 0} students · ${data.users.byRole.instructor ?? 0} instructors`} icon={<Users className="size-4" />} />
        <StatCard label="Active (7 days)" value={data.users.activeLast7Days} hint={`${data.users.byStatus.pending ?? 0} pending activation`} />
        <StatCard label="Courses" value={sum(data.courses.byStatus)} hint={`${data.courses.byStatus.published ?? 0} published · ${data.courses.byStatus.unpublished ?? 0} drafts`} icon={<BookOpen className="size-4" />} />
        <StatCard label="Active enrollments" value={sum(data.enrollments.byRole)} hint={`${data.enrollments.byRole.student ?? 0} student enrollments`} />
      </div>
      <Card>
        <CardHeader title="Completion by published course" />
        {data.completion.length === 0 ? (
          <EmptyState icon={<AlertCircle className="size-6" />} title="No published courses yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Term</th>
                <th className="text-right">Students</th>
                <th className="text-right">Avg progress</th>
                <th className="text-right">Completed</th>
                <th className="text-right">Avg score</th>
              </tr>
            </thead>
            <tbody>
              {data.completion.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/courses/${c.id}/stats`} className="font-medium text-brand-700 hover:underline">
                      {c.code}
                    </Link>{" "}
                    <span className="text-slate-600">{c.name}</span>
                  </td>
                  <td>{c.termName ?? "—"}</td>
                  <td className="text-right">{c.studentCount}</td>
                  <td className="text-right">{formatPercent(c.averageProgress)}</td>
                  <td className="text-right">{c.completedCount}</td>
                  <td className="text-right">{formatPercent(c.averageCurrentScore)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title="Recent administrative activity" actions={<Link to="/admin/audit" className="text-sm font-medium text-brand-700 hover:underline">Audit log</Link>} />
        <ul className={clsx("divide-y divide-line")}>
          {data.recentAudit.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
              <span>
                <span className="font-medium">{e.actorName ?? "System"}</span> <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{e.action}</code>
              </span>
              <span className="text-xs text-slate-600">{relative(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
