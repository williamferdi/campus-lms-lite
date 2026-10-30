import { and, eq, inArray } from "drizzle-orm";
import { enrollments, notifications, users } from "../db/schema.js";
import type { AppContext } from "../types.js";

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string | null;
  courseId?: string | null;
}

/**
 * Create in-app notifications and, when SMTP is configured, email them.
 * Email delivery is best-effort and its real outcome is recorded per notification.
 */
export async function notify(ctx: AppContext, userIds: string[], n: NotificationInput): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const recipients = await ctx.db
    .select({ id: users.id, email: users.email, emailNotifications: users.emailNotifications })
    .from(users)
    .where(and(inArray(users.id, unique), eq(users.status, "active")));
  if (recipients.length === 0) return;

  const rows = await ctx.db
    .insert(notifications)
    .values(
      recipients.map((r) => ({
        userId: r.id,
        courseId: n.courseId ?? null,
        type: n.type,
        title: n.title,
        body: n.body ?? "",
        link: n.link ?? null,
        emailStatus: !r.emailNotifications
          ? ("skipped" as const)
          : ctx.mailer.configured
            ? ("skipped" as const) // updated below once delivery is attempted
            : ("not_configured" as const),
      })),
    )
    .returning({ id: notifications.id, userId: notifications.userId });

  if (!ctx.mailer.configured) return;
  const byUser = new Map(recipients.map((r) => [r.id, r]));
  // Fire and forget: email must never block or fail the request.
  void (async () => {
    for (const row of rows) {
      const r = byUser.get(row.userId);
      if (!r?.emailNotifications) continue;
      const link = n.link ? `\n\n${ctx.config.APP_URL}${n.link}` : "";
      const ok = await ctx.mailer.send(r.email, n.title, `${n.body ?? ""}${link}`);
      await ctx.db
        .update(notifications)
        .set({ emailStatus: ok ? "sent" : "failed" })
        .where(eq(notifications.id, row.id))
        .catch(() => undefined);
    }
  })();
}

/** Active students (optionally plus staff) of a course. */
export async function courseMemberIds(
  ctx: AppContext,
  courseId: string,
  roles: ("student" | "teacher" | "ta")[] = ["student"],
): Promise<string[]> {
  const rows = await ctx.db
    .select({ userId: enrollments.userId })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.status, "active"), inArray(enrollments.role, roles)));
  return rows.map((r) => r.userId);
}
