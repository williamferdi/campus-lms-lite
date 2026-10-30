import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../src/db/seed.js";
import { createTestEnv, login, type TestEnv } from "../helpers.js";

let env: TestEnv;
const PASSWORD = "DemoPassword2026";

beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

describe("development seed", () => {
  it("refuses to run on a non-empty database", async () => {
    // createTestEnv already inserted an organization.
    await expect(seed(env.app, env.database.db, PASSWORD, () => {})).rejects.toThrow(/already contains data/);
  });

  it("seeds a fresh database through the API and produces coherent dashboards", async () => {
    const fresh = await createTestEnv();
    try {
      const { organizations } = await import("../../src/db/schema.js");
      await fresh.database.db.delete(organizations);
      const result = await seed(fresh.app, fresh.database.db, PASSWORD, () => {});
      const student = await login(fresh, result.emails.s1!, PASSWORD);
      const dash = await student.get("/dashboard");
      expect(dash.body.learning.courses.map((c: { code: string }) => c.code).sort()).toEqual(["BIO101", "CS150"]);
      expect(dash.body.learning.recentGrades.length).toBeGreaterThan(0);
      const teacher = await login(fresh, result.emails.drLee!, PASSWORD);
      const tdash = await teacher.get("/dashboard");
      expect(tdash.body.teaching.courses.find((c: { code: string }) => c.code === "BIO101").studentCount).toBe(6);
      const admin = await login(fresh, result.emails.admin!, PASSWORD);
      expect((await admin.get("/dashboard")).body.admin.courses.byStatus).toMatchObject({ published: 2, unpublished: 1 });
    } finally {
      await fresh.close();
    }
  });
});
