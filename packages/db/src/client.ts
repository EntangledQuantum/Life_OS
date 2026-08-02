import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export function resolveDbPath(override?: string): string {
  const raw = override ?? process.env.DATABASE_PATH ?? "./data/lifeos.db";
  return path.isAbsolute(raw) ? raw : path.resolve(root, raw);
}

function normalizeArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (typeof a === "boolean") return a ? 1 : 0;
    if (a === undefined) return null;
    if (typeof a === "bigint") return Number(a);
    return a;
  });
}

/**
 * Wrap node:sqlite so it looks like better-sqlite3 for Drizzle.
 * Avoids native compilation (no VS build tools needed on Windows / Node 25).
 */
function openSqliteCompat(file: string) {
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
  } catch {
    /* ignore */
  }
  db.exec("PRAGMA foreign_keys = ON;");

  const originalPrepare = db.prepare.bind(db);
  (db as unknown as { prepare: (sql: string) => unknown }).prepare = (
    sql: string,
  ) => {
    const base = originalPrepare(sql) as {
      all: (...a: unknown[]) => Record<string, unknown>[];
      get: (...a: unknown[]) => Record<string, unknown> | undefined;
      run: (...a: unknown[]) => {
        changes: number;
        lastInsertRowid: number | bigint;
      };
      iterate: (...a: unknown[]) => IterableIterator<Record<string, unknown>>;
    };

    let isRaw = false;
    let isPluck = false;

    const toRawRow = (row: Record<string, unknown>) => Object.values(row);

    const stmt = {
      all(...args: unknown[]) {
        const rows = base.all(...normalizeArgs(args)) ?? [];
        if (isPluck) return rows.map((r) => Object.values(r)[0]);
        if (isRaw) return rows.map(toRawRow);
        return rows;
      },
      get(...args: unknown[]) {
        const row = base.get(...normalizeArgs(args));
        if (!row) return undefined;
        if (isPluck) return Object.values(row)[0];
        if (isRaw) return toRawRow(row);
        return row;
      },
      run(...args: unknown[]) {
        const result = base.run(...normalizeArgs(args));
        return {
          changes: result.changes,
          lastInsertRowid: Number(result.lastInsertRowid),
        };
      },
      iterate(...args: unknown[]) {
        return base.iterate(...normalizeArgs(args));
      },
      raw(toggle = true) {
        isRaw = toggle;
        return stmt;
      },
      pluck(toggle = true) {
        isPluck = toggle;
        return stmt;
      },
      expand() {
        return stmt;
      },
      bind(..._args: unknown[]) {
        return stmt;
      },
      columns() {
        return [];
      },
    };

    return stmt;
  };

  (db as unknown as { pragma: (s: string) => void }).pragma = (s: string) => {
    try {
      db.exec(`PRAGMA ${s}`);
    } catch {
      /* ignore */
    }
  };

  return db;
}

export function createDb(dbPath?: string) {
  const file = resolveDbPath(dbPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = openSqliteCompat(file);
  return drizzle(sqlite as never, { schema });
}

export type LifeOsDb = BetterSQLite3Database<typeof schema>;

let singleton: LifeOsDb | null = null;

export function getDb(): LifeOsDb {
  if (!singleton) singleton = createDb();
  return singleton;
}

export function setDb(db: LifeOsDb) {
  singleton = db;
}
