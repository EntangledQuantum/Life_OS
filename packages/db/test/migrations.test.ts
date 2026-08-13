import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import {
  LATEST_VERSION,
  MIGRATIONS,
  currentVersion,
  runMigrations,
} from "../src/migrations.js";

/**
 * The contract that matters: someone's four-month-old database has to survive
 * an upgrade with every row intact, and a database that is already current has
 * to do nothing at all.
 */

let dir: string;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-migrate-"));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function open(name: string): DatabaseSync {
  return new DatabaseSync(path.join(dir, name));
}

describe("the migration list itself", () => {
  it("has strictly increasing, unique versions", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    assert.deepEqual(
      versions,
      [...versions].sort((a, b) => a - b),
      "migrations must be declared in order",
    );
    assert.equal(new Set(versions).size, versions.length, "versions must be unique");
  });

  it("starts at 1, so an unversioned database (0) runs everything", () => {
    assert.equal(Math.min(...MIGRATIONS.map((m) => m.version)), 1);
  });

  it("LATEST_VERSION is the highest declared version", () => {
    assert.equal(LATEST_VERSION, Math.max(...MIGRATIONS.map((m) => m.version)));
  });
});

describe("a brand-new database", () => {
  it("migrates from 0 to the latest version", () => {
    const db = open("fresh.db");
    assert.equal(currentVersion(db), 0);

    const result = runMigrations(db);
    assert.equal(result.from, 0);
    assert.equal(result.to, LATEST_VERSION);
    assert.equal(result.applied.length, MIGRATIONS.length);
    assert.equal(currentVersion(db), LATEST_VERSION);
    db.close();
  });

  it("does nothing on the second run", () => {
    const db = open("fresh.db");
    const result = runMigrations(db);
    assert.equal(result.applied.length, 0, "a current database must be a no-op");
    assert.equal(result.from, LATEST_VERSION);
    db.close();
  });

  it("records what it ran, for a human reading the file later", () => {
    const db = open("fresh.db");
    const rows = db
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as { version: number; name: string }[];
    assert.equal(rows.length, MIGRATIONS.length);
    assert.equal(rows[0]!.version, 1);
    db.close();
  });
});

describe("an old database with real data", () => {
  /**
   * Stand up something shaped like a database from before versioning existed:
   * the tables are there, several later columns are not, and `user_version` has
   * never been set. This is the case that must not lose anything.
   */
  function makeLegacy(name: string): string {
    const file = path.join(dir, name);
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE habits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '✨',
        category TEXT NOT NULL DEFAULT 'Custom',
        frequency_rule TEXT NOT NULL DEFAULT 'daily',
        base_xp INTEGER NOT NULL DEFAULT 15,
        active INTEGER NOT NULL DEFAULT 1,
        theme_color TEXT NOT NULL DEFAULT '#5B8CFF',
        theme_graphic TEXT NOT NULL DEFAULT 'ring',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY,
        accent_theme TEXT NOT NULL DEFAULT 'nebula',
        agent_webhook_url TEXT,
        agent_webhook_secret TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE active_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activity TEXT NOT NULL,
        started_at TEXT NOT NULL
      );
      CREATE TABLE auth_sessions (id TEXT PRIMARY KEY, token TEXT NOT NULL);
    `);
    db.prepare(
      "INSERT INTO habits (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run("h1", "Wake window", "2026-01-01", "2026-01-01");
    db.prepare(
      "INSERT INTO habits (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run("h2", "Read", "2026-01-01", "2026-01-01");
    db.prepare(
      "INSERT INTO settings (id, agent_webhook_url, agent_webhook_secret, updated_at) VALUES (1, ?, ?, ?)",
    ).run("https://agent.example/hooks/lifeos", "old-secret", "2026-01-01");
    db.prepare("INSERT INTO auth_sessions (id, token) VALUES ('s1','dead')").run();
    db.close();
    return file;
  }

  it("upgrades to the latest version without losing a row", () => {
    const file = makeLegacy("legacy.db");
    const db = new DatabaseSync(file);

    const before = (db.prepare("SELECT COUNT(*) c FROM habits").get() as { c: number }).c;
    assert.equal(before, 2);
    assert.equal(currentVersion(db), 0);

    runMigrations(db);

    assert.equal(currentVersion(db), LATEST_VERSION);
    const after = (db.prepare("SELECT COUNT(*) c FROM habits").get() as { c: number }).c;
    assert.equal(after, before, "no habit may be lost in a migration");
    const names = db
      .prepare("SELECT name FROM habits ORDER BY id")
      .all()
      .map((r) => (r as { name: string }).name);
    assert.deepEqual(names, ["Wake window", "Read"]);
    db.close();
  });

  it("adds the columns the old file was missing", () => {
    const db = new DatabaseSync(path.join(dir, "legacy.db"));
    const cols = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (r) => r.name,
      );

    assert.ok(cols("settings").includes("reminder_lead_minutes"));
    assert.ok(cols("settings").includes("day_reset_time"));
    assert.ok(cols("habits").includes("xp_weight"));
    assert.ok(cols("habits").includes("webhook_on_complete"));
    assert.ok(cols("active_sessions").includes("block_id"));
    db.close();
  });

  it("creates the tables that did not exist yet", () => {
    const db = new DatabaseSync(path.join(dir, "legacy.db"));
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);

    assert.ok(tables.includes("activity_log"));
    assert.ok(tables.includes("webhook_targets"));
    assert.ok(tables.includes("webhook_deliveries"));
    assert.ok(tables.includes("agent_properties"));
    db.close();
  });

  it("carries a previously configured webhook across as a target", () => {
    // Silently dropping it would look like the webhook simply stopped working.
    const db = new DatabaseSync(path.join(dir, "legacy.db"));
    const rows = db.prepare("SELECT url, secret, preset FROM webhook_targets").all() as {
      url: string;
      secret: string;
      preset: string;
    }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.url, "https://agent.example/hooks/lifeos");
    assert.equal(rows[0]!.secret, "old-secret");
    assert.equal(rows[0]!.preset, "generic");
    db.close();
  });

  it("drops the dead credentials table", () => {
    const db = new DatabaseSync(path.join(dir, "legacy.db"));
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'")
      .get();
    assert.equal(row, undefined);
    db.close();
  });
});

describe("a partially-migrated database", () => {
  it("runs only the steps it is missing", () => {
    const file = path.join(dir, "partial.db");
    const db = new DatabaseSync(file);
    runMigrations(db);

    // Pretend this database only ever got as far as v3.
    db.exec("PRAGMA user_version = 3");
    const result = runMigrations(db);

    assert.equal(result.from, 3);
    assert.equal(result.to, LATEST_VERSION);
    assert.deepEqual(
      result.applied.map((a) => a.version),
      MIGRATIONS.filter((m) => m.version > 3).map((m) => m.version),
    );
    db.close();
  });
});

describe("failure handling", () => {
  it("leaves the version at the last step that fully succeeded", () => {
    const file = path.join(dir, "broken.db");
    const db = new DatabaseSync(file);
    runMigrations(db);
    const good = currentVersion(db);

    const exploding = {
      version: LATEST_VERSION + 1,
      name: "deliberately broken",
      up() {
        throw new Error("boom");
      },
    };
    MIGRATIONS.push(exploding);
    try {
      assert.throws(() => runMigrations(db), /deliberately broken/);
      assert.equal(
        currentVersion(db),
        good,
        "a failed migration must not advance the version",
      );
    } finally {
      MIGRATIONS.pop();
    }
    db.close();
  });
});
