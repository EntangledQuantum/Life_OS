import { strict as assert } from "node:assert";
import { after, before, beforeEach, describe, it } from "node:test";
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from "@life-os/shared";
import type { SyncEnvelope } from "@life-os/shared";

/**
 * The client half of protocol 4.
 *
 * These are written against the handful of things that are wrong in a way
 * nothing reports. A cursor stored but not sent, a tombstone applied as an
 * upsert, a `304` treated as an empty delta, a mutation counter that does not
 * survive a reload: every one of them leaves an app that looks like it is
 * working. The expensive ones are the two that corrupt rather than break —
 * a tombstone that does not delete leaves a habit the user retired on screen
 * for ever, and a reset that does not clear merges two databases into one.
 *
 * The pure half (`sync-state.ts`) is tested directly. The engine is tested
 * through a stubbed `fetch`, because what it must get right is the shape of the
 * request it sends and what it does with the reply — neither of which is
 * visible from the state alone.
 */

/* --------------------------------------------------------------- scaffold */

/** Node has no `localStorage`; the engine persists its cursor into one. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>([["lifeos_token", "lifeos_test_token"]]);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let seen: Seen[] = [];
/** What the next fetch answers with. Pushed per test. */
let replies: { status: number; body?: unknown; etag?: string }[] = [];
let realFetch: typeof globalThis.fetch;
let storage: Map<string, string>;

before(() => {
  storage = installStorage();
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    seen.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    const reply = replies.shift() ?? { status: 200, body: {} };
    if (reply.status === 304) {
      return new Response(null, { status: 304 });
    }
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: {
        "Content-Type": "application/json",
        ...(reply.etag ? { ETag: reply.etag } : {}),
      },
    });
  }) as unknown as typeof globalThis.fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  seen = [];
  replies = [];
});

const LIFE_DAY = {
  lifeDay: "2026-10-30",
  lifeDayStart: "2026-10-29T22:30:00.000Z",
  lifeDayEnd: "2026-10-30T22:30:00.000Z",
  dayResetTime: "04:00",
  timezone: "Asia/Kolkata",
};

/** An envelope with only the fields a test cares about spelled out. */
function envelope(over: Partial<SyncEnvelope> = {}): SyncEnvelope {
  return {
    protocol: 4,
    cursor: "epoch1.1",
    reset: false,
    lifeDay: LIFE_DAY,
    serverTime: new Date().toISOString(),
    changed: {},
    deleted: {},
    docs: {},
    upToDate: true,
    ...over,
  } as SyncEnvelope;
}

function task(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    kind: "task",
    title: "Read a chapter",
    status: "active",
    eventAt: null,
    remindAt: null,
    showAt: null,
    notifiedAt: null,
    durationMinutes: 30,
    xpOnComplete: 10,
    resources: [],
    repeatRule: "none",
    createdAt: "2026-10-30T06:00:00.000Z",
    updatedAt: "2026-10-30T06:00:00.000Z",
    currentFrom: null,
    currentUntil: null,
    dueFrom: null,
    dueUntil: null,
    ...over,
  } as never;
}

/* ------------------------------------------------------- applying a delta */

describe("applying a delta", () => {
  it("keys entities by id on a cold sync, and keeps the cursor", async () => {
    const { applyEnvelope, emptyState } = await import("../src/lib/sync-state.js");

    const state = applyEnvelope(
      emptyState(),
      envelope({
        reset: true,
        cursor: "epoch1.41",
        changed: {
          habits: [{ id: "h1", name: "Walk" } as never],
          tasks: [task({ id: "t1" }), task({ id: "t2" })],
        },
        upToDate: false,
      }),
    );

    assert.equal(state.cursor, "epoch1.41");
    assert.equal(state.loaded, true);
    assert.deepEqual(Object.keys(state.tasks).sort(), ["t1", "t2"]);
    assert.equal(state.habits.h1?.name, "Walk");
  });

  it("patches the rows a delta names and leaves the rest alone", async () => {
    const { applyEnvelope, emptyState } = await import("../src/lib/sync-state.js");

    const cold = applyEnvelope(
      emptyState(),
      envelope({
        reset: true,
        changed: { tasks: [task({ id: "t1" }), task({ id: "t2" })] },
      }),
    );
    const next = applyEnvelope(
      cold,
      envelope({
        cursor: "epoch1.2",
        changed: { tasks: [task({ id: "t1", title: "Changed" })] },
      }),
    );

    /*
     * The point of rows rather than a blob: t2 was not in the delta and is
     * still there, unchanged. The old payload replaced everything on every
     * poll, which is why it had to contain everything.
     */
    assert.equal(next.tasks.t1?.title, "Changed");
    assert.equal(next.tasks.t2?.title, "Read a chapter");
    assert.equal(next.cursor, "epoch1.2");
  });

  it("removes a row named in `deleted`, and does not resurrect it", async () => {
    const { applyEnvelope, emptyState } = await import("../src/lib/sync-state.js");

    const cold = applyEnvelope(
      emptyState(),
      envelope({
        reset: true,
        changed: {
          habits: [{ id: "h1", name: "Walk" } as never, { id: "h2", name: "Read" } as never],
        },
      }),
    );
    const next = applyEnvelope(
      cold,
      envelope({ cursor: "epoch1.3", deleted: { habits: ["h1"] } }),
    );

    assert.equal(next.habits.h1, undefined);
    assert.equal(next.habits.h2?.name, "Read");
    // A tombstone for something we never had is not an error.
    const again = applyEnvelope(
      next,
      envelope({ cursor: "epoch1.4", deleted: { habits: ["h1", "nope"] } }),
    );
    assert.equal(again.habits.h1, undefined);
  });

  it("throws local state away when the server says `reset`", async () => {
    const { applyEnvelope, emptyState } = await import("../src/lib/sync-state.js");

    const held = applyEnvelope(
      emptyState(),
      envelope({
        reset: true,
        changed: { tasks: [task({ id: "stale" })] },
        docs: { settings: { accentTheme: "nebula" } as never },
      }),
    );
    const reset = applyEnvelope(
      held,
      envelope({
        reset: true,
        cursor: "epoch2.1",
        changed: { tasks: [task({ id: "fresh" })] },
      }),
    );

    /*
     * A restored backup or a different instance on the same address. Keeping
     * the old rows would show a day that no longer exists, and the documents
     * are the half that is easiest to forget — they are replaced, not merged,
     * so one left behind here would persist for ever.
     */
    assert.equal(reset.tasks.stale, undefined);
    assert.ok(reset.tasks.fresh);
    assert.equal(reset.docs.settings, undefined);
    assert.equal(reset.cursor, "epoch2.1");
  });

  it("keeps a document that is absent and replaces one that is present", async () => {
    const { applyEnvelope, emptyState } = await import("../src/lib/sync-state.js");

    const first = applyEnvelope(
      emptyState(),
      envelope({
        reset: true,
        docs: {
          progress: { totalXp: 10, dailyXp: 5 } as never,
          settings: { accentTheme: "nebula" } as never,
        },
      }),
    );
    const second = applyEnvelope(
      first,
      envelope({
        cursor: "epoch1.9",
        docs: { progress: { totalXp: 99, dailyXp: 7 } as never },
      }),
    );

    assert.equal(second.docs.progress?.totalXp, 99);
    // Absent means unchanged, so the settings we were sent once are still here.
    assert.equal((second.docs.settings as { accentTheme: string }).accentTheme, "nebula");
  });

  it("treats a present-but-null activeSession as a real value", async () => {
    const { applyEnvelope, emptyState } = await import("../src/lib/sync-state.js");

    const running = applyEnvelope(
      emptyState(),
      envelope({
        reset: true,
        docs: { activeSession: { activity: "Deep Work", startedAt: "x" } as never },
      }),
    );
    const cleared = applyEnvelope(
      running,
      envelope({ cursor: "epoch1.5", docs: { activeSession: null } }),
    );

    /*
     * `null` here means the session was cleared, and absent means it did not
     * change. A truthiness check instead of a key check makes clearing a
     * session impossible, and it would look exactly like the server failing to
     * send the update.
     */
    assert.equal(cleared.docs.activeSession, null);
    assert.ok("activeSession" in cleared.docs);
  });
});

/* ----------------------------------------------- what the client computes */

describe("the four clock-dependent values", () => {
  it("decides what is current from the task's own window, not from the server", async () => {
    const { applyEnvelope, clockDependent, emptyState } = await import(
      "../src/lib/sync-state.js"
    );

    const state = applyEnvelope(
      emptyState(),
      envelope({
        reset: true,
        changed: {
          tasks: [
            task({
              id: "soon",
              currentFrom: "2026-10-30T10:00:00.000Z",
              currentUntil: "2026-10-30T11:00:00.000Z",
            }),
            task({ id: "never", currentFrom: null }),
          ],
        },
      }),
    );

    const inside = clockDependent(state, new Date("2026-10-30T10:30:00.000Z"));
    assert.deepEqual(inside.current.map((t) => t.id), ["soon"]);

    /*
     * The same bytes, a different clock, a different answer. This is the whole
     * reason the server stopped sending `current`: a payload with it baked in
     * was stale the instant it was written, so no poll could ever be answered
     * with "nothing has changed".
     */
    const after = clockDependent(state, new Date("2026-10-30T12:00:00.000Z"));
    assert.deepEqual(after.current, []);
  });

  it("fires a reminder once its window opens, and never after it is notified", async () => {
    const { applyEnvelope, clockDependent, emptyState } = await import(
      "../src/lib/sync-state.js"
    );

    const state = applyEnvelope(
      emptyState(),
      envelope({
        reset: true,
        changed: {
          tasks: [
            task({
              id: "due",
              dueFrom: "2026-10-30T09:00:00.000Z",
              dueUntil: "2026-10-30T09:30:00.000Z",
            }),
            task({
              id: "already",
              dueFrom: "2026-10-30T09:00:00.000Z",
              dueUntil: "2026-10-30T09:30:00.000Z",
              notifiedAt: "2026-10-30T09:01:00.000Z",
            }),
          ],
        },
      }),
    );

    const at = (iso: string) => clockDependent(state, new Date(iso)).dueReminders.map((t) => t.id);
    assert.deepEqual(at("2026-10-30T08:59:00.000Z"), []);
    // `notifiedAt` is still the server's record, so "already" never chimes.
    assert.deepEqual(at("2026-10-30T09:10:00.000Z"), ["due"]);
    assert.deepEqual(at("2026-10-30T10:00:00.000Z"), []);
  });

  it("cuts the timeline at its own clock rather than at the server's", async () => {
    const { applyEnvelope, clockDependent, emptyState } = await import(
      "../src/lib/sync-state.js"
    );

    const state = applyEnvelope(
      emptyState(),
      envelope({
        reset: true,
        docs: {
          ribbon: [
            {
              id: "plan",
              category: "Deep Work",
              label: "Work",
              startHour: 0,
              endHour: 24,
              color: "#A78BFA",
              status: "planned",
            },
          ],
          lived: [],
        },
      }),
    );

    const early = clockDependent(state, new Date("2026-10-30T00:00:00")).timeline;
    const late = clockDependent(state, new Date("2026-10-30T18:00:00")).timeline;
    const plannedFrom = (segs: { actual: boolean; startHour: number }[]) =>
      segs.find((s) => !s.actual)?.startHour;

    /*
     * The marker is where the plan starts being a plan. The server used to ship
     * the ribbon pre-cut, which is the single reason moving a marker four
     * pixels cost 2.26 MB.
     */
    assert.equal(plannedFrom(early), 0);
    assert.equal(plannedFrom(late), 18);
  });

  it("paces the improvement figure against how far through the day it is", async () => {
    const { applyEnvelope, clockDependent, emptyState } = await import(
      "../src/lib/sync-state.js"
    );

    const state = applyEnvelope(
      emptyState(),
      envelope({
        reset: true,
        docs: {
          progress: {
            totalXp: 0,
            dailyXp: 0,
            dailyXpTarget: 100,
            efficiencyPct: 50,
            yesterdayEfficiencyPct: 100,
            lastImprovementPulse: "Stable",
            growthStyle: "orb",
            nurtureStyle: "orb",
          } as never,
        },
      }),
    );

    /*
     * Halfway through the day, 50% today against yesterday's 100% is level, not
     * a catastrophe. The raw delta is what greeted the user with roughly -100%
     * every morning, and it is the reason this one cannot be computed on a
     * server that does not know what time it is where you are.
     */
    const midday = clockDependent(state, new Date("2026-10-30T10:30:00.000Z"));
    assert.equal(midday.improvementPct, 0);

    const nearlyOver = clockDependent(state, new Date("2026-10-30T22:00:00.000Z"));
    assert.ok(nearlyOver.improvementPct < -40, "a day that fell behind should say so");
  });
});

/* ----------------------------------------------------------- the transport */

describe("the sync transport", () => {
  it("cold syncs without a cursor and sends no validator", async () => {
    const sync = await import("../src/lib/sync.js");
    sync.forget();

    replies = [
      { status: 200, body: envelope({ reset: true, cursor: "epoch1.5" }), etag: '"aaa"' },
    ];
    await sync.pull();

    const call = seen.at(-1)!;
    assert.match(call.url, /\/api\/v1\/sync$/, "no `since` on a cold sync");
    assert.equal(call.headers["If-None-Match"], undefined);
    assert.equal(call.headers[PROTOCOL_HEADER], String(PROTOCOL_VERSION));
    assert.equal(call.headers.Authorization, "Bearer lifeos_test_token");
    assert.equal(sync.getSnapshot().state.cursor, "epoch1.5");
  });

  it("sends the cursor it holds, and the validator with it", async () => {
    const sync = await import("../src/lib/sync.js");
    sync.forget();

    replies = [
      { status: 200, body: envelope({ reset: true, cursor: "epoch1.5" }), etag: '"aaa"' },
      { status: 200, body: envelope({ cursor: "epoch1.6" }), etag: '"bbb"' },
    ];
    await sync.pull();
    await sync.pull();

    const call = seen.at(-1)!;
    assert.match(call.url, /\?since=epoch1\.5$/);
    assert.equal(call.headers["If-None-Match"], '"aaa"');
    assert.equal(sync.getSnapshot().state.cursor, "epoch1.6");
    assert.equal(sync.getSnapshot().state.etag, '"bbb"');
  });

  it("tells its subscribers when a delta actually lands", async () => {
    const sync = await import("../src/lib/sync.js");
    sync.forget();

    let notifications = 0;
    const unsubscribe = sync.subscribe(() => void notifications++);

    replies = [
      {
        status: 200,
        body: envelope({
          reset: true,
          cursor: "epoch1.5",
          changed: { tasks: [task({ id: "t1" })] },
        }),
        etag: '"aaa"',
      },
      {
        status: 200,
        body: envelope({
          cursor: "epoch1.6",
          changed: { tasks: [task({ id: "t1", title: "Moved" })] },
        }),
        etag: '"bbb"',
      },
    ];

    await sync.pull();
    assert.ok(notifications > 0, "a cold sync that nobody is told about renders nothing");

    const afterCold = notifications;
    await sync.pull();
    assert.ok(notifications > afterCold, "a delta must reach the subscribers too");
    unsubscribe();

    /*
     * The other half of `emit`'s job, and the one that bit: it decides whether
     * anything changed by comparing against the snapshot it holds, so anything
     * that moves the snapshot before calling it makes every change look like no
     * change. The symptom is not a crash — it is a dashboard that syncs
     * perfectly, logs a 200, and shows "Loading…" for ever.
     */
    assert.equal(sync.getSnapshot().state.tasks.t1?.title, "Moved");
  });

  it("treats a 304 as nothing at all — same state object, no churn", async () => {
    const sync = await import("../src/lib/sync.js");
    sync.forget();

    replies = [
      {
        status: 200,
        body: envelope({
          reset: true,
          cursor: "epoch1.5",
          changed: { tasks: [task({ id: "t1" })] },
        }),
        etag: '"aaa"',
      },
      { status: 304 },
      { status: 304 },
    ];

    let notifications = 0;
    const unsubscribe = sync.subscribe(() => void notifications++);

    await sync.pull();
    const after = sync.getSnapshot().state;
    notifications = 0;

    await sync.pull();
    await sync.pull();

    /*
     * This is the assertion the whole rewrite rests on. A `304` must cost
     * nothing: not a byte on the wire, and not a re-render. The obvious engine
     * publishes a "syncing" and then an "idle" snapshot around every poll, and
     * then every screen in the app re-renders twice every eight seconds no
     * matter how empty the answer was — cheap on the network and exactly as
     * expensive as before on the main thread.
     */
    assert.equal(notifications, 0, "a 304 must not notify a single subscriber");
    assert.equal(sync.getSnapshot().state, after, "the state object must be identical");
    assert.equal(sync.getSnapshot().state.cursor, "epoch1.5", "the cursor is kept");
    assert.equal(seen.at(-1)!.headers["If-None-Match"], '"aaa"');
    unsubscribe();
  });

  it("resumes from the stored cursor rather than cold syncing after a reload", async () => {
    const sync = await import("../src/lib/sync.js");
    sync.forget();

    replies = [
      { status: 200, body: envelope({ reset: true, cursor: "epoch1.7" }), etag: '"ccc"' },
    ];
    await sync.pull();

    /*
     * A reload is a fresh module with the same storage. Read it back the way
     * the engine does on boot and insist the cursor survived — without this the
     * app cold syncs 300 KB on every refresh, which is most of what the old
     * route cost and would make the whole exercise pointless.
     */
    const raw = storage.get("lifeos.sync.v4");
    assert.ok(raw, "the state was never persisted");
    assert.equal(JSON.parse(raw).cursor, "epoch1.7");
  });

  it("stops polling on a 401 instead of hammering the door", async () => {
    const sync = await import("../src/lib/sync.js");
    sync.forget();

    replies = [{ status: 401, body: { error: "Unauthorized" } }];
    await sync.pull();

    assert.equal(sync.getSnapshot().status, "unauthorized");
  });

  it("keeps the cached day when the machine is simply unreachable", async () => {
    const sync = await import("../src/lib/sync.js");
    sync.forget();

    replies = [
      {
        status: 200,
        body: envelope({
          reset: true,
          cursor: "epoch1.5",
          changed: { tasks: [task({ id: "t1" })] },
        }),
        etag: '"aaa"',
      },
    ];
    await sync.pull();

    const saved = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    await sync.pull();
    globalThis.fetch = saved;

    /*
     * A sleeping machine is normal, not a crash. The day stays on screen —
     * blanking it would make "works offline" a lie about the one app whose
     * pitch is that it is yours and local.
     */
    assert.equal(sync.getSnapshot().status, "offline");
    assert.ok(sync.getSnapshot().state.tasks.t1, "the cached day must survive");
  });
});

/* --------------------------------------------------------------- the write */

describe("pushing a write", () => {
  it("numbers mutations from one, stamps the life-day, and applies the reply", async () => {
    const sync = await import("../src/lib/sync.js");
    sync.forget();
    storage.delete("lifeos.sync.mutationId");

    replies = [
      { status: 200, body: envelope({ reset: true, cursor: "epoch1.5" }), etag: '"aaa"' },
      {
        status: 200,
        body: {
          protocol: 4,
          lastMutationId: 1,
          results: [{ id: 1, status: "applied", result: { xpAwarded: 10 } }],
          sync: envelope({
            cursor: "epoch1.6",
            changed: { habits: [{ id: "h1", name: "Walk", completedToday: true } as never] },
          }),
        },
      },
    ];

    await sync.pull();
    const before = seen.length;
    const { result } = await sync.pushMutation("habit.complete", {
      habitId: "h1",
      source: "user",
    });

    const call = seen.at(-1)!;
    assert.equal(call.method, "POST");
    assert.match(call.url, /\/api\/v1\/sync\/push$/);
    assert.equal(call.headers[PROTOCOL_HEADER], String(PROTOCOL_VERSION));

    const body = call.body as {
      clientId: string;
      since: string;
      mutations: { id: number; name: string; lifeDayDate?: string }[];
    };
    assert.equal(body.since, "epoch1.5", "the cursor rides along so the reply can carry a delta");
    assert.ok(body.clientId, "a push needs a stable clientId");
    assert.equal(body.mutations[0].id, 1);
    /*
     * The stamp is what stops a write that was in flight at 04:00 landing on
     * the wrong day. A habit completion re-dated by a few minutes corrupts a
     * streak silently, which is strictly worse than losing the write.
     */
    assert.equal(body.mutations[0].lifeDayDate, LIFE_DAY.lifeDay);

    assert.equal(result?.status, "applied");
    /*
     * And the whole point: the new state came back with the write. One request
     * for the write, and none after it — this used to be a 2.26 MB refetch of a
     * day the client had just changed one field of.
     */
    assert.equal(seen.length, before + 1, "a write must not be followed by a refetch");
    assert.equal(sync.getSnapshot().state.habits.h1?.completedToday, true);
    assert.equal(sync.getSnapshot().state.cursor, "epoch1.6");
  });

  it("does not stamp a mutation that is not about a day", async () => {
    const sync = await import("../src/lib/sync.js");
    sync.forget();

    replies = [
      { status: 200, body: envelope({ reset: true, cursor: "epoch1.5" }), etag: '"aaa"' },
      {
        status: 200,
        body: {
          protocol: 4,
          lastMutationId: 5,
          results: [{ id: 5, status: "applied" }],
          sync: envelope({ cursor: "epoch1.7" }),
        },
      },
    ];
    await sync.pull();
    await sync.pushMutation("task.notified", { taskId: "t1" });

    const body = seen.at(-1)!.body as { mutations: { lifeDayDate?: string }[] };
    assert.equal(
      body.mutations[0].lifeDayDate,
      undefined,
      "a reminder having fired is a statement about a task, not about a day",
    );
  });

  it("renumbers and resends once when the server reports a hole", async () => {
    const sync = await import("../src/lib/sync.js");
    sync.forget();
    storage.delete("lifeos.sync.mutationId");

    replies = [
      { status: 200, body: envelope({ reset: true, cursor: "epoch1.5" }), etag: '"aaa"' },
      { status: 409, body: { error: "hole", lastMutationId: 7 } },
      {
        status: 200,
        body: {
          protocol: 4,
          lastMutationId: 8,
          results: [{ id: 8, status: "applied" }],
          sync: envelope({ cursor: "epoch1.8" }),
        },
      },
    ];

    await sync.pull();
    const { result } = await sync.pushMutation("task.dismiss", { taskId: "t1" });

    /*
     * The usual cause is cleared storage: this browser believes it is at 1 and
     * the server has seen 7. The server says where it is, we renumber from
     * there and send once. Not a loop — a second 409 is a real failure.
     */
    const resent = seen.at(-1)!.body as { mutations: { id: number }[] };
    assert.equal(resent.mutations[0].id, 8);
    assert.equal(result?.status, "applied");
    assert.equal(storage.get("lifeos.sync.mutationId"), "8");
  });

  it("counts a duplicate as success, because the thing did happen", async () => {
    const sync = await import("../src/lib/sync.js");
    const { wasApplied } = sync;

    assert.equal(wasApplied({ id: 1, status: "applied" }), true);
    assert.equal(wasApplied({ id: 1, status: "duplicate" }), true);
    /*
     * "Already completed today" arrives as `duplicate`. The optimistic tick is
     * on screen and the habit is done, so showing the user a failure for it
     * would be a lie about their own day.
     */
    assert.equal(wasApplied({ id: 1, status: "staleLifeDay" }), false);
    assert.equal(wasApplied({ id: 1, status: "rejected" }), false);
    assert.equal(wasApplied(null), false);
  });
});
