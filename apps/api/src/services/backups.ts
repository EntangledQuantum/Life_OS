/**
 * Scheduled database snapshots.
 *
 * The interval is a setting, so an agent can dial it up before doing anything
 * destructive ("back up hourly while I restructure the habits") and back down
 * afterwards. Every run records `lastBackupAt`, which is also what makes the
 * catch-up on boot safe: a laptop that was asleep for two days takes one
 * snapshot on wake, not the dozen it "missed".
 */
import { eq } from "drizzle-orm";
import { backupDatabase, getDb, listBackups, type BackupFile } from "@life-os/db";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import { getSettingsRow, nowIso } from "./helpers.js";
import { getSettings } from "./settings.js";

export function listDatabaseBackups(): BackupFile[] {
  return listBackups();
}

export function runBackup(
  db: LifeOsDb,
  opts: { force?: boolean } = {},
): { ok: true; backup: BackupFile; pruned: string[] } | { ok: false; error: string } {
  const settings = getSettings(db);
  if (!settings.backupsEnabled && !opts.force) {
    return { ok: false, error: "Backups are disabled in settings" };
  }

  const result = backupDatabase({ keep: settings.backupKeep });
  if (!result.ok) return result;

  const row = getSettingsRow(db);
  db.update(schema.settings)
    .set({ lastBackupAt: nowIso(), updatedAt: nowIso() })
    .where(eq(schema.settings.id, row.id))
    .run();

  return result;
}

function hoursSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return Number.POSITIVE_INFINITY;
  return (Date.now() - ms) / 3_600_000;
}

/**
 * Check every 15 minutes whether a snapshot is due. Polling beats a long timer
 * because the interval setting can change under us, and because a machine that
 * sleeps through a `setInterval` never fires it at all.
 */
export function startBackupScheduler(): { stop: () => void } {
  const CHECK_MS = 15 * 60_000;

  const tick = () => {
    try {
      const db = getDb();
      const settings = getSettings(db);
      if (!settings.backupsEnabled) return;
      if (hoursSince(settings.lastBackupAt) < settings.backupIntervalHours) return;

      const result = runBackup(db);
      if (result.ok) {
        console.log(
          `[backup] ${result.backup.file} (${Math.round(result.backup.bytes / 1024)} KB)` +
            (result.pruned.length ? `, pruned ${result.pruned.length}` : ""),
        );
      } else {
        console.warn(`[backup] skipped: ${result.error}`);
      }
    } catch (error) {
      console.warn("[backup] failed:", error);
    }
  };

  tick();
  const timer = setInterval(tick, CHECK_MS);
  // Do not hold the process open just for backups.
  if (typeof timer.unref === "function") timer.unref();
  return { stop: () => clearInterval(timer) };
}
