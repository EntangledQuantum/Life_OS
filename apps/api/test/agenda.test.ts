import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

/**
 * One list for the day, and a day that actually ends.
 *
 * Two failures from real use are pinned down here.
 *
 * A habit had no time on it, so an agent asked for "meditate at 07:00" by
 * creating a habit *and* a task. The user then had two rows to tick for one
 * act: ticking both paid XP twice, ticking one left the other surface saying it
 * never happened, and nothing in the data said they were the same thing.
 *
 * And a scheduled task stayed `active` forever, so yesterday's leftovers sat on
 * today's list. Completing one paid *today's* XP for something that was meant
 * to happen yesterday — flattering today and erasing the miss.
 */

let dir: string;
let db: import("@life-os/db").LifeOsDb;
let habits: typeof import("../src/services/habits.js");
let tasks: typeof import("../src/services/tasks.js");
let agenda: typeof import("../src/services/agenda.js");
let schema: typeof import("@life-os/db");

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-agenda-"));
  process.env.DATABASE_PATH = path.join(dir, "agenda.db");

  const dbmod = await import("@life-os/db");
  dbmod.bootstrapDatabase(process.env.DATABASE_PATH);
  db = dbmod.getDb();
  schema = dbmod;
  habits = await import("../src/services/habits.js");
  tasks = await import("../src/services/tasks.js");
  agenda = await import("../src/services/agenda.js");
});

after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows keeps the SQLite file open; the OS will reap the temp dir */
  }
});

/** A clean slate, so one test's fixtures are not another's background noise. */
beforeEach(() => {
  db.delete(schema.habitLogs).run();
  db.delete(schema.habits).run();
  db.delete(schema.tasks).run();
});

function makeHabit(input: Parameters<typeof habits.createHabit>[1]) {
  return habits.createHabit(db, input);
}

function makeTask(input: Parameters<typeof tasks.createTask>[1]) {
  const result = tasks.createTask(db, input);
  if ("error" in result) assert.fail(`createTask: ${result.error}`);
  return result.task;
}

/** An instant this far through the elapsed part of today's life-day. */
function earlierToday(fraction: number): string {
  const day = agenda.agendaLifeDay(db);
  const start = Date.parse(day.lifeDayStart);
  return new Date(start + (Date.now() - start) * fraction).toISOString();
}

describe("a habit can carry its own time", () => {
  it("stores HH:mm and hands it back", () => {
    const habit = makeHabit({ name: "Meditate", scheduledTime: "07:00", durationMinutes: 20 });
    assert.equal(habit.scheduledTime, "07:00");
    assert.equal(habit.durationMinutes, 20);
  });

  it("normalises what agents actually send", () => {
    // "7:00" and "07:00:00" mean the same instant; storing them as typed would
    // make every reader guess.
    assert.equal(makeHabit({ name: "A", scheduledTime: "7:00" }).scheduledTime, "07:00");
    assert.equal(
      makeHabit({ name: "B", scheduledTime: "07:00:00" }).scheduledTime,
      "07:00",
    );
  });

  it("treats an unparseable time as no time rather than storing nonsense", () => {
    // Better an anytime habit than one that lands at an hour nobody chose.
    assert.equal(makeHabit({ name: "C", scheduledTime: "half seven" }).scheduledTime, null);
    assert.equal(makeHabit({ name: "D", scheduledTime: "25:00" }).scheduledTime, null);
  });

  it("has no time unless one is given", () => {
    assert.equal(makeHabit({ name: "Whenever" }).scheduledTime, null);
  });

  it("can have its time removed, which takes it off the timeline", () => {
    const habit = makeHabit({ name: "Read", scheduledTime: "21:00" });
    const updated = habits.updateHabit(db, habit.id, { scheduledTime: null });
    assert.equal(updated?.scheduledTime, null);
  });
});

describe("the agenda is one list", () => {
  it("puts a timed habit on it without any task existing", () => {
    /*
     * The whole point. This used to require a second row, and that second row
     * was the duplicate.
     */
    const habit = makeHabit({ name: "Meditate", scheduledTime: "07:00" });
    const view = agenda.getAgenda(db);

    const item = view.items.find((i) => i.refId === habit.id);
    assert.ok(item, "the habit is not on the agenda");
    assert.equal(item!.source, "habit");
    assert.ok(item!.at, "it has an instant for today");
    assert.equal(tasks.listTasks(db, {}).length, 0, "and no task was created");
  });

  it("keeps a completed morning in the morning", () => {
    /*
     * Done items used to sort to the bottom, which reads fine as a to-do list
     * and wrong as a schedule: 07:30 landed after 22:00 and the morning
     * vanished under the evening. Done is shown, not moved.
     */
    const early = makeHabit({ name: "Wake", scheduledTime: "07:30" });
    makeHabit({ name: "Wind down", scheduledTime: "22:00" });
    habits.completeHabit(db, early.id, { source: "user" });

    const timed = agenda.getAgenda(db).items.filter((i) => i.at);
    assert.equal(timed[0]!.title, "Wake", "the finished morning item moved");
    assert.equal(timed[0]!.done, true);
  });

  it("carries habits and tasks side by side, in time order", () => {
    makeHabit({ name: "Late habit", scheduledTime: "22:00" });
    makeHabit({ name: "Early habit", scheduledTime: "06:00" });
    makeTask({ title: "Midday task", eventAt: earlierToday(0.5) });

    const timed = agenda.getAgenda(db).items.filter((i) => i.at);
    const times = timed.map((i) => i.at!);
    assert.deepEqual([...times].sort(), times, "not in time order");
    assert.ok(timed.some((i) => i.source === "habit"));
    assert.ok(timed.some((i) => i.source === "task"));
  });

  it("says which record an item came from, so the client completes the right one", () => {
    const habit = makeHabit({ name: "Stretch", scheduledTime: "08:00" });
    const item = agenda.getAgenda(db).items.find((i) => i.refId === habit.id)!;
    // `refId` is the habit id — not a synthesised task id that resolves to nothing.
    assert.equal(item.id, `habit:${habit.id}`);
    assert.equal(item.refId, habit.id);
  });

  it("keeps an untimed habit off the day's shape but still on the list", () => {
    makeHabit({ name: "Whenever" });
    const view = agenda.getAgenda(db);
    assert.equal(view.anytime.length, 1);
    assert.equal(view.anytime[0]!.at, null);
    assert.equal(view.counts.timed, 0);
  });

  it("marks a habit done once, from whichever surface completed it", () => {
    /*
     * One completion, one log, one streak. Two rows meant two completions and
     * XP paid twice for the same act.
     */
    const habit = makeHabit({ name: "Water", scheduledTime: "09:00" });
    habits.completeHabit(db, habit.id, { source: "user" });

    const item = agenda.getAgenda(db).items.find((i) => i.refId === habit.id)!;
    assert.equal(item.done, true);
    assert.equal(item.state, "done");

    const second = habits.completeHabit(db, habit.id, { source: "user" });
    assert.ok("error" in second, "a second completion in one day must be refused");
  });

  it("places a habit before the reset time at the far end of the day", () => {
    /*
     * With a 04:00 reset, 01:00 is twenty-one hours into the life-day, not
     * three hours before it started. Getting this wrong puts a late-night habit
     * on yesterday's ribbon.
     */
    const habit = makeHabit({ name: "Wind down", scheduledTime: "01:00" });
    const item = agenda.getAgenda(db).items.find((i) => i.refId === habit.id)!;
    const day = agenda.agendaLifeDay(db);
    assert.ok(item.at! > day.lifeDayStart);
    assert.ok(item.at! < day.lifeDayEnd);
    assert.ok(item.startHour! > 12, `expected late in the day, got ${item.startHour}`);
  });

  it("leaves tomorrow's task out of today", () => {
    const tomorrow = new Date(Date.now() + 30 * 3600_000).toISOString();
    makeTask({ title: "Tomorrow", eventAt: tomorrow });
    assert.equal(
      agenda.getAgenda(db).items.some((i) => i.title === "Tomorrow"),
      false,
    );
  });

  /*
   * A pinned card is drawn as a card — picture, body, progress bar, Complete
   * button. It was also being emitted as a row here, so the same thing appeared
   * twice on one screen with two places to tick it. That is the duplication the
   * whole one-list model exists to prevent, arriving through the other door.
   */
  it("leaves a pinned card out of the list, because it is already a card", () => {
    const pinned = makeTask({
      title: "A Game of Thrones",
      slot: 0,
      body: "p.550 of ~800",
    });
    const loose = makeTask({ title: "Book a dentist" });

    const view = agenda.getAgenda(db);
    assert.equal(
      view.items.some((i) => i.refId === pinned.id),
      false,
      "the pinned card is also a row",
    );
    assert.ok(
      view.items.some((i) => i.refId === loose.id),
      "an unpinned task still belongs on the list",
    );
  });

  it("puts a card back on the list when it is unpinned", () => {
    // Pinning is a statement about where a thing is shown, and it is reversible.
    const card = makeTask({ title: "Physics focus", slot: 1 });
    assert.equal(
      agenda.getAgenda(db).items.some((i) => i.refId === card.id),
      false,
    );

    tasks.updateTask(db, card.id, { slot: null });
    assert.ok(
      agenda.getAgenda(db).items.some((i) => i.refId === card.id),
      "unpinned, it should be an ordinary row again",
    );
  });

  it("keeps the agent status strip off the list", () => {
    // It renders as one ambient line, has no completion, and is not work.
    makeTask({ title: "Hermes connected", meta: { connected: true } });
    assert.equal(
      agenda.getAgenda(db).items.some((i) => i.title === "Hermes connected"),
      false,
    );
  });
});

describe("a day that has ended stays ended", () => {
  it("marks yesterday's unfinished scheduled work as missed", () => {
    const yesterday = new Date(Date.now() - 30 * 3600_000).toISOString();
    const stale = makeTask({ title: "Yesterday's thing", eventAt: yesterday });

    const swept = agenda.rolloverPastDays(db);
    assert.equal(swept, 1);
    assert.equal(tasks.getTask(db, stale.id)!.status, "missed");
  });

  it("keeps it off today's list, so it is not mistaken for today's work", () => {
    makeTask({
      title: "Yesterday's thing",
      eventAt: new Date(Date.now() - 30 * 3600_000).toISOString(),
    });
    agenda.rolloverPastDays(db);
    assert.equal(
      agenda.getAgenda(db).items.some((i) => i.title === "Yesterday's thing"),
      false,
    );
  });

  it("refuses to complete it, so yesterday cannot pay out today's XP", async () => {
    const stale = makeTask({
      title: "Yesterday's thing",
      eventAt: new Date(Date.now() - 30 * 3600_000).toISOString(),
      xpOnComplete: 50,
    });
    agenda.rolloverPastDays(db);

    const result = await tasks.completeTask(db, stale.id, { source: "user" });
    assert.ok("error" in result, "a missed task must not still be completable");
  });

  it("leaves today's work alone", () => {
    const today = makeTask({ title: "Today", eventAt: earlierToday(0.2) });
    agenda.rolloverPastDays(db);
    assert.equal(tasks.getTask(db, today.id)!.status, "active");
  });

  it("leaves untimed work alone — it was never tied to a day", () => {
    const someday = makeTask({ title: "No time on it" });
    agenda.rolloverPastDays(db);
    assert.equal(tasks.getTask(db, someday.id)!.status, "active");
  });

  it("does not touch something already completed", () => {
    const done = makeTask({
      title: "Done yesterday",
      eventAt: new Date(Date.now() - 30 * 3600_000).toISOString(),
    });
    db.update(schema.tasks)
      .set({ status: "done", completedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, done.id))
      .run();
    agenda.rolloverPastDays(db);
    assert.equal(tasks.getTask(db, done.id)!.status, "done");
  });

  it("is idempotent — a second sweep changes nothing", () => {
    makeTask({
      title: "Yesterday's thing",
      eventAt: new Date(Date.now() - 30 * 3600_000).toISOString(),
    });
    assert.equal(agenda.rolloverPastDays(db), 1);
    assert.equal(agenda.rolloverPastDays(db), 0);
  });
});
