import { and, asc, eq, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { moduleItems, pages, users } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { idParams, parse, trimmed } from "../lib/http.js";
import { renderMarkdown } from "../lib/markdown.js";
import { contentEditor, courseAccess, requireUser } from "../services/policy.js";
import { assertContentUnlocked, recordContentView } from "../services/progress.js";

const pageBody = z.object({
  title: trimmed(1, 200),
  body: z.string().max(200_000).default(""),
  published: z.boolean().default(false),
  isFrontPage: z.boolean().default(false),
});

export default async function pageRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  /** Render Markdown exactly as the server will store it (same sanitizer), for editor previews. */
  app.post("/markdown/preview", async (req) => {
    requireUser(req);
    const { markdown } = parse(z.object({ markdown: z.string().max(200_000) }), req.body);
    return { html: renderMarkdown(markdown) };
  });

  app.get("/courses/:id/pages", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    const rows = await ctx.db
      .select({ id: pages.id, title: pages.title, published: pages.published, isFrontPage: pages.isFrontPage, updatedAt: pages.updatedAt })
      .from(pages)
      .where(and(eq(pages.courseId, id), access.isStaff ? undefined : eq(pages.published, true)))
      .orderBy(asc(pages.title));
    return { data: rows };
  });

  app.get("/courses/:id/front-page", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    const [page] = await ctx.db
      .select()
      .from(pages)
      .where(and(eq(pages.courseId, id), eq(pages.isFrontPage, true), access.isStaff ? undefined : eq(pages.published, true)));
    return { page: page ? { id: page.id, title: page.title, bodyHtml: page.bodyHtml, published: page.published } : null };
  });

  app.post("/courses/:id/pages", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await contentEditor(ctx, user, id);
    const body = parse(pageBody, req.body);
    const page = await ctx.db.transaction(async (tx) => {
      if (body.isFrontPage) await tx.update(pages).set({ isFrontPage: false }).where(eq(pages.courseId, id));
      const [p] = await tx
        .insert(pages)
        .values({
          courseId: id,
          title: body.title,
          bodyMd: body.body,
          bodyHtml: renderMarkdown(body.body),
          published: body.published || body.isFrontPage,
          isFrontPage: body.isFrontPage,
          updatedById: user.id,
        })
        .returning();
      return p!;
    });
    reply.status(201);
    return { page };
  });

  async function load(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [page] = await ctx.db.select().from(pages).where(eq(pages.id, id));
    if (!page) throw notFound("Page");
    return { user, page };
  }

  app.get("/pages/:id", async (req) => {
    const { user, page } = await load(req);
    const access = await courseAccess(ctx, user, page.courseId);
    if (!access.isStaff) {
      if (!page.published) throw notFound("Page");
      await assertContentUnlocked(ctx, access, user.id, page.id);
      await recordContentView(ctx, access, user.id, page.id);
    }
    const [editor] = page.updatedById
      ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, page.updatedById))
      : [];
    return {
      page: {
        id: page.id,
        courseId: page.courseId,
        title: page.title,
        bodyHtml: page.bodyHtml,
        // Authors need the source to edit; students only get rendered HTML.
        ...(access.isStaff ? { body: page.bodyMd } : {}),
        published: page.published,
        isFrontPage: page.isFrontPage,
        updatedAt: page.updatedAt,
        updatedBy: editor?.name ?? null,
      },
    };
  });

  app.patch("/pages/:id", async (req) => {
    const { user, page } = await load(req);
    await contentEditor(ctx, user, page.courseId);
    const body = parse(pageBody.partial(), req.body);
    const updated = await ctx.db.transaction(async (tx) => {
      if (body.isFrontPage) await tx.update(pages).set({ isFrontPage: false }).where(and(eq(pages.courseId, page.courseId), ne(pages.id, page.id)));
      const [p] = await tx
        .update(pages)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.body !== undefined ? { bodyMd: body.body, bodyHtml: renderMarkdown(body.body) } : {}),
          ...(body.published !== undefined ? { published: body.published } : {}),
          ...(body.isFrontPage !== undefined ? { isFrontPage: body.isFrontPage } : {}),
          ...(body.isFrontPage ? { published: true } : {}),
          updatedById: user.id,
        })
        .where(eq(pages.id, page.id))
        .returning();
      return p!;
    });
    return { page: updated };
  });

  app.delete("/pages/:id", async (req) => {
    const { user, page } = await load(req);
    await contentEditor(ctx, user, page.courseId);
    await ctx.db.delete(moduleItems).where(and(eq(moduleItems.type, "page"), eq(moduleItems.refId, page.id)));
    await ctx.db.delete(pages).where(eq(pages.id, page.id));
    return { ok: true };
  });
}
