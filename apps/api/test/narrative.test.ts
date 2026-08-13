import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * The agent-facing summaries.
 *
 * The thing worth testing here is not the prose — it is that the numbers in the
 * prose mean what they say. A summary that reports "23 of 23 scheduled things
 * done" when sixteen of those were unscheduled is worse than no summary: the
 * agent will repeat it to the user as fact.
 */

let dir: string;
let db: import("@life-os/db").LifeOsDb;
let narrative: typeof import("../src/services/narrative.js");
let analytics: typeof import("../src/services/analytics.js");
let tasks: typeof import("../src/services/tasks.js");

/** Today's local day key, matching what the service uses. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Local time today at HH:00, as an ISO instant. */
function todayAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-narrative-"));
  process.env.DATABASE_PATH = path.join(dir, "n.db");

  const dbmod = await import("@life-os/db");
  dbmod.bootstrapDatabase(process.env.DATABASE_PATH);
  db = dbmod.getDb();
  narrative = await import("../src/services/narrative.js");
  analytics = await import("../src/services/analytics.js");
  tasks = await import("../src/services/tasks.js");
});

after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows keeps the SQLite file open */
  }
});

function make(input: Parameters<typeof tasks.createTask>[1]) {
  const result = tasks.createTask(db, input);
  if ("error" in result) assert.fail(`createTask: ${result.error}`);
  return result.task;
}

describe("getDaySummary", () => {
  it("does not count unscheduled completions as scheduled ones", async () => {
    /*
     * The bug this pins down: "23 of 23 scheduled things done" on real data,
     * when only 7 of the 23 scheduled things were actually done and the rest of
     * the count was untimed work that happened to be ticked off the same day.
     */
    const timed = make({ title: "At 10", eventAt: todayAt(10), durationMinutes: 30 });
    make({ title: "Also at 11", eventAt: todayAt(11), durationMinutes: 30 });
    const untimed = make({ title: "Whenever" });

    await tasks.completeTask(db, timed.id);
    await tasks.completeTask(db, untimed.id);

    const day = narrative.getDaySummary(db, todayKey());
    assert.equal(day.tasks.scheduled, 2, "two things had a time on them");
    assert.equal(day.tasks.scheduledDone, 1, "one of those two is done");
    assert.equal(day.tasks.completed.length, 2, "two completions in total");
    assert.match(day.story, /1 of 2 scheduled things done/);
    assert.match(day.story, /1 more done that had no time on them/);
  });

  it("agrees with what /analytics reports for the same window", () => {
    /*
     * Two code paths answering the same question have to give the same number,
     * or the agent and the dashboard tell the user different things about the
     * same day.
     */
    const day = narrative.getDaySummary(db, todayKey());
    const stats = analytics.getAnalytics(db, "7d");
    assert.equal(day.tasks.scheduled, stats.adherence.scheduled);
    assert.equal(day.tasks.scheduledDone, stats.adherence.completed);
  });

  it("says so plainly when nothing happened", () => {
    const day = narrative.getDaySummary(db, "2020-01-01");
    assert.match(day.story, /Nothing recorded/);
    assert.equal(day.xp.earned, 0);
  });

  it("marks a completion after its window as late", async () => {
    const late = make({
      title: "Long overdue",
      eventAt: todayAt(1),
      durationMinutes: 15,
    });
    await tasks.completeTask(db, late.id);

    const day = narrative.getDaySummary(db, todayKey());
    const row = day.tasks.completed.find((c) => c.title === "Long overdue");
    assert.ok(row);
    assert.equal(row!.late, true);
  });
});

describe("getRangeSummary", () => {
  it("caps the window rather than walking a year day by day", () => {
    const out = narrative.getRangeSummary(db, todayKey(), 5000);
    assert.equal(out.days, 90);
    assert.equal(out.daily.length, 90);
  });

  it("always covers at least one day", () => {
    const out = narrative.getRangeSummary(db, todayKey(), 0);
    assert.equal(out.days, 1);
    assert.equal(out.to, todayKey());
    assert.equal(out.from, todayKey());
  });

  it("names which habits are holding and which are slipping", () => {
    const out = narrative.getRangeSummary(db, todayKey(), 7);
    assert.ok(out.story.length > 0);
    for (const h of out.habitRates) {
      assert.ok(h.ratePct >= 0 && h.ratePct <= 100);
      assert.equal(h.days, 7);
    }
  });
});

describe("searchHistory", () => {
  it("finds a task by its body, not just its title", () => {
    make({
      title: "Something opaque",
      body: "This one mentions photosynthesis in the body only.",
    });
    const hits = narrative.searchHistory(db, "photosynthesis");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.title, "Something opaque");
  });

  it("returns nothing for an empty query rather than everything", () => {
    assert.deepEqual(narrative.searchHistory(db, "   "), []);
  });

  it("is case-insensitive", () => {
    assert.equal(narrative.searchHistory(db, "PHOTOSYNTHESIS").length, 1);
  });
});
