import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  assignments,
  discussionEntries,
  discussionTopics,
  files,
  itemCompletions,
  modulePrerequisites,
  moduleItems,
  modules,
  pages,
  quizAttempts,
  quizzes,
  submissions,
} from "../db/schema.js";
import { computeProgress, type ProgressFacts, type ProgressItem, type ProgressModule } from "../domain/progress.js";
import { keptScore } from "../domain/quiz.js";
import { forbidden } from "../lib/errors.js";
import type { AppContext } from "../types.js";
import type { CourseAccess } from "./policy.js";

export type RefType = "page" | "assignment" | "quiz" | "discussion" | "file";

/** Published state of every referenced content object in a course, by id. */
export async function contentPublishState(ctx: AppContext, courseId: string) {
  const [p, a, q, d, f] = await Promise.all([
    ctx.db.select({ id: pages.id, title: pages.title, published: pages.published }).from(pages).where(eq(pages.courseId, courseId)),
    ctx.db
      .select({ id: assignments.id, title: assignments.title, published: assignments.published, dueAt: assignments.dueAt, points: assignments.pointsPossible })
      .from(assignments)
      .where(eq(assignments.courseId, courseId)),
    ctx.db
      .select({ id: quizzes.id, title: quizzes.title, published: quizzes.published, dueAt: quizzes.dueAt })
      .from(quizzes)
      .where(eq(quizzes.courseId, courseId)),
    ctx.db
      .select({ id: discussionTopics.id, title: discussionTopics.title, published: discussionTopics.published })
      .from(discussionTopics)
      .where(and(eq(discussionTopics.courseId, courseId), eq(discussionTopics.isAnnouncement, false))),
    ctx.db
      .select({ id: files.id, title: files.originalName, published: files.published, mimeType: files.mimeType })
      .from(files)
      .where(and(eq(files.courseId, courseId), eq(files.purpose, "course"))),
  ]);
  const map = new Map<string, { title: string; published: boolean; dueAt?: Date | null; points?: number; mimeType?: string }>();
  for (const row of [...p, ...a, ...q, ...d, ...f]) map.set(row.id, row);
  return map;
}

/** Structure of published modules/items as seen by students. */
async function studentStructure(ctx: AppContext, courseId: string) {
  const [mods, items, prereqs, content] = await Promise.all([
    ctx.db.select().from(modules).where(and(eq(modules.courseId, courseId), eq(modules.published, true))),
    ctx.db.select().from(moduleItems).where(and(eq(moduleItems.courseId, courseId), eq(moduleItems.published, true))),
    ctx.db
      .select({ moduleId: modulePrerequisites.moduleId, prerequisiteId: modulePrerequisites.prerequisiteId })
      .from(modulePrerequisites)
      .innerJoin(modules, eq(modules.id, modulePrerequisites.moduleId))
      .where(eq(modules.courseId, courseId)),
    contentPublishState(ctx, courseId),
  ]);
  const moduleIds = new Set(mods.map((m) => m.id));
  const visibleItems = items.filter(
    (i) => moduleIds.has(i.moduleId) && (!i.refId || content.get(i.refId)?.published === true),
  );
  const progressModules: ProgressModule[] = mods.map((m) => ({
    id: m.id,
    position: m.position,
    unlockAt: m.unlockAt,
    requireSequential: m.requireSequential,
    prerequisiteIds: prereqs.filter((p) => p.moduleId === m.id && moduleIds.has(p.prerequisiteId)).map((p) => p.prerequisiteId),
  }));
  const progressItems: ProgressItem[] = visibleItems.map((i) => ({
    id: i.id,
    moduleId: i.moduleId,
    position: i.position,
    requirement: i.type === "subheader" ? "none" : i.requirement,
    minScore: i.minScore,
    refId: i.refId,
  }));
  return { mods, visibleItems, progressModules, progressItems, content };
}

/** Gather completion facts for many students at once. */
async function factsFor(ctx: AppContext, courseId: string, userIds: string[]) {
  const facts = new Map<string, ProgressFacts>();
  for (const id of userIds) {
    facts.set(id, { viewed: new Set(), markedDone: new Set(), submitted: new Set(), contributed: new Set(), scores: new Map() });
  }
  if (userIds.length === 0) return facts;
  const [completions, subs, attempts, posts, quizRows] = await Promise.all([
    ctx.db
      .select({ itemId: itemCompletions.moduleItemId, userId: itemCompletions.userId, viewedAt: itemCompletions.viewedAt, doneAt: itemCompletions.markedDoneAt })
      .from(itemCompletions)
      .innerJoin(moduleItems, eq(moduleItems.id, itemCompletions.moduleItemId))
      .where(and(eq(moduleItems.courseId, courseId), inArray(itemCompletions.userId, userIds))),
    ctx.db
      .select({ assignmentId: submissions.assignmentId, userId: submissions.userId, submittedAt: submissions.submittedAt, score: submissions.score, postedAt: submissions.postedAt, excused: submissions.excused })
      .from(submissions)
      .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
      .where(and(eq(assignments.courseId, courseId), inArray(submissions.userId, userIds))),
    ctx.db
      .select({ quizId: quizAttempts.quizId, userId: quizAttempts.userId, attemptNumber: quizAttempts.attemptNumber, score: quizAttempts.score, submittedAt: quizAttempts.submittedAt })
      .from(quizAttempts)
      .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
      .where(and(eq(quizzes.courseId, courseId), inArray(quizAttempts.userId, userIds), isNotNull(quizAttempts.submittedAt))),
    ctx.db
      .select({ topicId: discussionEntries.topicId, userId: discussionEntries.authorId })
      .from(discussionEntries)
      .innerJoin(discussionTopics, eq(discussionTopics.id, discussionEntries.topicId))
      .where(and(eq(discussionTopics.courseId, courseId), isNull(discussionEntries.deletedAt), inArray(discussionEntries.authorId, userIds))),
    ctx.db.select({ id: quizzes.id, assignmentId: quizzes.assignmentId, scoringPolicy: quizzes.scoringPolicy }).from(quizzes).where(eq(quizzes.courseId, courseId)),
  ]);
  for (const c of completions) {
    const f = facts.get(c.userId);
    if (!f) continue;
    if (c.viewedAt) f.viewed.add(c.itemId);
    if (c.doneAt) f.markedDone.add(c.itemId);
  }
  const quizByAssignment = new Map(quizRows.filter((q) => q.assignmentId).map((q) => [q.assignmentId!, q.id]));
  for (const s of subs) {
    const f = facts.get(s.userId);
    if (!f) continue;
    if (s.submittedAt || s.excused) f.submitted.add(s.assignmentId);
    // Only posted scores count toward min_score so module progress never leaks hidden grades.
    if (s.score !== null && s.postedAt) {
      f.scores.set(s.assignmentId, s.score);
      const quizId = quizByAssignment.get(s.assignmentId);
      if (quizId) f.scores.set(quizId, s.score);
    }
  }
  for (const q of quizRows) {
    for (const userId of userIds) {
      const mine = attempts.filter((a) => a.quizId === q.id && a.userId === userId);
      if (mine.length === 0) continue;
      const f = facts.get(userId)!;
      f.submitted.add(q.id);
      if (!q.assignmentId) {
        const kept = keptScore(mine, q.scoringPolicy);
        if (kept !== null) f.scores.set(q.id, kept); // practice quizzes have no hidden grade
      }
    }
  }
  for (const p of posts) {
    if (p.userId) facts.get(p.userId)?.contributed.add(p.topicId);
  }
  return facts;
}

export async function progressForUsers(ctx: AppContext, courseId: string, userIds: string[], now = new Date()) {
  const structure = await studentStructure(ctx, courseId);
  const allFacts = await factsFor(ctx, courseId, userIds);
  const titles = new Map(structure.mods.map((m) => [m.id, m.title]));
  const result = new Map<string, ReturnType<typeof computeProgress>>();
  for (const userId of userIds) {
    result.set(userId, computeProgress(structure.progressModules, structure.progressItems, allFacts.get(userId)!, now, titles));
  }
  return { structure, result };
}

export async function progressForUser(ctx: AppContext, courseId: string, userId: string) {
  const { structure, result } = await progressForUsers(ctx, courseId, [userId]);
  return { structure, progress: result.get(userId)! };
}

/**
 * Students cannot open content whose every module placement is locked for them.
 * Content that is not placed in any visible module is governed only by its publish state.
 */
export async function assertContentUnlocked(ctx: AppContext, access: CourseAccess, userId: string, refId: string) {
  if (access.isStaff) return;
  const { structure, progress } = await progressForUser(ctx, access.course.id, userId);
  const placements = structure.visibleItems.filter((i) => i.refId === refId);
  if (placements.length === 0) return;
  const open = placements.some((i) => progress.items.get(i.id)?.locked === false);
  if (!open) {
    const reason = placements
      .map((i) => progress.modules.get(i.moduleId)?.lockedReason)
      .find((r): r is string => !!r);
    throw forbidden(reason ? `This item is locked. ${reason}.` : "This item is locked until you complete the earlier required items in its module.");
  }
}

/** Record that a student viewed content (satisfies must_view on module items that reference it). */
export async function recordContentView(ctx: AppContext, access: CourseAccess, userId: string, refId: string) {
  if (access.role !== "student") return;
  const items = await ctx.db
    .select({ id: moduleItems.id })
    .from(moduleItems)
    .where(and(eq(moduleItems.courseId, access.course.id), eq(moduleItems.refId, refId)));
  for (const item of items) {
    await ctx.db
      .insert(itemCompletions)
      .values({ moduleItemId: item.id, userId, viewedAt: new Date() })
      .onConflictDoUpdate({
        target: [itemCompletions.moduleItemId, itemCompletions.userId],
        set: { viewedAt: sql`coalesce(${itemCompletions.viewedAt}, now())` },
      });
  }
}
