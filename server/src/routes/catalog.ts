import { and, asc, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { courses, departments, terms } from "../db/schema.js";
import { conflict, notFound, unprocessable } from "../lib/errors.js";
import { idParams, optionalDate, parse, requireChanges, trimmed } from "../lib/http.js";
import { audit } from "../services/audit.js";
import { requireAdmin, requireUser } from "../services/policy.js";

const termBody = z.object({ name: trimmed(1, 120), startAt: optionalDate, endAt: optionalDate });
const deptBody = z.object({ name: trimmed(1, 120), code: trimmed(1, 20) });

export default async function catalogRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  app.get("/terms", async (req) => {
    const user = requireUser(req);
    return {
      data: await ctx.db.select().from(terms).where(eq(terms.orgId, user.orgId)).orderBy(asc(terms.startAt), asc(terms.name)),
    };
  });

  app.post("/terms", async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parse(termBody, req.body);
    if (body.startAt && body.endAt && body.startAt > body.endAt) throw unprocessable("The term must end after it starts.");
    const [term] = await ctx.db.insert(terms).values({ ...body, orgId: admin.orgId }).returning();
    await audit(ctx.db, { actorId: admin.id, action: "term.created", entityType: "term", entityId: term!.id, ip: req.ip });
    reply.status(201);
    return { term };
  });

  app.patch("/terms/:id", async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParams, req.params);
    const body = requireChanges(parse(termBody.partial(), req.body));
    const [term] = await ctx.db.update(terms).set(body).where(and(eq(terms.id, id), eq(terms.orgId, admin.orgId))).returning();
    if (!term) throw notFound("Term");
    if (term.startAt && term.endAt && term.startAt > term.endAt) throw unprocessable("The term must end after it starts.");
    return { term };
  });

  app.delete("/terms/:id", async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParams, req.params);
    const [{ n } = { n: 0 }] = await ctx.db.select({ n: count() }).from(courses).where(eq(courses.termId, id));
    if (n > 0) throw conflict(`This term is used by ${n} course(s). Move them to another term first.`);
    const [term] = await ctx.db.delete(terms).where(and(eq(terms.id, id), eq(terms.orgId, admin.orgId))).returning();
    if (!term) throw notFound("Term");
    await audit(ctx.db, { actorId: admin.id, action: "term.deleted", entityType: "term", entityId: id, metadata: { name: term.name }, ip: req.ip });
    return { ok: true };
  });

  app.get("/departments", async (req) => {
    const user = requireUser(req);
    return {
      data: await ctx.db.select().from(departments).where(eq(departments.orgId, user.orgId)).orderBy(asc(departments.name)),
    };
  });

  app.post("/departments", async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parse(deptBody, req.body);
    const [department] = await ctx.db.insert(departments).values({ ...body, orgId: admin.orgId }).returning();
    reply.status(201);
    return { department };
  });

  app.patch("/departments/:id", async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParams, req.params);
    const body = requireChanges(parse(deptBody.partial(), req.body));
    const [department] = await ctx.db
      .update(departments)
      .set(body)
      .where(and(eq(departments.id, id), eq(departments.orgId, admin.orgId)))
      .returning();
    if (!department) throw notFound("Department");
    return { department };
  });

  app.delete("/departments/:id", async (req) => {
    const admin = requireAdmin(req);
    const { id } = parse(idParams, req.params);
    const [{ n } = { n: 0 }] = await ctx.db.select({ n: count() }).from(courses).where(eq(courses.departmentId, id));
    if (n > 0) throw conflict(`This department is used by ${n} course(s).`);
    const [department] = await ctx.db
      .delete(departments)
      .where(and(eq(departments.id, id), eq(departments.orgId, admin.orgId)))
      .returning();
    if (!department) throw notFound("Department");
    return { ok: true };
  });
}
