import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assignments, discussionTopics, files, itemCompletions, modulePrerequisites, moduleItems, modules, pages, quizzes } from "../db/schema.js";
import { forbidden, notFound, unprocessable } from "../lib/errors.js";
import { definedOnly, idParams, optionalDate, parse, trimmed } from "../lib/http.js";
import { toEmbedUrl } from "../lib/markdown.js";
import { contentEditor, courseAccess, requireUser, requireWritable } from "../services/policy.js";
import { contentPublishState, progressForUser } from "../services/progress.js";
import type { AppContext } from "../types.js";

const itemType = z.enum(["page", "assignment", "quiz", "discussion", "file", "link", "subheader"]);
const requirement = z.enum(["none", "must_view", "must_mark_done", "must_submit", "min_score", "must_contribute"]);

/** Which completion requirements make sense for which item types (reference: Canvas modules API). */
const ALLOWED_REQUIREMENTS: Record<z.infer<typeof itemType>, z.infer<typeof requirement>[]> = {
  page: ["none", "must_view", "must_mark_done"],
  assignment: ["none", "must_view", "must_mark_done", "must_submit", "min_score"],
  quiz: ["none", "must_view", "must_submit", "min_score"],
  discussion: ["none", "must_view", "must_contribute"],
  file: ["none", "must_view"],
  link: ["none", "must_view", "must_mark_done"],
  subheader: ["none"],
};

const REF_TABLE = { page: pages, assignment: assignments, quiz: quizzes, discussion: discussionTopics, file: files } as const;

async function refTitle(ctx: AppContext, courseId: string, type: keyof typeof REF_TABLE, refId: string): Promise<string> {
  if (type === "file") {
    const [f] = await ctx.db.select({ t: files.originalName }).from(files).where(and(eq(files.id, refId), eq(files.courseId, courseId), eq(files.purpose, "course")));
    if (!f) throw unprocessable("That file does not belong to this course.");
    return f.t;
  }
  const table = REF_TABLE[type];
  const [row] = await ctx.db
    .select({ t: table.title })
    .from(table)
    .where(and(eq(table.id, refId), eq(table.courseId, courseId)));
  if (!row) throw unprocessable(`That ${type} does not belong to this course.`);
  if (type === "discussion") {
    const [d] = await ctx.db.select({ a: discussionTopics.isAnnouncement }).from(discussionTopics).where(eq(discussionTopics.id, refId));
    if (d?.a) throw unprocessable("Announcements cannot be added to modules.");
  }
  return row.t;
}

const moduleBody = z.object({
  title: trimmed(1, 200),
  published: z.boolean().optional(),
  unlockAt: optionalDate,
  requireSequential: z.boolean().optional(),
  prerequisiteIds: z.array(z.uuid()).max(20).optional(),
});

const itemBody = z.object({
  type: itemType,
  refId: z.uuid().nullable().optional(),
  title: z.string().trim().max(200).optional(),
  url: z.string().trim().max(2000).optional(),
  indent: z.number().int().min(0).max(3).optional(),
  published: z.boolean().optional(),
  requirement: requirement.optional(),
  minScore: z.number().min(0).nullable().optional(),
});

function checkRequirement(type: z.infer<typeof itemType>, req: z.infer<typeof requirement>, minScore: number | null | undefined) {
  if (!ALLOWED_REQUIREMENTS[type].includes(req)) {
    throw unprocessable(`"${req.replace(/_/g, " ")}" is not a valid requirement for a ${type} item.`);
  }
  if (req === "min_score" && (minScore === null || minScore === undefined)) {
    throw unprocessable("Enter the minimum score.");
  }
}

function checkUrl(url: string | undefined) {
  if (!url || !/^https?:\/\/[^\s]+$/i.test(url)) throw unprocessable("Enter a full web address starting with http:// or https://");
}

export default async function moduleRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  async function setPrerequisites(courseId: string, moduleId: string, position: number, ids: string[]) {
    if (ids.includes(moduleId)) throw unprocessable("A module cannot be its own prerequisite.");
    if (ids.length) {
      const rows = await ctx.db.select().from(modules).where(and(eq(modules.courseId, courseId), inArray(modules.id, ids)));
      if (rows.length !== ids.length) throw unprocessable("Unknown prerequisite module.");
      if (rows.some((r) => r.position >= position)) throw unprocessable("Prerequisites must be modules that come earlier in the course.");
    }
    await ctx.db.delete(modulePrerequisites).where(eq(modulePrerequisites.moduleId, moduleId));
    if (ids.length) await ctx.db.insert(modulePrerequisites).values(ids.map((prerequisiteId) => ({ moduleId, prerequisiteId })));
  }

  app.get("/courses/:id/modules", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    const content = await contentPublishState(ctx, id);
    const describeItem = (i: typeof moduleItems.$inferSelect) => {
      const ref = i.refId ? content.get(i.refId) : undefined;
      return {
        id: i.id,
        moduleId: i.moduleId,
        type: i.type,
        title: ref?.title ?? i.title,
        position: i.position,
        refId: i.refId,
        url: i.url,
        embedUrl: i.type === "link" && i.url ? toEmbedUrl(i.url) : null,
        indent: i.indent,
        published: i.published,
        contentPublished: ref ? ref.published : true,
        requirement: i.requirement,
        minScore: i.minScore,
        dueAt: ref?.dueAt ?? null,
        pointsPossible: ref?.points ?? null,
        mimeType: ref?.mimeType ?? null,
      };
    };

    if (access.isStaff) {
      const [mods, items, prereqs] = await Promise.all([
        ctx.db.select().from(modules).where(eq(modules.courseId, id)).orderBy(asc(modules.position)),
        ctx.db.select().from(moduleItems).where(eq(moduleItems.courseId, id)).orderBy(asc(moduleItems.position)),
        ctx.db
          .select({ moduleId: modulePrerequisites.moduleId, prerequisiteId: modulePrerequisites.prerequisiteId })
          .from(modulePrerequisites)
          .innerJoin(modules, eq(modules.id, modulePrerequisites.moduleId))
          .where(eq(modules.courseId, id)),
      ]);
      return {
        modules: mods.map((m) => ({
          ...m,
          prerequisiteIds: prereqs.filter((p) => p.moduleId === m.id).map((p) => p.prerequisiteId),
          items: items.filter((i) => i.moduleId === m.id).map(describeItem),
        })),
        progress: null,
      };
    }

    const { structure, progress } = await progressForUser(ctx, id, user.id);
    const ordered = [...structure.mods].sort((a, b) => a.position - b.position);
    return {
      modules: ordered.map((m) => {
        const mp = progress.modules.get(m.id)!;
        return {
          id: m.id,
          title: m.title,
          position: m.position,
          unlockAt: m.unlockAt,
          requireSequential: m.requireSequential,
          prerequisiteIds: structure.progressModules.find((pm) => pm.id === m.id)?.prerequisiteIds ?? [],
          state: mp.state,
          lockedReason: mp.lockedReason,
          completedCount: mp.completedCount,
          requiredCount: mp.requiredCount,
          items: structure.visibleItems
            .filter((i) => i.moduleId === m.id)
            .sort((a, b) => a.position - b.position)
            .map((i) => ({ ...describeItem(i), ...progress.items.get(i.id)! })),
        };
      }),
      progress: progress.overall,
    };
  });

  app.post("/courses/:id/modules", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await contentEditor(ctx, user, id);
    const body = parse(moduleBody, req.body);
    const [{ pos } = { pos: 0 }] = await ctx.db.select({ pos: max(modules.position) }).from(modules).where(eq(modules.courseId, id));
    const [mod] = await ctx.db
      .insert(modules)
      .values({
        courseId: id,
        title: body.title,
        position: (pos ?? 0) + 1,
        published: body.published ?? false,
        unlockAt: body.unlockAt ?? null,
        requireSequential: body.requireSequential ?? false,
      })
      .returning();
    if (body.prerequisiteIds?.length) await setPrerequisites(id, mod!.id, mod!.position, body.prerequisiteIds);
    reply.status(201);
    return { module: mod };
  });

  async function loadModule(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [mod] = await ctx.db.select().from(modules).where(eq(modules.id, id));
    if (!mod) throw notFound("Module");
    await contentEditor(ctx, user, mod.courseId);
    return { user, mod };
  }

  app.patch("/modules/:id", async (req) => {
    const { mod } = await loadModule(req);
    const body = parse(moduleBody.partial(), req.body);
    const { prerequisiteIds, ...rest } = body;
    const fields = definedOnly(rest);
    if (!prerequisiteIds && Object.keys(fields).length === 0) throw unprocessable("Nothing to update.");
    // Validate prerequisites before writing anything.
    if (prerequisiteIds) await setPrerequisites(mod.courseId, mod.id, mod.position, prerequisiteIds);
    const [updated] = Object.keys(fields).length
      ? await ctx.db.update(modules).set(fields).where(eq(modules.id, mod.id)).returning()
      : [mod];
    return { module: updated };
  });

  app.delete("/modules/:id", async (req) => {
    const { mod } = await loadModule(req);
    await ctx.db.delete(modules).where(eq(modules.id, mod.id));
    return { ok: true };
  });

  app.post("/courses/:id/modules/reorder", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await contentEditor(ctx, user, id);
    const { moduleIds } = parse(z.object({ moduleIds: z.array(z.uuid()).max(500) }), req.body);
    const existing = await ctx.db.select({ id: modules.id }).from(modules).where(eq(modules.courseId, id));
    if (existing.length !== moduleIds.length || !existing.every((m) => moduleIds.includes(m.id))) {
      throw unprocessable("Provide every module in the course exactly once.");
    }
    await ctx.db.transaction(async (tx) => {
      for (const [i, mid] of moduleIds.entries()) await tx.update(modules).set({ position: i + 1 }).where(eq(modules.id, mid));
      // Prerequisites that now come later are no longer valid.
      await tx.execute(sql`delete from ${modulePrerequisites} mp using ${modules} m, ${modules} p
        where mp.module_id = m.id and mp.prerequisite_id = p.id and m.course_id = ${id} and p.position >= m.position`);
    });
    return { ok: true };
  });

  app.post("/modules/:id/items", async (req, reply) => {
    const { mod } = await loadModule(req);
    const body = parse(itemBody, req.body);
    const req2 = body.requirement ?? "none";
    checkRequirement(body.type, req2, body.minScore);
    let title = body.title ?? "";
    if (body.type === "link") {
      checkUrl(body.url);
      if (!title) throw unprocessable("Enter a title for the link.");
    } else if (body.type === "subheader") {
      if (!title) throw unprocessable("Enter the sub-heading text.");
    } else {
      if (!body.refId) throw unprocessable(`Choose a ${body.type} to add.`);
      title = await refTitle(ctx, mod.courseId, body.type, body.refId);
    }
    const [{ pos } = { pos: 0 }] = await ctx.db.select({ pos: max(moduleItems.position) }).from(moduleItems).where(eq(moduleItems.moduleId, mod.id));
    const [item] = await ctx.db
      .insert(moduleItems)
      .values({
        moduleId: mod.id,
        courseId: mod.courseId,
        type: body.type,
        title,
        position: (pos ?? 0) + 1,
        refId: body.type === "link" || body.type === "subheader" ? null : body.refId!,
        url: body.type === "link" ? body.url! : null,
        indent: body.indent ?? 0,
        published: body.published ?? false,
        requirement: req2,
        minScore: req2 === "min_score" ? (body.minScore ?? null) : null,
      })
      .returning();
    reply.status(201);
    return { item };
  });

  app.post("/modules/:id/items/reorder", async (req) => {
    const { mod } = await loadModule(req);
    const { itemIds } = parse(z.object({ itemIds: z.array(z.uuid()).max(1000) }), req.body);
    if (itemIds.length === 0) return { ok: true };
    const rows = await ctx.db.select({ id: moduleItems.id, courseId: moduleItems.courseId }).from(moduleItems).where(inArray(moduleItems.id, itemIds));
    if (rows.length !== itemIds.length || rows.some((r) => r.courseId !== mod.courseId)) throw unprocessable("Unknown module item.");
    await ctx.db.transaction(async (tx) => {
      for (const [i, itemId] of itemIds.entries()) {
        await tx.update(moduleItems).set({ position: i + 1, moduleId: mod.id }).where(eq(moduleItems.id, itemId));
      }
    });
    return { ok: true };
  });

  async function loadItem(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [item] = await ctx.db.select().from(moduleItems).where(eq(moduleItems.id, id));
    if (!item) throw notFound("Module item");
    return { user, item };
  }

  app.patch("/module-items/:id", async (req) => {
    const { user, item } = await loadItem(req);
    await contentEditor(ctx, user, item.courseId);
    const body = parse(itemBody.omit({ type: true, refId: true }).partial(), req.body);
    const nextReq = body.requirement ?? item.requirement;
    const nextMin = body.minScore === undefined ? item.minScore : body.minScore;
    checkRequirement(item.type, nextReq, nextMin);
    if (item.type === "link" && body.url !== undefined) checkUrl(body.url);
    const [updated] = await ctx.db
      .update(moduleItems)
      .set({
        ...(body.title !== undefined && (item.type === "link" || item.type === "subheader") ? { title: body.title } : {}),
        ...(body.url !== undefined && item.type === "link" ? { url: body.url } : {}),
        ...(body.indent !== undefined ? { indent: body.indent } : {}),
        ...(body.published !== undefined ? { published: body.published } : {}),
        requirement: nextReq,
        minScore: nextReq === "min_score" ? nextMin : null,
      })
      .where(eq(moduleItems.id, item.id))
      .returning();
    return { item: updated };
  });

  app.delete("/module-items/:id", async (req) => {
    const { user, item } = await loadItem(req);
    await contentEditor(ctx, user, item.courseId);
    await ctx.db.delete(moduleItems).where(eq(moduleItems.id, item.id));
    return { ok: true };
  });

  /** Students: record a view (used for link items; other content records views when opened). */
  app.post("/module-items/:id/view", async (req) => {
    const { user, item } = await loadItem(req);
    const access = await courseAccess(ctx, user, item.courseId);
    if (access.isStaff) return { ok: true };
    const { progress } = await progressForUser(ctx, item.courseId, user.id);
    const state = progress.items.get(item.id);
    if (!state) throw notFound("Module item");
    if (state.locked) throw forbidden("This item is locked.");
    await ctx.db
      .insert(itemCompletions)
      .values({ moduleItemId: item.id, userId: user.id, viewedAt: new Date() })
      .onConflictDoUpdate({
        target: [itemCompletions.moduleItemId, itemCompletions.userId],
        set: { viewedAt: sql`coalesce(${itemCompletions.viewedAt}, now())` },
      });
    return { ok: true };
  });

  app.post("/module-items/:id/done", async (req) => {
    const { user, item } = await loadItem(req);
    const access = await courseAccess(ctx, user, item.courseId);
    if (access.role !== "student") throw forbidden("Only students track their own progress.");
    requireWritable(access);
    const { done } = parse(z.object({ done: z.boolean() }), req.body);
    if (item.requirement !== "must_mark_done") throw unprocessable("This item does not need to be marked as done.");
    const { progress } = await progressForUser(ctx, item.courseId, user.id);
    const state = progress.items.get(item.id);
    if (!state) throw notFound("Module item");
    if (state.locked) throw forbidden("This item is locked.");
    const doneAt = done ? new Date() : null;
    await ctx.db
      .insert(itemCompletions)
      .values({ moduleItemId: item.id, userId: user.id, viewedAt: new Date(), markedDoneAt: doneAt })
      .onConflictDoUpdate({ target: [itemCompletions.moduleItemId, itemCompletions.userId], set: { markedDoneAt: doneAt } });
    return { ok: true, done };
  });

  /** Previous/next navigation in course module order, plus this item's progress state. */
  app.get("/courses/:id/module-nav", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    const q = parse(z.object({ itemId: z.uuid().optional(), refId: z.uuid().optional() }), req.query);
    let ordered: { id: string; type: string; title: string; refId: string | null; url: string | null; moduleTitle: string; locked: boolean; completed: boolean; requirement: string }[];
    if (access.isStaff) {
      const [mods, items, content] = await Promise.all([
        ctx.db.select().from(modules).where(eq(modules.courseId, id)).orderBy(asc(modules.position)),
        ctx.db.select().from(moduleItems).where(eq(moduleItems.courseId, id)),
        contentPublishState(ctx, id),
      ]);
      ordered = mods.flatMap((m) =>
        items
          .filter((i) => i.moduleId === m.id && i.type !== "subheader")
          .sort((a, b) => a.position - b.position)
          .map((i) => ({ id: i.id, type: i.type, title: (i.refId && content.get(i.refId)?.title) || i.title, refId: i.refId, url: i.url, moduleTitle: m.title, locked: false, completed: false, requirement: i.requirement })),
      );
    } else {
      const { structure, progress } = await progressForUser(ctx, id, user.id);
      const mods = [...structure.mods].sort((a, b) => a.position - b.position);
      ordered = mods.flatMap((m) =>
        structure.visibleItems
          .filter((i) => i.moduleId === m.id && i.type !== "subheader")
          .sort((a, b) => a.position - b.position)
          .map((i) => {
            const st = progress.items.get(i.id)!;
            return { id: i.id, type: i.type, title: (i.refId && structure.content.get(i.refId)?.title) || i.title, refId: i.refId, url: i.url, moduleTitle: m.title, locked: st.locked, completed: st.completed, requirement: i.requirement };
          }),
      );
    }
    const idx = ordered.findIndex((i) => (q.itemId ? i.id === q.itemId : i.refId === q.refId));
    if (idx < 0) return { current: null, prev: null, next: null };
    return { current: ordered[idx], prev: ordered[idx - 1] ?? null, next: ordered[idx + 1] ?? null };
  });
}
