import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * The two things agents got wrong about this data, and the reads that fix them.
 *
 * A task created with a future `showAt` was stored and then missing from every
 * list an agent could ask for, because the only list forced `visibleOnly`. The
 * write looked like it had failed, so agents wrote it again.
 *
 * And anything with no `eventAt` sat in the open list forever — right for a
 * screen, wrong as the answer to "what is on today". An imported review
 * backlog became seventeen things that looked due and were not.
 */

let dir: string;
let db: import("@life-os/db").LifeOsDb;
let tasks: typeof import("../src/services/tasks.js");
let view: typeof import("../src/services/agent-view.js");

const MINUTE = 60_000;
const inMinutes = (n: number) => new Date(Date.now() + n * MINUTE).toISOString();

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-agentview-"));
  process.env.DATABASE_PATH = path.join(dir, "view.db");

  const dbmod = await import("@life-os/db");
  dbmod.bootstrapDatabase(process.env.DATABASE_PATH);
  db = dbmod.getDb();
  tasks = await import("../src/services/tasks.js");
  view = await import("../src/services/agent-view.js");
});

after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows keeps the SQLite file open; the OS will reap the temp dir */
  }
});

function create(input: Parameters<typeof tasks.createTask>[1]) {
  const result = tasks.createTask(db, input);
  if ("error" in result) throw new Error(result.error);
  return result.task;
}

describe("visibility", () => {
  it("says a future task is hidden rather than leaving it unexplained", () => {
    const task = create({
      title: "Next week's review",
      showAt: inMinutes(60 * 24 * 3),
      eventAt: inMinutes(60 * 24 * 3 + 60),
    });
    const v = view.describeVisibility(task);
    assert.equal(v.state, "hidden_until_show_at");
    assert.equal(v.visibleFrom, task.showAt);
    assert.ok(v.visibleInMinutes! > 0);
    // The note is the part an agent reads when the row is not in its list.
    assert.match(v.note, /hidden until/i);
  });

  it("calls a task with no showAt visible", () => {
    const task = create({ title: "Now", eventAt: inMinutes(30) });
    assert.equal(view.describeVisibility(task).state, "visible");
  });

  it("calls a past showAt visible — it has already arrived", () => {
    const task = create({ title: "Arrived", showAt: inMinutes(-10) });
    assert.equal(view.describeVisibility(task).state, "visible");
  });

  it("distinguishes not-active from hidden", () => {
    /*
     * Both are absent from a default list, for completely different reasons.
     * Collapsing them would send an agent looking for a showAt that is not
     * there when the real answer is that someone dismissed it.
     */
    const task = create({ title: "Gone" });
    tasks.dismissTask(db, task.id);
    const after = tasks.getTask(db, task.id)!;
    assert.equal(view.describeVisibility(after).state, "not_active");
  });
});

describe("workload", () => {
  it("keeps untimed work out of what is due", () => {
    /*
     * The failure this exists for: a migrated spaced-repetition catalogue has
     * no times on it, and every one of those rows is genuinely open. Reading
     * them as today's plan is how the day grew to seventeen items.
     */
    for (let i = 0; i < 5; i++) {
      create({ title: `Imported review ${i}`, kind: "review" });
    }
    const w = view.getWorkload(db);
    assert.equal(w.counts.backlog >= 5, true, "the untimed ones are backlog");
    for (const t of w.due) {
      assert.ok(
        t.eventAt || t.remindAt,
        `${t.title} is due with nothing to be due at`,
      );
    }
  });

  it("puts something happening shortly in due, not upcoming", () => {
    create({ title: "Starting soon", eventAt: inMinutes(5), durationMinutes: 30 });
    const w = view.getWorkload(db);
    assert.ok(w.due.some((t) => t.title === "Starting soon"));
    assert.ok(!w.upcoming.some((t) => t.title === "Starting soon"));
  });

  it("puts tomorrow in upcoming", () => {
    create({ title: "Tomorrow", eventAt: inMinutes(60 * 26) });
    const w = view.getWorkload(db);
    assert.ok(w.upcoming.some((t) => t.title === "Tomorrow"));
    assert.ok(!w.due.some((t) => t.title === "Tomorrow"));
  });

  it("respects the horizon rather than returning the whole future", () => {
    create({ title: "Next month", eventAt: inMinutes(60 * 24 * 30) });
    const near = view.getWorkload(db, { horizonDays: 7 });
    assert.ok(!near.upcoming.some((t) => t.title === "Next month"));
    const far = view.getWorkload(db, { horizonDays: 60 });
    assert.ok(far.upcoming.some((t) => t.title === "Next month"));
  });

  it("separates something whose time went past", () => {
    create({
      title: "Went past",
      eventAt: inMinutes(-300),
      durationMinutes: 30,
    });
    const w = view.getWorkload(db);
    assert.ok(w.missed.some((t) => t.title === "Went past"));
  });

  it("counts hidden work instead of pretending it does not exist", () => {
    create({ title: "Hidden one", showAt: inMinutes(60 * 24 * 5) });
    const w = view.getWorkload(db);
    assert.ok(w.counts.hidden >= 1);
    assert.ok(w.hidden.some((t) => t.title === "Hidden one"));
    // And it is in exactly one bucket.
    assert.ok(!w.backlog.some((t) => t.title === "Hidden one"));
    assert.ok(!w.due.some((t) => t.title === "Hidden one"));
  });

  it("says which is which in one quotable line", () => {
    const w = view.getWorkload(db);
    assert.match(w.story, /due now/);
    assert.match(w.story, /inventory, not today's work/);
  });

  it("reports the life-day it answered for", () => {
    const w = view.getWorkload(db);
    assert.match(w.lifeDay.lifeDay, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(w.lifeDay.lifeDayStart < w.lifeDay.lifeDayEnd);
    assert.ok(w.lifeDay.timezone.length > 0);
  });
});

describe("cleanup selection", () => {
  it("never writes — it only says what it would touch", () => {
    const beforeRows = tasks.listTasks(db, { status: "active" }).length;
    view.selectForCleanup(db, { untimedOnly: true });
    assert.equal(tasks.listTasks(db, { status: "active" }).length, beforeRows);
  });

  it("finds the untimed leftovers a migration leaves behind", () => {
    const picked = view.selectForCleanup(db, { untimedOnly: true, kind: "review" });
    assert.ok(picked.length >= 5);
    for (const t of picked) assert.equal(t.eventAt, null);
  });

  it("filters by title, for a duplicate with a known name", () => {
    const picked = view.selectForCleanup(db, { titleContains: "imported review 1" });
    assert.equal(picked.length, 1);
  });

  it("filters by creation time, so an import can be undone by when it ran", () => {
    const future = new Date(Date.now() + 60 * MINUTE).toISOString();
    const all = view.selectForCleanup(db, { createdBefore: future });
    const none = view.selectForCleanup(db, {
      createdBefore: new Date(Date.now() - 60 * MINUTE).toISOString(),
    });
    assert.ok(all.length > 0);
    assert.equal(none.length, 0);
  });
});
