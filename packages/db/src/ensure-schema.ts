/**
 * Bring a database up to the current schema version.
 *
 * This used to be a hand-maintained list of `hasColumn` checks re-run in full on
 * every boot, with no record of what a given database had actually been through.
 * The work now lives in `migrations.ts` as numbered, forward-only steps, and the
 * database carries its own version in SQLite's `user_version` header — so a
 * database that is already current does nothing at all, and one that is three
 * versions behind runs exactly the three steps it is missing.
 *
 * The name is kept because it is called from `bootstrap` and the migrate script.
 */
import { DatabaseSync } from "node:sqlite";
import { resolveDbPath } from "./client.js";
import {
  LATEST_VERSION,
  currentVersion,
  ensureSyncTriggers,
  runMigrations,
} from "./migrations.js";

export {
  LATEST_VERSION,
  MIGRATIONS,
  currentVersion,
  ensureSyncTriggers,
} from "./migrations.js";
export type { Migration, MigrationResult } from "./migrations.js";

export function ensureSchema(dbPath?: string) {
  const file = resolveDbPath(dbPath);
  const db = new DatabaseSync(file);
  try {
    const before = currentVersion(db);
    const result = runMigrations(db);
    /*
     * The sync triggers are the only schema here that something outside a
     * migration can plausibly remove — a `VACUUM INTO`, a restore from a
     * `.dump`, a table rebuilt by hand — and losing one is silent: writes stop
     * being recorded and every client polls forever without ever being told.
     * One `sqlite_master` count on boot is cheaper than that failure.
     */
    const triggersRepaired = ensureSyncTriggers(db);
    return {
      ...result,
      latest: LATEST_VERSION,
      wasCurrent: before === LATEST_VERSION,
      triggersRepaired,
    };
  } finally {
    db.close();
  }
}

/** Read a database's schema version without migrating it. */
export function readSchemaVersion(dbPath?: string): number {
  const db = new DatabaseSync(resolveDbPath(dbPath));
  try {
    return currentVersion(db);
  } finally {
    db.close();
  }
}
