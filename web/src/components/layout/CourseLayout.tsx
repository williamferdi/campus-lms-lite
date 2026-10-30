import clsx from "clsx";
import { ChevronRight, Menu } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router";
import type { Course, CoursePermissions } from "../../lib/types";
import { useApi } from "../../lib/query";
import { courseColor, useMediaQuery, usePref } from "../../lib/ui-prefs";
import { Badge, ErrorState, LoadingState, Sheet } from "../ui";
import { Tooltip } from "../ui/tooltip";
import { PageContainer, useShell, type CourseNavLink } from "./AppShell";

interface CourseCtx {
  course: Course;
  permissions: CoursePermissions;
  base: string;
}
const CourseContext = createContext<CourseCtx | null>(null);

export function useCourse(): CourseCtx {
  const ctx = useContext(CourseContext);
  if (!ctx) throw new Error("useCourse must be used inside CourseLayout");
  return ctx;
}

export const statusTone = (s: string) => (s === "published" ? "green" : s === "archived" ? "gray" : "amber");

export function courseLinks(course: Course, permissions: CoursePermissions): CourseNavLink[] {
  const base = `/courses/${course.id}`;
  const all: (CourseNavLink & { show: boolean })[] = [
    { to: base, label: "Home", show: true, end: true },
    { to: `${base}/announcements`, label: "Announcements", show: true },
    { to: `${base}/modules`, label: "Modules", show: true },
    { to: `${base}/assignments`, label: "Assignments", show: true },
    { to: `${base}/quizzes`, label: "Quizzes", show: true },
    { to: `${base}/discussions`, label: "Discussions", show: true },
    { to: `${base}/grades`, label: permissions.canGrade ? "Gradebook" : "Grades", show: permissions.canGrade || permissions.role === "student" },
    { to: `${base}/people`, label: "People", show: true },
    { to: `${base}/pages`, label: "Pages", show: true },
    { to: `${base}/files`, label: "Files", show: true },
    { to: `${base}/syllabus`, label: "Syllabus", show: true },
    { to: `${base}/stats`, label: "Progress", show: permissions.isStaff },
    { to: `${base}/settings`, label: "Settings", show: permissions.canManage },
  ];
  return all.filter((l) => l.show).map(({ show: _s, ...l }) => l);
}

function CourseNav({ links, onNavigate }: { links: CourseNavLink[]; onNavigate?: () => void }) {
  return (
    <nav aria-label="Course">
      <ul className="space-y-0.5">
        {links.map((l) => (
          <li key={l.to}>
            <NavLink
              to={l.to}
              end={l.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                clsx(
                  "flex min-h-10 items-center border-l-[3px] px-3 text-sm transition-colors",
                  isActive ? "border-slate-900 font-semibold text-slate-900" : "border-transparent text-brand-700 hover:border-brand-300 hover:underline",
                )
              }
            >
              {l.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function CourseLayout() {
  const { courseId } = useParams();
  const q = useApi<{ course: Course; permissions: CoursePermissions }>(`/courses/${courseId}`);
  if (q.isPending) return <LoadingState label="Loading course…" />;
  if (q.isError)
    return (
      <PageContainer>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </PageContainer>
    );
  return <CourseFrame course={q.data.course} permissions={q.data.permissions} />;
}

function CourseFrame({ course, permissions }: { course: Course; permissions: CoursePermissions }) {
  const { setCourseNav } = useShell();
  const { pathname } = useLocation();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [hidden, setHidden] = usePref<boolean>("courseNavHidden", false);
  const [sheet, setSheet] = useState(false);
  const base = `/courses/${course.id}`;
  const links = useMemo(() => courseLinks(course, permissions), [course, permissions]);

  useEffect(() => {
    setCourseNav({ title: course.code, links });
    return () => setCourseNav(null);
  }, [course.code, links, setCourseNav]);
  useEffect(() => setSheet(false), [pathname]);

  const section = links.filter((l) => !l.end && pathname.startsWith(l.to)).sort((a, b) => b.to.length - a.to.length)[0];
  const navVisible = wide ? !hidden : sheet;
  const toggleLabel = navVisible ? "Hide course navigation" : "Show course navigation";

  return (
    <CourseContext.Provider value={{ course, permissions, base }}>
      <div data-course-code={course.code}>
        <div className="sticky top-14 z-20 flex h-14 items-center gap-2 border-b border-line bg-white px-2 md:top-0 sm:px-4">
          <Tooltip label={toggleLabel}>
            <button
              type="button"
              onClick={() => (wide ? setHidden(!hidden) : setSheet(true))}
              aria-label={toggleLabel}
              aria-expanded={navVisible}
              // Phones reach course links through the main menu drawer, so the toggle starts at tablet width.
              className="hidden size-10 shrink-0 items-center justify-center rounded-control hover:bg-slate-100 md:inline-flex"
              style={{ color: courseColor(course.id) }}
            >
              <Menu className="size-6" aria-hidden />
            </button>
          </Tooltip>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-1 text-sm">
              <li className="min-w-0 truncate">
                {section ? (
                  <Link to={base} className="text-brand-700 hover:underline">
                    {course.code}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-slate-700">
                    {course.code}
                  </span>
                )}
              </li>
              {section && (
                <li className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
                  {pathname === section.to ? (
                    <span aria-current="page" className="truncate text-slate-700">
                      {section.label}
                    </span>
                  ) : (
                    <Link to={section.to} className="truncate text-brand-700 hover:underline">
                      {section.label}
                    </Link>
                  )}
                </li>
              )}
            </ol>
          </nav>
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            {permissions.isStaff && <Badge tone={statusTone(course.status)}>{course.status}</Badge>}
            {permissions.readOnly && <Badge tone="gray">Read-only</Badge>}
          </div>
        </div>
        <div className="flex">
          {wide && !hidden && (
            <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-52 shrink-0 overflow-y-auto py-4 pl-2 lg:block">
              {course.termName && <p className="mb-2 truncate px-3 text-xs text-slate-600">{course.termName}</p>}
              <CourseNav links={links} />
            </aside>
          )}
          <div className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
              <div className="mb-5">
                <h1 className="text-xl font-semibold tracking-tight text-slate-900">{course.name}</h1>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-slate-600">
                  <span>{course.code}</span>
                  {course.termName && <span>· {course.termName}</span>}
                  {permissions.isStaff && (
                    <span className="sm:hidden">
                      <Badge tone={statusTone(course.status)}>{course.status}</Badge>
                    </span>
                  )}
                </p>
              </div>
              <Outlet />
            </div>
          </div>
        </div>
        {!wide && (
          <Sheet open={sheet} onOpenChange={setSheet} title={course.code} description={course.name}>
            <div className="py-3 pr-2">
              <CourseNav links={links} onNavigate={() => setSheet(false)} />
            </div>
          </Sheet>
        )}
      </div>
    </CourseContext.Provider>
  );
}
