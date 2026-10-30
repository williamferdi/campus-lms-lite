import { BookOpen, Clock3, LogOut, Settings, Inbox, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { useUser } from "../../lib/auth";
import { roleLabel, relative } from "../../lib/format";
import { clearHistory, useHistoryEntries } from "../../lib/history";
import { useApi } from "../../lib/query";
import type { Course, Paged } from "../../lib/types";
import { courseColor, initials } from "../../lib/ui-prefs";
import { Button, EmptyState, Loadable, Sheet } from "../ui";

export type TrayName = "account" | "courses" | "history" | "help";

interface TrayProps {
  open: boolean;
  onClose: () => void;
}

const trayLink = "flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 hover:underline";

export function AccountTray({ open, onClose, onSignOut }: TrayProps & { onSignOut: () => void }) {
  const user = useUser();
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title="Account" offsetLeft>
      <div className="flex flex-col items-center gap-2 border-b border-line px-5 py-6 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-rail text-xl font-bold text-white" aria-hidden>
          {initials(user.name)}
        </span>
        <p className="text-lg font-semibold">{user.name}</p>
        <p className="text-sm text-slate-600">{user.email}</p>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{roleLabel(user.role)}</p>
        <Button variant="secondary" size="sm" className="mt-2" icon={<LogOut className="size-4" />} onClick={onSignOut}>
          Sign out
        </Button>
      </div>
      <ul className="space-y-0.5 px-2 py-3">
        <li>
          <Link to="/account" className={trayLink} onClick={onClose}>
            <Settings className="size-4" aria-hidden /> Profile and settings
          </Link>
        </li>
        <li>
          <Link to="/inbox" className={trayLink} onClick={onClose}>
            <Inbox className="size-4" aria-hidden /> Notifications
          </Link>
        </li>
      </ul>
    </Sheet>
  );
}

export function CoursesTray({ open, onClose }: TrayProps) {
  const q = useApi<Paged<Course>>(open ? "/courses?scope=mine&perPage=50" : null);
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title="Courses" offsetLeft>
      <div className="px-2 py-3">
        <Loadable query={q} label="Loading courses…">
          {(d) => {
            const current = d.data.filter((c) => c.status !== "archived");
            return current.length === 0 ? (
              <EmptyState icon={<BookOpen className="size-6" />} title="No current courses" description="Courses you teach or take will be listed here." />
            ) : (
              <ul className="space-y-0.5">
                {current.map((c) => (
                  <li key={c.id}>
                    <Link to={`/courses/${c.id}`} onClick={onClose} className="flex items-start gap-3 rounded-control px-3 py-2.5 hover:bg-brand-50">
                      <span className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: courseColor(c.id) }} aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-brand-700 hover:underline">{c.name}</span>
                        <span className="block text-xs text-slate-500">
                          {c.code}
                          {c.termName && ` · ${c.termName}`}
                          {c.status === "unpublished" && " · Unpublished"}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            );
          }}
        </Loadable>
        <div className="mt-3 border-t border-line px-3 pt-3">
          <Link to="/courses" onClick={onClose} className="text-sm font-semibold text-brand-700 hover:underline">
            All courses
          </Link>
        </div>
      </div>
    </Sheet>
  );
}

export function HistoryTray({ open, onClose }: TrayProps) {
  const entries = useHistoryEntries();
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title="Recent history" description="Pages you opened on this device in the last 3 weeks." offsetLeft>
      {entries.length === 0 ? (
        <EmptyState icon={<Clock3 className="size-6" />} title="No recent pages yet" description="Pages you open will appear here." />
      ) : (
        <div className="px-2 py-3">
          <ul className="space-y-0.5">
            {entries.map((e) => (
              <li key={e.path}>
                <Link to={e.path} onClick={onClose} className="block rounded-control px-3 py-2 hover:bg-brand-50">
                  <span className="block truncate text-sm font-medium text-brand-700">{e.title}</span>
                  <span className="block text-xs text-slate-500">
                    {e.context ? `${e.context} · ` : ""}
                    {relative(e.visitedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-line px-3 pt-3">
            <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={clearHistory}>
              Clear history
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

const HELP: Record<"student" | "staff" | "admin", { q: string; a: string }[]> = {
  student: [
    { q: "Find what's due", a: "Your Dashboard lists To Do items and the next 14 days. Calendar shows every due date." },
    { q: "Submit an assignment", a: "Open the assignment from Modules or Assignments, choose a submission type, then select Submit assignment." },
    { q: "See grades and feedback", a: "Open a course, then Grades. Only grades your instructor has released are shown." },
    { q: "Locked content", a: "A lock means a prerequisite module or an unlock date applies. The module header says which." },
  ],
  staff: [
    { q: "Build content", a: "In a course, open Modules and select + Module, then Add item to link pages, assignments, quizzes and files." },
    { q: "Grade work", a: "Use To Grade on the Dashboard, or open an assignment and select Grade submissions." },
    { q: "Release grades", a: "Grades stay hidden until you select Release grades on the grading page or in the Gradebook." },
    { q: "Publish a course", a: "Students only see published courses. Use Settings → Publish." },
  ],
  admin: [
    { q: "Create accounts", a: "Admin → Users → New user, or import a CSV with name,email,role." },
    { q: "Enroll people", a: "Open the course, then People → Add people. CSV import is also available." },
    { q: "Audit changes", a: "Admin → Audit log lists account, enrollment, grade and publishing changes." },
  ],
};

export function HelpTray({ open, onClose }: TrayProps) {
  const user = useUser();
  const topics = user.role === "student" ? HELP.student : user.role === "admin" ? [...HELP.admin, ...HELP.staff] : HELP.staff;
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title="Help" offsetLeft>
      <div className="space-y-5 px-5 py-4 text-sm">
        <section aria-labelledby="help-quick">
          <h3 id="help-quick" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Quick answers
          </h3>
          <dl className="space-y-3">
            {topics.map((t) => (
              <div key={t.q}>
                <dt className="font-semibold text-slate-900">{t.q}</dt>
                <dd className="text-slate-600">{t.a}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="help-kb" className="border-t border-line pt-4">
          <h3 id="help-kb" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Keyboard
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-slate-600">
            <li>Press Tab on any page to reveal Skip to content.</li>
            <li>Esc closes trays, menus and dialogs.</li>
            <li>Arrow keys move between tabs and menu items.</li>
          </ul>
        </section>
        <section aria-labelledby="help-contact" className="border-t border-line pt-4">
          <h3 id="help-contact" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Still stuck?
          </h3>
          <p className="text-slate-600">For course content, contact your instructor. For sign-in or enrollment problems, contact your institution's LMS administrator.</p>
        </section>
      </div>
    </Sheet>
  );
}
