import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, standardCourse, type Client, type TestEnv } from "../helpers.js";

let env: TestEnv;
let fx: Awaited<ReturnType<typeof standardCourse>>;
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

interface CriterionSpec {
  description: string;
  points: number;
}

/** A rubric with levels on every criterion: Full / Half / None. */
async function makeRubric(client: Client, path: string, title: string, criteria: CriterionSpec[]) {
  const made = await client.post(path, { title });
  if (made.status !== 201) throw new Error(JSON.stringify(made.body));
  const rubricId = made.body.rubric.id as string;
  const criterionIds: string[] = [];
  for (const c of criteria) {
    const added = await client.post(`/rubrics/${rubricId}/criteria`, {
      description: c.description,
      points: c.points,
      levels: [
        { description: "Full marks", points: c.points },
        { description: "Half marks", points: c.points / 2 },
        { description: "Nothing shown", points: 0 },
      ],
    });
    if (added.status !== 201) throw new Error(JSON.stringify(added.body));
    criterionIds.push(added.body.criterion.id as string);
  }
  return { rubricId, criterionIds };
}

describe("the course rubric library", () => {
  it("a teacher builds a rubric and reads it back with its criteria in order", async () => {
    const { rubricId, criterionIds } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Essay rubric", [
      { description: "Argument", points: 20 },
      { description: "Use of sources", points: 10 },
    ]);
    const r = await fx.teacher.get(`/rubrics/${rubricId}`);
    expect(r.status).toBe(200);
    expect(r.body.rubric.pointsPossible).toBe(30);
    expect(r.body.rubric.shared).toBe(false);
    expect(r.body.canEdit).toBe(true);
    expect(r.body.rubric.criteria.map((c: { description: string }) => c.description)).toEqual([
      "Argument",
      "Use of sources",
    ]);
    expect(r.body.rubric.criteria[0].levels).toHaveLength(3);
    expect(r.body.rubric.criteria[0].levels[0].id).toBeTruthy();
    expect(criterionIds).toHaveLength(2);
  });

  it("reorders criteria by naming every one, and renumbers 1..n", async () => {
    const { rubricId, criterionIds } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Reorder me", [
      { description: "First", points: 1 },
      { description: "Second", points: 2 },
      { description: "Third", points: 3 },
    ]);
    const reversed = [...criterionIds].reverse();
    const r = await fx.teacher.post(`/rubrics/${rubricId}/criteria/reorder`, { criterionIds: reversed });
    expect(r.status).toBe(200);
    expect(r.body.data.map((c: { description: string }) => c.description)).toEqual(["Third", "Second", "First"]);
    expect(r.body.data.map((c: { position: number }) => c.position)).toEqual([1, 2, 3]);

    const partial = await fx.teacher.post(`/rubrics/${rubricId}/criteria/reorder`, {
      criterionIds: [criterionIds[0]],
    });
    expect(partial.status).toBe(422);
  });

  it("closes the gap in positions when a criterion is deleted", async () => {
    const { rubricId, criterionIds } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Delete one", [
      { description: "Keep", points: 1 },
      { description: "Drop", points: 2 },
      { description: "Keep too", points: 3 },
    ]);
    expect((await fx.teacher.del(`/rubric-criteria/${criterionIds[1]}`)).status).toBe(200);
    const r = await fx.teacher.get(`/rubrics/${rubricId}`);
    expect(r.body.rubric.criteria.map((c: { position: number }) => c.position)).toEqual([1, 2]);
    expect(r.body.rubric.pointsPossible).toBe(4);
  });

  it("a student cannot see the library at all", async () => {
    expect((await fx.s1.get(`/courses/${fx.courseId}/rubrics`)).status).toBe(403);
  });

  it("another course's rubric is 404, not 403", async () => {
    const other = await fx.admin.post("/courses", { code: "CHEM101", name: "Chemistry" });
    const otherId = other.body.course.id as string;
    const { rubricId } = await makeRubric(fx.admin, `/courses/${otherId}/rubrics`, "Not yours", [
      { description: "Hidden", points: 5 },
    ]);
    expect((await fx.teacher.get(`/rubrics/${rubricId}`)).status).toBe(404);
  });
});

describe("the shared library belongs to the academic office", () => {
  let sharedId: string;
  let sharedCriteria: string[];

  beforeAll(async () => {
    const made = await makeRubric(fx.admin, "/rubrics", "College essay standard", [
      { description: "Scholarship", points: 15 },
      { description: "Written English", points: 5 },
    ]);
    sharedId = made.rubricId;
    sharedCriteria = made.criterionIds;
  });

  it("only an administrator may create one", async () => {
    expect((await fx.teacher.post("/rubrics", { title: "Mine, surely" })).status).toBe(403);
    expect((await fx.admin.post("/rubrics", { title: "The office's" })).status).toBe(201);
  });

  it("a teacher may use it but not change it", async () => {
    const read = await fx.teacher.get(`/rubrics/${sharedId}`);
    expect(read.status).toBe(200);
    expect(read.body.rubric.shared).toBe(true);
    expect(read.body.canEdit).toBe(false);

    const edit = await fx.teacher.patch(`/rubrics/${sharedId}`, { title: "Renamed by a teacher" });
    expect(edit.status).toBe(403);
    expect(edit.body.error.message).toMatch(/administrator/i);

    const byAdmin = await fx.admin.patch(`/rubrics/${sharedId}`, { description: "Approved by Senate" });
    expect(byAdmin.status).toBe(200);
    expect(sharedCriteria).toHaveLength(2);
  });

  it("it appears in every course's library alongside the course's own", async () => {
    const r = await fx.teacher.get(`/courses/${fx.courseId}/rubrics`);
    const shared = r.body.data.filter((x: { shared: boolean }) => x.shared);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.some((x: { id: string }) => x.id === sharedId)).toBe(true);
  });

  it("a teaching assistant may use it too, though their platform role is student", async () => {
    // A TA is a student who assists, so the platform role is the wrong thing to read.
    const r = await fx.ta.get(`/courses/${fx.courseId}/rubrics`);
    expect(r.status).toBe(200);
    expect(r.body.data.some((x: { id: string }) => x.id === sharedId)).toBe(true);
  });

  it("copying it into a course gives the teacher something of their own to edit", async () => {
    const copied = await fx.teacher.post(`/rubrics/${sharedId}/copy`, { courseId: fx.courseId });
    expect(copied.status).toBe(201);
    expect(copied.body.rubric.shared).toBe(false);
    expect(copied.body.rubric.title).toMatch(/copy/i);
    expect(copied.body.rubric.pointsPossible).toBe(20);
    expect(copied.body.rubric.criteria).toHaveLength(2);
    expect(copied.body.canEdit).toBe(true);

    // The copy is independent: renaming it leaves the college's original alone.
    await fx.teacher.patch(`/rubrics/${copied.body.rubric.id}`, { title: "Our version" });
    expect((await fx.admin.get(`/rubrics/${sharedId}`)).body.rubric.title).toBe("College essay standard");
  });
});

describe("attaching a rubric to an assessment", () => {
  it("reports a points mismatch without correcting it", async () => {
    const assignment = await createAssignment({ title: "Short paper", pointsPossible: 20, submissionTypes: ["online_text_entry"] });
    const { rubricId } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Forty points", [
      { description: "Depth", points: 40 },
    ]);
    const r = await fx.teacher.put(`/assignments/${assignment}/rubric`, { rubricId });
    expect(r.status).toBe(200);
    expect(r.body.pointsMismatch).toEqual({ criterionTotal: 40, pointsPossible: 20 });
    // Reported, never corrected: the rubric may be in use by other assignments.
    expect((await fx.teacher.get(`/assignments/${assignment}`)).body.assignment.pointsPossible).toBe(20);
  });

  it("a quiz refuses to be scored by a rubric, and takes it as feedback instead", async () => {
    const quiz = await fx.teacher.post(`/courses/${fx.courseId}/quizzes`, { title: "Week 1 quiz" });
    expect(quiz.status).toBe(201);
    const quizAssignmentId = quiz.body.quiz.assignmentId as string;
    expect(quizAssignmentId).toBeTruthy();
    const { rubricId } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Quiz rubric", [
      { description: "Reasoning", points: 10 },
    ]);

    const scoring = await fx.teacher.put(`/assignments/${quizAssignmentId}/rubric`, { rubricId, useForGrading: true });
    expect(scoring.status).toBe(422);
    expect(scoring.body.error.message).toMatch(/quiz scores this assignment/i);

    const feedback = await fx.teacher.put(`/assignments/${quizAssignmentId}/rubric`, { rubricId, useForGrading: false });
    expect(feedback.status).toBe(200);
    expect(feedback.body.attachment.useForGrading).toBe(false);
    expect(feedback.body.gradingBlocked).toMatch(/quiz/i);
  });

  it("an ungraded assignment refuses to be scored by a rubric", async () => {
    const assignment = await createAssignment({ title: "Reading log", gradingType: "not_graded", submissionTypes: ["none"] });
    const { rubricId } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Log rubric", [
      { description: "Done", points: 1 },
    ]);
    const r = await fx.teacher.put(`/assignments/${assignment}/rubric`, { rubricId, useForGrading: true });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/not graded/i);
  });

  it("a student cannot attach one", async () => {
    const assignment = await createAssignment({ title: "No meddling", submissionTypes: ["online_text_entry"] });
    const { rubricId } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Guarded", [
      { description: "Quality", points: 5 },
    ]);
    expect((await fx.s1.put(`/assignments/${assignment}/rubric`, { rubricId })).status).toBe(404);
  });
});

describe("marking against a rubric", () => {
  let assignment: string;
  let rubricId: string;
  let criterionIds: string[];

  beforeAll(async () => {
    assignment = await createAssignment({
      title: "Term paper",
      pointsPossible: 30,
      submissionTypes: ["online_text_entry"],
      postManually: true,
    });
    const made = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Term paper rubric", [
      { description: "Argument", points: 20 },
      { description: "Sources", points: 10 },
    ]);
    rubricId = made.rubricId;
    criterionIds = made.criterionIds;
    await fx.teacher.put(`/assignments/${assignment}/rubric`, { rubricId });
    await fx.s1.post(`/assignments/${assignment}/submit`, { submissionType: "online_text_entry", body: "My paper" });
  });

  it("shows the student the blank rubric before they submit", async () => {
    const r = await fx.s2.get(`/assignments/${assignment}`);
    expect(r.status).toBe(200);
    expect(r.body.assignment.rubric.title).toBe("Term paper rubric");
    expect(r.body.assignment.rubric.pointsPossible).toBe(30);
    expect(r.body.assignment.rubric.criteria).toHaveLength(2);
    // The blank rubric carries no awards, only what the work will be judged against.
    expect(r.body.assignment.rubric.criteria[0]).not.toHaveProperty("points_awarded");
  });

  it("a half-marked rubric is saved but does not grade", async () => {
    const r = await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/rubric-assessment`, {
      awards: [
        { criterionId: criterionIds[0], points: 15 },
        { criterionId: criterionIds[1], points: null },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.graded).toBe(false);
    expect(r.body.assessment.complete).toBe(false);
    expect(r.body.assessment.total).toBe(15);

    const view = await fx.teacher.get(`/assignments/${assignment}/submissions/${fx.users.s1.id}`);
    expect(view.body.submission.score).toBeNull();
    expect(view.body.submission.graded).toBe(false);
  });

  it("a complete rubric sets the mark through the normal grading path", async () => {
    const r = await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/rubric-assessment`, {
      awards: [
        { criterionId: criterionIds[0], levelId: undefined, points: 16 },
        { criterionId: criterionIds[1], points: 7.5 },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.graded).toBe(true);
    expect(r.body.assessment.total).toBe(23.5);
    expect(r.body.assessment.complete).toBe(true);

    const view = await fx.teacher.get(`/assignments/${assignment}/submissions/${fx.users.s1.id}`);
    expect(view.body.submission).toMatchObject({ enteredScore: 23.5, score: 23.5, graded: true, posted: false });
  });

  it("takes the points from the level the grader picked", async () => {
    const detail = await fx.teacher.get(`/rubrics/${rubricId}`);
    const argument = detail.body.rubric.criteria[0];
    const half = argument.levels.find((l: { description: string }) => l.description === "Half marks");
    const r = await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s2.id}/rubric-assessment`, {
      awards: [
        { criterionId: criterionIds[0], levelId: half.id },
        { criterionId: criterionIds[1], points: 10 },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.assessment.total).toBe(20);
    expect(r.body.assessment.criteria[0].levelId).toBe(half.id);
  });

  it("withholds the marked rubric from the student until grades are posted", async () => {
    const before = await fx.s1.get(`/assignments/${assignment}/submissions/${fx.users.s1.id}`);
    expect(before.body.submission.score).toBeNull();
    expect(before.body.rubricAssessment).toBeNull();

    expect((await fx.teacher.post(`/assignments/${assignment}/post-grades`)).status).toBe(200);

    const after = await fx.s1.get(`/assignments/${assignment}/submissions/${fx.users.s1.id}`);
    expect(after.body.submission.score).toBe(23.5);
    expect(after.body.rubricAssessment.total).toBe(23.5);
    expect(after.body.rubricAssessment.criteria).toHaveLength(2);
    expect(after.body.rubricAssessment.criteria[0].points).toBe(16);
  });

  it("editing the rubric afterwards leaves the mark and its snapshot untouched", async () => {
    // The decision this whole design exists to keep: a student has been told 23.5 out of 30
    // against these words. Rewriting the library must not move either.
    await fx.teacher.patch(`/rubric-criteria/${criterionIds[0]}`, {
      description: "Argument and structure",
      points: 50,
    });

    const view = await fx.s1.get(`/assignments/${assignment}/submissions/${fx.users.s1.id}`);
    expect(view.body.submission.score).toBe(23.5);
    expect(view.body.rubricAssessment.total).toBe(23.5);
    expect(view.body.rubricAssessment.pointsPossible).toBe(30);
    expect(view.body.rubricAssessment.criteria[0].description).toBe("Argument");
    expect(view.body.rubricAssessment.criteria[0].pointsPossible).toBe(20);

    // While the library itself has moved on.
    expect((await fx.teacher.get(`/rubrics/${rubricId}`)).body.rubric.pointsPossible).toBe(60);
  });

  it("refuses awards that no longer describe the rubric", async () => {
    const r = await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/rubric-assessment`, {
      awards: [{ criterionId: criterionIds[0], points: 1 }],
    });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/changed/i);
  });

  it("students cannot mark, and outsiders cannot see", async () => {
    const awards = [
      { criterionId: criterionIds[0], points: 20 },
      { criterionId: criterionIds[1], points: 10 },
    ];
    expect(
      (await fx.s1.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/rubric-assessment`, { awards })).status,
    ).toBe(404);
    expect((await fx.outsider.get(`/assignments/${assignment}`)).status).toBe(404);
  });

  it("records the marking in the audit log", async () => {
    const r = await fx.teacher.get(`/courses/${fx.courseId}/audit?perPage=100`);
    const actions = r.body.data.map((e: { action: string }) => e.action);
    expect(actions).toContain("rubric.assessed");
    expect(actions).toContain("rubric.attached");
    expect(actions).toContain("rubric.created");
  });
});

describe("a rubric total is a grade like any other", () => {
  it("the late policy still applies on top of it", async () => {
    await fx.teacher.patch(`/courses/${fx.courseId}`, { latePolicyEnabled: true, lateDeductionPercent: 10, lateFloorPercent: 50 });
    const assignment = await createAssignment({
      title: "Late essay",
      pointsPossible: 100,
      submissionTypes: ["online_text_entry"],
      dueAt: iso(-2.5 * day),
    });
    const { rubricId, criterionIds } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Hundred", [
      { description: "Everything", points: 100 },
    ]);
    await fx.teacher.put(`/assignments/${assignment}/rubric`, { rubricId });
    await fx.s2.post(`/assignments/${assignment}/submit`, { submissionType: "online_text_entry", body: "late" });

    const r = await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s2.id}/rubric-assessment`, {
      awards: [{ criterionId: criterionIds[0], points: 90 }],
    });
    expect(r.body.graded).toBe(true);
    expect(r.body.assessment.total).toBe(90);

    // The rubric produced the entered score; the late policy then took its cut, exactly as it
    // does for a mark typed into the grade box.
    const view = await fx.teacher.get(`/assignments/${assignment}/submissions/${fx.users.s2.id}`);
    expect(view.body.submission).toMatchObject({ enteredScore: 90, pointsDeducted: 30, score: 60, late: true });
    await fx.teacher.patch(`/courses/${fx.courseId}`, { latePolicyEnabled: false });
  });

  it("the gradebook and the course total see it", async () => {
    const assignment = await createAssignment({ title: "Counted", pointsPossible: 10, submissionTypes: ["online_text_entry"] });
    const { rubricId, criterionIds } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Ten", [
      { description: "All of it", points: 10 },
    ]);
    await fx.teacher.put(`/assignments/${assignment}/rubric`, { rubricId });
    await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/rubric-assessment`, {
      awards: [{ criterionId: criterionIds[0], points: 9 }],
    });
    const book = await fx.teacher.get(`/courses/${fx.courseId}/gradebook`);
    const row = book.body.students.find((s: { id: string }) => s.id === fx.users.s1.id);
    const cell = row.cells.find((c: { assignmentId: string }) => c.assignmentId === assignment);
    expect(cell.score).toBe(9);
  });

  it("refuses to mark an excused submission rather than silently losing the total", async () => {
    const assignment = await createAssignment({ title: "Excused one", pointsPossible: 10, submissionTypes: ["online_text_entry"] });
    const { rubricId, criterionIds } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Excuse me", [
      { description: "Work", points: 10 },
    ]);
    await fx.teacher.put(`/assignments/${assignment}/rubric`, { rubricId });
    await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/grade`, { excused: true });

    const r = await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/rubric-assessment`, {
      awards: [{ criterionId: criterionIds[0], points: 10 }],
    });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/excused/i);
  });

  it("says so when the mark was later overridden by hand", async () => {
    const assignment = await createAssignment({ title: "Overridden", pointsPossible: 10, submissionTypes: ["online_text_entry"] });
    const { rubricId, criterionIds } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Override", [
      { description: "Work", points: 10 },
    ]);
    await fx.teacher.put(`/assignments/${assignment}/rubric`, { rubricId });
    await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/rubric-assessment`, {
      awards: [{ criterionId: criterionIds[0], points: 6 }],
    });
    // Manual override is legitimate. The disagreement is surfaced, not prevented.
    await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/grade`, { grade: "9" });
    const view = await fx.teacher.get(`/assignments/${assignment}/submissions/${fx.users.s1.id}`);
    expect(view.body.submission.score).toBe(9);
    expect(view.body.rubricAssessment.total).toBe(6);
    expect(view.body.rubricAssessment.overridden).toBe(true);
  });
});

describe("hiding points", () => {
  it("strips them from the student's copy on the server, not in the browser", async () => {
    const assignment = await createAssignment({ title: "Hidden points", pointsPossible: 10, submissionTypes: ["online_text_entry"] });
    const { rubricId, criterionIds } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Qualitative", [
      { description: "Insight", points: 10 },
    ]);
    await fx.teacher.put(`/assignments/${assignment}/rubric`, { rubricId, hidePoints: true });
    await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/rubric-assessment`, {
      awards: [{ criterionId: criterionIds[0], points: 7 }],
    });

    const student = await fx.s1.get(`/assignments/${assignment}`);
    expect(student.body.assignment.rubric.pointsPossible).toBeNull();
    expect(student.body.assignment.rubric.criteria[0].points).toBeNull();
    expect(student.body.assignment.rubric.criteria[0].levels[0]).not.toHaveProperty("points");

    const marked = await fx.s1.get(`/assignments/${assignment}/submissions/${fx.users.s1.id}`);
    expect(marked.body.rubricAssessment.total).toBeNull();
    expect(marked.body.rubricAssessment.criteria[0].points).toBeNull();

    // Staff still see everything.
    const staff = await fx.teacher.get(`/assignments/${assignment}`);
    expect(staff.body.assignment.rubric.criteria[0].points).toBe(10);
  });
});

describe("deleting and detaching", () => {
  it("refuses to delete a rubric that is attached, and names what is using it", async () => {
    const assignment = await createAssignment({ title: "Holds a rubric", pointsPossible: 5, submissionTypes: ["online_text_entry"] });
    const { rubricId } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "In use", [
      { description: "Work", points: 5 },
    ]);
    await fx.teacher.put(`/assignments/${assignment}/rubric`, { rubricId });
    const r = await fx.teacher.del(`/rubrics/${rubricId}`);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/Holds a rubric/);
  });

  it("detaching keeps every mark exactly as it stands, but asks first", async () => {
    const assignment = await createAssignment({ title: "Detach me", pointsPossible: 10, submissionTypes: ["online_text_entry"] });
    const { rubricId, criterionIds } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Detachable", [
      { description: "Work", points: 10 },
    ]);
    await fx.teacher.put(`/assignments/${assignment}/rubric`, { rubricId });
    await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/rubric-assessment`, {
      awards: [{ criterionId: criterionIds[0], points: 8 }],
    });

    const refused = await fx.teacher.del(`/assignments/${assignment}/rubric`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/kept exactly as they are/i);

    const forced = await fx.teacher.req("DELETE", `/assignments/${assignment}/rubric?force=true`);
    expect(forced.status).toBe(200);
    expect(forced.body.keptAssessments).toBe(1);

    // The mark and its snapshot survive the rubric leaving the screen.
    const view = await fx.teacher.get(`/assignments/${assignment}/submissions/${fx.users.s1.id}`);
    expect(view.body.submission.score).toBe(8);
    expect(view.body.rubricAssessment.total).toBe(8);
    expect(view.body.rubricAssessment.rubricTitle).toBe("Detachable");
    expect((await fx.teacher.get(`/assignments/${assignment}`)).body.assignment.rubric).toBeNull();
  });

  it("a rubric that has only been used to mark can be deleted; the marking stands", async () => {
    const assignment = await createAssignment({ title: "Delete the rubric", pointsPossible: 10, submissionTypes: ["online_text_entry"] });
    const { rubricId, criterionIds } = await makeRubric(fx.teacher, `/courses/${fx.courseId}/rubrics`, "Doomed", [
      { description: "Work", points: 10 },
    ]);
    await fx.teacher.put(`/assignments/${assignment}/rubric`, { rubricId });
    await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s2.id}/rubric-assessment`, {
      awards: [{ criterionId: criterionIds[0], points: 4 }],
    });
    await fx.teacher.req("DELETE", `/assignments/${assignment}/rubric?force=true`);

    const deleted = await fx.teacher.del(`/rubrics/${rubricId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.keptAssessments).toBe(1);

    const view = await fx.teacher.get(`/assignments/${assignment}/submissions/${fx.users.s2.id}`);
    expect(view.body.submission.score).toBe(4);
    expect(view.body.rubricAssessment.total).toBe(4);
    expect(view.body.rubricAssessment.rubricId).toBeNull();
    expect(view.body.rubricAssessment.rubricTitle).toBe("Doomed");
  });
});

describe("duplicating a course", () => {
  it("clones the course's own rubrics but keeps a shared one shared", async () => {
    const src = await fx.admin.post("/courses", { code: "DUP101", name: "Duplicate source" });
    const srcId = src.body.course.id as string;
    const shared = await makeRubric(fx.admin, "/rubrics", "Shared for duplication", [
      { description: "Standard", points: 10 },
    ]);
    const own = await makeRubric(fx.admin, `/courses/${srcId}/rubrics`, "Own rubric", [
      { description: "Local", points: 5 },
    ]);
    const a1 = await fx.admin.post(`/courses/${srcId}/assignments`, { title: "With own rubric", pointsPossible: 5, submissionTypes: ["online_text_entry"] });
    const a2 = await fx.admin.post(`/courses/${srcId}/assignments`, { title: "With shared rubric", pointsPossible: 10, submissionTypes: ["online_text_entry"] });
    await fx.admin.put(`/assignments/${a1.body.assignment.id}/rubric`, { rubricId: own.rubricId });
    await fx.admin.put(`/assignments/${a2.body.assignment.id}/rubric`, { rubricId: shared.rubricId });

    const copy = await fx.admin.post(`/courses/${srcId}/duplicate`, { code: "DUP102", name: "Duplicate copy" });
    expect(copy.status).toBe(201);
    const copyId = copy.body.course.id as string;

    const library = await fx.admin.get(`/courses/${copyId}/rubrics`);
    const ownCopy = library.body.data.find((r: { title: string }) => r.title === "Own rubric");
    expect(ownCopy).toBeTruthy();
    expect(ownCopy.id).not.toBe(own.rubricId);
    expect(ownCopy.pointsPossible).toBe(5);

    const copied = await fx.admin.get(`/courses/${copyId}/assignments`);
    const names = copied.body.data.map((a: { title: string }) => a.title);
    expect(names).toContain("With own rubric");

    const withOwn = copied.body.data.find((a: { title: string }) => a.title === "With own rubric");
    const withShared = copied.body.data.find((a: { title: string }) => a.title === "With shared rubric");
    const ownAttached = await fx.admin.get(`/assignments/${withOwn.id}`);
    const sharedAttached = await fx.admin.get(`/assignments/${withShared.id}`);
    // The clone points at the clone; the shared original is still the shared original.
    expect(ownAttached.body.assignment.rubric.id).toBe(ownCopy.id);
    expect(sharedAttached.body.assignment.rubric.id).toBe(shared.rubricId);
    expect(sharedAttached.body.assignment.rubric.shared).toBe(true);
  });
});

describe("an unmarked assessment is unaffected", () => {
  it("leaves an assignment with no rubric exactly as it was", async () => {
    const assignment = await createAssignment({ title: "Plain assignment", pointsPossible: 10, submissionTypes: ["online_text_entry"] });
    expect((await fx.teacher.get(`/assignments/${assignment}`)).body.assignment.rubric).toBeNull();
    const r = await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/rubric-assessment`, {
      awards: [],
    });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/No rubric is attached/i);
    const graded = await fx.teacher.put(`/assignments/${assignment}/submissions/${fx.users.s1.id}/grade`, { grade: "7" });
    expect(graded.body.submission.score).toBe(7);
  });
});
