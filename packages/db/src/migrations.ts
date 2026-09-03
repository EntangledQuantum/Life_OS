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

/**
 * v6 — one task system.
 *
 * Four tables were doing the same job with slightly different rules:
 * `dashboard_cards` (scheduled events and reminders), `agent_events` (queued
 * agent work), `light_reviews` (prompts) and `schedule_blocks` (study). An
 * agent had to guess which to use, and the wrong guess meant the thing could
 * not repeat, could not carry XP, or showed up somewhere nobody was looking.
 *
 * Everything becomes a `task`. The originals are **not dropped** — they are
 * still read by the compatibility layer that keeps an already-installed mobile
 * build working, and they are the fallback if anything about the import turns
 * out to be wrong. `source_table` + `source_id` make the import idempotent.
 */
const unifiedTasks: Migration = {
  version: 6,
  name: "one task system: cards, agent events, reviews and study become tasks",
  up(db) {
    if (!hasTable(db, "tasks")) {
      db.exec(`
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL DEFAULT 'task',
          title TEXT NOT NULL,
          subtitle TEXT,
          body TEXT,
          purpose TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          activity_tag TEXT,
          show_at TEXT,
          event_at TEXT,
          duration_minutes INTEGER,
          remind_at TEXT,
          notified_at TEXT,
          repeat_rule TEXT NOT NULL DEFAULT 'none',
          repeat_index INTEGER NOT NULL DEFAULT 0,
          repeat_offsets_json TEXT,
          xp_on_complete INTEGER NOT NULL DEFAULT 0,
          webhook_on_complete INTEGER NOT NULL DEFAULT 0,
          webhook_on_interact INTEGER NOT NULL DEFAULT 0,
          resources_json TEXT,
          slot INTEGER,
          emoji TEXT,
          theme_color TEXT,
          image_url TEXT,
          image_data TEXT,
          svg TEXT,
          cta_label TEXT,
          cta_link TEXT,
          control_json TEXT,
          progress INTEGER NOT NULL DEFAULT 0,
          sound INTEGER NOT NULL DEFAULT 1,
          flash INTEGER NOT NULL DEFAULT 1,
          source TEXT NOT NULL DEFAULT 'agent',
          meta_json TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          source_table TEXT,
          source_id TEXT
        );
      `);
      db.exec("CREATE INDEX tasks_status_idx ON tasks (status)");
      db.exec("CREATE INDEX tasks_event_idx ON tasks (event_at)");
      // Makes the import safe to re-run: a second attempt hits this and stops.
      db.exec(
        "CREATE UNIQUE INDEX tasks_origin_idx ON tasks (source_table, source_id) WHERE source_table IS NOT NULL",
      );
    }

    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO tasks (
        id, kind, title, subtitle, body, purpose, status, activity_tag,
        show_at, event_at, duration_minutes, remind_at, notified_at,
        repeat_rule, repeat_index, repeat_offsets_json,
        xp_on_complete, webhook_on_complete, webhook_on_interact,
        resources_json, slot, emoji, theme_color, image_url, image_data, svg,
        cta_label, cta_link, control_json, progress, sound, flash,
        source, meta_json, completed_at, created_at, updated_at,
        source_table, source_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    const id = (prefix: string, source: string) => `${prefix}_${source}`;

    /* ---- dashboard_cards ------------------------------------------- */
    if (hasTable(db, "dashboard_cards")) {
      const rows = db.prepare("SELECT * FROM dashboard_cards").all() as Record<
        string,
        unknown
      >[];
      for (const r of rows) {
        /*
         * The agent-setup card is a status strip, not work — it never had a
         * Complete button and never will. It comes across as a task like
         * everything else, but with no slot (it does not consume one of the two
         * content slots) and `meta.connected`, which is what the UI keys on.
         */
        const isStatusStrip = r.kind === "agent-setup";
        const slot = Number(r.slot);
        let meta = (r.meta_json as string) ?? null;
        if (isStatusStrip) {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = meta ? (JSON.parse(meta) as Record<string, unknown>) : {};
          } catch {
            parsed = {};
          }
          if (parsed.connected === undefined) parsed.connected = true;
          meta = JSON.stringify(parsed);
        }
        insert.run(
          id("t", String(r.id)),
          r.kind === "reminder" ? "reminder" : "task",
          String(r.title),
          (r.subtitle as string) ?? null,
          (r.body as string) ?? null,
          (r.purpose as string) ?? null,
          String(r.status ?? "active"),
          (r.activity_tag as string) ?? null,
          (r.show_at as string) ?? null,
          (r.event_at as string) ?? null,
          (r.duration_minutes as number) ?? null,
          (r.remind_at as string) ?? null,
          (r.notified_at as string) ?? null,
          String(r.repeat_rule ?? "none"),
          Number(r.repeat_index ?? 0),
          (r.repeat_offsets_json as string) ?? null,
          Number(r.xp_on_complete ?? 0),
          Number(r.webhook_on_complete ?? 0),
          Number(r.webhook_on_interact ?? 0),
          null,
          !isStatusStrip && (slot === 0 || slot === 1) ? slot : null,
          (r.emoji as string) ?? null,
          (r.theme_color as string) ?? null,
          (r.image_url as string) ?? null,
          (r.image_data as string) ?? null,
          (r.svg as string) ?? null,
          (r.cta_label as string) ?? null,
          (r.cta_link as string) ?? null,
          (r.control_json as string) ?? null,
          Number(r.progress ?? 0),
          Number(r.sound ?? 1),
          Number(r.flash ?? 1),
          "agent",
          meta,
          (r.completed_at as string) ?? null,
          String(r.created_at ?? now),
          String(r.updated_at ?? now),
          "dashboard_cards",
          String(r.id),
        );
      }
    }

    /* ---- agent_events ---------------------------------------------- */
    if (hasTable(db, "agent_events")) {
      const rows = db.prepare("SELECT * FROM agent_events").all() as Record<
        string,
        unknown
      >[];
      for (const r of rows) {
        const status =
          r.status === "done" ? "done" : r.status === "dismissed" ? "dismissed" : "active";
        insert.run(
          id("e", String(r.id)),
          r.kind === "review" ? "review" : r.kind === "study" ? "study" : "task",
          String(r.title),
          null,
          (r.body as string) ?? null,
          null,
          status,
          r.kind === "study" ? "Study" : null,
          null,
          null,
          null,
          null,
          null,
          "none",
          0,
          null,
          Number(r.xp_on_complete ?? 0),
          0,
          0,
          // An agent event's single link becomes the first resource.
          r.link ? JSON.stringify([{ label: "Open", url: String(r.link) }]) : null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          (r.link as string) ?? null,
          null,
          0,
          1,
          1,
          "agent",
          null,
          (r.completed_at as string) ?? null,
          String(r.created_at ?? now),
          String(r.created_at ?? now),
          "agent_events",
          String(r.id),
        );
      }
    }

    /* ---- light_reviews --------------------------------------------- */
    if (hasTable(db, "light_reviews")) {
      const rows = db.prepare("SELECT * FROM light_reviews").all() as Record<
        string,
        unknown
      >[];
      for (const r of rows) {
        insert.run(
          id("r", String(r.id)),
          "review",
          String(r.prompt),
          null,
          null,
          null,
          r.completed_at ? "done" : "active",
          null,
          null,
          null,
          null,
          null,
          null,
          "none",
          0,
          null,
          0,
          0,
          0,
          r.link ? JSON.stringify([{ label: "Open", url: String(r.link) }]) : null,
          null,
          "📝",
          null,
          null,
          null,
          null,
          null,
          (r.link as string) ?? null,
          null,
          0,
          1,
          1,
          "agent",
          null,
          (r.completed_at as string) ?? null,
          String(r.created_at ?? now),
          String(r.created_at ?? now),
          "light_reviews",
          String(r.id),
        );
      }
    }

    /* ---- schedule_blocks (study) ------------------------------------ */
    if (hasTable(db, "schedule_blocks")) {
      const rows = db.prepare("SELECT * FROM schedule_blocks").all() as Record<
        string,
        unknown
      >[];
      for (const r of rows) {
        // `HH:mm` on a date becomes a real instant, which is what a task needs.
        const at = (time: unknown): string | null => {
          if (!time || !r.date) return null;
          const parsed = new Date(`${String(r.date)}T${String(time)}:00`);
          return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
        };
        const start = at(r.planned_start);
        const end = at(r.planned_end);
        const minutes =
          start && end
            ? Math.max(
                1,
                Math.round((Date.parse(end) - Date.parse(start)) / 60_000),
              )
            : null;

        insert.run(
          id("b", String(r.id)),
          String(r.category ?? "").toLowerCase() === "study" ? "study" : "task",
          String(r.label),
          null,
          (r.notes as string) ?? null,
          null,
          r.status === "done" ? "done" : r.status === "skipped" ? "dismissed" : "active",
          (r.category as string) ?? null,
          null,
          start,
          minutes,
          null,
          null,
          "none",
          0,
          null,
          0,
          Number(r.webhook_on_complete ?? 0),
          0,
          null,
          null,
          "📚",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          0,
          1,
          1,
          String(r.source ?? "agent"),
          null,
          (r.completed_at as string) ?? null,
          String(r.created_at ?? now),
          String(r.created_at ?? now),
          "schedule_blocks",
          String(r.id),
        );
      }
    }
  },
};

/**
 * History for the two things that move but leave no trace.
 *
 * `daily_snapshots` already records XP, habits, study and consistency once a
 * day, so those have a past. Agent properties and goal progress do not: both
 * are a single current number, overwritten in place. "Books read: 14" is not an
 * answer to "am I reading more than I was in June" — and that question is the
 * entire point of the analytics page.
 *
 * Rows are only written when the value actually changes, so a counter nobody
 * touches costs nothing.
 */
const changeHistory: Migration = {
  version: 7,
  name: "property and goal-progress history",
  up(db) {
    if (!hasTable(db, "property_history")) {
      db.exec(`
        CREATE TABLE property_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uid TEXT NOT NULL,
          key TEXT NOT NULL,
          value REAL NOT NULL,
          at TEXT NOT NULL
        );
      `);
      db.exec("CREATE INDEX property_history_uid_idx ON property_history (uid, at)");

      /*
       * Seed one point per existing property, so a counter that has been
       * running for months does not draw as a line starting today. It is a
       * single honest point — "this was the value when history began" — not a
       * fabricated back-story.
       */
      if (hasTable(db, "agent_properties")) {
        const now = new Date().toISOString();
        // `agent_properties.id` *is* the stable uid — the service maps it to
        // `uid` on the way out, and there is no column by that name.
        db.exec(`
          INSERT INTO property_history (uid, key, value, at)
          SELECT id, key, COALESCE(value, 0), COALESCE(updated_at, '${now}')
          FROM agent_properties
          WHERE value IS NOT NULL
        `);
      }
    }

    if (!hasTable(db, "goal_progress_history")) {
      db.exec(`
        CREATE TABLE goal_progress_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          goal_id TEXT NOT NULL,
          pct REAL NOT NULL,
          at TEXT NOT NULL
        );
      `);
      db.exec(
        "CREATE INDEX goal_progress_history_goal_idx ON goal_progress_history (goal_id, at)",
      );

      if (hasTable(db, "goals")) {
        const now = new Date().toISOString();
        db.exec(`
          INSERT INTO goal_progress_history (goal_id, pct, at)
          SELECT id, COALESCE(progress_pct, 0), COALESCE(updated_at, '${now}')
          FROM goals
        `);
      }
    }
  },
};

/**
 * v8 — say which timezone the times are in.
 *
 * Every instant in this database is an ISO string, and every day boundary is
 * computed in the server's local zone. That is invisible and correct while the
 * only things reading it are the dashboard and the phone, which sit in the same
 * zone as the machine.
 *
 * It stops being invisible the moment an agent reads it from somewhere else. A
 * container runs in UTC; asked to schedule "tomorrow at 09:00" it produces an
 * instant five and a half hours off, and asked which life-day a completion
 * belongs to it gets a different answer than the app does. Nothing in the
 * payload said which zone to interpret anything in, so there was nothing to
 * disagree with — just two components quietly using different clocks.
 *
 * Empty means "this machine's zone", which is what every existing database
 * already means. Nothing is rewritten and no behaviour changes; the value
 * becomes explicit rather than assumed.
 */
const explicitTimezone: Migration = {
  version: 8,
  name: "explicit timezone on settings",
  up(db) {
    addColumn(db, "settings", "timezone", "TEXT");
  },
};


/**
 * v9 — a habit can have a time, and owns its own place on the timeline.
 *
 * A habit had no time on it, so an agent that wanted "meditate at 07:00" had to
 * create the habit *and* a separate task to carry the time. Two rows, two
 * places to tick, and the user could complete either one — awarding XP twice
 * for the same act, or leaving one surface saying done and the other saying
 * not. There was nothing linking them, so nothing could tell they were the same
 * thing.
 *
 * The habit is the single row now. Give it `scheduled_time` and it appears on
 * the timeline for that slot every day, automatically, with no task to keep in
 * sync — a derived view of one record rather than a copy of it. Leave the time
 * null and it behaves exactly as habits always have.
 *
 * Nothing is rewritten. Existing habits get a null time, which is the "no
 * particular time" they already meant. The duplicate tasks an agent created
 * before this stay where they are; `lifeos_bulk_dismiss_tasks` clears them when
 * the user wants them cleared, rather than this migration deciding on their
 * behalf which of two rows was the real one.
 */
const scheduledHabits: Migration = {
  version: 9,
  name: "habits carry their own time",
  up(db) {
    addColumn(db, "habits", "scheduled_time", "TEXT");
    addColumn(db, "habits", "duration_minutes", "INTEGER");
  },
};


/**
 * v10 — a task can name the habit it is about.
 *
 * Agent cards are the app's one piece of prose: "GoT p.550, next rung p.600".
 * They almost always concern a habit — the reading habit, the physics habit —
 * and nothing recorded which, so the card and the habit sat next to each other
 * on the same screen with no visible relationship. The user had to know.
 *
 * A nullable pointer, and nothing more: the card does not complete the habit
 * and the habit does not complete the card. They are different things about the
 * same subject, and the link exists so a client can say so.
 */
const taskHabitLink: Migration = {
  version: 10,
  name: "tasks can point at a habit",
  up(db) {
    addColumn(db, "tasks", "habit_id", "TEXT");
  },
};


/**
 * v11 — everyone lands on the new default graphic once.
 *
 * `sprout` and `orb` were briefly the only two styles, so every existing
 * instance has one of those names stored. When they came back as *choices*
 * alongside `bloom`, that stored name started resolving to the old drawing
 * again — so someone who had been looking at the new one for a week would open
 * the app and find it silently replaced, having chosen nothing.
 *
 * This rewrites the stored preference once, and only where it still holds a
 * name from before the new styles existed. It is a preference, not history:
 * the user can pick either of them straight back in Settings, and anyone who
 * does keeps their choice, because a value written after this point is never
 * touched again.
 */
const defaultToBloom: Migration = {
  version: 11,
  name: "existing instances default to the bloom graphic",
  up(db) {
    if (!hasTable(db, "gamification_config")) return;
    const rows = db
      .prepare("SELECT id, config_json FROM gamification_config")
      .all() as { id: number; config_json: string }[];

    for (const row of rows) {
      try {
        const cfg = JSON.parse(row.config_json) as Record<string, unknown>;
        const current = cfg.growthStyle ?? cfg.nurtureStyle;
        // Only pre-bloom names. Anything else is a deliberate choice.
        if (!["sprout", "orb", "plant", "water", "both"].includes(String(current))) {
          continue;
        }
        cfg.growthStyle = "bloom";
        delete cfg.nurtureStyle;
        db.prepare("UPDATE gamification_config SET config_json = ? WHERE id = ?").run(
          JSON.stringify(cfg),
          row.id,
        );
      } catch {
        /* unparseable config is not this migration's problem to fix */
      }
    }
  },
};


/**
 * v12 — a card can say how it should look, and what it is about.
 *
 * A pinned card already carried a title, body, emoji, colour, image, inline
 * SVG, progress, a call to action and one interactive control. What it could
 * not do was *arrange* any of that: an image was always a banner across the
 * top, whatever the picture was for, and the phone drew no image at all — so a
 * card could look considered on the desktop and plain on the device it is
 * mostly read on.
 *
 * `card_style_json` is that arrangement, and `linked_task_id` is the sibling of
 * `habit_id`: a card can now point at the scheduled block it explains, the same
 * way it can point at a habit. Both are pointers and neither completes the
 * other — a card describing tonight's study session is not that session, and
 * making it one would recreate the duplication the agenda model removed.
 */
const cardStyling: Migration = {
  version: 12,
  name: "cards carry their own layout and a link to what they are about",
  up(db) {
    addColumn(db, "tasks", "card_style_json", "TEXT");
    addColumn(db, "tasks", "linked_task_id", "TEXT");
  },
};

/**
 * A card gets a second picture, because it always needed two.
 *
 * There was one image slot — `image_url`, `image_data` and `svg` all competing
 * for it — and `cardStyle.layout` decided what that one picture was *for*:
 * `side` made it the icon, `background` made it the wash. So an agent could
 * have a photograph behind its text or a book cover beside the title, never
 * both, and no amount of styling could get around it because there was nothing
 * else to point at. The two are different jobs: one is what the card is about,
 * the other is what marks it in a list of cards.
 *
 * `icon_image_*` is the second slot. Set it and it becomes the tile; leave it
 * and everything renders exactly as before.
 */
const cardIconImage: Migration = {
  version: 13,
  name: "cards can carry an icon image as well as a picture",
  up(db) {
    addColumn(db, "tasks", "icon_image_url", "TEXT");
    addColumn(db, "tasks", "icon_image_data", "TEXT");
  },
};

/**
 * Habits and goals get pictures, and a goal gets rungs.
 *
 * Two things, and they are the same thing twice.
 *
 * Only cards could carry art, so a habit and a goal were an emoji in a tinted
 * square whatever they were about — the app could show you a photograph of the
 * book you are reading but not of the mountain you are training for. Habits,
 * goals and tiers now take the same two slots a card takes, with the same
 * meanings and the same dimensions, so one picture works in any of them.
 *
 * And a goal was one condition: met or not. That is a switch, not an
 * achievement. "Read 12 books" and "read 50 books" had to be two unrelated
 * goals, with nothing in the data saying the second was the harder version of
 * the first, and no way to make reaching it *feel* different. `goal_tiers` is
 * the ladder — each rung its own condition, words, art and celebration, ordered
 * from the bottom up.
 *
 * Every column is nullable and every goal starts with zero tiers, so nothing
 * that exists today changes shape or behaviour.
 */
const habitGoalArtAndTiers: Migration = {
  version: 14,
  name: "habits and goals carry art; goals carry a rarity ladder",
  up(db) {
    for (const table of ["habits", "goals"]) {
      addColumn(db, table, "icon_image_url", "TEXT");
      addColumn(db, table, "icon_image_data", "TEXT");
      addColumn(db, table, "background_image_url", "TEXT");
      addColumn(db, table, "background_image_data", "TEXT");
      addColumn(db, table, "art_overlay", "REAL");
    }

    if (!hasTable(db, "goal_tiers")) {
      db.exec(`
        CREATE TABLE goal_tiers (
          id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL,
          rank INTEGER NOT NULL,
          label TEXT NOT NULL,
          title TEXT,
          description TEXT,
          condition_json TEXT,
          theme TEXT NOT NULL DEFAULT 'spark',
          theme_color TEXT,
          emoji TEXT,
          icon_image_url TEXT,
          icon_image_data TEXT,
          background_image_url TEXT,
          background_image_data TEXT,
          art_overlay REAL,
          progress_pct REAL NOT NULL DEFAULT 0,
          met_at TEXT,
          celebration_seen_at TEXT,
          condition_detail_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      /*
       * One row per rung per goal. The unique index is what makes "replace the
       * ladder" safe to run twice and stops two rungs claiming rank 2.
       */
      db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS goal_tiers_goal_rank ON goal_tiers (goal_id, rank)",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS goal_tiers_goal ON goal_tiers (goal_id)",
      );
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
  unifiedTasks,
  changeHistory,
  explicitTimezone,
  scheduledHabits,
  taskHabitLink,
  defaultToBloom,
  cardStyling,
  cardIconImage,
  habitGoalArtAndTiers,
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
