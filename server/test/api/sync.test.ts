import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enrollments, serviceTokens, users } from "../../src/db/schema.js";
import { randomToken, sha256 } from "../../src/lib/crypto.js";
import { createTestEnv, createUser, login, type TestEnv } from "../helpers.js";

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
    const admin = await createUser(env, "Ada Admin", "admin");
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
