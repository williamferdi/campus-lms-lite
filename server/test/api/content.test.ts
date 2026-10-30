import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, standardCourse, type TestEnv } from "../helpers.js";

let env: TestEnv;
let fx: Awaited<ReturnType<typeof standardCourse>>;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

beforeAll(async () => {
  env = await createTestEnv();
  fx = await standardCourse(env);
});
afterAll(async () => env.close());

describe("pages", () => {
  it("sanitizes markdown and hides drafts from students", async () => {
    const r = await fx.teacher.post(`/courses/${fx.courseId}/pages`, {
      title: "Welcome",
      body: "# Hello\n\n<script>alert(1)</script><img src=x onerror=alert(1)>[link](javascript:alert(1))\n\n<iframe src=\"https://evil.example/x\"></iframe>",
      published: false,
    });
    expect(r.status).toBe(201);
    const html: string = r.body.page.bodyHtml;
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).not.toMatch(/<script|onerror|href="javascript:|evil\.example|<iframe/);
    expect((await fx.s1.get(`/pages/${r.body.page.id}`)).status).toBe(404);
    expect((await fx.s1.get(`/courses/${fx.courseId}/pages`)).body.data).toHaveLength(0);
    await fx.teacher.patch(`/pages/${r.body.page.id}`, { published: true });
    const seen = await fx.s1.get(`/pages/${r.body.page.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.page).not.toHaveProperty("body"); // markdown source is staff-only
  });

  it("allows YouTube embeds", async () => {
    const r = await fx.teacher.post(`/courses/${fx.courseId}/pages`, {
      title: "Video",
      body: '<iframe src="https://www.youtube-nocookie.com/embed/abc123def"></iframe>',
    });
    expect(r.body.page.bodyHtml).toContain('src="https://www.youtube-nocookie.com/embed/abc123def"');
  });

  it("students and TAs: TA can edit content, student cannot", async () => {
    expect((await fx.s1.post(`/courses/${fx.courseId}/pages`, { title: "Mine" })).status).toBe(403);
    expect((await fx.ta.post(`/courses/${fx.courseId}/pages`, { title: "TA page" })).status).toBe(201);
  });

  it("only one front page per course", async () => {
    const a = await fx.teacher.post(`/courses/${fx.courseId}/pages`, { title: "Home A", isFrontPage: true });
    const b = await fx.teacher.post(`/courses/${fx.courseId}/pages`, { title: "Home B", isFrontPage: true });
    expect((await fx.teacher.get(`/pages/${a.body.page.id}`)).body.page.isFrontPage).toBe(false);
    expect((await fx.s1.get(`/courses/${fx.courseId}/front-page`)).body.page.id).toBe(b.body.page.id);
  });
});

describe("files", () => {
  it("validates type, content and enforces publish state + course membership", async () => {
    const bad = await fx.teacher.upload(`/courses/${fx.courseId}/files`, "evil.html", Buffer.from("<script></script>"));
    expect(bad.status).toBe(422);
    const spoof = await fx.teacher.upload(`/courses/${fx.courseId}/files`, "fake.pdf", Buffer.from("not a pdf"));
    expect(spoof.status).toBe(422);
    const ok = await fx.teacher.upload(`/courses/${fx.courseId}/files`, "syllabus.pdf", PDF);
    expect(ok.status).toBe(201);
    const file = ok.body.data[0];
    expect((await fx.s1.req("GET", `/files/${file.id}/download`)).status).toBe(404);
    await fx.teacher.patch(`/files/${file.id}`, { published: true });
    const dl = await fx.s1.req("GET", `/files/${file.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/pdf");
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    expect((await fx.outsider.req("GET", `/files/${file.id}/download`)).status).toBe(404);
  });
});

describe("modules and progress", () => {
  let m1: string;
  let m2: string;
  let pageId: string;
  let page2Id: string;
  let viewItem: string;
  let doneItem: string;

  beforeAll(async () => {
    pageId = (await fx.teacher.post(`/courses/${fx.courseId}/pages`, { title: "Reading 1", body: "Read me", published: true })).body.page.id;
    page2Id = (await fx.teacher.post(`/courses/${fx.courseId}/pages`, { title: "Reading 2", body: "Then me", published: true })).body.page.id;
    m1 = (await fx.teacher.post(`/courses/${fx.courseId}/modules`, { title: "Week 1", published: true, requireSequential: true })).body.module.id;
    m2 = (await fx.teacher.post(`/courses/${fx.courseId}/modules`, { title: "Week 2", published: true, prerequisiteIds: [m1] })).body.module.id;
    viewItem = (await fx.teacher.post(`/modules/${m1}/items`, { type: "page", refId: pageId, requirement: "must_view", published: true })).body.item.id;
    doneItem = (await fx.teacher.post(`/modules/${m1}/items`, { type: "page", refId: page2Id, requirement: "must_mark_done", published: true })).body.item.id;
    await fx.teacher.post(`/modules/${m2}/items`, { type: "link", title: "Lecture video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", requirement: "must_view", published: true });
    await fx.teacher.post(`/modules/${m2}/items`, { type: "subheader", title: "Optional", published: false });
  });

  it("validates item requirements and references", async () => {
    expect((await fx.teacher.post(`/modules/${m1}/items`, { type: "page", refId: pageId, requirement: "must_submit" })).status).toBe(422);
    expect((await fx.teacher.post(`/modules/${m1}/items`, { type: "link", title: "x", url: "javascript:alert(1)" })).status).toBe(422);
    expect((await fx.teacher.post(`/modules/${m1}/items`, { type: "page", refId: "00000000-0000-4000-8000-000000000000" })).status).toBe(422);
    expect((await fx.teacher.post(`/courses/${fx.courseId}/modules`, { title: "Bad", prerequisiteIds: [m2] })).status).toBe(201);
    const later = (await fx.teacher.get(`/courses/${fx.courseId}/modules`)).body.modules.find((m: { title: string }) => m.title === "Bad");
    expect((await fx.teacher.patch(`/modules/${m1}`, { prerequisiteIds: [later.id] })).status).toBe(422);
    await fx.teacher.del(`/modules/${later.id}`);
  });

  it("students see published items only, with lock state and video embed", async () => {
    const r = await fx.s1.get(`/courses/${fx.courseId}/modules`);
    expect(r.status).toBe(200);
    const [w1, w2] = r.body.modules;
    expect(w1.state).toBe("unlocked");
    expect(w1.items.map((i: { locked: boolean }) => i.locked)).toEqual([false, true]);
    expect(w2.state).toBe("locked");
    expect(w2.lockedReason).toContain("Week 1");
    expect(w2.items).toHaveLength(1); // unpublished subheader hidden
    expect(w2.items[0].embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(r.body.progress).toEqual({ required: 3, completed: 0, percent: 0 });
  });

  it("locked content cannot be opened directly", async () => {
    const r = await fx.s1.get(`/pages/${page2Id}`);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/locked/i);
    expect((await fx.s1.post(`/module-items/${doneItem}/done`, { done: true })).status).toBe(403);
  });

  it("viewing and marking done progresses the student and unlocks the next module", async () => {
    expect((await fx.s1.get(`/pages/${pageId}`)).status).toBe(200); // records must_view
    expect((await fx.s1.post(`/module-items/${doneItem}/done`, { done: true })).status).toBe(200);
    const r = await fx.s1.get(`/courses/${fx.courseId}/modules`);
    expect(r.body.modules[0].state).toBe("completed");
    expect(r.body.modules[1].state).toBe("unlocked");
    expect(r.body.progress.percent).toBe(67);
    // Progress is per student.
    expect((await fx.s2.get(`/courses/${fx.courseId}/modules`)).body.progress.completed).toBe(0);
  });

  it("prev/next navigation follows module order", async () => {
    const nav = await fx.s1.get(`/courses/${fx.courseId}/module-nav?itemId=${doneItem}`);
    expect(nav.body.prev.id).toBe(viewItem);
    expect(nav.body.next.type).toBe("link");
    expect(nav.body.current.completed).toBe(true);
  });

  it("reordering modules drops prerequisites that would point forward", async () => {
    expect((await fx.teacher.post(`/courses/${fx.courseId}/modules/reorder`, { moduleIds: [m2, m1] })).status).toBe(200);
    const staff = await fx.teacher.get(`/courses/${fx.courseId}/modules`);
    expect(staff.body.modules[0].id).toBe(m2);
    expect(staff.body.modules[0].prerequisiteIds).toEqual([]);
    await fx.teacher.post(`/courses/${fx.courseId}/modules/reorder`, { moduleIds: [m1, m2] });
  });

  it("students cannot modify modules", async () => {
    expect((await fx.s1.post(`/courses/${fx.courseId}/modules`, { title: "x" })).status).toBe(403);
    expect((await fx.s1.del(`/modules/${m1}`)).status).toBe(403);
  });
});
