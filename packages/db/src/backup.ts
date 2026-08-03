/**
 * Periodic snapshots of the SQLite file.
 *
 * Uses `VACUUM INTO`, which writes a consistent, already-compacted copy while
 * the database stays open — unlike copying the file, which can catch a
 * half-written WAL. Snapshots land in `data/backups/` next to the live DB and
 * are pruned oldest-first so the folder cannot grow without bound.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveDbPath } from "./client.js";

export interface BackupFile {
  file: string;
  path: string;
  bytes: number;
  createdAt: string;
}

export function backupsDir(dbPath?: string): string {
  return path.join(path.dirname(resolveDbPath(dbPath)), "backups");
}

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/** Newest first. */
export function listBackups(dbPath?: string): BackupFile[] {
  const dir = backupsDir(dbPath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return {
        file: f,
        path: full,
        bytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Delete the oldest snapshots until only `keep` remain. */
export function pruneBackups(keep: number, dbPath?: string): string[] {
  const removed: string[] = [];
  for (const backup of listBackups(dbPath).slice(Math.max(1, keep))) {
    try {
      fs.unlinkSync(backup.path);
      removed.push(backup.file);
    } catch {
      /* a locked or already-removed file is not worth failing the backup over */
    }
  }
  return removed;
}

export function backupDatabase(
  opts: { keep?: number; dbPath?: string } = {},
): { ok: true; backup: BackupFile; pruned: string[] } | { ok: false; error: string } {
  const source = resolveDbPath(opts.dbPath);
  if (!fs.existsSync(source)) {
    return { ok: false, error: `No database at ${source}` };
  }

  const dir = backupsDir(opts.dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `lifeos-${stamp()}.db`);

  const db = new DatabaseSync(source);
  try {
    // SQLite string literal: forward slashes work on every platform, and a
    // single quote in the path would otherwise break out of the literal.
    const escaped = target.replace(/\\/g, "/").replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    db.close();
  }

  const stat = fs.statSync(target);
  return {
    ok: true,
    backup: {
      file: path.basename(target),
      path: target,
      bytes: stat.size,
      createdAt: stat.mtime.toISOString(),
    },
    pruned: pruneBackups(opts.keep ?? 24, opts.dbPath),
  };
}
