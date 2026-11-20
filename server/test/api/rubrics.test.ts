import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, standardCourse, type TestEnv } from "../helpers.js";

let env: TestEnv;
let fx: Awaited<ReturnType<typeof standardCourse>>;

beforeAll(async () => {
  env = await createTestEnv();
  fx = await standardCourse(env);
});
afterAll(async () => env.close());

const essayRubric = {
  title: "Essay rubric",
  criteria: [
    { description: "Thesis", ratings: [{ description: "Clear", points: 5 }, { description: "Partial", points: 3 }, { description: "Missing", points: 0 }] },
    { description: "Evidence", ratings: [{ description: "Strong", points: 10 }, { description: "Weak", points: 4 }] },
  ],
};

async function createRubric(body: Record<string, unknown> = essayRubric) {
  const r = await fx.teacher.post(`/courses/${fx.courseId}/rubrics`, body);
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.rubric as { id: string; possible: number; criteria: { id: string; ratings: { id: string; points: number }[] }[] };
}

async function createAssignment(body: Record<string, unknown>) {
  const r = await fx.teacher.post(`/courses/${fx.courseId}/assignments`, { published: true, submissionTypes: ["online_text_entry"], ...body });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body.assignment as { id: string; rubricId: string | null; rubricUseForGrading: boolean };
}

describe("rubric library", () => {
  it("staff create and list rubrics; students and outsiders cannot", async () => {
    const rubric = await createRubric();
    expect(rubric.possible).toBe(15);
    expect(rubric.criteria[0]!.ratings.map((r) => r.points)).toEqual([5, 3, 0]);
    expect((await fx.s1.post(`/courses/${fx.courseId}/rubrics`, essayRubric)).status).toBe(403);
    expect((await fx.s1.get(`/courses/${fx.courseId}/rubrics`)).status).toBe(403);
    expect((await fx.outsider.get(`/rubrics/${rubric.id}`)).status).toBe(404);
    const list = await fx.ta.get(`/courses/${fx.courseId}/rubrics`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((r: { id: string }) => r.id === rubric.id)).toBe(true);
  });

  it("validates criteria", async () => {
    expect((await fx.teacher.post(`/courses/${fx.courseId}/rubrics`, { title: "Empty", criteria: [] })).status).toBe(422);
    const bad = await fx.teacher.post(`/courses/${fx.courseId}/rubrics`, { title: "Bad", criteria: [{ description: "A", ratings: [{ description: "x", points: -1 }] }] });
    expect(bad.status).toBe(422);
  });

  it("only allows attaching rubrics from the same course", async () => {
    const other = await fx.admin.post("/courses", { code: "CHEM1", name: "Chemistry" });
    const foreign = await fx.admin.post(`/courses/${other.body.course.id}/rubrics`, essayRubric);
    expect(foreign.status).toBe(201);
    const a = await createAssignment({ title: "Lab" });
    const r = await fx.teacher.patch(`/assignments/${a.id}`, { rubricId: foreign.body.rubric.id });
    expect(r.status).toBe(422);
  });
});

describe("grading with a rubric", () => {
  let rubric: Awaited<ReturnType<typeof createRubric>>;
  let assignmentId: string;
  beforeAll(async () => {
    rubric = await createRubric();
    const a = await createAssignment({ title: "Essay", pointsPossible: 15, postManually: true });
    assignmentId = a.id;
    const r = await fx.teacher.patch(`/assignments/${assignmentId}`, { rubricId: rubric.id, rubricUseForGrading: true });
    expect(r.body.assignment).toMatchObject({ rubricId: rubric.id, rubricUseForGrading: true });
  });

  it("students can read the attached rubric before submitting", async () => {
    const r = await fx.s1.get(`/assignments/${assignmentId}/rubric`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ useForGrading: true, rubric: { id: rubric.id, possible: 15 } });
  });

  it("graders save an assessment; students see it only after grades are posted", async () => {
    const [thesis, evidence] = rubric.criteria;
    const url = `/assignments/${assignmentId}/submissions/${fx.users.s1.id}`;
    expect((await fx.s1.put(`${url}/rubric-assessment`, { scores: {} })).status).toBe(403);
    const saved = await fx.ta.put(`${url}/rubric-assessment`, {
      scores: { [thesis!.id]: { ratingId: thesis!.ratings[1]!.id }, [evidence!.id]: { points: 9, comments: "Cite more" } },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.assessment.total).toBe(12);
    await fx.ta.put(`${url}/grade`, { grade: "12" });

    const teacherView = await fx.teacher.get(url);
    expect(teacherView.body.rubricAssessment).toMatchObject({ total: 12, rubricId: rubric.id });
    expect((await fx.s1.get(url)).body.rubricAssessment).toBeNull();

    await fx.teacher.post(`/assignments/${assignmentId}/post-grades`);
    const studentView = await fx.s1.get(url);
    expect(studentView.body.rubricAssessment.scores[evidence!.id]).toEqual({ ratingId: null, points: 9, comments: "Cite more" });
    expect(studentView.body.submission.score).toBe(12);
  });

  it("rejects scores for criteria outside the rubric", async () => {
    const r = await fx.teacher.put(`/assignments/${assignmentId}/submissions/${fx.users.s2.id}/rubric-assessment`, { scores: { nope: { points: 1 } } });
    expect(r.status).toBe(422);
  });

  it("locks criteria once used, allows title edits, duplicates, and blocks deletion while in use", async () => {
    const locked = await fx.teacher.patch(`/rubrics/${rubric.id}`, { criteria: essayRubric.criteria });
    expect(locked.status).toBe(409);
    expect((await fx.teacher.patch(`/rubrics/${rubric.id}`, { title: "Essay rubric v1" })).status).toBe(200);
    const copy = await fx.teacher.post(`/rubrics/${rubric.id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body.rubric.title).toBe("Essay rubric v1 (copy)");
    expect(copy.body.rubric.criteria[0].id).not.toBe(rubric.criteria[0]!.id);
    expect((await fx.teacher.patch(`/rubrics/${copy.body.rubric.id}`, { criteria: essayRubric.criteria })).status).toBe(200);
    expect((await fx.teacher.del(`/rubrics/${rubric.id}`)).status).toBe(409);
    expect((await fx.teacher.del(`/rubrics/${copy.body.rubric.id}`)).status).toBe(200);
  });

  it("removing the rubric turns off use-for-grading", async () => {
    const r = await fx.teacher.patch(`/assignments/${assignmentId}`, { rubricId: null });
    expect(r.body.assignment).toMatchObject({ rubricId: null, rubricUseForGrading: false });
    await fx.teacher.patch(`/assignments/${assignmentId}`, { rubricId: rubric.id, rubricUseForGrading: true });
  });
});

describe("quizzes and graded discussions", () => {
  it("quiz rubrics are feedback only", async () => {
    const rubric = await createRubric({ ...essayRubric, title: "Quiz rubric" });
    const q = await fx.teacher.post(`/courses/${fx.courseId}/quizzes`, { title: "Rubric quiz" });
    const r = await fx.teacher.patch(`/assignments/${q.body.quiz.assignmentId}`, { rubricId: rubric.id, rubricUseForGrading: true });
    expect(r.status).toBe(200);
    expect(r.body.assignment).toMatchObject({ rubricId: rubric.id, rubricUseForGrading: false });
  });

  it("graded discussions can be assessed through their assignment", async () => {
    const rubric = await createRubric({ ...essayRubric, title: "Discussion rubric" });
    const t = await fx.teacher.post(`/courses/${fx.courseId}/discussions`, { title: "Rubric debate", published: true, graded: { pointsPossible: 15 } });
    const assignmentId = t.body.topic.assignmentId as string;
    await fx.teacher.patch(`/assignments/${assignmentId}`, { rubricId: rubric.id, rubricUseForGrading: true });
    const saved = await fx.teacher.put(`/assignments/${assignmentId}/submissions/${fx.users.s2.id}/rubric-assessment`, { scores: { [rubric.criteria[1]!.id]: { ratingId: rubric.criteria[1]!.ratings[0]!.id } } });
    expect(saved.status).toBe(200);
    expect(saved.body.assessment.total).toBe(10);
  });
});

describe("course duplication", () => {
  it("copies the rubric library and remaps assignment rubrics", async () => {
    const copy = await fx.admin.post(`/courses/${fx.courseId}/duplicate`, { code: "BIO101-B", name: "Intro Biology (copy)" });
    expect(copy.status).toBe(201);
    const newId = copy.body.course.id as string;
    const rubrics = (await fx.admin.get(`/courses/${newId}/rubrics`)).body.data as { id: string; title: string; usedBy: { title: string }[] }[];
    const essay = rubrics.find((r) => r.title === "Essay rubric v1")!;
    expect(essay).toBeTruthy();
    expect(essay.usedBy.map((a) => a.title)).toContain("Essay");
    const original = (await fx.admin.get(`/courses/${fx.courseId}/rubrics`)).body.data as { id: string }[];
    expect(original.map((r) => r.id)).not.toContain(essay.id);
  });
});
