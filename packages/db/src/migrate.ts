import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, resolveDbPath } from "./client.js";
import { ensureSchema } from "./ensure-schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../drizzle");

console.log(`Migrating database at ${resolveDbPath()}…`);
const db = createDb();
try {
  migrate(db, { migrationsFolder });
} catch (e) {
  console.warn("Drizzle migrate note:", e instanceof Error ? e.message : e);
}
ensureSchema();
console.log("Migrations complete.");
