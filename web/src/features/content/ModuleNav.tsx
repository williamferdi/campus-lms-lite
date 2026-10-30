import { ArrowLeft, ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { Link } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { useFeedback } from "../../components/ui/feedback";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";
import { useApi, useInvalidate } from "../../lib/query";
import type { ModuleItem, NavEntry } from "../../lib/types";

/** Where a module item opens. Files open through the authorized download endpoint. */
export function itemHref(base: string, item: Pick<ModuleItem, "id" | "type" | "refId">): { to: string; external: boolean } {
  switch (item.type) {
    case "page":
      return { to: `${base}/pages/${item.refId}`, external: false };
    case "assignment":
      return { to: `${base}/assignments/${item.refId}`, external: false };
    case "quiz":
      return { to: `${base}/quizzes/${item.refId}`, external: false };
    case "discussion":
      return { to: `${base}/discussions/${item.refId}`, external: false };
    case "file":
      return { to: `/api/v1/files/${item.refId}/download`, external: true };
    default:
      return { to: `${base}/modules/items/${item.id}`, external: false };
  }
}

function NavLinkTo({ entry, dir }: { entry: NavEntry; dir: "prev" | "next" }) {
  const { base } = useCourse();
  const href = itemHref(base, entry);
  const label = (
    <>
      {dir === "prev" && <ArrowLeft className="size-4 shrink-0" aria-hidden />}
      <span className="min-w-0">
        <span className="block text-xs text-slate-500">{dir === "prev" ? "Previous" : "Next"}</span>
        <span className="block truncate font-medium">{entry.title}</span>
      </span>
      {dir === "next" && <ArrowRight className="size-4 shrink-0" aria-hidden />}
    </>
  );
  const cls = `flex max-w-[48%] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm hover:border-brand-300 ${dir === "next" ? "ml-auto text-right" : ""}`;
  if (entry.locked) return <span className={`${cls} cursor-not-allowed opacity-60`} title="Locked until earlier requirements are complete">{label}</span>;
  return href.external ? (
    <a href={href.to} target="_blank" rel="noreferrer" className={cls}>
      {label}
    </a>
  ) : (
    <Link to={href.to} className={cls}>
      {label}
    </Link>
  );
}

/** Previous/next footer for content opened from modules, with "mark as done" when required. */
export function ModuleNav({ refId, itemId }: { refId?: string; itemId?: string }) {
  const { course, permissions } = useCourse();
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const url = `/courses/${course.id}/module-nav?${itemId ? `itemId=${itemId}` : `refId=${refId}`}`;
  const q = useApi<{ current: NavEntry | null; prev: NavEntry | null; next: NavEntry | null }>(url);
  if (!q.data?.current) return null;
  const { current, prev, next } = q.data;
  const toggleDone = async () => {
    try {
      await api.post(`/module-items/${current.id}/done`, { done: !current.completed });
      await invalidate(url, `/courses/${course.id}/modules`, `/courses/${course.id}/module-nav`);
    } catch (err) {
      fb.error(err);
    }
  };
  return (
    <nav aria-label="Module navigation" className="mt-8 space-y-3 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>Module: {current.moduleTitle}</span>
        {permissions.role === "student" && current.requirement === "must_mark_done" && (
          <Button size="sm" variant={current.completed ? "subtle" : "secondary"} onClick={() => void toggleDone()} icon={current.completed ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}>
            {current.completed ? "Marked as done" : "Mark as done"}
          </Button>
        )}
      </div>
      <div className="flex gap-3">
        {prev && <NavLinkTo entry={prev} dir="prev" />}
        {next && <NavLinkTo entry={next} dir="next" />}
      </div>
    </nav>
  );
}
