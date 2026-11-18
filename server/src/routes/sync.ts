/**
 * Endpoints the registrar system calls to keep this LMS in step with it.
 *
 * SIBBCS keeps its student records in Frappe: who the students are, which courses run this term
 * and who is registered for them. That system is the source of truth for all three, so those
 * facts arrive here rather than being typed in twice.
 *
 * Every endpoint is idempotent on externalId -- the record's name in the registrar -- so a
 * repeated sync repairs a row instead of creating a second one, and a failed run can simply be
 * run again. Callers hold a service token, never a session: see requireService.
 */
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  courses,
  enrollments,
  quizAttempts,
  quizQuestions,
  quizzes,
  sections,
  terms,
  users,
} from "../db/schema.js";
import { conflict, notFound } from "../lib/errors.js";
import { parse, trimmed } from "../lib/http.js";
import { audit } from "../services/audit.js";
import { cellFor, loadGradeData, totalsFor } from "../services/grading.js";
import { requireService } from "../services/policy.js";
import { progressForUser } from "../services/progress.js";
import type { AppContext, ServiceCaller } from "../types.js";
import { issueToken, sortableNameOf, tokenUrl } from "./auth.js";
import { createCourseRecord } from "./courses.js";

/** A registrar record name, such as EDU-REG-00012. */
const externalId = trimmed(1, 140);

const personBody = z.object({
  externalId,
  /**
   * The key this person used to be filed under, when the registrar re-files
   * them: an applicant who is admitted stops being APP-2026-00014 and becomes
   * SIB-2026-0003, with the same address and the same account. Without it the
   * email below is already linked and the sync refuses, which is the right
   * answer for every other case.
   */
  replacesExternalId: externalId.optional(),
  email: z.email(),
  name: trimmed(1, 200),
  role: z.enum(["admin", "instructor", "student"]),
  status: z.enum(["active", "deactivated"]).optional(),
  // Update, but never create. The registrar uses this when it is reporting that
  // somebody has been *removed* there: without it this endpoint would upsert,
  // and deactivating a deleted student would create an account here for
  // somebody who has just stopped existing over there.
  onlyIfPresent: z.boolean().optional(),
});

const courseBody = z.object({
  externalId,
  code: trimmed(1, 40),
  name: trimmed(1, 200),
  term: trimmed(1, 120).optional(),
  status: z.enum(["unpublished", "published", "archived"]).optional(),
  // As above: archiving a deleted offering must not conjure the course.
  onlyIfPresent: z.boolean().optional(),
});

const enrollmentBody = z.object({
  externalId,
  personExternalId: externalId,
  courseExternalId: externalId,
  role: z.enum(["teacher", "ta", "student"]).default("student"),
  status: z.enum(["active", "inactive", "completed"]).default("active"),
});

/** Record a sync write against the token that made it; no person did it. */
const trace = (
  ctx: AppContext,
  caller: ServiceCaller,
  action: string,
  entityType: string,
  entityId: string,
  extra: Record<string, unknown>,
) =>
  audit(ctx.db, {
    actorId: null,
    action,
    entityType,
    entityId,
    metadata: { service: caller.label, ...extra },
  });

/** The term with this name, created if this is the first course to mention it. */
async function termIdFor(ctx: AppContext, orgId: string, name: string | undefined) {
  if (!name) return null;
  const [existing] = await ctx.db
    .select()
    .from(terms)
    .where(and(eq(terms.orgId, orgId), eq(terms.name, name)));
  if (existing) return existing.id;
  const [created] = await ctx.db.insert(terms).values({ orgId, name }).returning();
  return created!.id;
}

const describePerson = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  status: u.status,
  externalId: u.externalId,
});

const describeCourse = (c: typeof courses.$inferSelect) => ({
  id: c.id,
  code: c.code,
  name: c.name,
  status: c.status,
  externalId: c.externalId,
});

const describeEnrollment = (e: typeof enrollments.$inferSelect) => ({
  id: e.id,
  courseId: e.courseId,
  userId: e.userId,
  role: e.role,
  status: e.status,
  externalId: e.externalId,
});

export default async function syncRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  /** Lets the registrar confirm its token and URL are right before relying on them. */
  app.get("/sync/whoami", async (req) => {
    const caller = requireService(req);
    return { service: { label: caller.label }, orgId: caller.orgId };
  });

  app.post("/sync/people", async (req, reply) => {
    const caller = requireService(req);
    const body = parse(personBody, req.body);
    const email = body.email.toLowerCase();

    let [row] = await ctx.db.select().from(users).where(eq(users.externalId, body.externalId));
    if (!row && body.replacesExternalId) {
      // Re-filing, not a new person: keep the account and move the key onto it,
      // so an admitted applicant keeps the exam they already sat.
      [row] = await ctx.db.select().from(users).where(eq(users.externalId, body.replacesExternalId));
    }
    if (!row) {
      // No link yet: adopt the account already using this address, so somebody who signed up
      // here before the sync existed keeps their work instead of gaining a second account.
      const [byEmail] = await ctx.db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
      if (byEmail?.externalId && byEmail.externalId !== body.externalId) {
        throw conflict(`${byEmail.email} is already linked to ${byEmail.externalId}.`);
      }
      row = byEmail;
    }

    if (!row && body.onlyIfPresent) {
      // Nothing to update and nothing to create. Said plainly so the caller can
      // tell this apart from a write it thought it made.
      return { created: false, found: false, user: null, activationUrl: null };
    }

    // An administrator here is never demoted by a sync: the registrar does not know who
    // administers this system, and locking everyone out would be the cost of getting it wrong.
    const role = row?.role === "admin" ? "admin" : body.role;
    const values = {
      email: body.email,
      name: body.name,
      sortableName: sortableNameOf(body.name),
      role,
      externalId: body.externalId,
      ...(body.status ? { status: body.status } : {}),
    };

    if (row) {
      const [updated] = await ctx.db.update(users).set(values).where(eq(users.id, row.id)).returning();
      await trace(ctx, caller, "sync.person.updated", "user", updated!.id, { externalId: body.externalId });
      return { created: false, user: describePerson(updated!), activationUrl: null };
    }

    const [created] = await ctx.db
      .insert(users)
      .values({ orgId: caller.orgId, ...values, status: body.status ?? "pending" })
      .returning();
    await trace(ctx, caller, "sync.person.created", "user", created!.id, { externalId: body.externalId });

    // Only on creation. Issuing a token invalidates the previous one, so re-syncing somebody
    // would otherwise break the link they were about to use. Later links come from
    // Admin -> user -> Password reset link, as before.
    const activationUrl =
      created!.status === "pending"
        ? tokenUrl(ctx, "activation", await issueToken(ctx.db, created!.id, "activation"))
        : null;
    reply.status(201);
    return { created: true, user: describePerson(created!), activationUrl };
  });

  app.post("/sync/courses", async (req, reply) => {
    const caller = requireService(req);
    const body = parse(courseBody, req.body);

    const [existing] = await ctx.db.select().from(courses).where(eq(courses.externalId, body.externalId));
    if (!existing && body.onlyIfPresent) {
      return { created: false, found: false, course: null };
    }
    // After the bail-out on purpose: this creates the term if it is new, and a
    // no-op must not leave one behind.
    const termId = await termIdFor(ctx, caller.orgId, body.term);
    if (existing) {
      const [updated] = await ctx.db
        .update(courses)
        .set({ code: body.code, name: body.name, termId, ...(body.status ? { status: body.status } : {}) })
        .where(eq(courses.id, existing.id))
        .returning();
      await trace(ctx, caller, "sync.course.updated", "course", updated!.id, { externalId: body.externalId });
      return { created: false, course: describeCourse(updated!) };
    }

    // Reuses the helper the web app uses, so a synced course gets the default section and
    // assignment group a hand-made one gets.
    const course = await createCourseRecord(ctx, caller.orgId, null, {
      code: body.code,
      name: body.name,
      description: "",
      termId,
      departmentId: null,
      startAt: null,
      endAt: null,
    });
    const [linked] = await ctx.db
      .update(courses)
      .set({ externalId: body.externalId, ...(body.status ? { status: body.status } : {}) })
      .where(eq(courses.id, course.id))
      .returning();
    await trace(ctx, caller, "sync.course.created", "course", course.id, { externalId: body.externalId });
    reply.status(201);
    return { created: true, course: describeCourse(linked!) };
  });

  app.post("/sync/enrollments", async (req, reply) => {
    const caller = requireService(req);
    const body = parse(enrollmentBody, req.body);

    const [person] = await ctx.db.select().from(users).where(eq(users.externalId, body.personExternalId));
    if (!person) throw notFound(`Person ${body.personExternalId}`);
    const [course] = await ctx.db.select().from(courses).where(eq(courses.externalId, body.courseExternalId));
    if (!course) throw notFound(`Course ${body.courseExternalId}`);

    let [row] = await ctx.db.select().from(enrollments).where(eq(enrollments.externalId, body.externalId));
    if (!row) {
      // Adopt an enrolment made here before the sync knew about it, rather than failing on the
      // one-per-course-per-person rule.
      const [pair] = await ctx.db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.courseId, course.id), eq(enrollments.userId, person.id)));
      if (pair?.externalId && pair.externalId !== body.externalId) {
        throw conflict(`${person.email} is already enrolled in ${course.code} as ${pair.externalId}.`);
      }
      row = pair;
    }

    if (row) {
      const [updated] = await ctx.db
        .update(enrollments)
        .set({ role: body.role, status: body.status, externalId: body.externalId })
        .where(eq(enrollments.id, row.id))
        .returning();
      await trace(ctx, caller, "sync.enrollment.updated", "enrollment", updated!.id, {
        externalId: body.externalId,
        courseId: course.id,
      });
      return { created: false, enrollment: describeEnrollment(updated!) };
    }

    const [section] = await ctx.db.select().from(sections).where(eq(sections.courseId, course.id)).limit(1);
    const [created] = await ctx.db
      .insert(enrollments)
      .values({
        courseId: course.id,
        userId: person.id,
        role: body.role,
        status: body.status,
        sectionId: section?.id ?? null,
        externalId: body.externalId,
      })
      .returning();
    await trace(ctx, caller, "sync.enrollment.created", "enrollment", created!.id, {
      externalId: body.externalId,
      courseId: course.id,
    });
    reply.status(201);
    return { created: true, enrollment: describeEnrollment(created!) };
  });
}

// ---------------------------------------------------------------------------
// reading back, for the registrar
// ---------------------------------------------------------------------------

/** The person and course a read is about, or 404 naming the one that is missing. */
async function pairFor(ctx: AppContext, personExternalId: string, courseExternalId: string) {
  const [person] = await ctx.db.select().from(users).where(eq(users.externalId, personExternalId));
  if (!person) throw notFound(`Person ${personExternalId}`);
  const [course] = await ctx.db.select().from(courses).where(eq(courses.externalId, courseExternalId));
  if (!course) throw notFound(`Course ${courseExternalId}`);
  return { person, course };
}

export async function syncReadRoutes(app: FastifyInstance) {
  const ctx = app.ctx;

  /**
   * How far one person has got through one course.
   *
   * The registrar asks this before letting somebody sign to say they have read
   * the orientation manual. `complete` is deliberately false when a course asks
   * nothing of anybody: an empty course is not something a candidate can have
   * read, and treating it as read would open the signature to everyone.
   */
  app.get("/sync/progress", async (req) => {
    requireService(req);
    const q = parse(
      z.object({ personExternalId: externalId, courseExternalId: externalId }),
      req.query,
    );
    const { person, course } = await pairFor(ctx, q.personExternalId, q.courseExternalId);
    const { progress } = await progressForUser(ctx, course.id, person.id);
    const { required, completed, percent } = progress.overall;
    return {
      person: { externalId: person.externalId, email: person.email },
      course: { externalId: course.externalId, code: course.code },
      required,
      completed,
      percent,
      complete: required > 0 && completed === required,
    };
  });

  /**
   * Quiz attempts on one course, with what each answer earned.
   *
   * Questions come back in the order they are asked, because the caller matches
   * them positionally -- an essay carries no key to match on. `awaitingMarking`
   * is the distinction that matters: an unmarked attempt scores zero here and
   * recording that as a result would tell a candidate they failed an exam
   * nobody has read yet.
   */
  app.get("/sync/quiz-results", async (req) => {
    requireService(req);
    const q = parse(
      z.object({ courseExternalId: externalId, personExternalId: externalId.optional() }),
      req.query,
    );
    const [course] = await ctx.db.select().from(courses).where(eq(courses.externalId, q.courseExternalId));
    if (!course) throw notFound(`Course ${q.courseExternalId}`);

    const quizRows = await ctx.db.select().from(quizzes).where(eq(quizzes.courseId, course.id));
    if (quizRows.length === 0) return { course: { externalId: course.externalId }, attempts: [] };

    const quizIds = quizRows.map((row) => row.id);
    const questions = await ctx.db
      .select()
      .from(quizQuestions)
      .where(inArray(quizQuestions.quizId, quizIds))
      .orderBy(asc(quizQuestions.position));

    const filters = [inArray(quizAttempts.quizId, quizIds)];
    if (q.personExternalId) {
      const [person] = await ctx.db.select().from(users).where(eq(users.externalId, q.personExternalId));
      if (!person) throw notFound(`Person ${q.personExternalId}`);
      filters.push(eq(quizAttempts.userId, person.id));
    }
    const attempts = await ctx.db
      .select({ attempt: quizAttempts, user: users })
      .from(quizAttempts)
      .innerJoin(users, eq(users.id, quizAttempts.userId))
      .where(and(...filters))
      .orderBy(asc(quizAttempts.attemptNumber));

    return {
      course: { externalId: course.externalId, code: course.code },
      attempts: attempts
        .filter((row) => row.attempt.status !== "in_progress")
        .map(({ attempt, user }) => {
          const results = (attempt.results ?? {}) as Record<
            string,
            { auto: number | null; manual: number | null; comment?: string }
          >;
          const mine = questions.filter((question) => question.quizId === attempt.quizId);
          return {
            person: { externalId: user.externalId, email: user.email, name: user.name },
            quiz: { title: quizRows.find((row) => row.id === attempt.quizId)?.title ?? null },
            attemptNumber: attempt.attemptNumber,
            status: attempt.status,
            awaitingMarking: attempt.status === "pending_review",
            submittedAt: attempt.submittedAt,
            score: attempt.score,
            pointsPossible: attempt.pointsPossible ?? mine.reduce((sum, question) => sum + question.points, 0),
            questions: mine.map((question) => {
              const result = results[question.id];
              const answers = (attempt.answers ?? {}) as Record<string, unknown>;
              return {
                position: question.position,
                // The registrar shows the paper on the admissions record, so
                // staff can read what was written without a second login.
                prompt: question.promptMd,
                answer: answers[question.id] ?? null,
                points: question.points,
                // A marker's figure wins over the automatic one, as everywhere
                // else; null means nobody has marked it.
                earned: result ? (result.manual ?? result.auto) : null,
                comment: result?.comment ?? null,
              };
            }),
          };
        }),
    };
  });

  /**
   * Course results on one course, for the registrar to put on a transcript.
   *
   * This reports; it does not decide. Whether a figure is final is the
   * registrar's judgement -- it knows when a term ended and we do not -- so
   * both totals are given and the caller picks:
   *
   * - `current` counts only work that has been marked AND released. It is the
   *   running average, and it rises as marking happens.
   * - `final` treats unreleased and unsubmitted work as zero. It is only the
   *   truth once the course is over.
   *
   * `awaitingMarking` and `gradedUnposted` are the reason both are needed. A
   * course still being marked has a `final` that understates it, sometimes
   * badly, and recording that as a result would tell a student they failed a
   * course nobody has finished reading -- the same mistake the entrance exam
   * pull refuses to make with an unmarked essay. A caller that records a mark
   * while either count is above zero is reading this wrongly.
   *
   * Only enrolments the registrar created are listed: `externalId` is its own
   * registration name, and an enrolment made by hand here has none. Those are
   * counted as `unmanagedStudents` rather than dropped silently, because a
   * student being taught and marked outside the registrar is something it
   * should be able to notice -- there is no fee, no eligibility check and no
   * transcript behind them.
   */
  app.get("/sync/grades", async (req) => {
    requireService(req);
    const q = parse(
      z.object({ courseExternalId: externalId, personExternalId: externalId.optional() }),
      req.query,
    );
    const [course] = await ctx.db
      .select()
      .from(courses)
      .where(eq(courses.externalId, q.courseExternalId));
    if (!course) throw notFound(`Course ${q.courseExternalId}`);

    // An inactive enrolment is a withdrawal or an unpaid seat; it has no
    // result to report. A completed one does -- that is the ordinary state of
    // a finished course.
    const enrolled = and(
      eq(enrollments.courseId, course.id),
      eq(enrollments.role, "student"),
      ne(enrollments.status, "inactive"),
    );

    const [{ n: unmanagedStudents } = { n: 0 }] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(enrollments)
      .where(and(enrolled, sql`${enrollments.externalId} is null`));

    const filters = [enrolled, isNotNull(enrollments.externalId)];
    if (q.personExternalId) filters.push(eq(users.externalId, q.personExternalId));

    const rows = await ctx.db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        personExternalId: users.externalId,
        enrollmentExternalId: enrollments.externalId,
        enrollmentStatus: enrollments.status,
      })
      .from(enrollments)
      .innerJoin(users, eq(users.id, enrollments.userId))
      .where(and(...filters))
      .orderBy(asc(users.sortableName));

    // One load for the whole class, not one per student: this database is a
    // long way from the server that asks.
    const data = await loadGradeData(
      ctx,
      course,
      rows.map((row) => row.userId),
      { includeUnpublished: false },
    );
    const now = new Date();

    return {
      course: { externalId: course.externalId, code: course.code, status: course.status },
      unmanagedStudents,
      students: rows.map((row) => {
        const totals = totalsFor(course, data, row.userId, true);
        const cells = data.assignments.map((a) =>
          cellFor(
            a,
            data.submissions.find((s) => s.assignmentId === a.id && s.userId === row.userId),
            now,
            true,
          ),
        );
        return {
          personExternalId: row.personExternalId,
          enrollmentExternalId: row.enrollmentExternalId,
          email: row.email,
          name: row.name,
          enrollmentStatus: row.enrollmentStatus,
          current: totals.current,
          final: totals.final,
          assignments: data.assignments.length,
          posted: cells.filter((cell) => cell.posted).length,
          awaitingMarking: cells.filter((cell) => cell.needsGrading).length,
          gradedUnposted: cells.filter((cell) => cell.graded && !cell.posted).length,
        };
      }),
    };
  });
}
