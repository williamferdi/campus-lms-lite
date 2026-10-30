import clsx from "clsx";
import { Bell, CheckCheck, MailWarning } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { PageContainer } from "../../components/layout/AppShell";
import { useFeedback } from "../../components/ui/feedback";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, FormError, Loadable, PageHeader, Pagination, TextAreaField, TextField } from "../../components/ui";
import { api, ApiError, qs } from "../../lib/api";
import { useAuth, useUser } from "../../lib/auth";
import { relative, roleLabel } from "../../lib/format";
import { useApi, useInvalidate } from "../../lib/query";
import type { Notification, Paged } from "../../lib/types";

/** Notification list with filters; shown in the Inbox. */
export function NotificationsPanel() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const fb = useFeedback();
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const { emailConfigured } = useAuth();
  const q = useApi<Paged<Notification>>(`/notifications${qs({ unread: unreadOnly || undefined, page, perPage: 20 })}`, { placeholderData: (p) => p });
  const refresh = () => invalidate("/notifications");
  const markRead = async (n: Notification, read: boolean) => {
    try {
      await api.post(`/notifications/${n.id}/read`, { read });
      await refresh();
    } catch (err) {
      fb.error(err);
    }
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Checkbox label="Unread only" checked={unreadOnly} onChange={(e) => (setUnreadOnly(e.target.checked), setPage(1))} />
        <Button variant="secondary" size="sm" icon={<CheckCheck className="size-4" />} onClick={async () => { try { await api.post("/notifications/read-all"); await refresh(); fb.success("All notifications marked as read."); } catch (err) { fb.error(err); } }}>
          Mark all read
        </Button>
      </div>
      {!emailConfigured && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <MailWarning className="size-4 shrink-0" aria-hidden /> Email delivery is not configured on this server, so notifications are in-app only.
        </p>
      )}
      <Card>
        <Loadable query={q}>
          {(d) =>
            d.data.length === 0 ? (
              <EmptyState icon={<Bell className="size-6" />} title={unreadOnly ? "No unread notifications" : "No notifications yet"} />
            ) : (
              <>
                <ul className="divide-y divide-slate-100">
                  {d.data.map((n) => (
                    <li key={n.id} className={clsx("flex items-start gap-3 px-5 py-3", !n.readAt && "bg-brand-50/50")}>
                      <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-600")} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          className="text-left text-sm font-medium hover:text-brand-700"
                          onClick={async () => {
                            if (!n.readAt) await markRead(n, true);
                            if (n.link) navigate(n.link);
                          }}
                        >
                          {!n.readAt && <span className="sr-only">Unread: </span>}
                          {n.title}
                        </button>
                        {n.body && <p className="line-clamp-2 text-sm text-slate-600">{n.body}</p>}
                        <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span>{relative(n.createdAt)}</span>
                          <Badge>{n.type}</Badge>
                          {n.emailStatus === "sent" && <Badge tone="green">emailed</Badge>}
                          {n.emailStatus === "failed" && <Badge tone="red">email failed</Badge>}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void markRead(n, !n.readAt)}>
                        {n.readAt ? "Mark unread" : "Mark read"}
                      </Button>
                    </li>
                  ))}
                </ul>
                <Pagination page={d.meta.page} pageCount={d.meta.pageCount} total={d.meta.total} onPage={setPage} />
              </>
            )
          }
        </Loadable>
      </Card>
    </>
  );
}

export function AccountPage() {
  const user = useUser();
  const { refresh } = useAuth();
  const fb = useFeedback();
  const [profile, setProfile] = useState({ name: user.name, bio: user.bio, timeZone: user.timeZone, emailNotifications: user.emailNotifications });
  const [profileError, setProfileError] = useState<unknown>(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwError, setPwError] = useState<unknown>(null);
  useEffect(() => setProfile({ name: user.name, bio: user.bio, timeZone: user.timeZone, emailNotifications: user.emailNotifications }), [user]);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    try {
      await api.patch("/auth/me", profile);
      await refresh();
      fb.success("Profile saved.");
    } catch (err) {
      setProfileError(err);
    }
  };
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (pw.newPassword !== pw.confirm) return setPwError(new ApiError(422, "mismatch", "New passwords do not match."));
    try {
      await api.post("/auth/change-password", { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      fb.success("Password changed. Other sessions were signed out.");
    } catch (err) {
      setPwError(err);
    }
  };
  const pwFields = pwError instanceof ApiError ? pwError.fieldErrors() : {};
  const timeZones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["UTC"];

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="Account" description={`${user.email} · ${roleLabel(user.role)}`} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Profile" />
          <form onSubmit={saveProfile} className="space-y-4 px-5 py-4">
            <FormError error={profileError} />
            <TextField label="Display name" required value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
            <TextAreaField label="About me" rows={3} value={profile.bio} onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))} />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Time zone</span>
              <select value={profile.timeZone} onChange={(e) => setProfile((p) => ({ ...p, timeZone: e.target.value }))} className="block w-full rounded-control border border-slate-300 bg-white px-3 py-2 text-sm">
                {timeZones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </label>
            <Checkbox label="Email me notifications" hint="Only applies when your institution has configured email delivery." checked={profile.emailNotifications} onChange={(e) => setProfile((p) => ({ ...p, emailNotifications: e.target.checked }))} />
            <div className="flex justify-end">
              <Button type="submit">Save profile</Button>
            </div>
          </form>
        </Card>
        <Card>
          <CardHeader title="Change password" />
          <form onSubmit={changePassword} className="space-y-4 px-5 py-4">
            {!pwFields.newPassword && !pwFields.currentPassword && <FormError error={pwError} />}
            <TextField label="Current password" type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))} error={pwFields.currentPassword} />
            <TextField label="New password" type="password" autoComplete="new-password" required value={pw.newPassword} onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))} hint="At least 10 characters, including a letter and a number." error={pwFields.newPassword} />
            <TextField label="Confirm new password" type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />
            <div className="flex justify-end">
              <Button type="submit">Change password</Button>
            </div>
          </form>
        </Card>
        <p className="text-center text-sm text-slate-500">
          <Link to="/inbox" className="text-brand-700 hover:underline">Notification history</Link>
        </p>
      </div>
    </PageContainer>
  );
}
