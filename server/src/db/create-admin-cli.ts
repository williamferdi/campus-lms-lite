/**
 * Bootstrap the first administrator on a fresh production database.
 * Usage: npm run create-admin -- --email it-admin@example.edu --name "IT Admin" [--org "Your University"]
 * Prints a single-use activation link (valid 24 hours). No password is ever passed on the command line.
 */
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { sortableNameOf } from "../routes/auth.js";
import { createDatabase } from "./client.js";
import { authTokens, organizations, users } from "./schema.js";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, org: { type: "string" } } });
const args = z
  .object({ email: z.email(), name: z.string().trim().min(1), org: z.string().trim().min(1).default("Campus University") })
  .safeParse(values);
if (!args.success) {
  console.error('Usage: npm run create-admin -- --email you@example.edu --name "Your Name" [--org "Institution"]');
  process.exit(1);
}

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
await database.migrate();
const db = database.db;
try {
  let [org] = await db.select().from(organizations).limit(1);
  if (!org) [org] = await db.insert(organizations).values({ name: args.data.org, slug: "main" }).returning();
  const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${args.data.email.toLowerCase()}`);
  if (existing) throw new Error(`A user with email ${args.data.email} already exists.`);
  const [user] = await db
    .insert(users)
    .values({ orgId: org!.id, email: args.data.email, name: args.data.name, sortableName: sortableNameOf(args.data.name), role: "admin", status: "pending" })
    .returning();
  const token = randomToken();
  await db.insert(authTokens).values({ userId: user!.id, kind: "activation", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 24 * 3600_000) });
  console.log(`Administrator ${user!.email} created in "${org!.name}".`);
  console.log(`Send this single-use activation link (valid 24 hours) securely:\n${config.APP_URL}/activate?token=${encodeURIComponent(token)}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await database.close();
}
