import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../../src/domain/csv.js";
import { createTestEnv, standardCourse, type TestEnv } from "../helpers.js";

let env: TestEnv;
let fx: Awaited<ReturnType<typeof standardCourse>>;
const PDF = Buffer.from("%PDF-1.4\n%%EOF");
const day = 24 * 3600 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

beforeAll(async () => {
  env = await createTestEnv();
  fx = await standardCourse(env);
});
afterAll(async () => env.close());

async function createAssignment(body: Record<string, unknown>) {
  const r = await fx.teacher.post(`/courses/${fx.courseId}/assignments`, { published: true, ...body });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.assignment.id as string;
}

describe("assignment authoring", () => {
  it("validates dates and submission types", async () => {
    expect((await fx.teacher.post(`/courses/${fx.courseId}/assignments`, { title: "X", dueAt: iso(2 * day), lockAt: iso(day) })).status).toBe(422);
    expect((await fx.teacher.post(`/courses/${fx.courseId}/assignments`, { title: "X", submissionTypes: ["on_paper", "online_upload"] })).status).toBe(422);
    expect((await fx.teacher.post(`/courses/${fx.courseId}/assignments`, { title: "" })).status).toBe(422);
  });

  it("students cannot create, see unpublished, or see draft assignments in lists", async () => {
    expect((await fx.s1.post(`/courses/${fx.courseId}/assignments`, { title: "Mine" })).status).toBe(403);
    const draft = await fx.teacher.post(`/courses/${fx.courseId}/assignments`, { title: "Draft" });
    expect((await fx.s1.get(`/assignments/${draft.body.assignment.id}`)).status).toBe(404);
    const list = await fx.s1.get(`/courses/${fx.courseId}/assignments`);
    expect(list.body.data.map((a: { title: string }) => a.title)).not.toContain("Draft");
  });

  it("PATCH only changes the fields sent", async () => {
    const id = await createAssignment({ title: "Patch me", pointsPossible: 30, postManually: true });
    const r = await fx.teacher.patch(`/assignments/${id}`, { title: "Patched" });
    expect(r.body.assignment).toMatchObject({ title: "Patched", pointsPossible: 30, postManually: true, published: true });
  });
});

describe("submissions", () => {
  let essay: string;
  beforeAll(async () => {
    essay = await createAssignment({ title: "Essay", pointsPossible: 20, submissionTypes: ["online_text_entry", "online_upload"], allowedExtensions: ["pdf"], allowedAttempts: 2, dueAt: iso(7 * day), postManually: true });
  });

  it("student submits text and sees confirmation + history", async () => {
    const r = await fx.s1.post(`/assignments/${essay}/submit`, { submissionType: "online_text_entry", body: "My **essay**" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ attempt: 1, late: false });
    const detail = await fx.s1.get(`/assignments/${essay}/submissions/${fx.users.s1.id}`);
    expect(detail.body.attempts[0].bodyHtml).toContain("<strong>essay</strong>");
    expect(detail.body.submission.status).toBe("submitted");
  });

  it("rejects empty text, disallowed types and extensions", async () => {
    expect((await fx.s2.post(`/assignments/${essay}/submit`, { submissionType: "online_text_entry", body: "  " })).status).toBe(422);
    expect((await fx.s2.post(`/assignments/${essay}/submit`, { submissionType: "online_url", url: "https://x.org" })).status).toBe(422);
    expect((await fx.s2.upload(`/assignments/${essay}/uploads`, "notes.docx", Buffer.from("PK\u0003\u0004rest"))).status).toBe(422);
  });

  it("file upload flow: upload, then submit by file id; other students cannot use or read the file", async () => {
    const up = await fx.s2.upload(`/assignments/${essay}/uploads`, "paper.pdf", PDF);
    expect(up.status).toBe(201);
    const fileId = up.body.data[0].id;
    expect((await fx.s1.post(`/assignments/${essay}/submit`, { submissionType: "online_upload", fileIds: [fileId] })).status).toBe(422);
    expect((await fx.s1.req("GET", `/files/${fileId}/download`)).status).toBe(404);
    const r = await fx.s2.post(`/assignments/${essay}/submit`, { submissionType: "online_upload", fileIds: [fileId] });
    expect(r.status).toBe(201);
    expect((await fx.teacher.req("GET", `/files/${fileId}/download`)).status).toBe(200);
    expect((await fx.s2.req("GET", `/files/${fileId}/download`)).status).toBe(200);
  });

  it("students cannot read another student's submission", async () => {
    expect((await fx.s1.get(`/assignments/${essay}/submissions/${fx.users.s2.id}`)).status).toBe(404);
    expect((await fx.s1.get(`/assignments/${essay}/submissions`)).status).toBe(403);
    expect((await fx.outsider.get(`/assignments/${essay}/submissions/${fx.users.outsider.id}`)).status).toBe(404);
  });

  it("enforces attempt limits", async () => {
    expect((await fx.s1.post(`/assignments/${essay}/submit`, { submissionType: "online_text_entry", body: "v2" })).status).toBe(201);
    const third = await fx.s1.post(`/assignments/${essay}/submit`, { submissionType: "online_text_entry", body: "v3" });
    expect(third.status).toBe(403);
    expect(third.body.error.message).toMatch(/attempts/);
  });

  it("enforces the availability window", async () => {
    const closed = await createAssignment({ title: "Closed", submissionTypes: ["online_text_entry"], dueAt: iso(-3 * day), lockAt: iso(-2 * day) });
    const r = await fx.s1.post(`/assignments/${closed}/submit`, { submissionType: "online_text_entry", body: "late" });
    expect(r.status).toBe(403);
    const notYet = await createAssignment({ title: "Future", submissionTypes: ["online_text_entry"], unlockAt: iso(day) });
    expect((await fx.s1.post(`/assignments/${notYet}/submit`, { submissionType: "online_text_entry", body: "early" })).status).toBe(403);
  });

  it("staff cannot submit as students", async () => {
    expect((await fx.teacher.post(`/assignments/${essay}/submit`, { submissionType: "online_text_entry", body: "x" })).status).toBe(403);
  });
});

describe("grading, posting and feedback", () => {
  let hw: string;
  beforeAll(async () => {
    hw = await createAssignment({ title: "Homework 1", pointsPossible: 10, submissionTypes: ["online_text_entry"], postManually: true });
    await fx.s1.post(`/assignments/${hw}/submit`, { submissionType: "online_text_entry", body: "answer" });
  });

  it("students cannot grade", async () => {
    expect((await fx.s1.put(`/assignments/${hw}/submissions/${fx.users.s1.id}/grade`, { grade: "10" })).status).toBe(403);
  });

  it("grader grades with comment; hidden from student until posted", async () => {
    const r = await fx.ta.put(`/assignments/${hw}/submissions/${fx.users.s1.id}/grade`, { grade: "8", comment: "Good work" });
    expect(r.status).toBe(200);
    expect(r.body.submission).toMatchObject({ score: 8, graded: true, posted: false });
    const studentView = await fx.s1.get(`/assignments/${hw}/submissions/${fx.users.s1.id}`);
    expect(studentView.body.submission.score).toBeNull();
    expect(studentView.body.comments).toHaveLength(0);
    const grades = await fx.s1.get(`/courses/${fx.courseId}/grades/me`);
    expect(grades.body.assignments.find((a: { id: string }) => a.id === hw).score).toBeNull();
  });

  it("posting releases grade, comments and notifies the student", async () => {
    const r = await fx.teacher.post(`/assignments/${hw}/post-grades`);
    expect(r.body.posted).toBe(1);
    const view = await fx.s1.get(`/assignments/${hw}/submissions/${fx.users.s1.id}`);
    expect(view.body.submission.score).toBe(8);
    expect(view.body.comments[0].body).toContain("Good work");
    const notes = await fx.s1.get("/notifications");
    expect(notes.body.data.some((n: { title: string }) => n.title.includes("Homework 1"))).toBe(true);
  });

  it("hiding grades removes them from the student view again", async () => {
    await fx.teacher.post(`/assignments/${hw}/hide-grades`);
    expect((await fx.s1.get(`/assignments/${hw}/submissions/${fx.users.s1.id}`)).body.submission.score).toBeNull();
    await fx.teacher.post(`/assignments/${hw}/post-grades`);
  });

  it("accepts percent, letter, excused and validates bad grades", async () => {
    const u = fx.users.s2.id;
    expect((await fx.teacher.put(`/assignments/${hw}/submissions/${u}/grade`, { grade: "95%" })).body.submission.score).toBe(9.5);
    expect((await fx.teacher.put(`/assignments/${hw}/submissions/${u}/grade`, { grade: "banana" })).status).toBe(422);
    const ex = await fx.teacher.put(`/assignments/${hw}/submissions/${u}/grade`, { excused: true });
    expect(ex.body.submission).toMatchObject({ excused: true, score: null, graded: true });
    await fx.teacher.put(`/assignments/${hw}/submissions/${u}/grade`, { excused: false, grade: null });
  });

  it("automatic post policy posts immediately", async () => {
    const auto = await createAssignment({ title: "Auto", pointsPossible: 5, submissionTypes: ["on_paper"] });
    await fx.teacher.put(`/assignments/${auto}/submissions/${fx.users.s1.id}/grade`, { grade: "4" });
    const grades = await fx.s1.get(`/courses/${fx.courseId}/grades/me`);
    expect(grades.body.assignments.find((a: { id: string }) => a.id === auto)).toMatchObject({ score: 4, posted: true });
  });

  it("return for revision grants another attempt and shows the comment", async () => {
    const one = await createAssignment({ title: "One shot", pointsPossible: 10, submissionTypes: ["online_text_entry"], allowedAttempts: 1, postManually: true });
    await fx.s1.post(`/assignments/${one}/submit`, { submissionType: "online_text_entry", body: "draft" });
    expect((await fx.s1.post(`/assignments/${one}/submit`, { submissionType: "online_text_entry", body: "again" })).status).toBe(403);
    const r = await fx.teacher.post(`/assignments/${one}/submissions/${fx.users.s1.id}/return`, { comment: "Please add sources." });
    expect(r.body.submission.status).toBe("returned");
    const view = await fx.s1.get(`/assignments/${one}/submissions/${fx.users.s1.id}`);
    expect(view.body.canSubmit).toBe(true);
    expect(view.body.comments.map((c: { body: string }) => c.body).join()).toContain("Please add sources.");
    expect((await fx.s1.post(`/assignments/${one}/submit`, { submissionType: "online_text_entry", body: "revised" })).status).toBe(201);
  });

  it("applies the course late policy when grading late work", async () => {
    await fx.teacher.patch(`/courses/${fx.courseId}`, { latePolicyEnabled: true, lateDeductionPercent: 10, lateFloorPercent: 50 });
    const lateA = await createAssignment({ title: "Late one", pointsPossible: 100, submissionTypes: ["online_text_entry"], dueAt: iso(-2.5 * day) });
    await fx.s2.post(`/assignments/${lateA}/submit`, { submissionType: "online_text_entry", body: "sorry" });
    const g = await fx.teacher.put(`/assignments/${lateA}/submissions/${fx.users.s2.id}/grade`, { grade: "90" });
    expect(g.body.submission).toMatchObject({ enteredScore: 90, pointsDeducted: 30, score: 60, late: true });
    const waived = await fx.teacher.put(`/assignments/${lateA}/submissions/${fx.users.s2.id}/grade`, { latePolicyStatus: "none" });
    expect(waived.body.submission).toMatchObject({ score: 90, late: false });
    await fx.teacher.patch(`/courses/${fx.courseId}`, { latePolicyEnabled: false });
  });

  it("grade changes are audited", async () => {
    const r = await fx.teacher.get(`/courses/${fx.courseId}/audit?perPage=100`);
    expect(r.body.data.some((e: { action: string }) => e.action === "grade.updated")).toBe(true);
    expect(r.body.data.some((e: { action: string }) => e.action === "grades.posted")).toBe(true);
  });
});

describe("gradebook", () => {
  it("is staff-only and computes totals", async () => {
    expect((await fx.s1.get(`/courses/${fx.courseId}/gradebook`)).status).toBe(403);
    const r = await fx.teacher.get(`/courses/${fx.courseId}/gradebook`);
    expect(r.status).toBe(200);
    const s1 = r.body.students.find((s: { id: string }) => s.id === fx.users.s1.id);
    expect(s1.cells).toHaveLength(r.body.assignments.length);
    expect(s1.totals.current.percent).not.toBeNull();
  });

  it("students only see their own grades", async () => {
    expect((await fx.s1.get(`/courses/${fx.courseId}/grades/${fx.users.s2.id}`)).status).toBe(404);
    expect((await fx.teacher.get(`/courses/${fx.courseId}/grades/${fx.users.s2.id}`)).status).toBe(200);
  });

  it("exports CSV and imports with dry run then apply", async () => {
    const res = await fx.teacher.req("GET", `/courses/${fx.courseId}/gradebook/export`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const table = parseCsv(res.raw);
    const head = table[0]!;
    const hwCol = head.findIndex((h) => h.startsWith("Homework 1"));
    expect(hwCol).toBeGreaterThan(1);
    const s2Row = table.find((r) => r.includes(fx.users.s2.email))!;
    s2Row[hwCol] = "7";
    const csv = toCsv([head, s2Row, ["Nobody", "nobody@test.edu"]]);
    const dry = await fx.teacher.post(`/courses/${fx.courseId}/gradebook/import`, { csv, dryRun: true });
    expect(dry.body.changes).toEqual([expect.objectContaining({ email: fx.users.s2.email, to: "7" })]);
    expect(dry.body.errors[0].message).toMatch(/No student/);
    const before = await fx.teacher.get(`/courses/${fx.courseId}/grades/${fx.users.s2.id}`);
    expect(before.body.assignments.find((a: { title: string }) => a.title === "Homework 1").score).toBeNull();
    await fx.teacher.post(`/courses/${fx.courseId}/gradebook/import`, { csv, dryRun: false });
    const after = await fx.teacher.get(`/courses/${fx.courseId}/grades/${fx.users.s2.id}`);
    expect(after.body.assignments.find((a: { title: string }) => a.title === "Homework 1").score).toBe(7);
  });

  it("course cannot be unpublished once grades are posted", async () => {
    const r = await fx.teacher.post(`/courses/${fx.courseId}/status`, { status: "unpublished" });
    expect(r.status).toBe(409);
  });

  it("assignment cannot be unpublished after submissions", async () => {
    const list = await fx.teacher.get(`/courses/${fx.courseId}/assignments`);
    const essay = list.body.data.find((a: { title: string }) => a.title === "Essay");
    expect((await fx.teacher.patch(`/assignments/${essay.id}`, { published: false })).status).toBe(409);
  });
});
