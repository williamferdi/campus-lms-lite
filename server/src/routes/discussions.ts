import { and, asc, count, desc, eq, inArray, isNull, lte, max, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assignmentGroups, assignments, courses, discussionEntries, discussionTopics, moduleItems, submissions, users } from "../db/schema.js";
import { forbidden, notFound, unprocessable } from "../lib/errors.js";
import { idParams, optionalDate, parse, requireChanges, trimmed } from "../lib/http.js";
import { renderMarkdown, renderPlainText } from "../lib/markdown.js";
import { audit } from "../services/audit.js";
import { getOrCreateSubmission } from "../services/grading.js";
import { courseMemberIds, notify } from "../services/notify.js";
import { contentEditor, courseAccess, requireUser, requireWritable } from "../services/policy.js";
import { assertContentUnlocked, recordContentView } from "../services/progress.js";
import type { AppContext } from "../types.js";

type Topic = typeof discussionTopics.$inferSelect;

const topicFields = z
  .object({
    title: trimmed(1, 200),
    body: z.string().max(100_000),
    published: z.boolean(),
    delayedPostAt: optionalDate,
    locked: z.boolean(),
    pinned: z.boolean(),
    threaded: z.boolean(),
    requireInitialPost: z.boolean(),
  })
  .partial();

const MAX_DEPTH = 6;

const isVisibleToStudents = (t: Topic, now: Date) => t.published && !!t.postedAt && t.postedAt <= now;

/**
 * Make announcements whose delayed post time has passed visible and notify students once.
 * Idempotent: the conditional update guarantees each topic is released exactly once.
 */
export async function releaseDueTopics(ctx: AppContext, courseId?: string) {
  const now = new Date();
  const released = await ctx.db
    .update(discussionTopics)
    .set({ postedAt: sql`${discussionTopics.delayedPostAt}` })
    .where(
      and(
        eq(discussionTopics.published, true),
        isNull(discussionTopics.postedAt),
        lte(discussionTopics.delayedPostAt, now),
        courseId ? eq(discussionTopics.courseId, courseId) : undefined,
      ),
    )
    .returning();
  for (const t of released) await announce(ctx, t);
  return released.length;
}

async function announce(ctx: AppContext, t: Topic) {
  const [course] = await ctx.db.select({ status: courses.status, code: courses.code }).from(courses).where(eq(courses.id, t.courseId));
  if (course?.status !== "published") return;
  await notify(ctx, await courseMemberIds(ctx, t.courseId), {
    type: t.isAnnouncement ? "announcement" : "discussion",
    title: t.isAnnouncement ? `${course.code}: ${t.title}` : `New discussion: ${t.title}`,
    body: t.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300),
    link: `/courses/${t.courseId}/${t.isAnnouncement ? "announcements" : "discussions"}/${t.id}`,
    courseId: t.courseId,
  });
}

/** Mark a graded discussion as submitted when a student first contributes. */
async function syncDiscussionSubmission(ctx: AppContext, t: Topic, userId: string, at: Date) {
  if (!t.assignmentId) return;
  const sub = await getOrCreateSubmission(ctx, t.assignmentId, userId);
  if (sub.submittedAt) return;
  await ctx.db
    .update(submissions)
    .set({ submittedAt: at, attempt: 1, submissionType: "discussion_topic", status: sub.status === "graded" ? "graded" : "submitted" })
    .where(eq(submissions.id, sub.id));
}

export default async function discussionRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get("/courses/:id/discussions", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    const { type } = parse(z.object({ type: z.enum(["discussion", "announcement"]).default("discussion") }), req.query);
    await releaseDueTopics(ctx, id);
    const now = new Date();
    const rows = await ctx.db
      .select({ topic: discussionTopics, authorName: users.name })
      .from(discussionTopics)
      .leftJoin(users, eq(users.id, discussionTopics.authorId))
      .where(and(eq(discussionTopics.courseId, id), eq(discussionTopics.isAnnouncement, type === "announcement")))
      .orderBy(desc(discussionTopics.pinned), desc(sql`coalesce(${discussionTopics.postedAt}, ${discussionTopics.createdAt})`));
    const visible = access.isStaff ? rows : rows.filter((r) => isVisibleToStudents(r.topic, now));
    const ids = visible.map((r) => r.topic.id);
    const stats = ids.length
      ? await ctx.db
          .select({ topicId: discussionEntries.topicId, n: count(), last: max(discussionEntries.createdAt) })
          .from(discussionEntries)
          .where(and(inArray(discussionEntries.topicId, ids), isNull(discussionEntries.deletedAt)))
          .groupBy(discussionEntries.topicId)
      : [];
    return {
      data: visible.map(({ topic: t, authorName }) => ({
        id: t.id,
        title: t.title,
        bodyHtml: t.bodyHtml,
        authorName,
        isAnnouncement: t.isAnnouncement,
        published: t.published,
        postedAt: t.postedAt,
        delayedPostAt: t.delayedPostAt,
        locked: t.locked,
        pinned: t.pinned,
        threaded: t.threaded,
        requireInitialPost: t.requireInitialPost,
        assignmentId: t.assignmentId,
        replyCount: stats.find((s) => s.topicId === t.id)?.n ?? 0,
        lastReplyAt: stats.find((s) => s.topicId === t.id)?.last ?? null,
        createdAt: t.createdAt,
      })),
    };
  });

  app.post("/courses/:id/discussions", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await contentEditor(ctx, user, id);
    const body = parse(
      topicFields.required({ title: true }).extend({
        isAnnouncement: z.boolean().default(false),
        graded: z.object({ pointsPossible: z.number().min(0).max(10_000), dueAt: optionalDate, groupId: z.uuid().nullable().optional() }).nullable().optional(),
      }),
      req.body,
    );
    if (body.isAnnouncement && body.graded) throw unprocessable("Announcements cannot be graded.");
    const now = new Date();
    const published = body.published ?? body.isAnnouncement;
    const delayed = body.delayedPostAt ?? null;
    const topic = await ctx.db.transaction(async (tx) => {
      let assignmentId: string | null = null;
      if (body.graded) {
        let groupId = body.graded.groupId ?? null;
        if (groupId) {
          const [g] = await tx.select().from(assignmentGroups).where(and(eq(assignmentGroups.id, groupId), eq(assignmentGroups.courseId, id)));
          if (!g) throw unprocessable("Unknown assignment group.");
        } else {
          const [g] = await tx.select().from(assignmentGroups).where(eq(assignmentGroups.courseId, id)).orderBy(asc(assignmentGroups.position)).limit(1);
          groupId = g?.id ?? null;
        }
        const [a] = await tx
          .insert(assignments)
          .values({ courseId: id, groupId, title: body.title, pointsPossible: body.graded.pointsPossible, dueAt: body.graded.dueAt ?? null, submissionTypes: ["discussion_topic"], published })
          .returning();
        assignmentId = a!.id;
      }
      const [t] = await tx
        .insert(discussionTopics)
        .values({
          courseId: id,
          authorId: user.id,
          assignmentId,
          title: body.title,
          bodyMd: body.body ?? "",
          bodyHtml: renderMarkdown(body.body ?? ""),
          isAnnouncement: body.isAnnouncement,
          published,
          delayedPostAt: delayed,
          postedAt: published && (!delayed || delayed <= now) ? now : null,
          locked: body.locked ?? false,
          pinned: body.pinned ?? false,
          threaded: body.threaded ?? true,
          requireInitialPost: body.requireInitialPost ?? false,
        })
        .returning();
      return t!;
    });
    if (topic.postedAt) await announce(ctx, topic);
    reply.status(201);
    return { topic };
  });

  async function loadTopic(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [topic] = await ctx.db.select().from(discussionTopics).where(eq(discussionTopics.id, id));
    if (!topic) throw notFound("Discussion");
    const access = await courseAccess(ctx, user, topic.courseId);
    if (!access.isStaff && !isVisibleToStudents(topic, new Date())) throw notFound("Discussion");
    return { user, topic, access };
  }

  app.get("/discussions/:id", async (req) => {
    const { user, topic, access } = await loadTopic(req);
    if (!access.isStaff && !topic.isAnnouncement) {
      await assertContentUnlocked(ctx, access, user.id, topic.id);
      await recordContentView(ctx, access, user.id, topic.id);
    }
    const entries = await ctx.db
      .select({ entry: discussionEntries, authorName: users.name })
      .from(discussionEntries)
      .leftJoin(users, eq(users.id, discussionEntries.authorId))
      .where(eq(discussionEntries.topicId, topic.id))
      .orderBy(asc(discussionEntries.createdAt));
    const hasPosted = entries.some((e) => e.entry.authorId === user.id && !e.entry.deletedAt);
    const mustPostFirst = !access.isStaff && topic.requireInitialPost && !hasPosted;
    const [author] = topic.authorId ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, topic.authorId)) : [];
    return {
      topic: {
        ...topic,
        bodyMd: access.isStaff ? topic.bodyMd : undefined,
        authorName: author?.name ?? null,
      },
      mustPostFirst,
      canReply: !access.readOnly && (!topic.locked || access.isStaff),
      canModerate: access.isStaff && !access.readOnly,
      // With "post before seeing replies", students only see their own entries until they post.
      entries: entries
        .filter((e) => !mustPostFirst || e.entry.authorId === user.id)
        .map(({ entry, authorName }) => ({
          id: entry.id,
          parentId: entry.parentId,
          authorId: entry.authorId,
          authorName: entry.deletedAt ? null : authorName,
          bodyHtml: entry.deletedAt ? null : entry.bodyHtml,
          deleted: !!entry.deletedAt,
          editedAt: entry.editedAt,
          createdAt: entry.createdAt,
          canEdit: !entry.deletedAt && !access.readOnly && (entry.authorId === user.id || access.isStaff),
        })),
    };
  });

  app.patch("/discussions/:id", async (req) => {
    const { user, topic } = await loadTopic(req);
    await contentEditor(ctx, user, topic.courseId);
    const body = requireChanges(parse(topicFields, req.body));
    const now = new Date();
    const published = body.published ?? topic.published;
    const delayed = body.delayedPostAt === undefined ? topic.delayedPostAt : body.delayedPostAt;
    let postedAt = topic.postedAt;
    if (!published) postedAt = null;
    else if (!postedAt && (!delayed || delayed <= now)) postedAt = now;
    const { body: md, ...rest } = body;
    const [updated] = await ctx.db
      .update(discussionTopics)
      .set({ ...rest, ...(md !== undefined ? { bodyMd: md, bodyHtml: renderMarkdown(md) } : {}), postedAt })
      .where(eq(discussionTopics.id, topic.id))
      .returning();
    if (topic.assignmentId && (body.title !== undefined || body.published !== undefined)) {
      await ctx.db
        .update(assignments)
        .set({ ...(body.title ? { title: body.title } : {}), ...(body.published !== undefined ? { published: body.published } : {}) })
        .where(eq(assignments.id, topic.assignmentId));
    }
    if (!topic.postedAt && updated!.postedAt) await announce(ctx, updated!);
    if (body.locked !== undefined && body.locked !== topic.locked) {
      await audit(ctx.db, { actorId: user.id, action: body.locked ? "discussion.locked" : "discussion.unlocked", entityType: "discussion", entityId: topic.id, courseId: topic.courseId, ip: req.ip });
    }
    return { topic: updated };
  });

  app.delete("/discussions/:id", async (req) => {
    const { user, topic } = await loadTopic(req);
    await contentEditor(ctx, user, topic.courseId);
    await ctx.db.delete(moduleItems).where(and(eq(moduleItems.type, "discussion"), eq(moduleItems.refId, topic.id)));
    await ctx.db.delete(discussionTopics).where(eq(discussionTopics.id, topic.id));
    if (topic.assignmentId) await ctx.db.delete(assignments).where(eq(assignments.id, topic.assignmentId));
    await audit(ctx.db, { actorId: user.id, action: "discussion.deleted", entityType: "discussion", entityId: topic.id, courseId: topic.courseId, metadata: { title: topic.title }, ip: req.ip });
    return { ok: true };
  });

  app.post("/discussions/:id/entries", async (req, reply) => {
    const { user, topic, access } = await loadTopic(req);
    requireWritable(access);
    if (topic.locked && !access.isStaff) throw forbidden("This discussion is closed for comments.");
    if (!access.isStaff && !topic.isAnnouncement) await assertContentUnlocked(ctx, access, user.id, topic.id);
    const body = parse(z.object({ body: z.string().trim().min(1, "Write a reply.").max(20_000), parentId: z.uuid().nullable().optional() }), req.body);
    let parent: typeof discussionEntries.$inferSelect | undefined;
    if (body.parentId) {
      [parent] = await ctx.db.select().from(discussionEntries).where(and(eq(discussionEntries.id, body.parentId), eq(discussionEntries.topicId, topic.id)));
      if (!parent || parent.deletedAt) throw unprocessable("You can't reply to that post.");
      if (!access.isStaff && topic.requireInitialPost) {
        const [{ n } = { n: 0 }] = await ctx.db
          .select({ n: count() })
          .from(discussionEntries)
          .where(and(eq(discussionEntries.topicId, topic.id), eq(discussionEntries.authorId, user.id), isNull(discussionEntries.parentId), isNull(discussionEntries.deletedAt)));
        if (n === 0) throw forbidden("Post your own response to the topic before replying to others.");
      }
      if (!topic.threaded && parent.parentId) {
        // Single-level discussions attach nested replies to the top-level post.
        [parent] = await ctx.db.select().from(discussionEntries).where(eq(discussionEntries.id, parent.parentId));
      } else if (topic.threaded) {
        let depth = 1;
        let cursor: typeof discussionEntries.$inferSelect | undefined = parent;
        while (cursor?.parentId && depth <= MAX_DEPTH) {
          [cursor] = await ctx.db.select().from(discussionEntries).where(eq(discussionEntries.id, cursor.parentId));
          depth++;
        }
        if (depth >= MAX_DEPTH) throw unprocessable("This conversation is nested too deeply; reply further up the thread.");
      }
    }
    const now = new Date();
    const [entry] = await ctx.db
      .insert(discussionEntries)
      .values({ topicId: topic.id, parentId: parent?.id ?? null, authorId: user.id, bodyHtml: renderPlainText(body.body) })
      .returning();
    if (access.role === "student") await syncDiscussionSubmission(ctx, topic, user.id, now);
    const recipients = [topic.authorId, parent?.authorId].filter((x): x is string => !!x && x !== user.id);
    await notify(ctx, recipients, {
      type: "reply",
      title: `New reply in ${topic.title}`,
      body: `${user.name}: ${body.body.slice(0, 200)}`,
      link: `/courses/${topic.courseId}/${topic.isAnnouncement ? "announcements" : "discussions"}/${topic.id}`,
      courseId: topic.courseId,
    });
    reply.status(201);
    return { entry };
  });

  async function loadEntry(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [entry] = await ctx.db.select().from(discussionEntries).where(eq(discussionEntries.id, id));
    if (!entry || entry.deletedAt) throw notFound("Post");
    const [topic] = await ctx.db.select().from(discussionTopics).where(eq(discussionTopics.id, entry.topicId));
    const access = await courseAccess(ctx, user, topic!.courseId);
    requireWritable(access);
    if (entry.authorId !== user.id && !access.isStaff) throw forbidden("You can only change your own posts.");
    return { user, entry, topic: topic!, access };
  }

  app.patch("/discussion-entries/:id", async (req) => {
    const { entry, topic, access } = await loadEntry(req);
    if (topic.locked && !access.isStaff) throw forbidden("This discussion is closed for comments.");
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(20_000) }), req.body);
    const [updated] = await ctx.db.update(discussionEntries).set({ bodyHtml: renderPlainText(body), editedAt: new Date() }).where(eq(discussionEntries.id, entry.id)).returning();
    return { entry: updated };
  });

  app.delete("/discussion-entries/:id", async (req) => {
    const { user, entry, topic } = await loadEntry(req);
    await ctx.db.update(discussionEntries).set({ deletedAt: new Date(), deletedById: user.id }).where(eq(discussionEntries.id, entry.id));
    if (entry.authorId !== user.id) {
      await audit(ctx.db, { actorId: user.id, action: "discussion_entry.moderated", entityType: "discussion_entry", entityId: entry.id, courseId: topic.courseId, metadata: { authorId: entry.authorId, topicId: topic.id }, ip: req.ip });
    }
    return { ok: true };
  });
}
