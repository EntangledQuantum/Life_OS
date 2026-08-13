import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { runMigrations } from "../src/migrations.js";

/**
 * The v6 import: four tables of near-identical work become one.
 *
 * The thing that must not happen is losing something. A card the user has not
 * done, an agent event still waiting, a study block scheduled for tonight —
 * each has to come out the other side, once, with its meaning intact.
 */

let dir: string;
let file: string;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-tasks-"));
  file = path.join(dir, "import.db");

  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE dashboard_cards (
      id TEXT PRIMARY KEY, slot INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'task',
      title TEXT NOT NULL, subtitle TEXT, body TEXT, emoji TEXT, theme_color TEXT,
      image_url TEXT, image_data TEXT, svg TEXT, status TEXT NOT NULL DEFAULT 'active',
      progress INTEGER DEFAULT 0, cta_label TEXT, cta_link TEXT, meta_json TEXT,
      xp_on_complete INTEGER NOT NULL DEFAULT 0,
      webhook_on_complete INTEGER NOT NULL DEFAULT 1,
      completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_events (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'task', title TEXT NOT NULL,
      body TEXT, link TEXT, for_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 0, xp_on_complete INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE light_reviews (
      id TEXT PRIMARY KEY, prompt TEXT NOT NULL, for_date TEXT NOT NULL,
      completed_at TEXT, created_at TEXT NOT NULL, link TEXT
    );
    CREATE TABLE schedule_blocks (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, category TEXT NOT NULL, label TEXT NOT NULL,
      planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT,
      status TEXT NOT NULL DEFAULT 'planned', source TEXT NOT NULL DEFAULT 'agent',
      notes TEXT, completed_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE settings (id INTEGER PRIMARY KEY, updated_at TEXT NOT NULL);
    CREATE TABLE habits (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);

  db.prepare(
    `INSERT INTO dashboard_cards (id, slot, kind, title, status, xp_on_complete, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run("c1", -1, "event", "Read one chapter", "active", 25, "2026-08-01", "2026-08-01");
  db.prepare(
    `INSERT INTO dashboard_cards (id, slot, kind, title, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run("c2", 0, "task", "Pinned thing", "active", "2026-08-01", "2026-08-01");
  db.prepare(
    `INSERT INTO dashboard_cards (id, slot, kind, title, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run("c3", 2, "agent-setup", "Hermes connected", "active", "2026-08-01", "2026-08-01");

  db.prepare(
    `INSERT INTO agent_events (id, kind, title, body, link, for_date, status, xp_on_complete, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run("e1", "task", "Revise chapter 3", "spaced repetition", "https://x.test/ch3", "2026-08-13", "pending", 10, "2026-08-13");
  db.prepare(
    `INSERT INTO agent_events (id, kind, title, for_date, status, created_at) VALUES (?,?,?,?,?,?)`,
  ).run("e2", "task", "Already handled", "2026-08-12", "done", "2026-08-12");

  db.prepare(
    `INSERT INTO light_reviews (id, prompt, for_date, created_at) VALUES (?,?,?,?)`,
  ).run("r1", "How did the week go?", "2026-08-13", "2026-08-13");

  db.prepare(
    `INSERT INTO schedule_blocks (id, date, category, label, planned_start, planned_end, status, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run("b1", "2026-08-13", "Study", "Chapter 4", "09:00", "10:30", "planned", "2026-08-13");

  db.close();
});

after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the OS will get it */
  }
});

function open() {
  return new DatabaseSync(file);
}

describe("v6 task import", () => {
  it("runs", () => {
    const db = open();
    const result = runMigrations(db);
    assert.ok(result.applied.some((a) => a.version === 6));
    db.close();
  });

  it("brings every piece of work across", () => {
    const db = open();
    const rows = db
      .prepare("SELECT source_table, COUNT(*) c FROM tasks GROUP BY source_table")
      .all() as { source_table: string; c: number }[];
    const bySource = Object.fromEntries(rows.map((r) => [r.source_table, r.c]));

    // All three cards, including c3 — the agent-setup strip, which comes across
    // as a task like everything else but holds no slot.
    assert.equal(bySource.dashboard_cards, 3);
    assert.equal(bySource.agent_events, 2);
    assert.equal(bySource.light_reviews, 1);
    assert.equal(bySource.schedule_blocks, 1);
    db.close();
  });

  it("carries the agent status strip across without a slot", () => {
    /*
     * The strip is status, not work. It must survive the import — losing it
     * would make a connected instance look unconnected — but it must not eat
     * one of the two content slots, and `meta.connected` is what marks it.
     */
    const db = open();
    const strip = db
      .prepare("SELECT * FROM tasks WHERE source_id = 'c3'")
      .get() as Record<string, unknown>;
    assert.ok(strip, "the agent-setup card must come across");
    assert.equal(strip.slot, null);
    assert.ok(
      JSON.parse(String(strip.meta_json)).connected !== undefined,
      "meta.connected is how the UI recognises the strip",
    );
    db.close();
  });

  it("leaves the original tables alone", () => {
    /*
     * Nothing reads them any more, but dropping data on an upgrade is not a
     * thing this project does. If the import got something wrong, the original
     * row is still there to check it against.
     */
    const db = open();
    const count = (t: string) =>
      (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
    assert.equal(count("dashboard_cards"), 3);
    assert.equal(count("agent_events"), 2);
    assert.equal(count("light_reviews"), 1);
    assert.equal(count("schedule_blocks"), 1);
    db.close();
  });

  it("keeps XP, status and pinning", () => {
    const db = open();
    const card = db
      .prepare("SELECT * FROM tasks WHERE source_id = 'c1'")
      .get() as Record<string, unknown>;
    assert.equal(card.xp_on_complete, 25);
    assert.equal(card.status, "active");
    assert.equal(card.slot, null, "an unpinned card must not claim a slot");

    const pinned = db
      .prepare("SELECT slot FROM tasks WHERE source_id = 'c2'")
      .get() as { slot: number };
    assert.equal(pinned.slot, 0);
    db.close();
  });

  it("maps a done agent event to done, not active", () => {
    const db = open();
    const done = db
      .prepare("SELECT status FROM tasks WHERE source_id = 'e2'")
      .get() as { status: string };
    assert.equal(done.status, "done");
    db.close();
  });

  it("turns an event's link into a resource", () => {
    const db = open();
    const row = db
      .prepare("SELECT resources_json, cta_link FROM tasks WHERE source_id = 'e1'")
      .get() as { resources_json: string; cta_link: string };
    const resources = JSON.parse(row.resources_json);
    assert.equal(resources[0].url, "https://x.test/ch3");
    assert.equal(row.cta_link, "https://x.test/ch3");
    db.close();
  });

  it("gives a light review the review kind", () => {
    const db = open();
    const row = db
      .prepare("SELECT kind, title FROM tasks WHERE source_id = 'r1'")
      .get() as { kind: string; title: string };
    assert.equal(row.kind, "review");
    assert.equal(row.title, "How did the week go?");
    db.close();
  });

  it("turns a study block's HH:mm window into a real instant and a duration", () => {
    const db = open();
    const row = db
      .prepare("SELECT kind, event_at, duration_minutes FROM tasks WHERE source_id = 'b1'")
      .get() as { kind: string; event_at: string; duration_minutes: number };
    assert.equal(row.kind, "study");
    assert.equal(row.duration_minutes, 90, "09:00–10:30 is ninety minutes");
    assert.ok(row.event_at, "a block with a planned start must get an eventAt");
    assert.equal(new Date(row.event_at).getHours(), 9);
    db.close();
  });

  it("is idempotent — a second run imports nothing new", () => {
    const db = open();
    const before = (db.prepare("SELECT COUNT(*) c FROM tasks").get() as { c: number }).c;
    // Force the migration to run again against an already-imported database.
    db.exec("PRAGMA user_version = 5");
    runMigrations(db);
    const after = (db.prepare("SELECT COUNT(*) c FROM tasks").get() as { c: number }).c;
    assert.equal(after, before, "re-running the import must not duplicate work");
    db.close();
  });
});
