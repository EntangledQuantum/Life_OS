/**
 * Lightweight additive migrations for existing local DBs (no full re-migrate).
 */
import type { DatabaseSync } from "node:sqlite";
import { resolveDbPath } from "./client.js";
import { DatabaseSync as SQLite } from "node:sqlite";

function hasColumn(db: DatabaseSync, table: string, column: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return rows.some((r) => r.name === column);
}

function hasTable(db: DatabaseSync, table: string) {
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    )
    .get(table) as { name?: string } | undefined;
  return Boolean(row?.name);
}

export function ensureSchema(dbPath?: string) {
  const file = resolveDbPath(dbPath);
  const db = new SQLite(file);

  const alters: [string, string, string][] = [
    ["settings", "day_reset_time", "TEXT NOT NULL DEFAULT '04:00'"],
    ["settings", "agent_webhook_url", "TEXT"],
    ["settings", "agent_webhook_secret", "TEXT"],
    ["habits", "extra_xp", "INTEGER NOT NULL DEFAULT 0"],
    ["habits", "xp_weight", "INTEGER NOT NULL DEFAULT 1"],
    ["schedule_blocks", "status", "TEXT NOT NULL DEFAULT 'planned'"],
    ["schedule_blocks", "source", "TEXT NOT NULL DEFAULT 'agent'"],
    ["schedule_blocks", "notes", "TEXT"],
    ["schedule_blocks", "completed_at", "TEXT"],
    ["light_reviews", "link", "TEXT"],
    ["active_sessions", "block_id", "TEXT"],
  ];

  for (const [table, col, def] of alters) {
    if (!hasTable(db, table)) continue;
    if (!hasColumn(db, table, col)) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      } catch {
        /* ignore */
      }
    }
  }

  if (!hasTable(db, "agent_events")) {
    db.exec(`
      CREATE TABLE agent_events (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'task',
        title TEXT NOT NULL,
        body TEXT,
        link TEXT,
        for_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  if (!hasTable(db, "dashboard_cards")) {
    db.exec(`
      CREATE TABLE dashboard_cards (
        id TEXT PRIMARY KEY,
        slot INTEGER NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT,
        body TEXT,
        emoji TEXT DEFAULT '📌',
        theme_color TEXT DEFAULT '#5B8CFF',
        image_url TEXT,
        image_data TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        progress INTEGER DEFAULT 0,
        cta_label TEXT,
        cta_link TEXT,
        meta_json TEXT,
        xp_on_complete INTEGER NOT NULL DEFAULT 0,
        webhook_on_complete INTEGER NOT NULL DEFAULT 1,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  db.close();
}
