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
    ["dashboard_cards", "kind", "TEXT NOT NULL DEFAULT 'task'"],
    ["dashboard_cards", "svg", "TEXT"],
    ["agent_events", "xp_on_complete", "INTEGER NOT NULL DEFAULT 0"],
    // Scheduling / reminders on cards
    ["dashboard_cards", "purpose", "TEXT"],
    ["dashboard_cards", "activity_tag", "TEXT"],
    ["dashboard_cards", "show_at", "TEXT"],
    ["dashboard_cards", "remind_at", "TEXT"],
    ["dashboard_cards", "event_at", "TEXT"],
    ["dashboard_cards", "duration_minutes", "INTEGER"],
    ["dashboard_cards", "repeat_rule", "TEXT NOT NULL DEFAULT 'none'"],
    ["dashboard_cards", "repeat_index", "INTEGER NOT NULL DEFAULT 0"],
    ["dashboard_cards", "repeat_offsets_json", "TEXT"],
    ["dashboard_cards", "sound", "INTEGER NOT NULL DEFAULT 1"],
    ["dashboard_cards", "flash", "INTEGER NOT NULL DEFAULT 1"],
    ["dashboard_cards", "notified_at", "TEXT"],
    ["dashboard_cards", "linked_block_id", "TEXT"],
    // Agent-authored goal conditions + the seen-it-or-it-didn't-happen fields
    ["goals", "owner_kind", "TEXT NOT NULL DEFAULT 'agent'"],
    ["goals", "condition_json", "TEXT"],
    ["goals", "auto_check", "INTEGER NOT NULL DEFAULT 1"],
    ["goals", "condition_met_at", "TEXT"],
    ["goals", "celebration_seen_at", "TEXT"],
    ["goals", "condition_detail_json", "TEXT"],
    ["goals", "emoji", "TEXT NOT NULL DEFAULT '🎯'"],
    ["goals", "theme_color", "TEXT NOT NULL DEFAULT '#A78BFA'"],
    // Periodic database snapshots
    ["settings", "backups_enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["settings", "backup_interval_hours", "INTEGER NOT NULL DEFAULT 6"],
    ["settings", "backup_keep", "INTEGER NOT NULL DEFAULT 24"],
    ["settings", "last_backup_at", "TEXT"],
    // Reminder sound + do-not-disturb
    ["settings", "notification_sound", "TEXT NOT NULL DEFAULT 'chime'"],
    ["settings", "do_not_disturb", "INTEGER NOT NULL DEFAULT 0"],
    ["settings", "quiet_hours_silent", "INTEGER NOT NULL DEFAULT 1"],
  ];

  /*
   * Tables that outlived their feature. `auth_sessions` backed the old
   * username/password login; auth has been a single bearer token since, and
   * nothing has read or written this table since then. Leaving a table of
   * credentials lying around is worse than dropping it.
   */
  for (const dead of ["auth_sessions"]) {
    if (hasTable(db, dead)) {
      try {
        db.exec(`DROP TABLE ${dead}`);
      } catch {
        /* a locked DB will get it on the next boot */
      }
    }
  }

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
        xp_on_complete INTEGER NOT NULL DEFAULT 0,
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
        kind TEXT NOT NULL DEFAULT 'task',
        title TEXT NOT NULL,
        subtitle TEXT,
        body TEXT,
        emoji TEXT DEFAULT '📌',
        theme_color TEXT DEFAULT '#5B8CFF',
        image_url TEXT,
        image_data TEXT,
        svg TEXT,
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

  if (!hasTable(db, "agent_properties")) {
    db.exec(`
      CREATE TABLE agent_properties (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'counter',
        value REAL,
        text_value TEXT,
        unit TEXT,
        description TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Fold the pre-rename gamification key (`nurtureStyle`: plant|water|both)
   * onto `growthStyle` (sprout|orb) so existing local DBs keep working.
   */
  if (hasTable(db, "gamification_config")) {
    const rows = db
      .prepare("SELECT id, config_json FROM gamification_config")
      .all() as { id: number; config_json: string }[];
    for (const row of rows) {
      try {
        const cfg = JSON.parse(row.config_json) as Record<string, unknown>;
        if (cfg.growthStyle !== undefined) continue;
        const legacy = cfg.nurtureStyle;
        cfg.growthStyle = legacy === "water" ? "orb" : "sprout";
        delete cfg.nurtureStyle;
        db.prepare("UPDATE gamification_config SET config_json = ? WHERE id = ?").run(
          JSON.stringify(cfg),
          row.id,
        );
      } catch {
        /* leave malformed config alone — loadGamificationConfig falls back */
      }
    }
  }

  db.close();
}
