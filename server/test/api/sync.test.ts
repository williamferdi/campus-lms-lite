import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { courses, enrollments, serviceTokens, terms as termsTable, users } from "../../src/db/schema.js";
import { randomToken, sha256 } from "../../src/lib/crypto.js";
import { createTestEnv, createUser, login, standardCourse, type TestEnv } from "../helpers.js";

let env: TestEnv;
let token: string;

/** Call the API as another system would: a bearer token, no cookie, no CSRF header. */
async function sync(method: "GET" | "POST", url: string, body?: unknown, bearer = token) {
  const r = await env.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${bearer}` },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  let parsed: any = null;
  try {
    parsed = r.json();
  } catch {
    parsed = null;
  }
  return { status: r.statusCode, body: parsed };
}

const person = (over: Record<string, unknown> = {}) => ({
  externalId: "EDU-STU-0001",
  email: "ruth.demo@sibbc.test",
  name: "Ruth Demo",
  role: "student",
  ...over,
});

const course = (over: Record<string, unknown> = {}) => ({
  externalId: "EDU-OFF-0001",
  code: "BIB101",
  name: "Biblical Hermeneutics",
  term: "2026-T2",
  status: "published",
  ...over,
});

beforeAll(async () => {
  env = await createTestEnv();
  token = randomToken();
  await env.database.db
    .insert(serviceTokens)
    .values({ orgId: env.orgId, label: "Frappe registrar", tokenHash: sha256(token) });
});
afterAll(async () => env.close());

describe("who may call the sync endpoints", () => {
  it("accepts a service token", async () => {
    const r = await sync("GET", "/sync/whoami");
    expect(r.status).toBe(200);
    expect(r.body.service.label).toBe("Frappe registrar");
  });

  it("refuses an unknown token", async () => {
    const r = await sync("GET", "/sync/whoami", undefined, randomToken());
    expect(r.status).toBe(401);
  });

  it("refuses a revoked token", async () => {
    const dead = randomToken();
    await env.database.db.insert(serviceTokens).values({
      orgId: env.orgId,
      label: "old laptop",
      tokenHash: sha256(dead),
      revokedAt: new Date(),
    });
    expect((await sync("GET", "/sync/whoami", undefined, dead)).status).toBe(401);
  });

  it("refuses a signed-in person, however senior", async () => {
    // A stolen session must not be able to rewrite the whole roster.
    const admin = await createUser(env, "Sole Admin", "admin");
    const client = await login(env, admin.email);
    expect((await client.get("/sync/whoami")).status).toBe(401);
    expect((await client.post("/sync/people", person())).status).toBe(401);
  });

  it("records who touched a token", async () => {
    await sync("GET", "/sync/whoami");
    const [row] = await env.database.db
      .select()
      .from(serviceTokens)
      .where(eq(serviceTokens.tokenHash, sha256(token)));
    expect(row!.lastUsedAt).not.toBeNull();
  });
});

describe("syncing people", () => {
  it("creates an account with an activation link the registrar can pass on", async () => {
    const r = await sync("POST", "/sync/people", person());
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(true);
    expect(r.body.user.status).toBe("pending");
    expect(r.body.activationUrl).toContain("/activate?token=");
  });

  it("repeats without making a second account", async () => {
    const again = await sync("POST", "/sync/people", person({ name: "Ruth A. Demo" }));
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.user.name).toBe("Ruth A. Demo");
    // No fresh link: it would invalidate the one the student may be about to use.
    expect(again.body.activationUrl).toBeNull();
    const rows = await env.database.db
      .select()
      .from(users)
      .where(eq(users.externalId, "EDU-STU-0001"));
    expect(rows).toHaveLength(1);
  });

  it("adopts somebody who already had an account here", async () => {
    const existing = await createUser(env, "Early Bird", "student");
    const r = await sync("POST", "/sync/people", person({ externalId: "EDU-STU-0002", email: existing.email, name: "Early Bird" }));
    expect(r.body.created).toBe(false);
    expect(r.body.user.id).toBe(existing.id);
    expect(r.body.user.externalId).toBe("EDU-STU-0002");
  });

  it("refuses to move an address already linked to another record", async () => {
    const r = await sync("POST", "/sync/people", person({ externalId: "EDU-STU-9999" }));
    expect(r.status).toBe(409);
  });

  it("never demotes an administrator of this system", async () => {
    // The registrar does not know who administers the LMS; being wrong locks everybody out.
    const admin = await createUser(env, "Ivy Admin", "admin");
    const r = await sync("POST", "/sync/people", person({ externalId: "EDU-STF-0001", email: admin.email, name: "Ivy Admin", role: "student" }));
    expect(r.body.user.role).toBe("admin");
  });
});

describe("syncing courses and enrolments", () => {
  it("creates a course, then updates the same one", async () => {
    const made = await sync("POST", "/sync/courses", course());
    expect(made.status).toBe(201);
    expect(made.body.course.status).toBe("published");

    const again = await sync("POST", "/sync/courses", course({ name: "Hermeneutics" }));
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.course.id).toBe(made.body.course.id);
    expect(again.body.course.name).toBe("Hermeneutics");
  });

  it("enrols a synced student on a synced course", async () => {
    const r = await sync("POST", "/sync/enrollments", {
      externalId: "EDU-REG-0001",
      personExternalId: "EDU-STU-0001",
      courseExternalId: "EDU-OFF-0001",
      role: "student",
    });
    expect(r.status).toBe(201);
    expect(r.body.enrollment.role).toBe("student");

    const again = await sync("POST", "/sync/enrollments", {
      externalId: "EDU-REG-0001",
      personExternalId: "EDU-STU-0001",
      courseExternalId: "EDU-OFF-0001",
      role: "student",
      status: "completed",
    });
    expect(again.body.created).toBe(false);
    const rows = await env.database.db
      .select()
      .from(enrollments)
      .where(eq(enrollments.externalId, "EDU-REG-0001"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("completed");
  });

  it("says plainly when the person or course has not been synced yet", async () => {
    const r = await sync("POST", "/sync/enrollments", {
      externalId: "EDU-REG-0002",
      personExternalId: "EDU-STU-NOPE",
      courseExternalId: "EDU-OFF-0001",
    });
    expect(r.status).toBe(404);
    expect(r.body.error.message).toContain("EDU-STU-NOPE");
  });
});

describe("re-filing a person who changes identity", () => {
  it("keeps the account and moves the key", async () => {
    // An applicant is admitted: APP-2026-00014 becomes SIB-2026-0003, same
    // person, same address, and the exam they already sat must come with them.
    const made = await sync("POST", "/sync/people", person({ externalId: "APP-0001", email: "moving@sibbc.test" }));
    expect(made.status).toBe(201);

    const moved = await sync("POST", "/sync/people", {
      ...person({ externalId: "SIB-0001", email: "moving@sibbc.test" }),
      replacesExternalId: "APP-0001",
    });

    expect(moved.body.created).toBe(false);
    expect(moved.body.user.id).toBe(made.body.user.id);
    expect(moved.body.user.externalId).toBe("SIB-0001");
    const rows = await env.database.db.select().from(users).where(eq(users.email, "moving@sibbc.test"));
    expect(rows).toHaveLength(1);
  });

  it("still refuses when nothing says they are the same person", async () => {
    await sync("POST", "/sync/people", person({ externalId: "APP-0002", email: "staying@sibbc.test" }));
    const r = await sync("POST", "/sync/people", person({ externalId: "SIB-0002", email: "staying@sibbc.test" }));
    expect(r.status).toBe(409);
  });
});

/** One set of people for the read tests: `standardCourse` names its users, so
 *  building it twice in one database collides on the email index. */
let fx: Awaited<ReturnType<typeof standardCourse>>;

describe("reading progress back", () => {
  const COURSE = "EDU-OFF-PROG";
  const STUDENT = "EDU-STU-PROG";

  beforeAll(async () => {
    fx = await standardCourse(env);
    await env.database.db.update(courses).set({ externalId: COURSE }).where(eq(courses.id, fx.courseId));
    await env.database.db.update(users).set({ externalId: STUDENT }).where(eq(users.id, fx.users.s1.id));
  });

  it("is closed to a signed-in person, however senior", async () => {
    const r = await fx.admin.get(`/sync/progress?personExternalId=${STUDENT}&courseExternalId=${COURSE}`);
    expect(r.status).toBe(401);
  });

  it("a course that asks nothing of anybody is not complete", async () => {
    // Otherwise an empty course would let a candidate sign to say they had read
    // a manual that does not exist yet.
    const r = await sync("GET", `/sync/progress?personExternalId=${STUDENT}&courseExternalId=${COURSE}`);
    expect(r.status).toBe(200);
    expect(r.body.required).toBe(0);
    expect(r.body.complete).toBe(false);
  });

  it("reports completion once the required reading is done", async () => {
    const page = (await fx.teacher.post(`/courses/${fx.courseId}/pages`, { title: "Welcome", bodyMd: "Read me", published: true })).body.page;
    const module = (await fx.teacher.post(`/courses/${fx.courseId}/modules`, { title: "Orientation", published: true })).body.module;
    await fx.teacher.post(`/modules/${module.id}/items`, { type: "page", refId: page.id, requirement: "must_view", published: true });

    const before = await sync("GET", `/sync/progress?personExternalId=${STUDENT}&courseExternalId=${COURSE}`);
    expect(before.body).toMatchObject({ required: 1, completed: 0, complete: false });

    await fx.s1.get(`/pages/${page.id}`);

    const after = await sync("GET", `/sync/progress?personExternalId=${STUDENT}&courseExternalId=${COURSE}`);
    expect(after.body).toMatchObject({ required: 1, completed: 1, percent: 100, complete: true });
  });

  it("says which of the two it could not find", async () => {
    const r = await sync("GET", `/sync/progress?personExternalId=EDU-STU-NOPE&courseExternalId=${COURSE}`);
    expect(r.status).toBe(404);
    expect(r.body.error.message).toContain("EDU-STU-NOPE");
  });
});

describe("reading exam results back", () => {
  let examCourseId: string;
  let quizId: string;
  let questionIds: string[];
  const COURSE = "EDU-OFF-EXAM";
  const CANDIDATE = "APP-EXAM-0001";

  beforeAll(async () => {
    // Its own course, as the entrance exam is: the candidate is enrolled here
    // and nowhere else, which is the whole of their isolation.
    examCourseId = (await fx.admin.post("/courses", { code: "ENTRANCE", name: "Entrance Exam" })).body.course.id;
    await fx.admin.post(`/courses/${examCourseId}/enrollments`, { email: fx.users.teacher.email, role: "teacher" });
    await fx.admin.post(`/courses/${examCourseId}/enrollments`, { email: fx.users.s2.email, role: "student" });
    await fx.admin.post(`/courses/${examCourseId}/status`, { status: "published" });
    await env.database.db.update(courses).set({ externalId: COURSE }).where(eq(courses.id, examCourseId));
    await env.database.db.update(users).set({ externalId: CANDIDATE }).where(eq(users.id, fx.users.s2.id));

    // The entrance exam: essays are short answers with no accepted answer, so
    // every one of them falls to a marker.
    const quiz = (await fx.teacher.post(`/courses/${examCourseId}/quizzes`, { title: "Entrance Exam — Essays", allowedAttempts: 1 })).body.quiz;
    quizId = quiz.id;
    questionIds = [];
    for (const prompt of ["Why this programme?", "Describe your call.", "A passage that shaped you."]) {
      const q = await fx.teacher.post(`/quizzes/${quizId}/questions`, { type: "short_answer", prompt, points: 25 });
      questionIds.push(q.body.question.id);
    }
    await fx.teacher.patch(`/quizzes/${quizId}`, { published: true });
  });

  it("flags an attempt nobody has marked instead of calling it zero", async () => {
    const attempt = (await fx.s2.post(`/quizzes/${quizId}/attempts`)).body.attempt;
    await fx.s2.post(`/quiz-attempts/${attempt.id}/submit`, {
      answers: Object.fromEntries(questionIds.map((id, i) => [id, `Essay ${i + 1}`])),
    });

    const r = await sync("GET", `/sync/quiz-results?courseExternalId=${COURSE}&personExternalId=${CANDIDATE}`);
    expect(r.status).toBe(200);
    expect(r.body.attempts).toHaveLength(1);
    const [row] = r.body.attempts;
    expect(row.awaitingMarking).toBe(true);
    expect(row.person.externalId).toBe(CANDIDATE);
    expect(row.pointsPossible).toBe(75);
    expect(row.questions.map((q: { earned: number | null }) => q.earned)).toEqual([null, null, null]);
    expect(row.questions[0].prompt).toContain("Why this programme");
    expect(row.questions[0].answer).toBe("Essay 1");
  });

  it("reports the marker's figures, in the order the essays are asked", async () => {
    const attempts = await fx.teacher.get(`/quizzes/${quizId}/attempts`);
    const attemptId = attempts.body.data[0].id;
    await fx.teacher.put(`/quiz-attempts/${attemptId}/grade`, {
      scores: { [questionIds[0]!]: 20, [questionIds[1]!]: 15, [questionIds[2]!]: 18 },
    });

    const r = await sync("GET", `/sync/quiz-results?courseExternalId=${COURSE}&personExternalId=${CANDIDATE}`);
    const [row] = r.body.attempts;
    expect(row.awaitingMarking).toBe(false);
    expect(row.questions.map((q: { position: number }) => q.position)).toEqual([1, 2, 3]);
    expect(row.questions.map((q: { earned: number }) => q.earned)).toEqual([20, 15, 18]);
    expect(row.score).toBe(53);
  });
});

describe("embedded video", () => {
  it("sends the origin to the video host, and never the path", async () => {
    // helmet defaults to no-referrer, and YouTube then refuses to play with
    // "Video player configuration error" (153), because it cannot tell which
    // site is framing it. The path stays private either way.
    const r = await env.app.inject({ method: "GET", url: "/api/v1/sync/whoami", headers: { authorization: `Bearer ${token}` } });
    expect(r.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});

describe("reporting a removal, not making one", () => {
  // The registrar deletes a Student or a Course Offering and tells this system
  // so. Both write endpoints upsert, so without a guard "deactivate this
  // person" would *create* an account for somebody who has just stopped
  // existing over there -- which is exactly what clearing the demo data would
  // have done.

  it("does not create a person it has never heard of", async () => {
    const before = await env.database.db.select().from(users);

    const r = await sync("POST", "/sync/people", person({
      externalId: "EDU-STU-GONE",
      email: "gone@sibbc.test",
      status: "deactivated",
      onlyIfPresent: true,
    }));

    expect(r.status).toBe(200);
    expect(r.body.found).toBe(false);
    expect(r.body.created).toBe(false);
    const after = await env.database.db.select().from(users);
    expect(after.length).toBe(before.length);
  });

  it("still deactivates a person it does know", async () => {
    await sync("POST", "/sync/people", person({ externalId: "EDU-STU-HERE", email: "here@sibbc.test" }));

    const r = await sync("POST", "/sync/people", person({
      externalId: "EDU-STU-HERE",
      email: "here@sibbc.test",
      status: "deactivated",
      onlyIfPresent: true,
    }));

    expect(r.status).toBe(200);
    expect(r.body.created).toBe(false);
    const [row] = await env.database.db.select().from(users).where(eq(users.externalId, "EDU-STU-HERE"));
    expect(row?.status).toBe("deactivated");
  });

  it("does not create a course it has never heard of", async () => {
    const before = await env.database.db.select().from(courses);

    const r = await sync("POST", "/sync/courses", course({
      externalId: "EDU-OFF-GONE",
      status: "archived",
      onlyIfPresent: true,
    }));

    expect(r.status).toBe(200);
    expect(r.body.found).toBe(false);
    const after = await env.database.db.select().from(courses);
    expect(after.length).toBe(before.length);
  });

  it("leaves no term behind when it declines to create the course", async () => {
    // termIdFor creates the term if it is new, so the bail-out has to come
    // first or a no-op litters.
    const r = await sync("POST", "/sync/courses", course({
      externalId: "EDU-OFF-GONE-2",
      term: "9999-TZ",
      status: "archived",
      onlyIfPresent: true,
    }));

    expect(r.body.found).toBe(false);
    const terms = await env.database.db.select().from(termsTable);
    expect(terms.some((t) => t.name === "9999-TZ")).toBe(false);
  });

  it("still archives a course it does know", async () => {
    await sync("POST", "/sync/courses", course({ externalId: "EDU-OFF-HERE" }));

    const r = await sync("POST", "/sync/courses", course({
      externalId: "EDU-OFF-HERE",
      status: "archived",
      onlyIfPresent: true,
    }));

    expect(r.status).toBe(200);
    const [row] = await env.database.db.select().from(courses).where(eq(courses.externalId, "EDU-OFF-HERE"));
    expect(row?.status).toBe("archived");
  });

  it("creates as before when the flag is absent", async () => {
    const r = await sync("POST", "/sync/people", person({ externalId: "EDU-STU-NEW", email: "new@sibbc.test" }));
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(true);
  });
});

describe("reading course results back", () => {
  const COURSE = "EDU-OFF-GRADES";
  const STUDENT = "SIB-2026-0099";
  const REGISTRATION = "SIB-2026-0099-MDIV-EDU-OFF-GRADES";
  const CLASSMATE = "SIB-2026-0100";
  const CLASSMATE_REG = "SIB-2026-0100-MDIV-EDU-OFF-GRADES";
  let courseId: string;
  let studentId: string;
  let paper: string;
  let reflection: string;

  const read = async (person?: string) =>
    (await sync("GET", `/sync/grades?courseExternalId=${COURSE}${person ? `&personExternalId=${person}` : ""}`)).body;
  const only = async (person: string) => (await read(person)).students[0];

  beforeAll(async () => {
    // Everything arrives the way the registrar sends it.
    await sync("POST", "/sync/courses", course({ externalId: COURSE, code: "HIST501", name: "History of Christianity", term: "2026-T3" }));
    await sync("POST", "/sync/people", person({ externalId: STUDENT, email: "grade.probe@sibbc.test", name: "Grade Probe" }));
    await sync("POST", "/sync/enrollments", { externalId: REGISTRATION, personExternalId: STUDENT, courseExternalId: COURSE, role: "student" });

    const [row] = await env.database.db.select().from(courses).where(eq(courses.externalId, COURSE));
    courseId = row!.id;
    const [me] = await env.database.db.select().from(users).where(eq(users.externalId, STUDENT));
    studentId = me!.id;

    await fx.admin.post(`/courses/${courseId}/enrollments`, { email: fx.users.teacher.email, role: "teacher" });
    await fx.admin.post(`/courses/${courseId}/status`, { status: "published" });

    // Two equal pieces of work, so the arithmetic in the assertions is legible.
    // The paper is marked `postManually`, because that is the only way a mark
    // is ever held back here: left to itself this LMS releases a grade the
    // moment it is entered.
    paper = (
      await fx.teacher.post(`/courses/${courseId}/assignments`, {
        title: "Term Paper",
        pointsPossible: 100,
        published: true,
        postManually: true,
        submissionTypes: ["online_text_entry"],
      })
    ).body.assignment.id;
    reflection = (await fx.teacher.post(`/courses/${courseId}/assignments`, { title: "Reflection", pointsPossible: 100, published: true })).body.assignment.id;
  });

  it("refuses a course it has never heard of", async () => {
    expect((await sync("GET", "/sync/grades?courseExternalId=EDU-OFF-NOPE")).status).toBe(404);
  });

  it("reports nothing earned before anybody marks anything", async () => {
    const mine = await only(STUDENT);
    expect(mine.enrollmentExternalId).toBe(REGISTRATION);
    expect(mine.assignments).toBe(2);
    expect(mine.posted).toBe(0);
    expect(mine.current.percent).toBeNull();
    expect(mine.final.percent).toBe(0);
  });

  it("withholds a mark that has been graded but not released", async () => {
    await fx.teacher.put(`/assignments/${paper}/submissions/${studentId}/grade`, { grade: "80" });
    const mine = await only(STUDENT);
    expect(mine.gradedUnposted).toBe(1);
    expect(mine.posted).toBe(0);
    // Neither total may show it: the student cannot see it yet either.
    expect(mine.current.percent).toBeNull();
    expect(mine.final.percent).toBe(0);
  });

  it("separates the running average from the end-of-course figure", async () => {
    await fx.teacher.post(`/assignments/${paper}/post-grades`);
    const mine = await only(STUDENT);
    expect(mine.posted).toBe(1);
    expect(mine.gradedUnposted).toBe(0);
    // 80 of the 100 marked so far, but 80 of the 200 the course is worth. This
    // is the whole reason both are sent: recording `final` here would put 40%
    // on a transcript for a course half of which nobody has marked.
    expect(mine.current.percent).toBe(80);
    expect(mine.final.percent).toBe(40);
  });

  it("agrees with itself once every piece of work is released", async () => {
    await fx.teacher.put(`/assignments/${reflection}/submissions/${studentId}/grade`, { grade: "60" });
    await fx.teacher.post(`/assignments/${reflection}/post-grades`);
    const mine = await only(STUDENT);
    expect(mine.posted).toBe(2);
    expect(mine.current.percent).toBe(70);
    expect(mine.final.percent).toBe(70);
  });

  it("counts work that is waiting for a marker", async () => {
    // A classmate who hands something in and waits. `awaitingMarking` is what
    // stops the registrar recording a result mid-marking.
    await sync("POST", "/sync/people", person({ externalId: CLASSMATE, email: fx.users.ta.email, name: fx.users.ta.name }));
    await sync("POST", "/sync/enrollments", { externalId: CLASSMATE_REG, personExternalId: CLASSMATE, courseExternalId: COURSE, role: "student" });
    await fx.ta.post(`/assignments/${paper}/submit`, { submissionType: "online_text_entry", body: "Mine" });

    const theirs = await only(CLASSMATE);
    expect(theirs.awaitingMarking).toBe(1);
    expect(theirs.current.percent).toBeNull();
  });

  it("lists only enrolments the registrar made, and counts the rest", async () => {
    // Somebody enrolled by hand over here has no registration, no fee and no
    // transcript. Dropping them silently would hide that; the count does not.
    await fx.admin.post(`/courses/${courseId}/enrollments`, { email: fx.users.outsider.email, role: "student" });
    const all = await read();
    expect(all.unmanagedStudents).toBe(1);
    expect(all.students.map((s: { enrollmentExternalId: string }) => s.enrollmentExternalId).sort()).toEqual([REGISTRATION, CLASSMATE_REG]);
  });
});

describe("the registrar's level and programmes ride with the course", () => {
  const COURSE = "EDU-OFF-LEVEL";

  const push = (over: Record<string, unknown> = {}) =>
    sync("POST", "/sync/courses", course({ externalId: COURSE, code: "BIST502", name: "Intro to OT", ...over }));

  const read = async () => {
    const [row] = await env.database.db.select().from(courses).where(eq(courses.externalId, COURSE));
    return row!;
  };

  it("carries them in on creation", async () => {
    const r = await push({ level: "2", programs: ["MDIV", "GDCS"] });
    expect(r.status).toBe(201);
    expect(r.body.course.level).toBe("2");
    expect(r.body.course.programs).toEqual(["MDIV", "GDCS"]);
    const row = await read();
    expect(row.level).toBe("2");
    expect(row.programs).toEqual(["MDIV", "GDCS"]);
  });

  it("updates them when the registrar corrects the catalogue", async () => {
    const r = await push({ level: "3", programs: ["MDIV"] });
    expect(r.body.course.level).toBe("3");
    expect((await read()).programs).toEqual(["MDIV"]);
  });

  it("lets a course stop counting towards a programme", async () => {
    // Sent as empty, not left out: the registrar has to be able to say that a
    // course now counts towards nothing.
    await push({ level: "3", programs: [] });
    expect((await read()).programs).toEqual([]);
  });

  it("leaves them alone when the registrar does not mention them", async () => {
    // A registrar that has not been upgraded sends neither key. Treating that
    // as "clear them" would blank every course on every ordinary push.
    await push({ level: "4", programs: ["MACS"] });
    await push({ status: "published" });
    const row = await read();
    expect(row.level).toBe("4");
    expect(row.programs).toEqual(["MACS"]);
    expect(row.status).toBe("published");
  });

  it("clears the level only when told to", async () => {
    await push({ level: null });
    expect((await read()).level).toBeNull();
  });

  it("gives a course made by hand here no level and no programmes", async () => {
    const made = await fx.admin.post("/courses", { code: "HAND101", name: "Made by hand" });
    expect(made.body.course.level).toBeNull();
    expect(made.body.course.programs).toEqual([]);
  });
});

describe("filtering the course list by level and programme", () => {
  const made: string[] = [];

  const push = (externalId: string, over: Record<string, unknown>) =>
    sync("POST", "/sync/courses", course({ externalId, ...over }));

  beforeAll(async () => {
    // A small catalogue: two Level 1 courses in different programmes, one of
    // which counts towards both, and a Level 2.
    await push("EDU-FLT-1", { code: "FLT101", name: "Old Testament", level: "1", programs: ["MDIV"] });
    await push("EDU-FLT-2", { code: "FLT102", name: "New Testament", level: "1", programs: ["MDIV", "GDCS"] });
    await push("EDU-FLT-3", { code: "FLT201", name: "Hermeneutics", level: "2", programs: ["GDCS"] });
    made.push("EDU-FLT-1", "EDU-FLT-2", "EDU-FLT-3");
    for (const externalId of made) {
      const [row] = await env.database.db.select().from(courses).where(eq(courses.externalId, externalId));
      await fx.admin.post(`/courses/${row!.id}/status`, { status: "published" });
    }
  });

  const codes = async (query: string) => {
    const r = await fx.admin.get(`/courses?scope=all&perPage=100${query}`);
    expect(r.status).toBe(200);
    return r.body.data.map((c: { code: string }) => c.code).filter((c: string) => c.startsWith("FLT")).sort();
  };

  it("narrows by level", async () => {
    expect(await codes("&level=1")).toEqual(["FLT101", "FLT102"]);
    expect(await codes("&level=2")).toEqual(["FLT201"]);
  });

  it("narrows by programme, matching a course that counts towards several", async () => {
    // FLT102 is in both; asking for GDCS must find it without naming MDIV too.
    expect(await codes("&program=GDCS")).toEqual(["FLT102", "FLT201"]);
    expect(await codes("&program=MDIV")).toEqual(["FLT101", "FLT102"]);
  });

  it("combines the two", async () => {
    expect(await codes("&level=1&program=GDCS")).toEqual(["FLT102"]);
    expect(await codes("&level=2&program=MDIV")).toEqual([]);
  });

  it("matches a programme exactly, never as a fragment", async () => {
    // "MDIV" must not be found by asking for "MD", or a filter would quietly
    // return courses belonging to a different programme.
    expect(await codes("&program=MD")).toEqual([]);
  });

  it("offers only the levels and programmes that exist", async () => {
    const r = await fx.admin.get("/courses/facets");
    expect(r.status).toBe(200);
    expect(r.body.levels).toEqual(expect.arrayContaining(["1", "2"]));
    expect(r.body.programs).toEqual(expect.arrayContaining(["GDCS", "MDIV"]));
    // Sorted and without repeats, so the dropdown is stable between loads.
    expect(r.body.programs).toEqual([...new Set(r.body.programs)].sort());
  });

  it("does not collide with the course-by-id route", async () => {
    // "facets" is a static segment and must win over /courses/:id.
    const r = await fx.admin.get("/courses/facets");
    expect(r.body).toHaveProperty("levels");
  });
});

describe("a second activation link, when the first one lapsed", () => {
  // The registrar's "resend" button needs a working link, and /sync/people
  // deliberately hands one out only on creation -- a token issued twice
  // invalidates the first, and a routine re-sync would break the link the
  // candidate was about to use. So asking is a deliberate act of its own.

  it("issues a fresh one for somebody who never activated", async () => {
    await sync("POST", "/sync/people", person({ externalId: "EDU-APP-9001", email: "late.candidate@sibbc.test" }));

    const r = await sync("POST", "/sync/people/EDU-APP-9001/activation-link");
    expect(r.status).toBe(200);
    expect(r.body.url).toContain("/activate?token=");
    expect(r.body.expiresInHours).toBe(168);
  });

  it("gives a different link each time it is asked", async () => {
    const first = await sync("POST", "/sync/people/EDU-APP-9001/activation-link");
    const second = await sync("POST", "/sync/people/EDU-APP-9001/activation-link");
    expect(second.body.url).not.toBe(first.body.url);
  });

  it("refuses for somebody who has already set a password", async () => {
    // A service token may finish an onboarding nobody completed. Minting
    // password resets for live accounts is a much larger power, and those
    // people have Forgot password.
    const active = await createUser(env, "Settled Student", "student");
    await env.database.db
      .update(users)
      .set({ externalId: "EDU-APP-9002" })
      .where(eq(users.id, active.id));

    const r = await sync("POST", "/sync/people/EDU-APP-9002/activation-link");
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain("Forgot password");
  });

  it("says plainly when it has never heard of them", async () => {
    const r = await sync("POST", "/sync/people/EDU-APP-NOBODY/activation-link");
    expect(r.status).toBe(404);
  });

  it("is closed to anyone without a service token", async () => {
    const r = await sync("POST", "/sync/people/EDU-APP-9001/activation-link", undefined, "not-a-real-token");
    expect(r.status).toBe(401);
  });
});

describe("the not-found handler keeps the message the registrar reads", () => {
  // The registrar cannot tell "I do not serve that address" from "I have never
  // heard of that person" by status or code: this handler and the app's own
  // notFound() both answer 404 with code "not_found". Only the message differs,
  // so it keys on this exact string -- see campus_lms.ROUTE_MISSING on that
  // side. An LMS that has not been restarted since an endpoint was added would
  // otherwise report itself as a candidate who does not exist.
  it("answers an address it does not serve with the string the registrar keys on", async () => {
    const r = await sync("POST", "/sync/people/EDU-APP-9001/no-such-endpoint");
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("not_found");
    expect(r.body.error.message).toBe("Route not found.");
  });

  it("says something different when it is the person it cannot find", async () => {
    const r = await sync("POST", "/sync/people/EDU-APP-NOBODY-AT-ALL/activation-link");
    expect(r.status).toBe(404);
    expect(r.body.error.message).not.toBe("Route not found.");
  });
});
