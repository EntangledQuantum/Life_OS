import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { runMigrations } from "../src/migrations.js";

/**
 * v7: history for agent properties and goal progress.
 *
 * The interesting part is the seed. A counter that has been running for months
 * would otherwise draw as a line starting the day this migration ran, and the
 * temptation is to invent a back-story for it. It gets exactly one honest
 * point: this was the value when history began.
 */

let dir: string;
let file: string;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-history-"));
  file = path.join(dir, "hist.db");

  const db = new DatabaseSync(file);
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
    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      progress_pct REAL NOT NULL DEFAULT 0,
      updated_at TEXT
    );
  `);
  db.prepare(
    "INSERT INTO agent_properties (id, key, label, kind, value, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  ).run("p1", "books_read", "Books read", "counter", 14, "2026-01-01", "2026-06-01");
  db.prepare(
    "INSERT INTO agent_properties (id, key, label, kind, text_value, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  ).run("p2", "current_book", "Current book", "text", "Dune", "2026-01-01", "2026-06-01");
  db.prepare(
    "INSERT INTO goals (id, title, progress_pct, updated_at) VALUES (?,?,?,?)",
  ).run("g1", "Read 20 books", 70, "2026-06-01");

  runMigrations(db);
  db.close();
});

after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* the OS will get it */
  }
});

describe("v7 history seed", () => {
  it("gives every numeric property one starting point", () => {
    const db = new DatabaseSync(file);
    const rows = db
      .prepare("SELECT uid, key, value, at FROM property_history")
      .all() as { uid: string; key: string; value: number; at: string }[];

    assert.equal(rows.length, 1, "only the counter — a text property has no curve");
    assert.equal(rows[0]!.uid, "p1", "keyed on the property's stable id");
    assert.equal(rows[0]!.key, "books_read");
    assert.equal(rows[0]!.value, 14);
    assert.equal(
      rows[0]!.at,
      "2026-06-01",
      "dated when the value was last touched, not when the migration ran",
    );
    db.close();
  });

  it("gives every goal one starting point", () => {
    const db = new DatabaseSync(file);
    const rows = db
      .prepare("SELECT goal_id, pct FROM goal_progress_history")
      .all() as { goal_id: string; pct: number }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.goal_id, "g1");
    assert.equal(rows[0]!.pct, 70);
    db.close();
  });

  it("is a no-op on a second run", () => {
    const db = new DatabaseSync(file);
    runMigrations(db);
    const count = (t: string) =>
      (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
    assert.equal(count("property_history"), 1);
    assert.equal(count("goal_progress_history"), 1);
    db.close();
  });
});
