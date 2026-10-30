import clsx from "clsx";
import {
  BookOpen,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  GraduationCap,
  CircleHelp,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth, useUser } from "../../lib/auth";
import { recordVisit } from "../../lib/history";
import { useApi } from "../../lib/query";
import { initials, usePref } from "../../lib/ui-prefs";
import { Sheet } from "../ui";
import { Tooltip } from "../ui/tooltip";
import { AccountTray, CoursesTray, HelpTray, HistoryTray, type TrayName } from "./Trays";

// ---------------------------------------------------------------- shell context
export interface CourseNavLink {
  to: string;
  label: string;
  end?: boolean;
}
interface ShellCtx {
  openTray(t: TrayName): void;
  /** CourseLayout publishes its links so the mobile drawer can show them. */
  setCourseNav(nav: { title: string; links: CourseNavLink[] } | null): void;
}
const ShellContext = createContext<ShellCtx | null>(null);
export const useShell = () => {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside AppShell");
  return ctx;
};

function useSignOut() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return async () => {
    // Leave protected routes first so the next sign-in starts fresh on the dashboard.
    navigate("/login", { replace: true });
    await logout();
  };
}

/** Sets document.title from the page's first <h1> and records the visit for the History tray. */
function usePageTracking() {
  const location = useLocation();
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    let timer = 0;
    const capture = () => {
      const headings = Array.from(main.querySelectorAll("h1")).map((h) => h.textContent?.trim() ?? "").filter(Boolean);
      if (!headings.length) return;
      const course = main.querySelector<HTMLElement>("[data-course-code]")?.dataset.courseCode ?? null;
      const title = headings[headings.length - 1]!;
      document.title = `${title} · Campus LMS Lite`;
      recordVisit({ path: location.pathname, title, context: course });
    };
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(capture, 250);
    });
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    timer = window.setTimeout(capture, 250);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [location.pathname]);
}

// ---------------------------------------------------------------- global rail
function RailItem({ icon: Icon, label, to, end, onClick, active, collapsed, badge }: { icon: LucideIcon; label: string; to?: string; end?: boolean; onClick?: () => void; active?: boolean; collapsed: boolean; badge?: number }) {
  const cls = (isActive: boolean) =>
    clsx(
      "relative flex w-full flex-col items-center justify-center gap-1 rounded-none text-[11px] font-medium leading-tight transition-colors",
      collapsed ? "h-12" : "min-h-[4.25rem] px-1 py-2",
      isActive ? "bg-rail-active text-rail-active-text" : "text-rail-text hover:bg-rail-hover hover:text-white",
    );
  const content = (
    <>
      <span className="relative">
        <Icon className="size-6" aria-hidden strokeWidth={1.75} />
        {!!badge && (
          <span className="absolute -right-2.5 -top-1.5 min-w-5 rounded-full bg-accent-400 px-1 text-center text-[10px] font-bold leading-4 text-slate-900" aria-hidden>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      <span className={clsx(collapsed && "sr-only")}>{label}</span>
      {!!badge && <span className="sr-only">, {badge} unread</span>}
    </>
  );
  const el = to ? (
    <NavLink to={to} end={end} className={({ isActive }) => cls(isActive || !!active)}>
      {content}
    </NavLink>
  ) : (
    <button type="button" onClick={onClick} aria-haspopup="dialog" aria-expanded={active} className={cls(!!active)}>
      {content}
    </button>
  );
  return (
    <li>
      <Tooltip label={label} side="right" disabled={!collapsed}>
        {el}
      </Tooltip>
    </li>
  );
}

function GlobalRail({ tray, openTray, unread, collapsed, setCollapsed }: { tray: TrayName | null; openTray: (t: TrayName) => void; unread: number; collapsed: boolean; setCollapsed: (v: boolean) => void }) {
  const user = useUser();
  const { pathname } = useLocation();
  const inCourse = pathname.startsWith("/courses");
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--rail-width)] flex-col bg-rail md:flex">
      <Link to="/" className="flex h-16 shrink-0 items-center justify-center text-white hover:bg-rail-hover" aria-label="Campus LMS Lite, go to dashboard">
        <GraduationCap className="size-8" aria-hidden strokeWidth={1.75} />
      </Link>
      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto">
        <ul>
          <li>
            <Tooltip label="Account" side="right" disabled={!collapsed}>
              <button
                type="button"
                onClick={() => openTray("account")}
                aria-haspopup="dialog"
                aria-expanded={tray === "account"}
                className={clsx(
                  "flex w-full flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  collapsed ? "h-12" : "min-h-[4.25rem] py-2",
                  tray === "account" ? "bg-rail-active text-rail-active-text" : "text-rail-text hover:bg-rail-hover hover:text-white",
                )}
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-white text-xs font-bold text-rail" aria-hidden>
                  {initials(user.name)}
                </span>
                <span className={clsx(collapsed && "sr-only")}>Account</span>
              </button>
            </Tooltip>
          </li>
          {user.role === "admin" && <RailItem icon={Shield} label="Admin" to="/admin" collapsed={collapsed} />}
          <RailItem icon={LayoutDashboard} label="Dashboard" to="/" end collapsed={collapsed} />
          <RailItem icon={BookOpen} label="Courses" onClick={() => openTray("courses")} active={tray === "courses" || (tray === null && inCourse)} collapsed={collapsed} />
          <RailItem icon={CalendarDays} label="Calendar" to="/calendar" collapsed={collapsed} />
          <RailItem icon={Inbox} label="Inbox" to="/inbox" collapsed={collapsed} badge={unread} />
          <RailItem icon={Clock3} label="History" onClick={() => openTray("history")} active={tray === "history"} collapsed={collapsed} />
          <RailItem icon={CircleHelp} label="Help" onClick={() => openTray("help")} active={tray === "help"} collapsed={collapsed} />
        </ul>
      </nav>
      <Tooltip label={collapsed ? "Expand navigation" : "Collapse navigation"} side="right">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-pressed={collapsed}
          className="flex h-12 shrink-0 items-center justify-center border-t border-white/10 text-rail-text hover:bg-rail-hover hover:text-white"
        >
          {collapsed ? <ChevronsRight className="size-5" aria-hidden /> : <ChevronsLeft className="size-5" aria-hidden />}
        </button>
      </Tooltip>
    </aside>
  );
}

// ---------------------------------------------------------------- mobile
function DrawerLink({ to, icon: Icon, label, end, badge }: { to: string; icon?: LucideIcon; label: string; end?: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx("flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-medium", isActive ? "bg-brand-50 text-brand-800" : "text-slate-800 hover:bg-slate-100")
      }
    >
      {Icon && <Icon className="size-5 text-slate-500" aria-hidden />}
      <span className="flex-1">{label}</span>
      {!!badge && <span className="rounded-full bg-brand-700 px-1.5 text-xs font-semibold text-white">{badge} <span className="sr-only">unread</span></span>}
    </NavLink>
  );
}

function DrawerButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-100">
      <Icon className="size-5 text-slate-500" aria-hidden />
      {label}
    </button>
  );
}

function MobileDrawer({ open, onOpenChange, unread, courseNav, openTray }: { open: boolean; onOpenChange: (v: boolean) => void; unread: number; courseNav: { title: string; links: CourseNavLink[] } | null; openTray: (t: TrayName) => void }) {
  const user = useUser();
  const signOut = useSignOut();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Menu" description={`${user.name}`}>
      <div className="space-y-5 px-3 py-4">
        <nav aria-label="Main">
          <ul className="space-y-0.5">
            <li><DrawerLink to="/" end icon={LayoutDashboard} label="Dashboard" /></li>
            <li><DrawerLink to="/courses" end icon={BookOpen} label="Courses" /></li>
            <li><DrawerLink to="/calendar" icon={CalendarDays} label="Calendar" /></li>
            <li><DrawerLink to="/inbox" icon={Inbox} label="Inbox" badge={unread} /></li>
            {user.role === "admin" && <li><DrawerLink to="/admin" icon={Shield} label="Admin" /></li>}
            <li><DrawerButton icon={Clock3} label="History" onClick={() => openTray("history")} /></li>
            <li><DrawerButton icon={CircleHelp} label="Help" onClick={() => openTray("help")} /></li>
          </ul>
        </nav>
        {courseNav && (
          <nav aria-label="Course" className="border-t border-line pt-4">
            <p className="mb-1 truncate px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{courseNav.title}</p>
            <ul className="space-y-0.5">
              {courseNav.links.map((l) => (
                <li key={l.to}><DrawerLink to={l.to} end={l.end} label={l.label} /></li>
              ))}
            </ul>
          </nav>
        )}
        <div className="space-y-0.5 border-t border-line pt-4">
          <DrawerLink to="/account" icon={Settings} label="Account settings" />
          <DrawerButton icon={LogOut} label="Sign out" onClick={() => void signOut()} />
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- shell
export function AppShell() {
  const user = useUser();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [tray, setTray] = useState<TrayName | null>(null);
  const [courseNav, setCourseNav] = useState<{ title: string; links: CourseNavLink[] } | null>(null);
  const [collapsed, setCollapsed] = usePref<boolean>("railCollapsed", false);
  const unread = useApi<{ count: number }>("/notifications/unread-count", { refetchInterval: 60_000 }).data?.count ?? 0;
  const signOut = useSignOut();
  usePageTracking();

  useEffect(() => {
    setDrawer(false);
    setTray(null);
  }, [location.pathname]);

  const ctx = useMemo<ShellCtx>(
    () => ({
      openTray: (t) => {
        setDrawer(false);
        setTray(t);
      },
      setCourseNav,
    }),
    [],
  );

  return (
    <ShellContext.Provider value={ctx}>
      <div className="min-h-dvh" style={{ ["--rail-width" as string]: collapsed ? "3.5rem" : "5.25rem" }}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-control focus:bg-white focus:px-4 focus:py-2 focus:shadow">
          Skip to content
        </a>
        <GlobalRail tray={tray} openTray={ctx.openTray} unread={unread} collapsed={collapsed} setCollapsed={setCollapsed} />
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-rail px-2 text-white md:hidden">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} className="inline-flex size-11 items-center justify-center rounded-control hover:bg-rail-hover">
            <Menu className="size-6" aria-hidden />
          </button>
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
            <GraduationCap className="size-6 shrink-0" aria-hidden />
            <span className="truncate">{courseNav?.title ?? "Campus LMS Lite"}</span>
          </Link>
          <Link to="/inbox" className="relative inline-flex size-11 items-center justify-center rounded-control hover:bg-rail-hover" aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}>
            <Inbox className="size-6" aria-hidden />
            {!!unread && <span className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-accent-400" aria-hidden />}
          </Link>
          <button type="button" onClick={() => setTray("account")} aria-label="Account" className="inline-flex size-11 items-center justify-center">
            <span className="flex size-8 items-center justify-center rounded-full bg-white text-xs font-bold text-rail" aria-hidden>
              {initials(user.name)}
            </span>
          </button>
        </header>
        <MobileDrawer open={drawer} onOpenChange={setDrawer} unread={unread} courseNav={courseNav} openTray={ctx.openTray} />
        <AccountTray open={tray === "account"} onClose={() => setTray(null)} onSignOut={signOut} />
        <CoursesTray open={tray === "courses"} onClose={() => setTray(null)} />
        <HistoryTray open={tray === "history"} onClose={() => setTray(null)} />
        <HelpTray open={tray === "help"} onClose={() => setTray(null)} />
        <main id="main" tabIndex={-1} className="min-w-0 outline-none md:pl-[var(--rail-width)]">
          <Outlet />
        </main>
      </div>
    </ShellContext.Provider>
  );
}

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8", className)}>{children}</div>;
}
