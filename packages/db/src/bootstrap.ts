/**
 * Database bootstrap shared by the API and CLI entry points.
 *
 * Two stages, in order: the Drizzle migration folder creates the tables for a
 * brand-new file, then the versioned migrations in `migrations.ts` bring any
 * database — new or years old — up to `LATEST_VERSION`. A freshly cloned repo
 * works from `pnpm dev` alone, and an existing one upgrades in place.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, resolveDbPath } from "./client.js";
import { ensureSchema } from "./ensure-schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../drizzle");

export interface BootstrapResult {
  dbPath: string;
  created: boolean;
  migrated: boolean;
  note?: string;
  /** Schema version before and after this boot, and what ran in between. */
  schemaVersion: number;
  schemaVersionBefore: number;
  appliedMigrations: { version: number; name: string }[];
}

/**
 * Ensure the database file, its directory, and the full schema exist.
 * Idempotent and safe to call on every boot.
 */
export function bootstrapDatabase(dbPath?: string): BootstrapResult {
  const file = resolveDbPath(dbPath);
  const created = !fs.existsSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let migrated = false;
  let note: string | undefined;

  const db = createDb(dbPath);
  try {
    migrate(db, { migrationsFolder });
    migrated = true;
  } catch (e) {
    // A DB created before the migration journal existed will report a conflict.
    // The versioned migrations below still reconcile it, so this is not fatal.
    note = e instanceof Error ? e.message : String(e);
  }

  const schema = ensureSchema(dbPath);

  return {
    dbPath: file,
    created,
    migrated,
    note,
    schemaVersion: schema.to,
    schemaVersionBefore: schema.from,
    appliedMigrations: schema.applied,
  };
}
