import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * The task service, against a real database.
 *
 * These cover the parts where the four old tables disagreed and the collapse
 * had to pick an answer: when something counts as "current", when a
 * notification is due, what happens to a repeating task when you finish it, and
 * whether completing a study task still records the minutes.
 */

let dir: string;
let db: import("@life-os/db").LifeOsDb;
let tasks: typeof import("../src/services/tasks.js");
let schema: typeof import("@life-os/db");

const MINUTE = 60_000;
/** ISO instant `n` minutes from now — negative is in the past. */
const inMinutes = (n: number) => new Date(Date.now() + n * MINUTE).toISOString();

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-tasks-"));
  process.env.DATABASE_PATH = path.join(dir, "tasks.db");

  const dbmod = await import("@life-os/db");
  dbmod.bootstrapDatabase(process.env.DATABASE_PATH);
  db = dbmod.getDb();
  schema = dbmod;
  tasks = await import("../src/services/tasks.js");
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
  if ("error" in result) assert.fail(`createTask: ${result.error}`);
  return result.task;
}

describe("creating tasks", () => {
  it("keeps everything the four old tables could not hold at once", () => {
    const task = create({
      kind: "study",
      title: "Chapter 4",
      body: "Read it twice.",
      eventAt: inMinutes(120),
      durationMinutes: 90,
      activityTag: "Study",
      xpOnComplete: 25,
      resources: [{ label: "PDF", url: "https://example.com/ch4.pdf", kind: "paper" }],
      repeatRule: "daily",
    });

    // A schedule block had a time but no body; an agent event had a body but no
    // time; neither had resources. One row now carries all of it.
    assert.equal(task.kind, "study");
    assert.equal(task.durationMinutes, 90);
    assert.equal(task.body, "Read it twice.");
    assert.equal(task.resources.length, 1);
    assert.equal(task.resources[0]!.url, "https://example.com/ch4.pdf");
    assert.equal(task.repeatRule, "daily");
    assert.equal(task.status, "active");
  });

  it("rejects a slot outside the two content slots", () => {
    const result = tasks.createTask(db, {
      title: "Nope",
      slot: 7 as unknown as 0,
    });
    assert.ok("error" in result, "slot 7 does not exist");
  });
});

describe("what is current", () => {
  it("is inside the lead window and not past its own end", () => {
    const soon = create({ title: "Soon", eventAt: inMinutes(5) });
    const later = create({ title: "Later", eventAt: inMinutes(300) });
    /*
     * Started 90 minutes ago and meant to take 30. It is over — whether or not
     * anyone completed it. This is the rule that stops the front page silting
     * up with things whose moment has passed.
     */
    const expired = create({
      title: "Expired",
      eventAt: inMinutes(-90),
      durationMinutes: 30,
    });

    const current = tasks.listCurrentTasks(db).map((t) => t.id);
    assert.ok(current.includes(soon.id), "5 minutes out is current");
    assert.ok(!current.includes(later.id), "5 hours out is not");
    assert.ok(!current.includes(expired.id), "past its own end is not");
  });
});

describe("when a notification is due", () => {
  it("derives the instant from eventAt, not from remindAt alone", () => {
    /*
     * The bug this replaces: agents set `eventAt` and expect to be warned
     * beforehand, but nothing derived a notify time from it — so a task with
     * only an `eventAt` was never pre-scheduled on the phone and never entered
     * dueReminders. The only notification you ever got was the one fired at the
     * moment you happened to open the app.
     */
    const task = create({ title: "Derived", eventAt: inMinutes(5) });
    assert.equal(task.remindAt, null, "nothing was written to remindAt");

    const due = tasks.listDueTasks(db).map((t) => t.id);
    assert.ok(due.includes(task.id), "5 minutes out is inside the 15-minute lead");
  });

  it("honours an explicit remindAt as an override", () => {
    const task = create({
      title: "Explicit",
      eventAt: inMinutes(600),
      remindAt: inMinutes(-1),
    });
    const due = tasks.listDueTasks(db).map((t) => t.id);
    assert.ok(due.includes(task.id), "the override fires even though the event is far off");
  });

  it("stops offering a task once it has been notified", () => {
    const task = create({ title: "Once", eventAt: inMinutes(5) });
    tasks.markTaskNotified(db, task.id);
    const due = tasks.listDueTasks(db).map((t) => t.id);
    assert.ok(!due.includes(task.id));
  });
});

describe("completing", () => {
  it("awards XP and marks the task done", async () => {
    const task = create({ title: "Worth 20", xpOnComplete: 20 });
    const result = await tasks.completeTask(db, task.id, { source: "user" });
    assert.ok(!("error" in result));
    assert.equal(result.xpAwarded, 20);
    assert.equal(result.task.status, "done");
    assert.ok(result.task.completedAt);
  });

  it("spawns the next occurrence as a new row rather than rewinding this one", async () => {
    /*
     * Rewinding in place would make "how many times did I actually do this"
     * unanswerable — the row would only ever show the next date.
     */
    const task = create({
      title: "Daily thing",
      eventAt: inMinutes(60),
      repeatRule: "daily",
    });
    const result = await tasks.completeTask(db, task.id);
    assert.ok(!("error" in result));
    assert.ok(result.nextOccurrence, "a daily task schedules itself again");
    assert.notEqual(result.nextOccurrence!.id, task.id, "it is a new row");
    assert.equal(result.task.status, "done", "the finished one stays finished");

    const then = new Date(result.nextOccurrence!.eventAt!).getTime();
    const original = new Date(task.eventAt!).getTime();
    assert.equal(then - original, 24 * 60 * MINUTE, "one day later");
  });

  it("records a study session, so study minutes still count", async () => {
    const task = create({
      kind: "study",
      title: "Two hours of reading",
      durationMinutes: 120,
    });
    const before = db.select().from(schema.studySessions).all().length;
    const result = await tasks.completeTask(db, task.id);
    assert.ok(!("error" in result));
    const after = db.select().from(schema.studySessions).all().length;

    assert.equal(after, before + 1);
    assert.ok(result.study, "the completion returns the session it wrote");
    assert.equal(result.study!.session.durationMinutes, 120);
  });

  it("writes no study session for an ordinary task", async () => {
    const task = create({ title: "Not studying" });
    const before = db.select().from(schema.studySessions).all().length;
    await tasks.completeTask(db, task.id);
    assert.equal(db.select().from(schema.studySessions).all().length, before);
  });

  it("404s on a task that is not there", async () => {
    const result = await tasks.completeTask(db, "no-such-task");
    assert.ok("error" in result);
  });
});

describe("dismissing", () => {
  it("is distinct from done and keeps the row", () => {
    const task = create({ title: "Not today" });
    const result = tasks.dismissTask(db, task.id);
    assert.ok(!("error" in result));

    const after = tasks.getTask(db, task.id);
    assert.equal(after!.status, "dismissed");
    assert.equal(after!.completedAt, null, "dismissed is not completed");
  });
});

describe("interacting", () => {
  it("moves a slider without completing the task", async () => {
    const task = create({
      title: "How did that feel?",
      control: { kind: "slider", label: "Energy", min: 0, max: 10, value: 5 },
    });
    const result = await tasks.interactWithTask(db, task.id, { value: 8 });
    assert.ok(!("error" in result));

    const after = tasks.getTask(db, task.id)!;
    assert.equal(after.control!.kind, "slider");
    assert.equal((after.control as { value: number }).value, 8);
    assert.equal(after.status, "active", "answering a question is not finishing it");
  });

  it("clamps a value outside the agent's range instead of rejecting it", async () => {
    /*
     * Clamping, not an error — this is what `<input type=range>` does, and a
     * client that sends 99 into a 0–10 slider meant "the top". Refusing would
     * turn a rounding difference between two clients into a failed write.
     */
    const task = create({
      title: "Bounded",
      control: { kind: "slider", label: "Energy", min: 0, max: 10, value: 5 },
    });
    const result = await tasks.interactWithTask(db, task.id, { value: 99 });
    assert.ok(!("error" in result));
    assert.equal((result.control as { value: number }).value, 10);
  });

  it("refuses a slider interaction with no number in it", async () => {
    const task = create({
      title: "Needs a number",
      control: { kind: "slider", label: "Energy", min: 0, max: 10, value: 5 },
    });
    const result = await tasks.interactWithTask(db, task.id, {});
    assert.ok("error" in result);
  });
});
