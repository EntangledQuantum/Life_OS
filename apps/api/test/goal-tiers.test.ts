import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

/**
 * A goal with rungs.
 *
 * A goal used to be one condition: met or not. That describes a switch, not an
 * achievement — "read 12 books" and "read 50 books" had to be two unrelated
 * goals, with nothing saying the second was the harder version of the first and
 * no way to make arriving there feel different.
 *
 * The rules these pin down are the ones that are not obvious from the shape of
 * the data, and each of them is a way the ladder could quietly lie: a higher
 * rung implying the lower ones, a rewrite not stealing what the user already
 * earned, one celebration per rung, and the goal itself only finishing at the
 * top.
 */

let dir: string;
let db: import("@life-os/db").LifeOsDb;
let goals: typeof import("../src/services/goals.js");
let properties: typeof import("../src/services/properties.js");
let schema: typeof import("@life-os/db");

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-tiers-"));
  process.env.DATABASE_PATH = path.join(dir, "tiers.db");

  const dbmod = await import("@life-os/db");
  dbmod.bootstrapDatabase(process.env.DATABASE_PATH);
  db = dbmod.getDb();
  schema = dbmod;
  goals = await import("../src/services/goals.js");
  properties = await import("../src/services/properties.js");
});

after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows keeps the SQLite file open; the OS will reap the temp dir */
  }
});

beforeEach(() => {
  db.delete(schema.goalTiers).run();
  db.delete(schema.goals).run();
  db.delete(schema.agentProperties).run();
});

/** A counter the ladder is written against, exactly as an agent would. */
function counter(key: string, value: number) {
  const existing = properties.listProperties(db).find((p) => p.key === key);
  if (existing) {
    properties.updateProperty(db, key, { value });
    return;
  }
  properties.createProperty(db, { key, label: key, kind: "counter", value });
}

function ladderGoal(counts: number[], labels?: string[]) {
  const result = goals.createGoal(db, {
    title: "Books",
    tiers: counts.map((n, i) => ({
      label: labels?.[i] ?? `Tier ${i + 1}`,
      condition: { type: "property", key: "books", op: ">=", value: n },
      theme: i === counts.length - 1 ? "void" : "spark",
    })),
  });
  if ("error" in result) assert.fail(result.error);
  return result.goal;
}

describe("defining a ladder", () => {
  it("numbers the rungs from the array order, bottom first", () => {
    counter("books", 0);
    const goal = ladderGoal([5, 10, 25], ["Bronze", "Silver", "Gold"]);
    assert.deepEqual(
      goal.tiers.map((t) => [t.rank, t.label]),
      [
        [1, "Bronze"],
        [2, "Silver"],
        [3, "Gold"],
      ],
    );
  });

  it("refuses a sixth rung", () => {
    counter("books", 0);
    const result = goals.createGoal(db, {
      title: "Too many",
      tiers: Array.from({ length: 6 }, (_, i) => ({ label: `T${i}` })),
    });
    assert.ok("error" in result, "six tiers should be refused");
    assert.match((result as { error: string }).error, /at most 5/);
  });

  it("refuses an unknown celebration theme instead of silently picking one", () => {
    /*
     * The opposite of the card style rule, on purpose. A bad gradient is
     * decoration and gets dropped; a tier is the definition of what counts as
     * having got there, so a typo comes back to the agent to fix.
     */
    const result = goals.createGoal(db, {
      title: "Bad theme",
      tiers: [{ label: "One", theme: "sparkle" }],
    });
    assert.ok("error" in result);
    assert.match((result as { error: string }).error, /unknown theme/i);
  });

  it("refuses a tier with a malformed condition, naming the tier", () => {
    const result = goals.createGoal(db, {
      title: "Bad condition",
      tiers: [
        { label: "Fine", condition: { type: "property", key: "books", op: ">=", value: 1 } },
        { label: "Broken", condition: { type: "property", op: "??" } as never },
      ],
    });
    assert.ok("error" in result);
    assert.match((result as { error: string }).error, /Broken/);
  });

  it("takes the ladder away when sent an empty array", () => {
    counter("books", 0);
    const goal = ladderGoal([5, 10]);
    const after = goals.updateGoal(db, goal.id, { tiers: [] });
    assert.ok(after && !("error" in after));
    assert.equal((after as { tiers: unknown[] }).tiers.length, 0);
  });
});

describe("climbing", () => {
  it("marks every rung below the one you reached", () => {
    /*
     * The load-bearing rule. The agent defines a ladder bottom to top, so
     * clearing rung 3 means 1 and 2 were passed on the way — "read 50 books"
     * cannot be true while "read 12 books" is false. Without this the goal sits
     * with its top lit and a gap underneath.
     */
    counter("books", 0);
    const goal = ladderGoal([5, 10, 25]);
    counter("books", 30);
    goals.evaluateGoals(db);

    const after = goals.getGoal(db, goal.id)!;
    assert.deepEqual(
      after.tiers.map((t) => Boolean(t.metAt)),
      [true, true, true],
    );
  });

  it("reads progress as a position on the ladder, not on one rung", () => {
    counter("books", 0);
    const goal = ladderGoal([10, 20, 30, 40]);
    counter("books", 25); // two rungs cleared, half way up the third
    goals.evaluateGoals(db);

    const after = goals.getGoal(db, goal.id)!;
    // 2 of 4 rungs, plus part of the third: comfortably past half, not at it.
    assert.ok(
      after.progressPct > 50 && after.progressPct < 75,
      `expected 50–75, got ${after.progressPct}`,
    );
  });

  it("says which rung you are on and which is next", () => {
    counter("books", 0);
    const goal = ladderGoal([5, 10, 25], ["Bronze", "Silver", "Gold"]);
    counter("books", 12);
    goals.evaluateGoals(db);

    const after = goals.getGoal(db, goal.id)!;
    assert.equal(after.currentTier?.label, "Silver");
    assert.equal(after.nextTier?.label, "Gold");
  });

  it("does not finish the goal until the top rung is reached", () => {
    counter("books", 0);
    const goal = ladderGoal([5, 100]);
    counter("books", 5);
    goals.evaluateGoals(db);

    const after = goals.getGoal(db, goal.id)!;
    assert.equal(after.conditionMetAt, null, "one rung is not the whole goal");
    assert.equal(after.status, "active");
  });
});

describe("celebrating", () => {
  it("owes one celebration per rung, lowest first", () => {
    counter("books", 0);
    const goal = ladderGoal([5, 10, 25], ["Bronze", "Silver", "Gold"]);
    counter("books", 30);
    goals.evaluateGoals(db);

    const pending = goals.pendingCelebrations(db);
    assert.equal(pending.length, 1, "the goal appears once, not three times");
    assert.equal(
      pending[0]!.pendingTier?.label,
      "Bronze",
      "a ladder is climbed in order, and so are its celebrations",
    );
  });

  it("advances one rung per claim, even when the client says nothing about tiers", () => {
    // An old build POSTs the goal id and nothing else. It must still walk.
    counter("books", 0);
    const goal = ladderGoal([5, 10], ["Bronze", "Silver"]);
    counter("books", 30);
    goals.evaluateGoals(db);

    const first = goals.markCelebrationSeen(db, goal.id);
    assert.ok(first && !("error" in first));
    assert.equal(
      (first as { goal: { pendingTier: { label: string } | null } }).goal.pendingTier?.label,
      "Silver",
      "claiming Bronze should leave Silver waiting",
    );
    assert.equal(
      (first as { goal: { status: string } }).goal.status,
      "active",
      "the goal is not finished on its first rung",
    );

    const second = goals.markCelebrationSeen(db, goal.id);
    assert.ok(second && !("error" in second));
    const done = (second as { goal: { status: string; pendingTier: unknown } }).goal;
    assert.equal(done.status, "achieved", "the top rung finishes the goal");
    assert.equal(done.pendingTier, null);
  });

  it("refuses to celebrate a rung that has not been reached", () => {
    counter("books", 0);
    const goal = ladderGoal([5, 500]);
    counter("books", 5);
    goals.evaluateGoals(db);

    const top = goals.getGoal(db, goal.id)!.tiers[1]!;
    const result = goals.markCelebrationSeen(db, goal.id, top.id);
    assert.ok(result && "error" in result);
  });
});

describe("rewriting a ladder", () => {
  it("keeps what the user already earned", () => {
    /*
     * An agent rewording a tier months later must not make the user earn it
     * again, and must not replay its celebration. Same rank, same label: the
     * dates are theirs.
     */
    counter("books", 0);
    const goal = ladderGoal([5, 10], ["Bronze", "Silver"]);
    counter("books", 6);
    goals.evaluateGoals(db);
    goals.markCelebrationSeen(db, goal.id); // watch Bronze

    const before = goals.getGoal(db, goal.id)!.tiers[0]!;
    assert.ok(before.metAt && before.celebrationSeenAt);

    goals.updateGoal(db, goal.id, {
      tiers: [
        {
          label: "Bronze",
          description: "reworded months later",
          condition: { type: "property", key: "books", op: ">=", value: 5 },
        },
        { label: "Silver", condition: { type: "property", key: "books", op: ">=", value: 10 } },
      ],
    });

    const after = goals.getGoal(db, goal.id)!.tiers[0]!;
    assert.equal(after.metAt, before.metAt, "the date it was earned changed");
    assert.equal(after.celebrationSeenAt, before.celebrationSeenAt);
    assert.equal(after.description, "reworded months later");
    assert.equal(after.celebrationPending, false, "it must not replay");
  });

  it("treats a renamed rung as a new one", () => {
    // A different word is a different rarity; it has not been earned yet.
    counter("books", 0);
    const goal = ladderGoal([5], ["Bronze"]);
    counter("books", 6);
    goals.evaluateGoals(db);

    goals.updateGoal(db, goal.id, {
      tiers: [
        { label: "Iron", condition: { type: "property", key: "books", op: ">=", value: 5 } },
      ],
    });
    const after = goals.getGoal(db, goal.id)!.tiers[0]!;
    assert.equal(after.label, "Iron");
    assert.equal(after.celebrationSeenAt, null);
  });
});

describe("a goal with no ladder", () => {
  it("behaves exactly as it always has", () => {
    counter("books", 0);
    const created = goals.createGoal(db, {
      title: "Plain",
      condition: { type: "property", key: "books", op: ">=", value: 3 },
    });
    assert.ok(!("error" in created));
    const goal = (created as { goal: { id: string } }).goal;

    counter("books", 3);
    goals.evaluateGoals(db);

    const met = goals.getGoal(db, goal.id)!;
    assert.equal(met.tiers.length, 0);
    assert.equal(met.pendingTier, null);
    assert.ok(met.conditionMetAt, "the single condition still fires");
    assert.equal(met.celebrationPending, true);

    const claimed = goals.markCelebrationSeen(db, goal.id);
    assert.ok(claimed && !("error" in claimed));
    assert.equal((claimed as { goal: { status: string } }).goal.status, "achieved");
  });
});
