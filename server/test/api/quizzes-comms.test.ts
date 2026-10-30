import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discussionTopics, quizAttempts } from "../../src/db/schema.js";
import { createTestEnv, standardCourse, type TestEnv } from "../helpers.js";

let env: TestEnv;
let fx: Awaited<ReturnType<typeof standardCourse>>;
const day = 24 * 3600 * 1000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

beforeAll(async () => {
  env = await createTestEnv();
  fx = await standardCourse(env);
});
afterAll(async () => env.close());

async function buildQuiz(settings: Record<string, unknown> = {}) {
  const q = await fx.teacher.post(`/courses/${fx.courseId}/quizzes`, { title: "Cell Quiz", ...settings });
  expect(q.status).toBe(201);
  const id = q.body.quiz.id as string;
  const add = (body: Record<string, unknown>) => fx.teacher.post(`/quizzes/${id}/questions`, body);
  const mc = (await add({ type: "multiple_choice", prompt: "Powerhouse of the cell?", points: 2, choices: [{ text: "Nucleus" }, { text: "Mitochondria" }], correctChoiceIndexes: [1] })).body.question;
  const ms = (await add({ type: "multiple_select", prompt: "Which are organelles?", points: 2, choices: [{ text: "Ribosome" }, { text: "Golgi" }, { text: "Pancreas" }], correctChoiceIndexes: [0, 1] })).body.question;
  const tf = (await add({ type: "true_false", prompt: "Cells have walls in animals.", points: 1, correctBoolean: false })).body.question;
  const sa = (await add({ type: "short_answer", prompt: "Explain osmosis.", points: 5 })).body.question;
  return { id, mc, ms, tf, sa, assignmentId: q.body.quiz.assignmentId as string };
}

describe("quiz authoring", () => {
  it("validates questions and requires questions before publishing", async () => {
    const q = await fx.teacher.post(`/courses/${fx.courseId}/quizzes`, { title: "Empty" });
    expect((await fx.teacher.patch(`/quizzes/${q.body.quiz.id}`, { published: true })).status).toBe(422);
    expect((await fx.teacher.post(`/quizzes/${q.body.quiz.id}/questions`, { type: "multiple_choice", prompt: "x", choices: [{ text: "a" }, { text: "b" }], correctChoiceIndexes: [] })).status).toBe(422);
    expect((await fx.teacher.post(`/quizzes/${q.body.quiz.id}/questions`, { type: "true_false", prompt: "x" })).status).toBe(422);
  });

  it("keeps the linked assignment's points in sync", async () => {
    const quiz = await buildQuiz();
    const a = await fx.teacher.get(`/assignments/${quiz.assignmentId}`);
    expect(a.body.assignment.pointsPossible).toBe(10);
    expect(a.body.assignment.submissionTypes).toEqual(["online_quiz"]);
  });
});

describe("taking a quiz", () => {
  let quiz: Awaited<ReturnType<typeof buildQuiz>>;
  beforeAll(async () => {
    quiz = await buildQuiz({ allowedAttempts: 2, timeLimitMinutes: 30 });
    await fx.teacher.patch(`/quizzes/${quiz.id}`, { published: true });
  });

  it("never exposes answer keys to students", async () => {
    expect((await fx.s1.get(`/quizzes/${quiz.id}/questions`)).status).toBe(403);
    const start = await fx.s1.post(`/quizzes/${quiz.id}/attempts`);
    expect(start.status).toBe(201);
    const text = JSON.stringify(start.body);
    expect(text).not.toContain("answerKey");
    expect(text).not.toContain("correctChoiceIds");
    expect(start.body.attempt.expiresAt).toBeTruthy();
  });

  it("resumes the open attempt instead of creating another", async () => {
    const again = await fx.s1.post(`/quizzes/${quiz.id}/attempts`);
    expect(again.body.resumed).toBe(true);
    expect(again.body.attempt.attemptNumber).toBe(1);
  });

  it("autosaves answers, auto-grades objective questions and leaves short answer for review", async () => {
    const open = (await fx.s1.post(`/quizzes/${quiz.id}/attempts`)).body.attempt;
    const mitochondria = quiz.mc.choices[1].id;
    const save = await fx.s1.put(`/quiz-attempts/${open.id}/answers`, { answers: { [quiz.mc.id]: mitochondria, [quiz.tf.id]: false, bogus: "x" } });
    expect(save.status).toBe(200);
    const sub = await fx.s1.post(`/quiz-attempts/${open.id}/submit`, {
      answers: { [quiz.ms.id]: [quiz.ms.choices[0].id, quiz.ms.choices[1].id], [quiz.sa.id]: "Water moves across a membrane." },
    });
    expect(sub.status).toBe(200);
    expect(sub.body.attempt.status).toBe("pending_review");
    // Student sees their answers but no score yet (pending review, nothing posted).
    expect(sub.body.attempt.score).toBeNull();
    // Grader sees the auto-scored 5/10 plus the open question.
    const g = await fx.teacher.get(`/quiz-attempts/${open.id}`);
    expect(g.body.attempt.score).toBe(5);
    expect(g.body.attempt.questions.find((q: { id: string }) => q.id === quiz.sa.id).needsReview).toBe(true);
    const sub2 = await fx.teacher.get(`/assignments/${quiz.assignmentId}/submissions`);
    expect(sub2.body.summary.needsGrading).toBe(1);
  });

  it("manual grading completes the attempt and posts to the gradebook", async () => {
    const attempts = await fx.teacher.get(`/quizzes/${quiz.id}/attempts`);
    const attemptId = attempts.body.data[0].id;
    expect((await fx.s1.put(`/quiz-attempts/${attemptId}/grade`, { scores: { [quiz.sa.id]: 5 } })).status).toBe(403);
    expect((await fx.teacher.put(`/quiz-attempts/${attemptId}/grade`, { scores: { [quiz.sa.id]: 9 } })).status).toBe(422);
    const r = await fx.teacher.put(`/quiz-attempts/${attemptId}/grade`, { scores: { [quiz.sa.id]: 4 }, comments: { [quiz.sa.id]: "Mention concentration." } });
    expect(r.body.attempt).toMatchObject({ status: "graded", score: 9 });
    const grades = await fx.s1.get(`/courses/${fx.courseId}/grades/me`);
    expect(grades.body.assignments.find((a: { id: string }) => a.id === quiz.assignmentId)).toMatchObject({ score: 9, posted: true });
    const view = await fx.s1.get(`/quiz-attempts/${attemptId}`);
    expect(view.body.attempt.score).toBe(9);
    expect(view.body.attempt.questions.find((q: { id: string }) => q.id === quiz.sa.id).comment).toBe("Mention concentration.");
  });

  it("other students cannot open someone else's attempt", async () => {
    const attempts = await fx.teacher.get(`/quizzes/${quiz.id}/attempts`);
    expect((await fx.s2.get(`/quiz-attempts/${attempts.body.data[0].id}`)).status).toBe(404);
  });

  it("server enforces the time limit: expired attempts auto-submit and reject late answers", async () => {
    const open = (await fx.s2.post(`/quizzes/${quiz.id}/attempts`)).body.attempt;
    await fx.s2.put(`/quiz-attempts/${open.id}/answers`, { answers: { [quiz.tf.id]: false } });
    await env.database.db.update(quizAttempts).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(quizAttempts.id, open.id));
    const late = await fx.s2.put(`/quiz-attempts/${open.id}/answers`, { answers: { [quiz.mc.id]: quiz.mc.choices[1].id } });
    expect(late.status).toBe(409);
    const view = await fx.teacher.get(`/quiz-attempts/${open.id}`);
    expect(view.body.attempt.status).not.toBe("in_progress");
    expect(view.body.attempt.score).toBe(1); // only the answer saved before expiry counted
  });

  it("enforces the attempt limit", async () => {
    const second = await fx.s1.post(`/quizzes/${quiz.id}/attempts`);
    expect(second.status).toBe(201);
    await fx.s1.post(`/quiz-attempts/${second.body.attempt.id}/submit`, { answers: {} });
    const third = await fx.s1.post(`/quizzes/${quiz.id}/attempts`);
    expect(third.status).toBe(403);
    expect(third.body.error.message).toMatch(/attempts/);
  });

  it("staff cannot take quizzes; students cannot edit them", async () => {
    expect((await fx.teacher.post(`/quizzes/${quiz.id}/attempts`)).status).toBe(403);
    expect((await fx.s1.patch(`/quizzes/${quiz.id}`, { title: "hack" })).status).toBe(403);
  });

  it("cannot unpublish once started", async () => {
    expect((await fx.teacher.patch(`/quizzes/${quiz.id}`, { published: false })).status).toBe(409);
  });
});

describe("quiz result release settings", () => {
  it("hide results 'always' and manual posting hide scores and correctness", async () => {
    const quiz = await buildQuiz({ hideResults: "always", postManually: true });
    await fx.teacher.del(`/quiz-questions/${quiz.sa.id}`);
    await fx.teacher.patch(`/quizzes/${quiz.id}`, { published: true });
    const a = (await fx.s1.post(`/quizzes/${quiz.id}/attempts`)).body.attempt;
    const done = await fx.s1.post(`/quiz-attempts/${a.id}/submit`, { answers: { [quiz.mc.id]: quiz.mc.choices[1].id } });
    expect(done.body.attempt.status).toBe("graded");
    expect(done.body.attempt.score).toBeNull();
    expect(done.body.attempt.questions[0]).not.toHaveProperty("correct");
    expect(done.body.attempt.questions[0]).not.toHaveProperty("answerKey");
    await fx.teacher.post(`/assignments/${quiz.assignmentId}/post-grades`);
    const after = await fx.s1.get(`/quiz-attempts/${a.id}`);
    expect(after.body.attempt.score).toBe(2); // score visible once posted …
    expect(after.body.attempt.questions[0]).not.toHaveProperty("correct"); // … responses stay hidden
  });

  it("practice quizzes have no gradebook entry and show results immediately", async () => {
    const quiz = await buildQuiz({ quizType: "practice" });
    expect(quiz.assignmentId).toBeNull();
    await fx.teacher.del(`/quiz-questions/${quiz.sa.id}`);
    await fx.teacher.patch(`/quizzes/${quiz.id}`, { published: true });
    const a = (await fx.s1.post(`/quizzes/${quiz.id}/attempts`)).body.attempt;
    const done = await fx.s1.post(`/quiz-attempts/${a.id}/submit`, { answers: { [quiz.tf.id]: true } });
    expect(done.body.attempt.score).toBe(0);
    expect(done.body.attempt.questions.find((q: { id: string }) => q.id === quiz.tf.id)).toMatchObject({ correct: false, answerKey: { kind: "boolean", value: false } });
  });

  it("regrade applies a corrected answer key", async () => {
    const quiz = await buildQuiz();
    await fx.teacher.del(`/quiz-questions/${quiz.sa.id}`);
    await fx.teacher.patch(`/quizzes/${quiz.id}`, { published: true });
    const a = (await fx.s2.post(`/quizzes/${quiz.id}/attempts`)).body.attempt;
    await fx.s2.post(`/quiz-attempts/${a.id}/submit`, { answers: { [quiz.mc.id]: quiz.mc.choices[0].id } });
    await fx.teacher.patch(`/quiz-questions/${quiz.mc.id}`, { type: "multiple_choice", prompt: "Powerhouse?", points: 2, choices: quiz.mc.choices, correctChoiceIndexes: [0] });
    expect((await fx.teacher.post(`/quizzes/${quiz.id}/regrade`)).body.regraded).toBe(1);
    expect((await fx.teacher.get(`/quiz-attempts/${a.id}`)).body.attempt.score).toBe(2);
  });
});

describe("discussions", () => {
  let topicId: string;
  beforeAll(async () => {
    const r = await fx.teacher.post(`/courses/${fx.courseId}/discussions`, { title: "Week 1 reflections", body: "What surprised you?", published: true, requireInitialPost: true });
    topicId = r.body.topic.id;
  });

  it("students cannot create topics or announcements", async () => {
    expect((await fx.s1.post(`/courses/${fx.courseId}/discussions`, { title: "Mine" })).status).toBe(403);
    expect((await fx.s1.post(`/courses/${fx.courseId}/discussions`, { title: "News", isAnnouncement: true })).status).toBe(403);
  });

  it("require-initial-post hides others' replies and blocks replying first", async () => {
    const s1Post = await fx.s1.post(`/discussions/${topicId}/entries`, { body: "Mitosis was fascinating." });
    expect(s1Post.status).toBe(201);
    const before = await fx.s2.get(`/discussions/${topicId}`);
    expect(before.body.mustPostFirst).toBe(true);
    expect(before.body.entries).toHaveLength(0);
    expect((await fx.s2.post(`/discussions/${topicId}/entries`, { body: "reply", parentId: s1Post.body.entry.id })).status).toBe(403);
    await fx.s2.post(`/discussions/${topicId}/entries`, { body: "My own view." });
    const after = await fx.s2.get(`/discussions/${topicId}`);
    expect(after.body.entries).toHaveLength(2);
    expect((await fx.s2.post(`/discussions/${topicId}/entries`, { body: "Agreed!", parentId: s1Post.body.entry.id })).status).toBe(201);
  });

  it("escapes HTML in replies", async () => {
    const r = await fx.s1.post(`/discussions/${topicId}/entries`, { body: "<img src=x onerror=alert(1)> hi" });
    expect(r.body.entry.bodyHtml).not.toContain("<img");
  });

  it("students can only edit/delete their own posts; staff moderate", async () => {
    const view = await fx.teacher.get(`/discussions/${topicId}`);
    const s1Entry = view.body.entries.find((e: { authorId: string }) => e.authorId === fx.users.s1.id);
    expect((await fx.s2.del(`/discussion-entries/${s1Entry.id}`)).status).toBe(403);
    expect((await fx.s1.patch(`/discussion-entries/${s1Entry.id}`, { body: "edited" })).status).toBe(200);
    expect((await fx.teacher.del(`/discussion-entries/${s1Entry.id}`)).status).toBe(200);
    const after = await fx.s2.get(`/discussions/${topicId}`);
    const removed = after.body.entries.find((e: { id: string }) => e.id === s1Entry.id);
    expect(removed).toMatchObject({ deleted: true, bodyHtml: null, authorName: null });
  });

  it("locked topics reject student replies", async () => {
    await fx.teacher.patch(`/discussions/${topicId}`, { locked: true });
    expect((await fx.s1.post(`/discussions/${topicId}/entries`, { body: "late" })).status).toBe(403);
    await fx.teacher.patch(`/discussions/${topicId}`, { locked: false });
  });

  it("graded discussions create a submission when a student posts", async () => {
    const r = await fx.teacher.post(`/courses/${fx.courseId}/discussions`, { title: "Graded debate", published: true, graded: { pointsPossible: 10 } });
    const assignmentId = r.body.topic.assignmentId;
    expect(assignmentId).toBeTruthy();
    await fx.s1.post(`/discussions/${r.body.topic.id}/entries`, { body: "My argument" });
    const subs = await fx.teacher.get(`/assignments/${assignmentId}/submissions`);
    expect(subs.body.summary.submitted).toBe(1);
  });

  it("unpublished topics are hidden from students", async () => {
    const r = await fx.teacher.post(`/courses/${fx.courseId}/discussions`, { title: "Draft topic", published: false });
    expect((await fx.s1.get(`/discussions/${r.body.topic.id}`)).status).toBe(404);
  });
});

describe("announcements and notifications", () => {
  it("publishing an announcement notifies students; read/unread works", async () => {
    await fx.teacher.post(`/courses/${fx.courseId}/discussions`, { title: "Exam moved", body: "Now on Friday.", isAnnouncement: true });
    const unread = await fx.s1.get("/notifications/unread-count");
    expect(unread.body.count).toBeGreaterThan(0);
    const list = await fx.s1.get("/notifications?unread=true");
    const n = list.body.data.find((x: { title: string }) => x.title.includes("Exam moved"));
    expect(n).toBeTruthy();
    expect(n.emailStatus).toBe("not_configured");
    await fx.s1.post(`/notifications/${n.id}/read`, { read: true });
    const again = await fx.s1.get("/notifications?unread=true");
    expect(again.body.data.find((x: { id: string }) => x.id === n.id)).toBeUndefined();
    expect((await fx.s2.post(`/notifications/${n.id}/read`, { read: true })).status).toBe(404);
    await fx.s1.post("/notifications/read-all");
    expect((await fx.s1.get("/notifications/unread-count")).body.count).toBe(0);
  });

  it("delayed announcements stay hidden until their time, then notify once", async () => {
    const r = await fx.teacher.post(`/courses/${fx.courseId}/discussions`, { title: "Future news", isAnnouncement: true, delayedPostAt: iso(day) });
    const id = r.body.topic.id;
    expect((await fx.s1.get(`/discussions/${id}`)).status).toBe(404);
    let list = await fx.s1.get(`/courses/${fx.courseId}/discussions?type=announcement`);
    expect(list.body.data.map((t: { id: string }) => t.id)).not.toContain(id);
    await env.database.db.update(discussionTopics).set({ delayedPostAt: new Date(Date.now() - 1000) }).where(eq(discussionTopics.id, id));
    list = await fx.s1.get(`/courses/${fx.courseId}/discussions?type=announcement`);
    expect(list.body.data.map((t: { id: string }) => t.id)).toContain(id);
    await fx.s1.get(`/courses/${fx.courseId}/discussions?type=announcement`);
    const notes = await fx.s1.get("/notifications?perPage=100");
    expect(notes.body.data.filter((x: { title: string }) => x.title.includes("Future news"))).toHaveLength(1);
  });
});

describe("calendar", () => {
  it("shows published due dates and course events; staff-only course events", async () => {
    await fx.teacher.post(`/courses/${fx.courseId}/assignments`, { title: "Lab report", published: true, dueAt: iso(3 * day) });
    await fx.teacher.post(`/courses/${fx.courseId}/assignments`, { title: "Hidden lab", published: false, dueAt: iso(3 * day) });
    expect((await fx.s1.post("/calendar-events", { title: "Study group", startAt: iso(day), courseId: fx.courseId })).status).toBe(403);
    expect((await fx.teacher.post("/calendar-events", { title: "Office hours", startAt: iso(2 * day), courseId: fx.courseId })).status).toBe(201);
    expect((await fx.s1.post("/calendar-events", { title: "My study block", startAt: iso(day) })).status).toBe(201);
    const r = await fx.s1.get(`/calendar?start=${encodeURIComponent(iso(0))}&end=${encodeURIComponent(iso(10 * day))}`);
    const titles = r.body.data.map((i: { title: string }) => i.title);
    expect(titles).toEqual(expect.arrayContaining(["Lab report", "Office hours", "My study block"]));
    expect(titles).not.toContain("Hidden lab");
    const s2 = await fx.s2.get(`/calendar?start=${encodeURIComponent(iso(0))}&end=${encodeURIComponent(iso(10 * day))}`);
    expect(s2.body.data.map((i: { title: string }) => i.title)).not.toContain("My study block");
  });
});

describe("dashboards", () => {
  it("student dashboard reflects real progress, pending work and grades", async () => {
    const r = await fx.s1.get("/dashboard");
    expect(r.status).toBe(200);
    expect(r.body.admin).toBeNull();
    expect(r.body.teaching).toBeNull();
    const course = r.body.learning.courses.find((c: { id: string }) => c.id === fx.courseId);
    expect(course).toBeTruthy();
    expect(r.body.learning.pending.map((p: { title: string }) => p.title)).toContain("Lab report");
    expect(r.body.learning.recentGrades.length).toBeGreaterThan(0);
    expect(r.body.announcements.length).toBeGreaterThan(0);
  });

  it("instructor dashboard lists courses with grading queue", async () => {
    const r = await fx.teacher.get("/dashboard");
    expect(r.body.learning).toBeNull();
    const course = r.body.teaching.courses.find((c: { id: string }) => c.id === fx.courseId);
    expect(course).toMatchObject({ studentCount: 2 });
    expect(typeof course.needsGradingCount).toBe("number");
  });

  it("admin dashboard counts come from the database", async () => {
    const r = await fx.admin.get("/dashboard");
    expect(r.body.admin.users.byRole.student).toBeGreaterThanOrEqual(4);
    expect(r.body.admin.courses.byStatus.published).toBeGreaterThanOrEqual(1);
    expect(r.body.admin.completion.find((c: { id: string }) => c.id === fx.courseId).studentCount).toBe(2);
    expect((await fx.teacher.get("/admin/audit")).status).toBe(403);
    expect((await fx.admin.get("/admin/audit?perPage=5")).body.data.length).toBe(5);
  });

  it("course stats are staff-only", async () => {
    expect((await fx.s1.get(`/courses/${fx.courseId}/stats`)).status).toBe(403);
    const r = await fx.teacher.get(`/courses/${fx.courseId}/stats`);
    expect(r.body.summary.studentCount).toBe(2);
    expect(r.body.students[0]).toHaveProperty("progressPercent");
  });
});
