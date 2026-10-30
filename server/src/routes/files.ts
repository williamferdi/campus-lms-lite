import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { files, moduleItems } from "../db/schema.js";
import { sha256 } from "../lib/crypto.js";
import { notFound, unprocessable } from "../lib/errors.js";
import { idParams, parse, requireChanges, trimmed } from "../lib/http.js";
import { contentEditor, courseAccess, requireUser } from "../services/policy.js";
import { assertContentUnlocked, recordContentView } from "../services/progress.js";
import { isInlineSafe, safeFileName, validateUpload } from "../services/uploads.js";
import type { AppContext, SessionUser } from "../types.js";

export function describeFile(f: typeof files.$inferSelect) {
  return {
    id: f.id,
    name: f.originalName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    published: f.published,
    createdAt: f.createdAt,
    url: `/api/v1/files/${f.id}/download`,
  };
}

/** Read every file part from a multipart request, validating each one before storing anything. */
export async function receiveUploads(
  ctx: AppContext,
  req: FastifyRequest,
  opts: { courseId: string; owner: SessionUser; purpose: "course" | "submission"; allowedExtensions?: string[]; published?: boolean },
) {
  const received: { name: string; data: Buffer; mimeType: string }[] = [];
  for await (const part of req.files()) {
    const data = await part.toBuffer();
    const info = validateUpload(part.filename, data, opts.allowedExtensions ?? []);
    received.push({ name: info.name, data, mimeType: info.mimeType });
  }
  if (received.length === 0) throw unprocessable("Choose at least one file to upload.");
  const stored: (typeof files.$inferSelect)[] = [];
  for (const r of received) {
    const storageKey = randomUUID();
    await ctx.storage.put(storageKey, r.data);
    const [f] = await ctx.db
      .insert(files)
      .values({
        courseId: opts.courseId,
        ownerId: opts.owner.id,
        purpose: opts.purpose,
        originalName: r.name,
        storageKey,
        mimeType: r.mimeType,
        sizeBytes: r.data.length,
        sha256: sha256(r.data),
        published: opts.published ?? false,
      })
      .returning();
    stored.push(f!);
  }
  return stored;
}

async function sendFile(ctx: AppContext, reply: FastifyReply, f: typeof files.$inferSelect, download: boolean) {
  let stream;
  try {
    stream = await ctx.storage.read(f.storageKey);
  } catch {
    throw notFound("File");
  }
  const disposition = !download && isInlineSafe(f.mimeType) ? "inline" : "attachment";
  const ascii = safeFileName(f.originalName).replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  reply
    .header("Content-Type", f.mimeType)
    .header("Content-Length", String(f.sizeBytes))
    .header("Content-Disposition", `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.originalName)}`)
    .header("Cache-Control", "private, max-age=300")
    .header("X-Content-Type-Options", "nosniff");
  return reply.send(stream);
}

export default async function fileRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get("/courses/:id/files", async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const access = await courseAccess(ctx, user, id);
    const rows = await ctx.db
      .select()
      .from(files)
      .where(and(eq(files.courseId, id), eq(files.purpose, "course"), access.isStaff ? undefined : eq(files.published, true)))
      .orderBy(asc(files.originalName));
    return { data: rows.map(describeFile) };
  });

  app.post("/courses/:id/files", async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    await contentEditor(ctx, user, id);
    const stored = await receiveUploads(ctx, req, { courseId: id, owner: user, purpose: "course" });
    reply.status(201);
    return { data: stored.map(describeFile) };
  });

  async function load(req: FastifyRequest) {
    const user = requireUser(req);
    const { id } = parse(idParams, req.params);
    const [file] = await ctx.db.select().from(files).where(eq(files.id, id));
    if (!file || !file.courseId) throw notFound("File");
    return { user, file };
  }

  app.patch("/files/:id", async (req) => {
    const { user, file } = await load(req);
    if (file.purpose !== "course") throw notFound("File");
    await contentEditor(ctx, user, file.courseId!);
    const body = requireChanges(parse(z.object({ name: trimmed(1, 200).optional(), published: z.boolean().optional() }), req.body));
    if (body.name) {
      const ext = file.originalName.split(".").pop()?.toLowerCase();
      if (body.name.split(".").pop()?.toLowerCase() !== ext) throw unprocessable(`Keep the ".${ext}" extension.`);
    }
    const [updated] = await ctx.db
      .update(files)
      .set({ ...(body.name ? { originalName: safeFileName(body.name) } : {}), ...(body.published !== undefined ? { published: body.published } : {}) })
      .where(eq(files.id, file.id))
      .returning();
    return { file: describeFile(updated!) };
  });

  app.delete("/files/:id", async (req) => {
    const { user, file } = await load(req);
    if (file.purpose !== "course") throw notFound("File");
    await contentEditor(ctx, user, file.courseId!);
    await ctx.db.delete(moduleItems).where(and(eq(moduleItems.type, "file"), eq(moduleItems.refId, file.id)));
    await ctx.db.delete(files).where(eq(files.id, file.id));
    await ctx.storage.remove(file.storageKey);
    return { ok: true };
  });

  /**
   * The only way to read stored bytes. Authorization by purpose:
   * - course files: staff, or students when published and not module-locked
   * - course images: anyone with course access
   * - submission files: the submitting student or graders of the course the file was submitted to
   */
  app.get("/files/:id/download", async (req, reply) => {
    const { user, file } = await load(req);
    const { download } = parse(z.object({ download: z.enum(["1", "0"]).optional() }), req.query);
    const access = await courseAccess(ctx, user, file.courseId!);
    if (file.purpose === "course" && !access.isStaff) {
      if (!file.published) throw notFound("File");
      await assertContentUnlocked(ctx, access, user.id, file.id);
      await recordContentView(ctx, access, user.id, file.id);
    }
    if (file.purpose === "submission" && !access.canGrade && file.ownerId !== user.id) throw notFound("File");
    return sendFile(ctx, reply, file, download === "1");
  });
}
