import clsx from "clsx";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { PageContainer } from "../../components/layout/AppShell";
import { useFeedback } from "../../components/ui/feedback";
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, FormError, IconButton, Loadable, PageHeader, SelectField, TextAreaField, TextField } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDate, formatTime, fromLocalInput, toLocalInput } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { CalendarItem } from "../../lib/types";

interface CalendarResponse {
  data: CalendarItem[];
  courses: { id: string; code: string; name: string; isStaff: boolean }[];
}

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const kindTone = { assignment: "bg-brand-100 text-brand-900", quiz: "bg-violet-100 text-violet-900", event: "bg-amber-100 text-amber-900" } as const;

export function CalendarPage() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [courseFilter, setCourseFilter] = useState("");
  const [creating, setCreating] = useState<Date | null>(null);
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const gridStart = useMemo(() => {
    const s = new Date(month);
    s.setDate(1 - s.getDay());
    return s;
  }, [month]);
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 42);
  const url = `/calendar?start=${encodeURIComponent(gridStart.toISOString())}&end=${encodeURIComponent(gridEnd.toISOString())}${courseFilter ? `&courseId=${courseFilter}` : ""}`;
  const q = useApi<CalendarResponse>(url, { placeholderData: (p) => p });
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  const today = new Date();
  const label = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <PageContainer>
      <PageHeader title="Calendar" description="Due dates and events from all your courses." actions={<Button icon={<Plus className="size-4" />} onClick={() => setCreating(new Date())}>Event</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <IconButton label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="size-5" /></IconButton>
        <h2 className="min-w-40 text-center text-lg font-semibold" aria-live="polite">{label}</h2>
        <IconButton label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="size-5" /></IconButton>
        <Button variant="ghost" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>Today</Button>
        <select aria-label="Filter by course" value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All courses</option>
          {q.data?.courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select>
      </div>
      <div className="mb-3 flex gap-3 text-xs">
        <span className="rounded px-2 py-0.5 bg-brand-100 text-brand-900">Assignment</span>
        <span className="rounded px-2 py-0.5 bg-violet-100 text-violet-900">Quiz</span>
        <span className="rounded px-2 py-0.5 bg-amber-100 text-amber-900">Event</span>
      </div>
      <Loadable query={q}>
        {(d) => (
          <>
            {/* Month grid (tablet/desktop) */}
            <Card className="hidden overflow-hidden md:block">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold uppercase text-slate-500">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => <div key={w} className="py-2">{w}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const items = d.data.filter((i) => sameDay(new Date(i.startAt), day));
                  const inMonth = day.getMonth() === month.getMonth();
                  return (
                    <div key={day.toISOString()} className={clsx("min-h-28 border-b border-r border-slate-100 p-1.5", !inMonth && "bg-slate-50/70")}>
                      <button type="button" onClick={() => setCreating(day)} aria-label={`Add event on ${formatDate(day)}`} className={clsx("mb-1 flex size-7 items-center justify-center rounded-full text-xs", sameDay(day, today) ? "bg-brand-700 font-semibold text-white" : inMonth ? "text-slate-700 hover:bg-slate-100" : "text-slate-400")}>
                        {day.getDate()}
                      </button>
                      <ul className="space-y-1">
                        {items.slice(0, 4).map((i) => (
                          <li key={`${i.kind}-${i.id}`}>
                            <button type="button" onClick={() => setSelected(i)} className={clsx("block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium", kindTone[i.kind])} title={i.title}>
                              {!i.allDay && <span className="opacity-70">{formatTime(i.startAt)} </span>}
                              {i.title}
                            </button>
                          </li>
                        ))}
                        {items.length > 4 && <li className="px-1 text-[11px] text-slate-500">+{items.length - 4} more</li>}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </Card>
            {/* Agenda (mobile) */}
            <Card className="md:hidden">
              {d.data.filter((i) => new Date(i.startAt).getMonth() === month.getMonth()).length === 0 ? (
                <EmptyState title="Nothing this month" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {d.data
                    .filter((i) => new Date(i.startAt).getMonth() === month.getMonth())
                    .map((i) => (
                      <li key={`${i.kind}-${i.id}`}>
                        <button type="button" onClick={() => setSelected(i)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                          <span className="w-14 shrink-0 text-xs text-slate-500">{formatDate(i.startAt)}</span>
                          <span className={clsx("size-2 shrink-0 rounded-full", i.kind === "quiz" ? "bg-violet-500" : i.kind === "event" ? "bg-amber-500" : "bg-brand-600")} aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.title}</span>
                          <span className="text-xs text-slate-500">{i.courseCode}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
            {creating && <EventDialog date={creating} courses={d.courses.filter((c) => c.isStaff)} onClose={() => setCreating(null)} refreshUrl={url} />}
            {selected && <ItemDialog item={selected} onClose={() => setSelected(null)} />}
          </>
        )}
      </Loadable>
    </PageContainer>
  );
}

function ItemDialog({ item, onClose }: { item: CalendarItem; onClose: () => void }) {
  const fb = useFeedback();
  const invalidate = useInvalidate();
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={item.title}
      footer={
        <>
          {item.editable && (
            <Button
              variant="ghost"
              className="mr-auto text-red-700"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                if (!(await fb.confirm({ title: "Delete event?", message: "This cannot be undone.", danger: true, confirmLabel: "Delete" }))) return;
                try {
                  await api.del(`/calendar-events/${item.id}`);
                  await invalidate("/calendar", "/courses", "/dashboard");
                  onClose();
                } catch (err) {
                  fb.error(err);
                }
              }}
            >
              Delete
            </Button>
          )}
          {item.link ? <Link to={item.link} className="inline-flex h-10 items-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800">Open</Link> : <Button variant="secondary" onClick={onClose}>Close</Button>}
        </>
      }
    >
      <dl className="space-y-2 text-sm">
        <div className="flex gap-2"><dt className="w-20 text-slate-500">Type</dt><dd><Badge>{item.kind === "event" ? "Event" : item.kind === "quiz" ? "Quiz due" : "Assignment due"}</Badge></dd></div>
        <div className="flex gap-2"><dt className="w-20 text-slate-500">When</dt><dd>{formatDate(item.startAt)} {!item.allDay && formatTime(item.startAt)}{item.endAt && ` – ${formatTime(item.endAt)}`}</dd></div>
        {item.courseCode && <div className="flex gap-2"><dt className="w-20 text-slate-500">Course</dt><dd>{item.courseCode}</dd></div>}
        {item.description && <div><dt className="text-slate-500">Details</dt><dd className="mt-1 whitespace-pre-line">{item.description}</dd></div>}
      </dl>
    </Dialog>
  );
}

function EventDialog({ date, courses, onClose, refreshUrl }: { date: Date; courses: { id: string; code: string }[]; onClose: () => void; refreshUrl: string }) {
  const invalidate = useInvalidate();
  const start = new Date(date);
  if (start.getHours() === 0) start.setHours(9, 0, 0, 0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState(toLocalInput(start.toISOString()));
  const [endAt, setEndAt] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/calendar-events", { title, description, startAt: fromLocalInput(startAt), endAt: fromLocalInput(endAt), allDay, courseId: courseId || null });
      await invalidate(refreshUrl, "/calendar", "/dashboard");
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Dialog open onClose={onClose} title="New event" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="event-form">Save event</Button></>}>
      <form id="event-form" onSubmit={submit} className="space-y-4">
        <FormError error={error} />
        <TextField label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Starts" type="datetime-local" required value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          <TextField label="Ends" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </div>
        <Checkbox label="All-day event" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        <SelectField label="Calendar" value={courseId} onChange={(e) => setCourseId(e.target.value)} hint="Course events are visible to everyone in the course.">
          <option value="">My personal calendar</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} (course)</option>)}
        </SelectField>
        <TextAreaField label="Details" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </form>
    </Dialog>
  );
}
