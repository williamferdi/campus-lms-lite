import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabase, type Database } from "../src/db/client.js";
import { organizations, users } from "../src/db/schema.js";
import { hashPassword } from "../src/lib/crypto.js";
import { MemoryStorage } from "../src/services/storage.js";
import { sortableNameOf } from "../src/routes/auth.js";

export const PASSWORD = "Password123!";

export interface TestEnv {
  app: FastifyInstance;
  database: Database;
  storage: MemoryStorage;
  orgId: string;
  close(): Promise<void>;
}

let cachedHash: string | null = null;

export async function createTestEnv(overrides: Record<string, string> = {}): Promise<TestEnv> {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "pglite:memory",
    LOG_LEVEL: "silent",
    APP_URL: "http://lms.test",
    AUTH_RATE_LIMIT_PER_MINUTE: "10000",
    ...overrides,
  });
  const database = createDatabase(config.DATABASE_URL);
  await database.migrate();
  const storage = new MemoryStorage();
  const app = await buildApp({ config, db: database.db, storage, logger: false });
  const [org] = await database.db.insert(organizations).values({ name: "Test University", slug: "test" }).returning();
  return {
    app,
    database,
    storage,
    orgId: org!.id,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

export async function createUser(env: TestEnv, name: string, role: "admin" | "instructor" | "student" = "student") {
  cachedHash ??= await hashPassword(PASSWORD);
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@test.edu`;
  const [u] = await env.database.db
    .insert(users)
    .values({ orgId: env.orgId, name, sortableName: sortableNameOf(name), email, role, status: "active", passwordHash: cachedHash })
    .returning();
  return u!;
}

/** A signed-in HTTP client bound to one user's session cookie + CSRF token. */
export interface Client {
  userId: string;
  req(method: InjectOptions["method"], url: string, body?: unknown): Promise<{ status: number; body: any; headers: Record<string, unknown>; raw: string }>;
  get(url: string): Promise<{ status: number; body: any }>;
  post(url: string, body?: unknown): Promise<{ status: number; body: any }>;
  patch(url: string, body?: unknown): Promise<{ status: number; body: any }>;
  put(url: string, body?: unknown): Promise<{ status: number; body: any }>;
  del(url: string): Promise<{ status: number; body: any }>;
  upload(url: string, filename: string, content: Buffer, field?: string): Promise<{ status: number; body: any }>;
}

export async function login(env: TestEnv, email: string, password = PASSWORD): Promise<Client> {
  const res = await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === "lms_session")!;
  const { csrfToken, user } = res.json();
  const headers = { cookie: `lms_session=${cookie.value}`, "x-csrf-token": csrfToken };
  const req: Client["req"] = async (method, url, body) => {
    const r = await env.app.inject({ method, url: `/api/v1${url}`, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    let parsed: unknown = null;
    try {
      parsed = r.json();
    } catch {
      parsed = null;
    }
    return { status: r.statusCode, body: parsed, headers: r.headers as Record<string, unknown>, raw: r.body };
  };
  return {
    userId: user.id,
    req,
    get: (u) => req("GET", u),
    post: (u, b) => req("POST", u, b ?? {}),
    patch: (u, b) => req("PATCH", u, b ?? {}),
    put: (u, b) => req("PUT", u, b ?? {}),
    del: (u) => req("DELETE", u),
    upload: async (url, filename, content, field = "file") => {
      const boundary = "----lmsTestBoundary";
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const r = await env.app.inject({
        method: "POST",
        url: `/api/v1${url}`,
        headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` },
        payload,
      });
      return { status: r.statusCode, body: r.json() };
    },
  };
}

/** Standard fixture: admin, teacher, TA, two students, one outsider, and a published course. */
export async function standardCourse(env: TestEnv) {
  const admin = await createUser(env, "Ada Admin", "admin");
  const teacher = await createUser(env, "Tess Teacher", "instructor");
  const ta = await createUser(env, "Tom Assistant", "student");
  const s1 = await createUser(env, "Sam Student", "student");
  const s2 = await createUser(env, "Sue Student", "student");
  const outsider = await createUser(env, "Olly Outsider", "student");
  const adminC = await login(env, admin.email);
  const created = await adminC.post("/courses", { code: "BIO101", name: "Intro Biology" });
  const courseId: string = created.body.course.id;
  for (const [u, role] of [
    [teacher, "teacher"],
    [ta, "ta"],
    [s1, "student"],
    [s2, "student"],
  ] as const) {
    const r = await adminC.post(`/courses/${courseId}/enrollments`, { email: u.email, role });
    if (r.status !== 201) throw new Error(`enroll failed: ${JSON.stringify(r.body)}`);
  }
  await adminC.post(`/courses/${courseId}/status`, { status: "published" });
  return {
    courseId,
    users: { admin, teacher, ta, s1, s2, outsider },
    admin: adminC,
    teacher: await login(env, teacher.email),
    ta: await login(env, ta.email),
    s1: await login(env, s1.email),
    s2: await login(env, s2.email),
    outsider: await login(env, outsider.email),
  };
}
