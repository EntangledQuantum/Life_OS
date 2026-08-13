/**
 * Versioned, forward-only schema migrations.
 *
 * The database carries its own version in SQLite's `user_version` header field —
 * a 32-bit integer that costs nothing to read, needs no table, and is written
 * atomically with the rest of the transaction. On boot we read it, run every
 * migration numbered above it in order, and stamp the new number. A database
 * that is already current does zero work.
 *
 * Two rules for anything added here:
 *
 * 1. **Never renumber or edit a shipped migration.** Someone's database has
 *    already run it and will never run it again. Fix a mistake with a new one.
 * 2. **Additive only.** No dropped tables, no dropped columns, no rewritten
 *    rows. This is someone's personal history and there is no undo.
 *
 * `schema_migrations` records what ran and when. It is for humans — the version
 * header is what the code actually branches on.
 */
import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  /** Strictly increasing. Never reused, never reordered. */
  version: number;
  name: string;
  up(db: DatabaseSync): void;
}

/* ------------------------------------------------------------- helpers */

function hasTable(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  if (!hasTable(db, table)) return false;
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

/** Add a column only if the table exists and the column does not. */
function addColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  if (!hasTable(db, table)) return;
  if (hasColumn(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/* ---------------------------------------------------------- migrations */

/**
 * v1 — the baseline.
 *
 * Everything the old `ensureSchema` used to do on every single boot. It is
 * written to be idempotent because it has to run against two very different
 * starting points: a brand-new database created from the Drizzle migrations,
 * and a database that has been in daily use since before versioning existed and
 * already has most of these columns.
 */
const baseline: Migration = {
  version: 1,
  name: "baseline: columns and tables added before versioning",
  up(db) {
    const columns: [string, string, string][] = [
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
      ["goals", "owner_kind", "TEXT NOT NULL DEFAULT 'agent'"],
      ["goals", "condition_json", "TEXT"],
      ["goals", "auto_check", "INTEGER NOT NULL DEFAULT 1"],
      ["goals", "condition_met_at", "TEXT"],
      ["goals", "celebration_seen_at", "TEXT"],
      ["goals", "condition_detail_json", "TEXT"],
      ["goals", "emoji", "TEXT NOT NULL DEFAULT '🎯'"],
      ["goals", "theme_color", "TEXT NOT NULL DEFAULT '#A78BFA'"],
      ["settings", "backups_enabled", "INTEGER NOT NULL DEFAULT 1"],
      ["settings", "backup_interval_hours", "INTEGER NOT NULL DEFAULT 6"],
      ["settings", "backup_keep", "INTEGER NOT NULL DEFAULT 24"],
      ["settings", "last_backup_at", "TEXT"],
      ["settings", "notification_sound", "TEXT NOT NULL DEFAULT 'chime'"],
      ["settings", "do_not_disturb", "INTEGER NOT NULL DEFAULT 0"],
      ["settings", "quiet_hours_silent", "INTEGER NOT NULL DEFAULT 1"],
    ];
    for (const [table, column, definition] of columns) {
      addColumn(db, table, column, definition);
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

    /*
     * The pre-rename gamification key: nurtureStyle (plant|water|both) became
     * growthStyle (sprout|orb).
     */
    if (hasTable(db, "gamification_config")) {
      const rows = db
        .prepare("SELECT id, config_json FROM gamification_config")
        .all() as { id: number; config_json: string }[];
      for (const row of rows) {
        try {
          const cfg = JSON.parse(row.config_json) as Record<string, unknown>;
          if (cfg.growthStyle !== undefined) continue;
          cfg.growthStyle = cfg.nurtureStyle === "water" ? "orb" : "sprout";
          delete cfg.nurtureStyle;
          db.prepare(
            "UPDATE gamification_config SET config_json = ? WHERE id = ?",
          ).run(JSON.stringify(cfg), row.id);
        } catch {
          /* a malformed config falls back at read time; do not fail the boot */
        }
      }
    }
  },
};

/**
 * v2 — drop the dead credentials table.
 *
 * `auth_sessions` backed a username/password login that has not existed since
 * auth became a single bearer token. This is the one exception to additive-only:
 * a table of stale credentials is worse kept than dropped.
 */
const dropAuthSessions: Migration = {
  version: 2,
  name: "drop the dead auth_sessions table",
  up(db) {
    if (hasTable(db, "auth_sessions")) db.exec("DROP TABLE auth_sessions");
  },
};

/**
 * v3 — the activity log.
 *
 * `active_sessions` holds one row that is replaced on every switch, so the
 * interval that just ended was simply discarded and the lived part of the day
 * could not be drawn at all.
 */
const activityLog: Migration = {
  version: 3,
  name: "record what actually happened",
  up(db) {
    if (hasTable(db, "activity_log")) return;
    db.exec(`
      CREATE TABLE activity_log (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        activity TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        block_id TEXT,
        source TEXT NOT NULL DEFAULT 'user'
      );
    `);
    db.exec("CREATE INDEX activity_log_date_idx ON activity_log (date)");
  },
};

/**
 * v4 — how far ahead the user is told about a scheduled thing.
 *
 * The same number decides what reaches the front page, because "you should know
 * about this now" and "this is on your plate now" are the same statement.
 */
const reminderLead: Migration = {
  version: 4,
  name: "reminder lead window",
  up(db) {
    addColumn(db, "settings", "reminder_lead_minutes", "INTEGER NOT NULL DEFAULT 15");
  },
};

/**
 * v5 — real webhook delivery.
 *
 * Replaces the single global URL in `settings` with named targets, and keeps a
 * row per delivery attempt so a webhook that has been failing for a week stops
 * looking identical to one that was never configured.
 */
const webhooks: Migration = {
  version: 5,
  name: "webhook targets, deliveries, and per-item opt-in",
  up(db) {
    if (!hasTable(db, "webhook_targets")) {
      db.exec(`
        CREATE TABLE webhook_targets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          preset TEXT NOT NULL DEFAULT 'generic',
          url TEXT NOT NULL,
          secret TEXT,
          events_json TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    }

    if (!hasTable(db, "webhook_deliveries")) {
      db.exec(`
        CREATE TABLE webhook_deliveries (
          id TEXT PRIMARY KEY,
          target_id TEXT NOT NULL,
          event TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          attempt INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'pending',
          response_status INTEGER,
          error TEXT,
          created_at TEXT NOT NULL,
          delivered_at TEXT
        );
      `);
      db.exec(
        "CREATE INDEX webhook_deliveries_created_idx ON webhook_deliveries (created_at)",
      );
    }

    addColumn(db, "habits", "webhook_on_complete", "INTEGER NOT NULL DEFAULT 0");
    addColumn(
      db,
      "schedule_blocks",
      "webhook_on_complete",
      "INTEGER NOT NULL DEFAULT 0",
    );
    addColumn(db, "dashboard_cards", "control_json", "TEXT");
    addColumn(
      db,
      "dashboard_cards",
      "webhook_on_interact",
      "INTEGER NOT NULL DEFAULT 0",
    );

    // Carry a previously configured global webhook across as a generic target,
    // so anyone who had one keeps working without touching settings again.
    const count = db.prepare("SELECT COUNT(*) c FROM webhook_targets").get() as {
      c: number;
    };
    if (count.c === 0 && hasColumn(db, "settings", "agent_webhook_url")) {
      const row = db
        .prepare(
          "SELECT agent_webhook_url u, agent_webhook_secret s FROM settings LIMIT 1",
        )
        .get() as { u?: string | null; s?: string | null } | undefined;
      if (row?.u) {
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO webhook_targets
             (id, name, preset, url, secret, events_json, active, created_at, updated_at)
           VALUES (?, ?, 'generic', ?, ?, NULL, 1, ?, ?)`,
        ).run(`migrated-${Date.now()}`, "Migrated webhook", row.u, row.s ?? null, now, now);
      }
    }
  },
};

/** Every migration, in order. Append only. */
export const MIGRATIONS: Migration[] = [
  baseline,
  dropAuthSessions,
  activityLog,
  reminderLead,
  webhooks,
];

/** The version a database is brought to by `runMigrations`. */
export const LATEST_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);

export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version?: number }
    | undefined;
  return row?.user_version ?? 0;
}

export interface MigrationResult {
  from: number;
  to: number;
  applied: { version: number; name: string }[];
}

/**
 * Bring an open database up to `LATEST_VERSION`.
 *
 * Each migration runs in its own transaction and stamps the version inside it,
 * so a failure part-way through leaves the database at the last version that
 * fully succeeded rather than in a half-migrated state nobody can reason about.
 */
export function runMigrations(db: DatabaseSync): MigrationResult {
  if (!hasTable(db, "schema_migrations")) {
    db.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  const from = currentVersion(db);
  const applied: { version: number; name: string }[] = [];

  for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (migration.version <= from) continue;

    db.exec("BEGIN");
    try {
      migration.up(db);
      db.prepare(
        "INSERT OR REPLACE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, new Date().toISOString());
      // PRAGMA does not accept a bound parameter, and the value is an integer
      // from our own table rather than anything user-supplied.
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
      applied.push({ version: migration.version, name: migration.name });
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { from, to: currentVersion(db), applied };
}
