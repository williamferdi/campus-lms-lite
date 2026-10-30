import { loadConfig } from "../config.js";
import { createDatabase } from "./client.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
await database.migrate();
console.log(`Migrations applied (${database.kind}).`);
await database.close();
