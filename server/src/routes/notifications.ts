import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notifications } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { idParams, paged, pagination, parse, queryBool } from "../lib/http.js";
import { requireUser } from "../services/policy.js";
import { releaseDueTopics } from "./discussions.js";

export default async function notificationRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get("/notifications", async (req) => {
    const user = requireUser(req);
    const q = parse(pagination.extend({ unread: queryBool.optional() }), req.query);
    await releaseDueTopics(ctx);
    const where = and(eq(notifications.userId, user.id), q.unread ? isNull(notifications.readAt) : undefined);
    const [{ total } = { total: 0 }] = await ctx.db.select({ total: count() }).from(notifications).where(where);
    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage);
    return paged(rows, total, q.page, q.perPage);
  });

  app.get("/notifications/unread-count", async (req) => {
    const user = requireUser(req);
    const [{ n } = { n: 0 }] = await ctx.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return { count: n };
  });

  app.post("/notifications/:id/read", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const { read } = parse(z.object({ read: z.boolean().default(true) }), req.body ?? {});
    const [row] = await ctx.db
      .update(notifications)
      .set({ readAt: read ? new Date() : null })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
      .returning();
    if (!row) throw notFound("Notification");
    return { notification: row };
  });

  app.post("/notifications/read-all", async (req) => {
    const user = requireUser(req);
    const rows = await ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { updated: rows.length };
  });
}
