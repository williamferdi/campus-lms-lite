/**
 * Development/demo seed. Builds realistic synthetic data by calling the real HTTP API, so every
 * record passes the same validation, permission, grading and notification rules as production use.
 * Never run against production data.
 */
import type { FastifyInstance } from "fastify";
import { hashPassword } from "../lib/crypto.js";
import { sortableNameOf } from "../routes/auth.js";
import type { Db } from "./client.js";
import { organizations, users } from "./schema.js";

const DAY = 24 * 3600_000;
const at = (days: number, hour = 23, minute = 59) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

type Json = Record<string, unknown>;

class ApiClient {
  constructor(
    private app: FastifyInstance,
    private headers: Record<string, string>,
  ) {}
  static async login(app: FastifyInstance, email: string, password: string) {
    const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
    if (r.statusCode !== 200) throw new Error(`seed login failed for ${email}: ${r.body}`);
    const cookie = r.cookies.find((c) => c.name === "lms_session")!;
    return new ApiClient(app, { cookie: `lms_session=${cookie.value}`, "x-csrf-token": r.json().csrfToken });
  }
  async call<T = Json>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown): Promise<T> {
    const r = await this.app.inject({ method, url: `/api/v1${url}`, headers: this.headers, ...(body !== undefined ? { payload: body as object } : {}) });
    if (r.statusCode >= 400) throw new Error(`seed ${method} ${url} -> ${r.statusCode}: ${r.body}`);
    const isJson = String(r.headers["content-type"] ?? "").includes("json");
    return (isJson ? r.json() : r.body) as T;
  }
  post<T = Json>(url: string, body: unknown = {}) {
    return this.call<T>("POST", url, body);
  }
  patch<T = Json>(url: string, body: unknown) {
    return this.call<T>("PATCH", url, body);
  }
  put<T = Json>(url: string, body: unknown) {
    return this.call<T>("PUT", url, body);
  }
  get<T = Json>(url: string) {
    return this.call<T>("GET", url);
  }
  async upload<T = Json>(url: string, filename: string, content: Buffer) {
    const boundary = "----seedBoundary";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await this.app.inject({ method: "POST", url: `/api/v1${url}`, headers: { ...this.headers, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    if (r.statusCode >= 400) throw new Error(`seed upload ${url} -> ${r.statusCode}: ${r.body}`);
    return r.json() as T;
  }
}

export const DEMO_DOMAIN = "campus.test";

export async function seed(app: FastifyInstance, db: Db, password: string, log: (m: string) => void = console.log) {
  const existing = await db.select().from(organizations).limit(1);
  if (existing.length > 0) throw new Error("The database already contains data. Seeding only runs on an empty database.");

  const [org] = await db.insert(organizations).values({ name: "Campus University (demo)", slug: "campus" }).returning();
  const hash = await hashPassword(password);
  const people = {
    admin: { name: "Avery Admin", role: "admin" as const },
    drLee: { name: "Morgan Lee", role: "instructor" as const },
    drPatel: { name: "Riya Patel", role: "instructor" as const },
    ta: { name: "Jordan Kim", role: "student" as const },
    s1: { name: "Alex Rivera", role: "student" as const },
    s2: { name: "Blake Chen", role: "student" as const },
    s3: { name: "Casey Okafor", role: "student" as const },
    s4: { name: "Dana Novak", role: "student" as const },
    s5: { name: "Eli Sato", role: "student" as const },
    s6: { name: "Fran Duarte", role: "student" as const },
  };
  const ids: Record<keyof typeof people, { id: string; email: string }> = {} as never;
  for (const [key, p] of Object.entries(people) as [keyof typeof people, (typeof people)[keyof typeof people]][]) {
    const email = `${p.name.split(" ")[0]!.toLowerCase()}@${DEMO_DOMAIN}`;
    const [u] = await db
      .insert(users)
      .values({ orgId: org!.id, name: p.name, sortableName: sortableNameOf(p.name), email, role: p.role, status: "active", passwordHash: hash })
      .returning();
    ids[key] = { id: u!.id, email };
  }
  log(`Created ${Object.keys(people).length} demo users (@${DEMO_DOMAIN}).`);

  const as = async (key: keyof typeof people) => ApiClient.login(app, ids[key].email, password);
  const admin = await as("admin");
  const lee = await as("drLee");
  const patel = await as("drPatel");
  const students = { s1: await as("s1"), s2: await as("s2"), s3: await as("s3"), s4: await as("s4"), s5: await as("s5"), s6: await as("s6") };

  // ---- catalog
  const fall = await admin.post<{ term: { id: string } }>("/terms", { name: "Fall 2026", startAt: at(-60, 0, 0), endAt: at(50, 0, 0) });
  await admin.post("/terms", { name: "Spring 2027", startAt: at(80, 0, 0), endAt: at(190, 0, 0) });
  const bio = await admin.post<{ department: { id: string } }>("/departments", { name: "Biology", code: "BIO" });
  const cs = await admin.post<{ department: { id: string } }>("/departments", { name: "Computer Science", code: "CS" });

  // ================================================================ BIO101
  const bio101 = (await admin.post<{ course: { id: string } }>("/courses", {
    code: "BIO101",
    name: "Introduction to Biology",
    description: "Cells, genetics, evolution and ecosystems — the foundations of life science.",
    termId: fall.term.id,
    departmentId: bio.department.id,
  })).course.id;
  await admin.post(`/courses/${bio101}/enrollments`, { email: ids.drLee.email, role: "teacher" });
  await admin.post(`/courses/${bio101}/enrollments`, { email: ids.ta.email, role: "ta" });
  await admin.post(`/courses/${bio101}/enrollments/import`, {
    csv: ["email,role", ...(["s1", "s2", "s3", "s4", "s5", "s6"] as const).map((k) => `${ids[k].email},student`)].join("\n"),
  });

  // grading setup: weighted groups + late policy
  const groups = await lee.get<{ data: { id: string; name: string }[] }>(`/courses/${bio101}/assignment-groups`);
  const gAssign = groups.data[0]!.id;
  await lee.patch(`/assignment-groups/${gAssign}`, { name: "Assignments", weight: 40 });
  const gQuiz = (await lee.post<{ group: { id: string } }>(`/courses/${bio101}/assignment-groups`, { name: "Quizzes", weight: 35 })).group.id;
  const gDisc = (await lee.post<{ group: { id: string } }>(`/courses/${bio101}/assignment-groups`, { name: "Participation", weight: 25 })).group.id;
  await lee.patch(`/courses/${bio101}`, { applyGroupWeights: true, latePolicyEnabled: true, lateDeductionPercent: 10, lateFloorPercent: 50 });

  // content
  const welcome = (await lee.post<{ page: { id: string } }>(`/courses/${bio101}/pages`, {
    title: "Welcome to BIO101",
    isFrontPage: true,
    body: "## Welcome!\n\nThis course introduces the core ideas of biology.\n\n**How this course works**\n\n1. Work through each module in order.\n2. Complete the readings and the short quiz.\n3. Join the weekly discussion.\n\nOffice hours: Tuesdays 2–4 pm (see the calendar).",
  })).page.id;
  const reading1 = (await lee.post<{ page: { id: string } }>(`/courses/${bio101}/pages`, {
    title: "Reading: The Cell",
    published: true,
    body: "# The Cell\n\nAll living things are made of cells. Key organelles:\n\n| Organelle | Role |\n|---|---|\n| Nucleus | Stores DNA |\n| Mitochondria | Produces ATP |\n| Ribosome | Builds proteins |\n\n> Cells are the basic unit of life.",
  })).page.id;
  const reading2 = (await lee.post<{ page: { id: string } }>(`/courses/${bio101}/pages`, {
    title: "Reading: Membranes and Transport",
    published: true,
    body: "# Membranes\n\nThe plasma membrane controls what enters and leaves the cell through **diffusion**, **osmosis** and **active transport**.",
  })).page.id;
  const syllabus = (await lee.upload<{ data: { id: string }[] }>(`/courses/${bio101}/files`, "BIO101-syllabus.pdf", PDF)).data[0]!.id;
  await lee.patch(`/files/${syllabus}`, { published: true });

  const essay = (await lee.post<{ assignment: { id: string } }>(`/courses/${bio101}/assignments`, {
    title: "Cell Structure Essay",
    description: "Write 500 words describing three organelles and how they work together. Submit a PDF or type your answer.",
    pointsPossible: 20,
    submissionTypes: ["online_text_entry", "online_upload"],
    allowedExtensions: ["pdf", "docx"],
    allowedAttempts: 2,
    dueAt: at(2),
    published: true,
    postManually: true,
    groupId: gAssign,
  })).assignment.id;
  const lab = (await lee.post<{ assignment: { id: string } }>(`/courses/${bio101}/assignments`, {
    title: "Osmosis Lab Report",
    description: "Share a link to your lab notebook (Google Docs or similar) describing the potato osmosis experiment.",
    pointsPossible: 30,
    submissionTypes: ["online_url"],
    dueAt: at(5),
    published: true,
    groupId: gAssign,
  })).assignment.id;
  const fieldTrip = (await lee.post<{ assignment: { id: string } }>(`/courses/${bio101}/assignments`, {
    title: "Field Notebook Check",
    description: "Bring your field notebook to the lab session.",
    pointsPossible: 10,
    submissionTypes: ["on_paper"],
    dueAt: at(-6),
    published: true,
    groupId: gAssign,
  })).assignment.id;

  const quiz = (await lee.post<{ quiz: { id: string; assignmentId: string } }>(`/courses/${bio101}/quizzes`, {
    title: "Quiz 1: Cells",
    description: "Ten minutes, two attempts. Your highest score counts.",
    timeLimitMinutes: 10,
    allowedAttempts: 2,
    dueAt: at(7),
    groupId: gQuiz,
  })).quiz;
  type Q = { question: { id: string; choices: { id: string }[] } };
  const q1 = (await lee.post<Q>(`/quizzes/${quiz.id}/questions`, { type: "multiple_choice", prompt: "Which organelle produces most of the cell's ATP?", points: 2, choices: [{ text: "Nucleus" }, { text: "Mitochondrion" }, { text: "Golgi apparatus" }], correctChoiceIndexes: [1], feedback: "Mitochondria are the site of cellular respiration." })).question;
  const q2 = (await lee.post<Q>(`/quizzes/${quiz.id}/questions`, { type: "multiple_select", prompt: "Select all structures found in plant cells but not animal cells.", points: 2, choices: [{ text: "Cell wall" }, { text: "Chloroplast" }, { text: "Ribosome" }], correctChoiceIndexes: [0, 1] })).question;
  const q3 = (await lee.post<Q>(`/quizzes/${quiz.id}/questions`, { type: "true_false", prompt: "Prokaryotic cells have a nucleus.", points: 1, correctBoolean: false })).question;
  const q4 = (await lee.post<Q>(`/quizzes/${quiz.id}/questions`, { type: "short_answer", prompt: "Name the process by which water crosses a membrane.", points: 1, acceptedAnswers: ["osmosis"] })).question;
  const q5 = (await lee.post<Q>(`/quizzes/${quiz.id}/questions`, { type: "short_answer", prompt: "In one or two sentences, explain why cells are small.", points: 4 })).question;
  await lee.patch(`/quizzes/${quiz.id}`, { published: true });

  const discussion = (await lee.post<{ topic: { id: string } }>(`/courses/${bio101}/discussions`, {
    title: "Week 1: Where do you see biology every day?",
    body: "Share one example from your daily life and reply to at least one classmate.",
    published: true,
    requireInitialPost: true,
    graded: { pointsPossible: 10, dueAt: at(3), groupId: gDisc },
  })).topic.id;

  // modules
  type M = { module: { id: string } };
  const m1 = (await lee.post<M>(`/courses/${bio101}/modules`, { title: "Week 1 — Getting Started", published: true, requireSequential: true })).module.id;
  await lee.post(`/modules/${m1}/items`, { type: "page", refId: welcome, requirement: "must_view", published: true });
  await lee.post(`/modules/${m1}/items`, { type: "file", refId: syllabus, requirement: "must_view", published: true });
  await lee.post(`/modules/${m1}/items`, { type: "link", title: "Video: Inside the Cell", url: "https://www.youtube.com/watch?v=URUJD5NEXC8", requirement: "must_view", published: true });
  await lee.post(`/modules/${m1}/items`, { type: "page", refId: reading1, requirement: "must_mark_done", published: true });
  await lee.post(`/modules/${m1}/items`, { type: "discussion", refId: discussion, requirement: "must_contribute", published: true });
  const m2 = (await lee.post<M>(`/courses/${bio101}/modules`, { title: "Week 2 — Cells in Depth", published: true, prerequisiteIds: [m1] })).module.id;
  await lee.post(`/modules/${m2}/items`, { type: "subheader", title: "Learn", published: true });
  await lee.post(`/modules/${m2}/items`, { type: "page", refId: reading2, requirement: "must_view", published: true });
  await lee.post(`/modules/${m2}/items`, { type: "subheader", title: "Show what you know", published: true });
  await lee.post(`/modules/${m2}/items`, { type: "assignment", refId: essay, requirement: "must_submit", published: true });
  await lee.post(`/modules/${m2}/items`, { type: "quiz", refId: quiz.id, requirement: "min_score", minScore: 6, published: true });
  const m3 = (await lee.post<M>(`/courses/${bio101}/modules`, { title: "Week 3 — Lab Work", published: true, prerequisiteIds: [m2] })).module.id;
  await lee.post(`/modules/${m3}/items`, { type: "assignment", refId: lab, requirement: "must_submit", published: true });
  await lee.post(`/modules/${m3}/items`, { type: "assignment", refId: fieldTrip, requirement: "none", published: true });
  await lee.post(`/courses/${bio101}/modules`, { title: "Week 4 — Genetics (coming soon)", published: false });

  await lee.post(`/courses/${bio101}/status`, { status: "published" });
  await lee.post(`/courses/${bio101}/discussions`, { title: "Welcome to the course!", body: "Start with the **Week 1** module. Office hours are on the calendar.", isAnnouncement: true });
  await lee.post("/calendar-events", { title: "BIO101 office hours", startAt: at(1, 14, 0), endAt: at(1, 16, 0), courseId: bio101 });
  await lee.post("/calendar-events", { title: "BIO101 midterm review", startAt: at(9, 15, 0), endAt: at(9, 16, 30), courseId: bio101 });

  // ---- student activity
  const s = students;
  // Module 1 progress for several students
  for (const st of [s.s1, s.s2, s.s3]) {
    await st.get(`/pages/${welcome}`);
    await st.call("GET", `/files/${syllabus}/download`);
    const mods = await st.get<{ modules: { items: { id: string; type: string; requirement: string }[] }[] }>(`/courses/${bio101}/modules`);
    const items = mods.modules[0]!.items;
    await st.post(`/module-items/${items.find((i) => i.type === "link")!.id}/view`);
    await st.get(`/pages/${reading1}`);
    await st.post(`/module-items/${items.find((i) => i.requirement === "must_mark_done")!.id}/done`, { done: true });
  }
  await s.s1.post(`/discussions/${discussion}/entries`, { body: "Bread rising! Yeast are single-celled fungi releasing CO2." });
  await s.s2.post(`/discussions/${discussion}/entries`, { body: "Sunburn — UV light damages DNA in skin cells." });
  await s.s3.post(`/discussions/${discussion}/entries`, { body: "My houseplants leaning toward the window (phototropism)." });
  const entries = await s.s1.get<{ entries: { id: string; authorId: string }[] }>(`/discussions/${discussion}`);
  await s.s1.post(`/discussions/${discussion}/entries`, { body: "Great example — sunscreen makes more sense now.", parentId: entries.entries.find((e) => e.authorId === ids.s2.id)!.id });
  await s.s4.get(`/pages/${welcome}`);

  // Module 2 work (s1, s2 have completed module 1)
  for (const [st, text] of [
    [s.s1, "Mitochondria, ribosomes and the nucleus cooperate: the nucleus stores instructions..."],
    [s.s2, "The endoplasmic reticulum, Golgi apparatus and vesicles form a production line..."],
  ] as const) {
    await st.get(`/pages/${reading2}`);
    await st.post(`/assignments/${essay}/submit`, { submissionType: "online_text_entry", body: text });
  }
  const up = await s.s3.upload<{ data: { id: string }[] }>(`/assignments/${essay}/uploads`, "essay-casey.pdf", PDF);
  await s.s3.post(`/assignments/${essay}/submit`, { submissionType: "online_upload", fileIds: [up.data[0]!.id] });

  // Quiz attempts
  type Attempt = { attempt: { id: string } };
  const a1 = (await s.s1.post<Attempt>(`/quizzes/${quiz.id}/attempts`)).attempt.id;
  await s.s1.post(`/quiz-attempts/${a1}/submit`, { answers: { [q1.id]: q1.choices[1]!.id, [q2.id]: [q2.choices[0]!.id, q2.choices[1]!.id], [q3.id]: false, [q4.id]: "Osmosis", [q5.id]: "Small cells have a larger surface-area-to-volume ratio, so diffusion is efficient." } });
  const a2 = (await s.s2.post<Attempt>(`/quizzes/${quiz.id}/attempts`)).attempt.id;
  await s.s2.post(`/quiz-attempts/${a2}/submit`, { answers: { [q1.id]: q1.choices[0]!.id, [q2.id]: [q2.choices[0]!.id], [q3.id]: false, [q4.id]: "diffusion", [q5.id]: "So they can divide quickly." } });

  // Grading (TA and teacher)
  const ta = await as("ta");
  await ta.put(`/assignments/${essay}/submissions/${ids.s1.id}/grade`, { grade: "18", comment: "Clear structure and accurate detail. Add one diagram next time." });
  await lee.put(`/assignments/${essay}/submissions/${ids.s2.id}/grade`, { grade: "15", comment: "Good analogy; expand on the Golgi's role." });
  await lee.post(`/assignments/${essay}/post-grades`);
  await lee.put(`/assignments/${fieldTrip}/submissions/${ids.s1.id}/grade`, { grade: "10" });
  await lee.put(`/assignments/${fieldTrip}/submissions/${ids.s2.id}/grade`, { grade: "8" });
  await lee.put(`/assignments/${fieldTrip}/submissions/${ids.s3.id}/grade`, { grade: "9" });
  await lee.put(`/assignments/${fieldTrip}/submissions/${ids.s4.id}/grade`, { excused: true, comment: "Excused — medical note received." });
  const attempts = await lee.get<{ data: { id: string; userId: string }[] }>(`/quizzes/${quiz.id}/attempts`);
  for (const at1 of attempts.data) {
    await lee.put(`/quiz-attempts/${at1.id}/grade`, { scores: { [q5.id]: at1.userId === ids.s1.id ? 4 : 2 }, comments: { [q5.id]: at1.userId === ids.s1.id ? "Exactly right." : "Think about surface area." } });
  }
  const dEntries = await lee.get<{ entries: { authorId: string }[] }>(`/discussions/${discussion}`);
  const discAssignment = (await lee.get<{ data: { id: string; discussionId: string | null }[] }>(`/courses/${bio101}/assignments`)).data.find((x) => x.discussionId === discussion)!.id;
  for (const authorId of new Set(dEntries.entries.map((e) => e.authorId))) {
    await lee.put(`/assignments/${discAssignment}/submissions/${authorId}/grade`, { grade: authorId === ids.s1.id ? "10" : "8" });
  }

  // ================================================================ CS150
  const cs150 = (await admin.post<{ course: { id: string } }>("/courses", {
    code: "CS150",
    name: "Programming Foundations",
    description: "Problem solving with Python: variables, control flow, functions and data structures.",
    termId: fall.term.id,
    departmentId: cs.department.id,
  })).course.id;
  await admin.post(`/courses/${cs150}/enrollments`, { email: ids.drPatel.email, role: "teacher" });
  for (const k of ["s1", "s3", "s5", "s6"] as const) await patel.post(`/courses/${cs150}/enrollments`, { email: ids[k].email, role: "student" });
  const csIntro = (await patel.post<{ page: { id: string } }>(`/courses/${cs150}/pages`, { title: "Course Overview", isFrontPage: true, body: "Welcome to **CS150**. We use Python 3.12. Install it before week 1." })).page.id;
  const hw1 = (await patel.post<{ assignment: { id: string } }>(`/courses/${cs150}/assignments`, { title: "Homework 1: Hello, Python", description: "Upload your `hello.py` as a .txt or .zip file.", pointsPossible: 10, submissionTypes: ["online_upload", "online_text_entry"], dueAt: at(-1), published: true })).assignment.id;
  const hw2 = (await patel.post<{ assignment: { id: string } }>(`/courses/${cs150}/assignments`, { title: "Homework 2: Loops", description: "Write a program that prints the first 20 Fibonacci numbers.", pointsPossible: 10, submissionTypes: ["online_text_entry"], dueAt: at(4), published: true })).assignment.id;
  const cm1 = (await patel.post<M>(`/courses/${cs150}/modules`, { title: "Unit 1 — Basics", published: true })).module.id;
  await patel.post(`/modules/${cm1}/items`, { type: "page", refId: csIntro, requirement: "must_view", published: true });
  await patel.post(`/modules/${cm1}/items`, { type: "assignment", refId: hw1, requirement: "must_submit", published: true });
  await patel.post(`/modules/${cm1}/items`, { type: "assignment", refId: hw2, requirement: "must_submit", published: true });
  await patel.post(`/courses/${cs150}/status`, { status: "published" });
  await patel.post(`/courses/${cs150}/discussions`, { title: "Lab room change", body: "Thursday labs move to room 204.", isAnnouncement: true });
  await s.s1.post(`/assignments/${hw1}/submit`, { submissionType: "online_text_entry", body: "```python\nprint('Hello, world!')\n```" });
  await s.s3.post(`/assignments/${hw1}/submit`, { submissionType: "online_text_entry", body: "```python\nname = input()\nprint(f'Hello, {name}')\n```" });
  await patel.put(`/assignments/${hw1}/submissions/${ids.s1.id}/grade`, { grade: "10", comment: "Perfect." });

  // ================================================================ BIO201 (draft)
  const bio201 = (await lee.post<{ course: { id: string } }>("/courses", { code: "BIO201", name: "Genetics", description: "Mendelian and molecular genetics (draft for Spring).", departmentId: bio.department.id })).course.id;
  await lee.post(`/courses/${bio201}/pages`, { title: "Draft syllabus", body: "Coming soon." });

  log("Seeded courses BIO101 (published), CS150 (published) and BIO201 (draft).");
  return { orgId: org!.id, emails: Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.email])) };
}
