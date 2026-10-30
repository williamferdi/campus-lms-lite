import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  assignmentGroups,
  assignments,
  courses,
  discussionTopics,
  enrollments,
  files,
  modulePrerequisites,
  moduleItems,
  modules,
  pages,
  quizQuestions,
  quizzes,
  sections,
} from "../db/schema.js";
import type { AppContext } from "../types.js";

type Course = typeof courses.$inferSelect;

/**
 * Copy a course's structure and content (not people, submissions, grades or discussion replies)
 * into a new unpublished course. Content keeps its publish state and dates.
 * Runs in one transaction; file blobs are copied first so a failure leaves no dangling rows.
 */
export async function duplicateCourse(
  ctx: AppContext,
  source: Course,
  opts: { code: string; name: string; termId?: string | null | undefined; createdById: string; enrollCreatorAsTeacher: boolean },
): Promise<string> {
  const srcFiles = await ctx.db
    .select()
    .from(files)
    .where(and(eq(files.courseId, source.id), inArray(files.purpose, ["course", "course_image"])));
  const fileKeyMap = new Map<string, string>();
  for (const f of srcFiles) {
    const newKey = randomUUID();
    const stream = await ctx.storage.read(f.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    await ctx.storage.put(newKey, Buffer.concat(chunks));
    fileKeyMap.set(f.id, newKey);
  }

  return ctx.db.transaction(async (tx) => {
    const [course] = await tx
      .insert(courses)
      .values({
        orgId: source.orgId,
        termId: opts.termId === undefined ? source.termId : opts.termId,
        departmentId: source.departmentId,
        code: opts.code,
        name: opts.name,
        description: source.description,
        status: "unpublished",
        startAt: null,
        endAt: null,
        applyGroupWeights: source.applyGroupWeights,
        latePolicyEnabled: source.latePolicyEnabled,
        lateDeductionPercent: source.lateDeductionPercent,
        lateFloorPercent: source.lateFloorPercent,
        createdById: opts.createdById,
      })
      .returning();
    const courseId = course!.id;
    const [section] = await tx.insert(sections).values({ courseId, name: `${opts.code} (default section)` }).returning();
    if (opts.enrollCreatorAsTeacher) {
      await tx.insert(enrollments).values({ courseId, userId: opts.createdById, role: "teacher", sectionId: section!.id });
    }

    // files
    const fileMap = new Map<string, string>();
    for (const f of srcFiles) {
      const { id: _old, createdAt: _c, ...rest } = f;
      const [nf] = await tx
        .insert(files)
        .values({ ...rest, courseId, ownerId: opts.createdById, storageKey: fileKeyMap.get(f.id)! })
        .returning();
      fileMap.set(f.id, nf!.id);
    }
    if (source.imageFileId && fileMap.has(source.imageFileId)) {
      await tx.update(courses).set({ imageFileId: fileMap.get(source.imageFileId)! }).where(eq(courses.id, courseId));
    }

    // assignment groups + assignments
    const groupMap = new Map<string, string>();
    const srcGroups = await tx.select().from(assignmentGroups).where(eq(assignmentGroups.courseId, source.id));
    for (const g of srcGroups) {
      const { id: _old, createdAt: _c, ...rest } = g;
      const [ng] = await tx.insert(assignmentGroups).values({ ...rest, courseId }).returning();
      groupMap.set(g.id, ng!.id);
    }
    if (srcGroups.length === 0) await tx.insert(assignmentGroups).values({ courseId, name: "Assignments" });

    const assignmentMap = new Map<string, string>();
    for (const a of await tx.select().from(assignments).where(eq(assignments.courseId, source.id))) {
      const { id: _old, createdAt: _c, updatedAt: _u, ...rest } = a;
      const [na] = await tx
        .insert(assignments)
        .values({ ...rest, courseId, groupId: a.groupId ? (groupMap.get(a.groupId) ?? null) : null })
        .returning();
      assignmentMap.set(a.id, na!.id);
    }

    // quizzes + questions
    const quizMap = new Map<string, string>();
    const srcQuizzes = await tx.select().from(quizzes).where(eq(quizzes.courseId, source.id));
    for (const q of srcQuizzes) {
      const { id: _old, createdAt: _c, updatedAt: _u, ...rest } = q;
      const [nq] = await tx
        .insert(quizzes)
        .values({ ...rest, courseId, assignmentId: q.assignmentId ? (assignmentMap.get(q.assignmentId) ?? null) : null })
        .returning();
      quizMap.set(q.id, nq!.id);
    }
    if (srcQuizzes.length) {
      const questions = await tx.select().from(quizQuestions).where(inArray(quizQuestions.quizId, srcQuizzes.map((q) => q.id)));
      for (const qq of questions) {
        const { id: _old, createdAt: _c, ...rest } = qq;
        await tx.insert(quizQuestions).values({ ...rest, quizId: quizMap.get(qq.quizId)! });
      }
    }

    // pages
    const pageMap = new Map<string, string>();
    for (const p of await tx.select().from(pages).where(eq(pages.courseId, source.id))) {
      const { id: _old, createdAt: _c, updatedAt: _u, ...rest } = p;
      const [np] = await tx.insert(pages).values({ ...rest, courseId, updatedById: opts.createdById }).returning();
      pageMap.set(p.id, np!.id);
    }

    // discussions (topics only, no announcements, no replies)
    const discussionMap = new Map<string, string>();
    for (const d of await tx
      .select()
      .from(discussionTopics)
      .where(and(eq(discussionTopics.courseId, source.id), eq(discussionTopics.isAnnouncement, false)))) {
      const { id: _old, createdAt: _c, updatedAt: _u, ...rest } = d;
      const [nd] = await tx
        .insert(discussionTopics)
        .values({
          ...rest,
          courseId,
          authorId: opts.createdById,
          assignmentId: d.assignmentId ? (assignmentMap.get(d.assignmentId) ?? null) : null,
        })
        .returning();
      discussionMap.set(d.id, nd!.id);
    }

    // modules, prerequisites, items
    const moduleMap = new Map<string, string>();
    const srcModules = await tx.select().from(modules).where(eq(modules.courseId, source.id));
    for (const m of srcModules) {
      const { id: _old, createdAt: _c, updatedAt: _u, ...rest } = m;
      const [nm] = await tx.insert(modules).values({ ...rest, courseId }).returning();
      moduleMap.set(m.id, nm!.id);
    }
    if (srcModules.length) {
      const prereqs = await tx.select().from(modulePrerequisites).where(inArray(modulePrerequisites.moduleId, srcModules.map((m) => m.id)));
      for (const p of prereqs) {
        const moduleId = moduleMap.get(p.moduleId);
        const prerequisiteId = moduleMap.get(p.prerequisiteId);
        if (moduleId && prerequisiteId) await tx.insert(modulePrerequisites).values({ moduleId, prerequisiteId });
      }
      const refMaps: Record<string, Map<string, string>> = {
        page: pageMap,
        assignment: assignmentMap,
        quiz: quizMap,
        discussion: discussionMap,
        file: fileMap,
      };
      for (const item of await tx.select().from(moduleItems).where(eq(moduleItems.courseId, source.id))) {
        const { id: _old, createdAt: _c, updatedAt: _u, ...rest } = item;
        const refId = item.refId ? (refMaps[item.type]?.get(item.refId) ?? null) : null;
        if (item.refId && !refId) continue; // referenced content no longer exists
        await tx.insert(moduleItems).values({ ...rest, courseId, moduleId: moduleMap.get(item.moduleId)!, refId });
      }
    }
    return courseId;
  });
}
