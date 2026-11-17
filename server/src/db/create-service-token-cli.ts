/**
 * Mint a service token for another system to call the sync endpoints with.
 * Usage: npm run create-service-token -- --label "Frappe registrar"
 *
 * The token is shown once and never stored, only its SHA-256 hash, so a copy of the database
 * cannot be used to call the API. Losing it means minting another and revoking this one.
 */
import { parseArgs } from "node:util";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { createDatabase } from "./client.js";
import { organizations, serviceTokens } from "./schema.js";

const { values } = parseArgs({
  options: { label: { type: "string" }, list: { type: "boolean" }, revoke: { type: "string" } },
});

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
await database.migrate();
const db = database.db;
try {
  if (values.list) {
    const rows = await db.select().from(serviceTokens);
    if (rows.length === 0) console.log("No service tokens.");
    for (const r of rows) {
      const state = r.revokedAt ? `revoked ${r.revokedAt.toISOString()}` : "active";
      console.log(`${r.id}  ${r.label}  ${state}  last used ${r.lastUsedAt?.toISOString() ?? "never"}`);
    }
  } else if (values.revoke) {
    const [row] = await db
      .update(serviceTokens)
      .set({ revokedAt: new Date() })
      .where(eq(serviceTokens.id, values.revoke))
      .returning();
    if (!row) throw new Error(`No service token with id ${values.revoke}.`);
    console.log(`Revoked ${row.label}. Calls using it now fail.`);
  } else {
    const args = z.object({ label: z.string().trim().min(1).max(120) }).safeParse(values);
    if (!args.success) {
      console.error('Usage: npm run create-service-token -- --label "Frappe registrar"');
      console.error("       npm run create-service-token -- --list");
      console.error("       npm run create-service-token -- --revoke <id>");
      process.exit(1);
    }
    const [org] = await db.select().from(organizations).limit(1);
    if (!org) throw new Error("No organization yet. Run create-admin first.");
    const token = randomToken();
    const [row] = await db
      .insert(serviceTokens)
      .values({ orgId: org.id, label: args.data.label, tokenHash: sha256(token) })
      .returning();
    const active = await db.select().from(serviceTokens).where(isNull(serviceTokens.revokedAt));
    console.log(`Service token "${row!.label}" created for "${org.name}" (${active.length} active).`);
    console.log("Give it to the calling system securely. It is shown once and cannot be recovered:");
    console.log(token);
    console.log(`\nThe caller sends it as:  Authorization: Bearer <token>`);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await database.close();
}
