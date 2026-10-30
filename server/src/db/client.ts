import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle as drizzlePg, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema.js";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** Anything that can run queries: the root db or a transaction. */
export type Executor = PgDatabase<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export interface Database {
  db: Db;
  kind: "postgres" | "pglite";
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
// src/db -> ../../drizzle ; dist -> ../drizzle
export function migrationsFolder(): string {
  const candidates = [path.resolve(here, "../../drizzle"), path.resolve(here, "../drizzle")];
  return process.env.MIGRATIONS_DIR ?? candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}


export function createDatabase(url: string): Database {
  if (url.startsWith("pglite:")) {
    const target = url.slice("pglite:".length);
    const inMemory = target === "memory" || target === "";
    if (!inMemory) mkdirSync(path.resolve(target), { recursive: true });
    const client = inMemory ? new PGlite() : new PGlite(path.resolve(target));
    const db = drizzlePglite(client, { schema }) as unknown as Db;
    return {
      db,
      kind: "pglite",
      migrate: async () => {
        await migratePglite(db as never, { migrationsFolder: migrationsFolder() });
      },
      close: async () => {
        await client.close();
      },
    };
  }
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // Hosted databases can drop idle connections (Neon pauses when idle). Without a listener this would crash the process;
  // the pool discards the broken client and opens a new one on the next query.
  pool.on("error", (err) => console.error("Idle database connection closed:", err.message));
  const db = drizzlePg(pool, { schema });
  return {
    db,
    kind: "postgres",
    migrate: async () => {
      await migratePg(db, { migrationsFolder: migrationsFolder() });
    },
    close: async () => {
      await pool.end();
    },
  };
}
