import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { courses, enrollments, serviceTokens, users } from "../../src/db/schema.js";
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
