import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, createUser, login, PASSWORD, standardCourse, type TestEnv } from "../helpers.js";

let env: TestEnv;
let fx: Awaited<ReturnType<typeof standardCourse>>;

beforeAll(async () => {
  env = await createTestEnv();
  fx = await standardCourse(env);
});
afterAll(async () => env.close());

describe("authentication", () => {
  it("rejects bad credentials with a generic message", async () => {
    const r = await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: fx.users.s1.email, password: "wrong-password-1" } });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.message).toBe("Invalid email or password.");
    const r2 = await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "nobody@test.edu", password: "x" } });
    expect(r2.json().error.message).toBe("Invalid email or password.");
  });

  it("returns the user and sets an HttpOnly session cookie", async () => {
    const r = await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: fx.users.s1.email.toUpperCase(), password: PASSWORD } });
    expect(r.statusCode).toBe(200);
    const cookie = r.cookies.find((c) => c.name === "lms_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(r.json().user).not.toHaveProperty("passwordHash");
  });

  it("requires a CSRF token for state-changing requests", async () => {
    const r = await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: fx.users.s1.email, password: PASSWORD } });
    const cookie = r.cookies.find((c) => c.name === "lms_session")!;
    const bad = await env.app.inject({
      method: "PATCH",
      url: "/api/v1/auth/me",
      headers: { cookie: `lms_session=${cookie.value}` },
      payload: { name: "Hacked" },
    });
    expect(bad.statusCode).toBe(403);
    expect(bad.json().error.code).toBe("csrf_failed");
  });

  it("unauthenticated API calls get 401", async () => {
    const r = await env.app.inject({ method: "GET", url: "/api/v1/courses" });
    expect(r.statusCode).toBe(401);
    const me = await env.app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(me.json()).toEqual({ user: null, csrfToken: null });
  });

  it("logout invalidates the session", async () => {
    const c = await login(env, fx.users.s2.email);
    expect((await c.post("/auth/logout")).status).toBe(200);
    expect((await c.get("/courses")).status).toBe(401);
  });

  it("activation flow: admin creates pending user, link sets password and signs in", async () => {
    const created = await fx.admin.post("/users", { name: "New Person", email: "new.person@test.edu", role: "student" });
    expect(created.status).toBe(201);
    expect(created.body.user.status).toBe("pending");
    expect(created.body.emailSent).toBe(false); // no SMTP configured: never claims an email was sent
    const token = new URL(created.body.activationUrl).searchParams.get("token")!;
    const info = await env.app.inject({ method: "GET", url: `/api/v1/auth/token-info?token=${token}` });
    expect(info.json()).toMatchObject({ valid: true, kind: "activation", email: "new.person@test.edu" });
    const weak = await env.app.inject({ method: "POST", url: "/api/v1/auth/activate", payload: { token, password: "short" } });
    expect(weak.statusCode).toBe(422);
    const ok = await env.app.inject({ method: "POST", url: "/api/v1/auth/activate", payload: { token, password: "GoodPassword1" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.status).toBe("active");
    const reuse = await env.app.inject({ method: "POST", url: "/api/v1/auth/activate", payload: { token, password: "GoodPassword1" } });
    expect(reuse.statusCode).toBe(422);
    await login(env, "new.person@test.edu", "GoodPassword1");
  });

  it("password reset via admin-issued link revokes sessions", async () => {
    const u = await createUser(env, "Reset Me");
    const c = await login(env, u.email);
    const link = await fx.admin.post(`/users/${u.id}/reset-link`);
    const token = new URL(link.body.url).searchParams.get("token")!;
    const r = await env.app.inject({ method: "POST", url: "/api/v1/auth/reset-password", payload: { token, password: "BrandNewPass9" } });
    expect(r.statusCode).toBe(200);
    expect((await c.get("/courses")).status).toBe(401);
    await login(env, u.email, "BrandNewPass9");
  });

  it("forgot-password is honest when email is not configured", async () => {
    const r = await env.app.inject({ method: "POST", url: "/api/v1/auth/forgot-password", payload: { email: fx.users.s1.email } });
    expect(r.json()).toMatchObject({ ok: true, emailConfigured: false });
  });

  it("deactivated users cannot sign in and lose sessions", async () => {
    const u = await createUser(env, "Gone Soon");
    const c = await login(env, u.email);
    const r = await fx.admin.patch(`/users/${u.id}`, { status: "deactivated" });
    expect(r.status).toBe(200);
    expect((await c.get("/courses")).status).toBe(401);
    const again = await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: u.email, password: PASSWORD } });
    expect(again.statusCode).toBe(403);
  });

  it("rate-limits repeated login attempts", async () => {
    const limited = await createTestEnv({ AUTH_RATE_LIMIT_PER_MINUTE: "3" });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await limited.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "a@b.c", password: "x" } });
        codes.push(r.statusCode);
      }
      expect(codes).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.close();
    }
  });

  it("change password requires the current password", async () => {
    const u = await createUser(env, "Changer Person");
    const c = await login(env, u.email);
    expect((await c.post("/auth/change-password", { currentPassword: "nope", newPassword: "AnotherPass22" })).status).toBe(422);
    expect((await c.post("/auth/change-password", { currentPassword: PASSWORD, newPassword: "AnotherPass22" })).status).toBe(200);
    await login(env, u.email, "AnotherPass22");
  });
});

describe("user administration", () => {
  it("only admins can list or create users", async () => {
    expect((await fx.teacher.get("/users")).status).toBe(403);
    expect((await fx.s1.post("/users", { name: "X", email: "x@test.edu" })).status).toBe(403);
    const list = await fx.admin.get("/users?q=student&perPage=2");
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeLessThanOrEqual(2);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it("rejects duplicate emails case-insensitively", async () => {
    const r = await fx.admin.post("/users", { name: "Dup", email: fx.users.s1.email.toUpperCase() });
    expect(r.status).toBe(409);
  });

  it("bulk imports users from CSV and reports per-row results", async () => {
    const csv = `name,email,role\nCsv One,csv.one@test.edu,student\nBad Row,not-an-email,student\nDup,${fx.users.s1.email},student\n`;
    const r = await fx.admin.post("/users/import", { csv });
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(["created", "error", "skipped"]);
  });

  it("admins cannot demote or deactivate themselves", async () => {
    const r = await fx.admin.patch(`/users/${fx.users.admin.id}`, { status: "deactivated" });
    expect(r.status).toBe(403);
  });

  it("records audit events for admin actions", async () => {
    const r = await fx.admin.get(`/courses/${fx.courseId}/audit`);
    expect(r.status).toBe(200);
    const actions = r.body.data.map((e: { action: string }) => e.action);
    expect(actions).toContain("course.created");
    expect(actions).toContain("enrollment.created");
    expect(actions).toContain("course.published");
  });
});

describe("courses and enrollments", () => {
  it("students cannot create courses; instructors can and become teacher", async () => {
    expect((await fx.s1.post("/courses", { code: "X1", name: "Nope" })).status).toBe(403);
    const r = await fx.teacher.post("/courses", { code: "CHEM1", name: "Chemistry" });
    expect(r.status).toBe(201);
    const view = await fx.teacher.get(`/courses/${r.body.course.id}`);
    expect(view.body.permissions).toMatchObject({ role: "teacher", canManage: true });
  });

  it("each role gets the right permissions on a course", async () => {
    expect((await fx.teacher.get(`/courses/${fx.courseId}`)).body.permissions).toMatchObject({ role: "teacher", canManage: true, canGrade: true });
    expect((await fx.ta.get(`/courses/${fx.courseId}`)).body.permissions).toMatchObject({ role: "ta", canManage: false, canGrade: true });
    expect((await fx.s1.get(`/courses/${fx.courseId}`)).body.permissions).toMatchObject({ role: "student", isStaff: false, canGrade: false });
  });

  it("outsiders get 404 for a course they are not enrolled in", async () => {
    expect((await fx.outsider.get(`/courses/${fx.courseId}`)).status).toBe(404);
    expect((await fx.outsider.get(`/courses/${fx.courseId}/enrollments`)).status).toBe(404);
  });

  it("students cannot see unpublished courses in lists or by id", async () => {
    const r = await fx.admin.post("/courses", { code: "HID1", name: "Hidden" });
    const id = r.body.course.id;
    await fx.admin.post(`/courses/${id}/enrollments`, { email: fx.users.s1.email, role: "student" });
    expect((await fx.s1.get(`/courses/${id}`)).status).toBe(403);
    const list = await fx.s1.get("/courses");
    expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(id);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(fx.courseId);
  });

  it("TAs and students cannot manage enrollments or settings", async () => {
    expect((await fx.ta.post(`/courses/${fx.courseId}/enrollments`, { email: fx.users.outsider.email, role: "student" })).status).toBe(403);
    expect((await fx.s1.patch(`/courses/${fx.courseId}`, { name: "Mine now" })).status).toBe(403);
    expect((await fx.s1.post(`/courses/${fx.courseId}/status`, { status: "archived" })).status).toBe(403);
  });

  it("student roster hides emails; staff roster shows them", async () => {
    const asStudent = await fx.s1.get(`/courses/${fx.courseId}/enrollments`);
    expect(asStudent.body.data[0]).not.toHaveProperty("email");
    const asTeacher = await fx.teacher.get(`/courses/${fx.courseId}/enrollments`);
    expect(asTeacher.body.data[0]).toHaveProperty("email");
  });

  it("CSV enrollment import reports enrolled / skipped / errors", async () => {
    const extra = await createUser(env, "Csv Student");
    const csv = `email,role\n${extra.email},student\n${fx.users.s1.email},student\nmissing@test.edu,student\n`;
    const r = await fx.teacher.post(`/courses/${fx.courseId}/enrollments/import`, { csv });
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(["enrolled", "skipped", "error"]);
  });

  it("inactive enrollment blocks access; reactivation restores it", async () => {
    const list = await fx.teacher.get(`/courses/${fx.courseId}/enrollments?role=student`);
    const enr = list.body.data.find((e: { userId: string }) => e.userId === fx.users.s2.id);
    expect((await fx.teacher.patch(`/enrollments/${enr.id}`, { status: "inactive" })).status).toBe(200);
    expect((await fx.s2.get(`/courses/${fx.courseId}`)).status).toBe(404);
    await fx.teacher.patch(`/enrollments/${enr.id}`, { status: "active" });
    expect((await fx.s2.get(`/courses/${fx.courseId}`)).status).toBe(200);
  });

  it("teachers cannot remove themselves", async () => {
    const list = await fx.teacher.get(`/courses/${fx.courseId}/enrollments?role=teacher`);
    const mine = list.body.data.find((e: { userId: string }) => e.userId === fx.users.teacher.id);
    expect((await fx.teacher.del(`/enrollments/${mine.id}`)).status).toBe(403);
  });

  it("validates course input with actionable messages", async () => {
    const r = await fx.admin.post("/courses", { code: "", name: "x" });
    expect(r.status).toBe(422);
    expect(r.body.error.details[0].path).toBe("code");
  });

  it("archived courses are read-only for teachers; only admins reopen them", async () => {
    const c = await fx.teacher.post("/courses", { code: "ARC1", name: "To archive" });
    const id = c.body.course.id;
    expect((await fx.teacher.post(`/courses/${id}/status`, { status: "archived" })).status).toBe(200);
    expect((await fx.teacher.get(`/courses/${id}`)).body.permissions.readOnly).toBe(true);
    expect((await fx.teacher.post(`/courses/${id}/status`, { status: "published" })).status).toBe(403);
    expect((await fx.admin.post(`/courses/${id}/status`, { status: "published" })).status).toBe(200);
  });

  it("admin course list supports scope=all, search and pagination", async () => {
    const r = await fx.admin.get("/courses?scope=all&q=bio&perPage=5");
    expect(r.body.data[0]).toMatchObject({ code: "BIO101", studentCount: expect.any(Number) });
    expect(r.body.meta).toMatchObject({ page: 1, perPage: 5 });
  });
});
