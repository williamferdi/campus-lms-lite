import { ExternalLink } from "lucide-react";
import { useEffect } from "react";
import { useParams } from "react-router";
import { useCourse } from "../../components/layout/CourseLayout";
import { Card, EmptyState, ErrorState, LoadingState } from "../../components/ui";
import { api } from "../../lib/api";
import { useApi, useInvalidate } from "../../lib/query";
import type { ModulesResponse } from "../../lib/types";
import { ModuleNav } from "./ModuleNav";

/** External link / embedded video module item. Opening it records a view. */
export function ModuleItemPage() {
  const { itemId } = useParams();
  const { course, permissions } = useCourse();
  const invalidate = useInvalidate();
  const q = useApi<ModulesResponse>(`/courses/${course.id}/modules`);
  const item = q.data?.modules.flatMap((m) => m.items).find((i) => i.id === itemId);

  useEffect(() => {
    if (!item || item.locked || permissions.isStaff) return;
    void api.post(`/module-items/${item.id}/view`).then(() => invalidate(`/courses/${course.id}/modules`, `/courses/${course.id}/module-nav`)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} />;
  if (!item) return <EmptyState title="This item is not available" description="It may be unpublished or locked." />;
  if (item.locked) return <EmptyState title="This item is locked" description="Complete the earlier requirements in this module first." />;

  return (
    <article>
      <h1 className="mb-4 text-2xl font-semibold">{item.title}</h1>
      {item.embedUrl ? (
        <div className="overflow-hidden rounded-xl bg-black shadow">
          <iframe src={item.embedUrl} title={item.title} className="aspect-video w-full" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />
        </div>
      ) : (
        <Card className="p-6">
          <p className="text-sm text-slate-600">This item links to an external website.</p>
          <a href={item.url ?? "#"} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 font-medium text-brand-700 hover:underline">
            Open {item.url} <ExternalLink className="size-4" aria-hidden />
          </a>
        </Card>
      )}
      <ModuleNav itemId={item.id} />
    </article>
  );
}
