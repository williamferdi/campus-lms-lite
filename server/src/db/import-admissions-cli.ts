/**
 * Import the admissions courses exported from the registrar system.
 * Usage: npm run import-admissions -- --file ./admissions-content.json [--apply]
 *
 * The content half of the move. Courses, people and enrolments arrive through
 * the sync endpoints, which a service token may use; pages and quizzes may not
 * be authored with a token, and widening that for a one-off import would leave
 * a standing door open. So this runs once, here, against the database.
 *
 * Idempotent: matched on course, module title and page title, so a second run
 * updates what it made the first time rather than making it again. Dry by
 * default -- it prints what it would do and writes nothing until --apply.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { renderMarkdown } from "../lib/markdown.js";
import { createDatabase, type Db } from "./client.js";
import { courses, moduleItems, modules, pages, quizQuestions, quizzes } from "./schema.js";

interface Page {
  title: string;
  markdown: string;
  published: boolean;
}
interface Module {
  title: string;
  pages: Page[];
}
interface Side {
  externalId: string;
  modules: Module[];
  quiz?: { title: string; questions: { prompt: string; points: number }[] } | null;
}

const { values: args } = parseArgs({ options: { file: { type: "string" }, apply: { type: "boolean" } } });
if (!args.file) {
  console.error("Usage: npm run import-admissions -- --file <export.json> [--apply]");
  process.exit(1);
}
const apply = args.apply === true;
const payload = JSON.parse(readFileSync(args.file, "utf8")) as Record<string, Side>;

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const db: Db = database.db;
const tally = { modules: 0, pages: 0, items: 0, questions: 0, unpublished: 0 };

async function courseFor(externalId: string) {
  const [course] = await db.select().from(courses).where(eq(courses.externalId, externalId));
  if (!course) {
    throw new Error(`No course with external id ${externalId}. Run the registrar builder first.`);
  }
  return course;
}

/** Find by the natural key, or make it. Returns the row either way. */
async function upsertModule(courseId: string, title: string, position: number) {
  const [found] = await db.select().from(modules).where(and(eq(modules.courseId, courseId), eq(modules.title, title)));
  if (found) {
    if (apply) await db.update(modules).set({ position, published: true }).where(eq(modules.id, found.id));
    return found;
  }
  tally.modules += 1;
  if (!apply) return { id: "" } as typeof modules.$inferSelect;
  const [made] = await db.insert(modules).values({ courseId, title, position, published: true }).returning();
  return made!;
}

async function upsertPage(courseId: string, page: Page) {
  const [found] = await db.select().from(pages).where(and(eq(pages.courseId, courseId), eq(pages.title, page.title)));
  const body = {
    bodyMd: page.markdown,
    // Rendered and sanitised by the same code the editor uses, so imported
    // prose cannot carry anything an author could not have written here.
    bodyHtml: renderMarkdown(page.markdown),
    published: page.published,
  };
  if (!page.published) tally.unpublished += 1;
  if (found) {
    if (apply) await db.update(pages).set(body).where(eq(pages.id, found.id));
    return found;
  }
  tally.pages += 1;
  if (!apply) return { id: "" } as typeof pages.$inferSelect;
  const [made] = await db.insert(pages).values({ courseId, title: page.title, ...body }).returning();
  return made!;
}

async function upsertItem(
  courseId: string,
  moduleId: string,
  refId: string,
  type: "page" | "quiz",
  title: string,
  position: number,
  published: boolean,
) {
  if (!moduleId || !refId) {
    // Dry run: the module or page it would hang off does not exist yet, so
    // there is nothing to look up. Count it, or the dry run reports no items
    // and the real run is a surprise.
    tally.items += 1;
    return;
  }
  const [found] = await db
    .select()
    .from(moduleItems)
    .where(and(eq(moduleItems.moduleId, moduleId), eq(moduleItems.refId, refId)));
  // An unpublished page is the mark scheme: it sits on the module for a marker
  // to find, and asks nothing of anybody.
  const requirement = published ? (type === "quiz" ? "must_submit" : "must_view") : "none";
  const body = { position, published, requirement, title } as const;
  if (found) {
    if (apply) await db.update(moduleItems).set(body).where(eq(moduleItems.id, found.id));
    return;
  }
  tally.items += 1;
  if (!apply) return;
  await db.insert(moduleItems).values({ courseId, moduleId, type, refId, ...body });
}

async function upsertQuiz(courseId: string, spec: NonNullable<Side["quiz"]>, moduleId: string, position: number) {
  const [found] = await db.select().from(quizzes).where(and(eq(quizzes.courseId, courseId), eq(quizzes.title, spec.title)));
  let quizId = found?.id ?? "";
  if (!found && apply) {
    const [made] = await db
      .insert(quizzes)
      .values({
        courseId,
        title: spec.title,
        // One sitting, and no gradebook column: an applicant is not enrolled on
        // a programme, so there is nothing for a score to roll up into.
        quizType: "practice",
        allowedAttempts: 1,
        published: true,
      })
      .returning();
    quizId = made!.id;
  } else if (found && apply) {
    await db.update(quizzes).set({ allowedAttempts: 1, published: true }).where(eq(quizzes.id, found.id));
  }

  for (const [index, question] of spec.questions.entries()) {
    const body = {
      type: "short_answer" as const,
      promptMd: question.prompt,
      promptHtml: renderMarkdown(question.prompt),
      points: question.points,
      // No accepted answers, so autoScore returns null and every essay waits
      // for a marker. That is the whole point of this paper.
      answerKey: { kind: "text" as const, acceptedAnswers: [] as string[] },
    };
    const existing = quizId
      ? (
          await db
            .select()
            .from(quizQuestions)
            .where(and(eq(quizQuestions.quizId, quizId), eq(quizQuestions.position, index + 1)))
        )[0]
      : undefined;
    if (existing) {
      if (apply) await db.update(quizQuestions).set(body).where(eq(quizQuestions.id, existing.id));
      continue;
    }
    tally.questions += 1;
    if (apply && quizId) await db.insert(quizQuestions).values({ quizId, position: index + 1, ...body });
  }

  await upsertItem(courseId, moduleId, quizId, "quiz", spec.title, position, true);
}

try {
  for (const [side, spec] of Object.entries(payload)) {
    const course = await courseFor(spec.externalId);
    console.log(`\n${side} -> ${course.code} (${course.externalId})`);
    let lastModuleId = "";
    for (const [index, mod] of spec.modules.entries()) {
      const module = await upsertModule(course.id, mod.title, index + 1);
      lastModuleId = module.id;
      console.log(`  ${mod.title}: ${mod.pages.length} page(s)`);
      for (const [position, page] of mod.pages.entries()) {
        const row = await upsertPage(course.id, page);
        await upsertItem(course.id, module.id, row.id, "page", page.title, position + 1, page.published);
      }
    }
    if (spec.quiz) {
      await upsertQuiz(course.id, spec.quiz, lastModuleId, (spec.modules.at(-1)?.pages.length ?? 0) + 1);
      console.log(`  quiz: ${spec.quiz.title} (${spec.quiz.questions.length} essays)`);
    }
  }
  console.log(`\n${apply ? "written" : "would write"}:`, tally);
  if (!apply) console.log("Nothing was changed. Re-run with --apply.");
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await database.close();
}
