import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * Analytics, and the history it reads.
 *
 * The interesting cases are the ones where a naive implementation lies: a habit
 * created three days ago scored against a thirty-day window, a counter that has
 * not moved drawn as an empty chart, and a goal re-checked on every request
 * writing a history row every request.
 */

let dir: string;
let db: import("@life-os/db").LifeOsDb;
let analytics: typeof import("../src/services/analytics.js");
let history: typeof import("../src/services/history.js");
let properties: typeof import("../src/services/properties.js");
let tasks: typeof import("../src/services/tasks.js");
let schema: typeof import("@life-os/db");

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-analytics-"));
  process.env.DATABASE_PATH = path.join(dir, "an.db");

  const dbmod = await import("@life-os/db");
  dbmod.bootstrapDatabase(process.env.DATABASE_PATH);
  db = dbmod.getDb();
  schema = dbmod;
  analytics = await import("../src/services/analytics.js");
  history = await import("../src/services/history.js");
  properties = await import("../src/services/properties.js");
  tasks = await import("../src/services/tasks.js");
});

after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows keeps the SQLite file open */
  }
});

describe("property history", () => {
  it("records a point on create and on every change", () => {
    const created = properties.createProperty(db, {
      key: "books_read",
      label: "Books read",
      kind: "counter",
      value: 3,
    });
    assert.ok(!("error" in created));
    const uid = created.property.uid;

    properties.incrementProperty(db, "books_read", 2);
    properties.incrementProperty(db, "books_read", 1);

    const series = history.propertySeries(db, uid, "1970-01-01T00:00:00.000Z");
    assert.deepEqual(
      series.map((p) => p.value),
      [3, 5, 6],
    );
  });

  it("does not record a point when nothing moved", () => {
    const created = properties.createProperty(db, {
      key: "stationary",
      label: "Stationary",
      kind: "counter",
      value: 7,
    });
    assert.ok(!("error" in created));
    const uid = created.property.uid;

    // Setting it to the value it already holds is not a change.
    properties.updateProperty(db, "stationary", { value: 7 });
    properties.updateProperty(db, "stationary", { value: 7 });

    const series = history.propertySeries(db, uid, "1970-01-01T00:00:00.000Z");
    assert.equal(series.length, 1, "one point, from creation");
  });

  it("carries the last value in from before the window", () => {
    /*
     * A counter untouched for three weeks should draw as a flat line at its
     * value, not as an empty chart — "no data in this window" and "no change in
     * this window" are different statements.
     */
    const created = properties.createProperty(db, {
      key: "old_counter",
      label: "Old counter",
      kind: "counter",
      value: 42,
    });
    assert.ok(!("error" in created));

    const future = new Date(Date.now() + 60_000).toISOString();
    const series = history.propertySeries(db, created.property.uid, future);
    assert.equal(series.length, 1);
    assert.equal(series[0]!.value, 42);
    assert.equal(series[0]!.at, future, "carried in at the window's edge");
  });
});

describe("getAnalytics", () => {
  it("puts the target on the same axis as the actual", () => {
    const out = analytics.getAnalytics(db, "30d");
    for (const day of out.daily) {
      assert.ok(day.xpTarget > 0, "every day carries its target");
      assert.equal(day.efficiencyTarget, 100);
    }
  });

  it("scores a habit only over the days it existed", () => {
    /*
     * A habit created yesterday must not be reported at 3% because it missed
     * the twenty-nine days before it was made. That number is not just unfair,
     * it is wrong — the habit was not missed, it did not exist.
     */
    const now = new Date().toISOString();
    db.insert(schema.habits)
      .values({
        id: "brand-new",
        name: "Brand new",
        emoji: "🌱",
        category: "Custom",
        frequencyRule: "daily",
        isTiny: true,
        baseXp: 10,
        extraXp: 0,
        xpWeight: 1,
        active: true,
        themeColor: "#34D399",
        themeGraphic: "leaf",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const out = analytics.getAnalytics(db, "90d");
    const fresh = out.habits.find((h) => h.id === "brand-new");
    assert.ok(fresh);
    assert.ok(
      fresh!.daysPossible <= 1,
      `a habit created today has at most one day to be judged on, got ${fresh!.daysPossible}`,
    );
  });

  it("counts a task finished after its window as completed late", async () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const created = tasks.createTask(db, {
      title: "Was due hours ago",
      eventAt: past,
      durationMinutes: 30,
    });
    assert.ok(!("error" in created));
    await tasks.completeTask(db, created.task.id);

    const out = analytics.getAnalytics(db, "7d");
    assert.ok(out.adherence.scheduled >= 1);
    assert.ok(
      out.adherence.completedLate >= 1,
      "finished three hours after a thirty-minute window is late",
    );
  });

  it("narrows the window when asked", () => {
    const week = analytics.getAnalytics(db, "7d");
    const quarter = analytics.getAnalytics(db, "90d");
    assert.ok(week.from >= quarter.from, "7d starts no earlier than 90d");
    assert.equal(week.range, "7d");
  });

  it("only reports counters that hold a number", () => {
    properties.createProperty(db, {
      key: "a_note",
      label: "A note",
      kind: "text",
      textValue: "not a number",
    });
    const out = analytics.getAnalytics(db, "all");
    assert.ok(
      !out.properties.some((p) => p.key === "a_note"),
      "a text property has no curve to draw",
    );
  });
});
