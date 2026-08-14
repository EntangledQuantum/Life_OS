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
import { backupDatabase } from "./backup.js";
import { createDb, resolveDbPath } from "./client.js";
import { ensureSchema, readSchemaVersion } from "./ensure-schema.js";
import { LATEST_VERSION } from "./migrations.js";

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
  /** Snapshot taken because migrations were about to run, if one was. */
  preMigrationBackup?: string;
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

  /*
   * Snapshot *before* migrating, and only when there is something to migrate.
   *
   * The periodic backup scheduler already runs, but it starts after boot — so
   * its most recent snapshot was of the database as it is *now*, post-migration.
   * If a migration got something subtly wrong, the newest copy would have the
   * mistake baked in and the last clean one could be a day old.
   *
   * A migration is the one moment where the before-state is worth more than any
   * scheduled snapshot, and it is the one moment we know is coming.
   */
  let preMigrationBackup: string | undefined;
  if (!created) {
    let behind = false;
    try {
      behind = readSchemaVersion(dbPath) < LATEST_VERSION;
    } catch {
      // Cannot read the version — treat that as "worth a snapshot" rather than
      // skipping the safety net on the one boot that most needs it.
      behind = true;
    }
    if (behind) {
      const snapshot = backupDatabase({ dbPath });
      if (snapshot.ok) preMigrationBackup = snapshot.backup.file;
      else note = `pre-migration backup failed: ${snapshot.error}`;
    }
  }

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
    preMigrationBackup,
  };
}
