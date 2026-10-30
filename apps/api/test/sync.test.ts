import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from "@life-os/shared";

/**
 * The incremental sync protocol, end to end over the real app.
 *
 * These are written against the two properties the whole thing rests on, since
 * both are easy to break without noticing and neither shows up as an error:
 *
 * 1. **An unchanged poll is empty and cheap.** Something that writes on read —
 *    a snapshot refresh, a hash being recorded, a rollover — would bump the
 *    counter on every GET, every poll would carry a delta, and the protocol
 *    would be an elaborate way of sending the whole day again. So the test
 *    polls repeatedly and insists the cursor does not move.
 * 2. **Nothing in a response depends on the clock.** Two polls a moment apart
 *    must be byte-identical apart from `serverTime`. If a clock reading leaks
 *    into a payload, property 1 becomes unachievable and no amount of caching
 *    saves it — which is exactly how the old dashboard route ended up
 *    re-sending 2.26 MB to move a marker.
 */

let dir: string;
let app: { fetch: (req: Request) => Response | Promise<Response> };
let dbmod: typeof import("@life-os/db");

const TOKEN = "lifeos_test_token_for_sync_checks_000001";

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-sync-"));
  process.env.DATABASE_PATH = path.join(dir, "sync.db");
  // Before the env module loads, or it treats the token as missing and writes
  // a fresh one into the developer's real .env.
  process.env.API_TOKEN = TOKEN;
  process.env.TUNNEL = "off";

  dbmod = await import("@life-os/db");
  dbmod.bootstrapDatabase(process.env.DATABASE_PATH);

  const { createApp } = await import("../src/app.js");
  app = createApp();
});

after(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows keeps the SQLite file open; the OS will reap the temp dir */
  }
});

interface Call {
  status: number;
  body: any;
  bytes: number;
  etag: string | null;
  headers: Headers;
}

async function call(
  path_: string,
  {
    method = "GET",
    body = undefined as unknown,
    protocol = true as boolean | string,
    headers = {} as Record<string, string>,
  } = {},
): Promise<Call> {
  const res = await app.fetch(
    new Request(`http://localhost${path_}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        ...(protocol
          ? {
              [PROTOCOL_HEADER]:
                typeof protocol === "string" ? protocol : String(PROTOCOL_VERSION),
            }
          : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const raw = Buffer.from(await res.arrayBuffer());
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    /* 304 and binary bodies */
  }
  return {
    status: res.status,
    body: parsed,
    bytes: raw.length,
    etag: res.headers.get("etag"),
    headers: res.headers,
  };
}

const sync = (since?: string | null, headers?: Record<string, string>) =>
  call(since ? `/api/v1/sync?since=${encodeURIComponent(since)}` : "/api/v1/sync", {
    headers,
  });

/** A habit to write against, plus a task, so the deltas have something in them. */
async function seed() {
  const habit = await call("/api/v1/habits", {
    method: "POST",
    body: { name: "Read", category: "Study", emoji: "📖" },
  });
  const task = await call("/api/v1/tasks", {
    method: "POST",
    body: { title: "Chapter 4", kind: "study" },
  });
  return { habitId: habit.body.id as string, taskId: task.body.id as string };
}

describe("the cold sync", () => {
  it("asks for everything by omitting the cursor, and says so", async () => {
    await seed();
    const res = await sync();
    assert.equal(res.status, 200);
    assert.equal(res.body.protocol, PROTOCOL_VERSION);
    assert.equal(res.body.reset, true, "a first sync must tell the client to reset");
    assert.equal(typeof res.body.cursor, "string");
    assert.ok(res.body.cursor.includes("."), "a cursor carries its epoch");
    assert.ok(res.body.changed.habits.length >= 1);
    assert.ok(res.body.changed.tasks.length >= 1);
  });

  it("sends no tombstones, because there is nothing to delete", async () => {
    const res = await sync();
    assert.deepEqual(res.body.deleted, {});
  });

  it("carries the life-day, which is what a queued write is stamped against", async () => {
    const res = await sync();
    assert.match(res.body.lifeDay.lifeDay, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(res.body.lifeDay.lifeDayStart < res.body.lifeDay.lifeDayEnd);
    assert.ok(res.body.lifeDay.timezone, "a client elsewhere needs the zone");
  });

  it("includes every derived document, since the client has none of them", async () => {
    const res = await sync();
    for (const name of ["agenda", "ribbon", "progress", "insights", "settings"]) {
      assert.ok(name in res.body.docs, `${name} missing from a reset`);
    }
  });
});

describe("the unchanged poll — the whole point of the exercise", () => {
  it("is empty, and says it is up to date", async () => {
    const first = await sync();
    const res = await sync(first.body.cursor);
    assert.equal(res.status, 200);
    assert.equal(res.body.upToDate, true);
    assert.deepEqual(res.body.changed, {});
    assert.deepEqual(res.body.deleted, {});
    assert.deepEqual(res.body.docs, {});
  });

  it("is a few hundred bytes, not a few million", async () => {
    const first = await sync();
    const res = await sync(first.body.cursor);
    assert.ok(
      res.bytes < 800,
      `an unchanged poll was ${res.bytes} bytes; it must stay tiny or none of this matters`,
    );
  });

  it("does not move the cursor, however many times it is asked", async () => {
    /*
     * The regression this exists for: anything that writes while answering a
     * read — a snapshot refresh, recording a document hash, a rollover sweep —
     * bumps the counter, and then every poll carries a delta forever. It would
     * look like the protocol working and cost exactly what it was built to
     * save.
     */
    const start = (await sync()).body.cursor;
    let cursor = start;
    for (let i = 0; i < 6; i++) {
      const res = await sync(cursor);
      assert.equal(res.body.cursor, start, `cursor moved on poll ${i + 1}`);
      assert.equal(res.body.upToDate, true);
      cursor = res.body.cursor;
    }
  });

  it("answers 304 to a conditional poll, with no body at all", async () => {
    const first = await sync();
    const warm = await sync(first.body.cursor);
    assert.ok(warm.etag, "no ETag means no conditional request is possible");
    const conditional = await sync(first.body.cursor, {
      "If-None-Match": warm.etag!,
    });
    assert.equal(conditional.status, 304);
    assert.equal(conditional.bytes, 0);
  });

  it("is never cacheable by a shared cache in between", async () => {
    const res = await sync();
    const cc = res.headers.get("cache-control") ?? "";
    assert.match(cc, /private/, "one person's day must not be held by a relay");
  });
});

describe("nothing in a response depends on what time it is", () => {
  it("two polls a moment apart differ only in serverTime", async () => {
    const a = await sync();
    const b = await sync();
    const strip = (body: any) => {
      const { serverTime, ...rest } = body;
      return rest;
    };
    assert.deepEqual(
      strip(b.body),
      strip(a.body),
      "something clock-dependent leaked into the payload",
    );
  });

  it("a task's windows are instants, and stable between calls", async () => {
    const { taskId } = await seed();
    await call(`/api/v1/tasks/${taskId}`, {
      method: "PATCH",
      body: { eventAt: new Date(Date.now() + 3_600_000).toISOString() },
    });
    const pick = async () =>
      (await sync()).body.changed.tasks.find((t: any) => t.id === taskId);
    const a = await pick();
    const b = await pick();
    assert.ok(a.currentFrom, "a timed task must say when it becomes current");
    assert.ok(a.dueFrom, "a timed task must say when it should chime");
    assert.equal(a.currentFrom, b.currentFrom);
    assert.equal(a.dueUntil, b.dueUntil);
  });
});

describe("deltas carry only what moved", () => {
  it("a write from the REST surface shows up, because the log is in triggers", async () => {
    /*
     * The trigger is why this works for every writer: the REST routes, the MCP
     * tools, the seed script, an agent with a sqlite3 prompt. A change log
     * maintained by hand in the service layer would have needed a line in each
     * of them, and the one that was forgotten would be invisible.
     */
    const before_ = (await sync()).body.cursor;
    const made = await call("/api/v1/tasks", {
      method: "POST",
      body: { title: "written over REST" },
    });
    const res = await sync(before_);
    assert.notEqual(res.body.cursor, before_, "the cursor must move on a write");
    assert.equal(res.body.upToDate, false);
    const titles = (res.body.changed.tasks ?? []).map((t: any) => t.title);
    assert.ok(titles.includes("written over REST"));
    assert.ok(made.body.id);
  });

  it("leaves untouched collections out entirely", async () => {
    const before_ = (await sync()).body.cursor;
    await call("/api/v1/tasks", { method: "POST", body: { title: "just a task" } });
    const res = await sync(before_);
    assert.ok(!("properties" in res.body.changed), "properties did not change");
    assert.ok(!("achievements" in res.body.changed));
  });

  it("re-sends a document only when its content actually changed", async () => {
    const before_ = (await sync()).body.cursor;
    // A backup setting moves `settings` and nothing else about the day.
    await call("/api/v1/settings", {
      method: "PATCH",
      body: { backupKeep: 19 },
    });
    const res = await sync(before_);
    assert.ok("settings" in res.body.docs, "the setting that changed must arrive");
    assert.ok(
      !("insights" in res.body.docs),
      "a backup setting cannot move the pulse; sending it anyway is the bug",
    );
  });

  it("deletes arrive as tombstones, so a client can forget the row", async () => {
    const made = await call("/api/v1/tasks", {
      method: "POST",
      body: { title: "doomed" },
    });
    const before_ = (await sync()).body.cursor;
    await call(`/api/v1/tasks/${made.body.id}`, { method: "DELETE" });
    const res = await sync(before_);
    assert.deepEqual(res.body.deleted.tasks, [made.body.id]);
    const stillThere = (res.body.changed.tasks ?? []).some(
      (t: any) => t.id === made.body.id,
    );
    assert.equal(stillThere, false, "a tombstoned row must not also be sent");
  });

  it("a habit the user retired is a tombstone, not a row to keep showing", async () => {
    /*
     * The row is physically still there — `deleted_at` is set and the history
     * is never destroyed — so the log says `put`. What decides is whether the
     * projection still returns it. Getting this backwards leaves a retired
     * habit on every client forever.
     */
    const made = await call("/api/v1/habits", {
      method: "POST",
      body: { name: "retired", category: "Health" },
    });
    const before_ = (await sync()).body.cursor;
    await call(`/api/v1/habits/${made.body.id}`, { method: "DELETE" });
    const res = await sync(before_);
    assert.ok(
      (res.body.deleted.habits ?? []).includes(made.body.id),
      "a soft-deleted habit must arrive as a tombstone",
    );
  });
});

describe("artwork leaves the payload", () => {
  const PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

  it("becomes a URL, and the data field is emptied", async () => {
    const made = await call("/api/v1/habits", {
      method: "POST",
      body: { name: "with art", category: "Study", iconImageData: PNG },
    });
    const res = await sync();
    const habit = res.body.changed.habits.find((h: any) => h.id === made.body.id);
    assert.equal(habit.iconImageData, null, "base64 must not ride along");
    assert.match(habit.iconImageUrl, /\/api\/v1\/assets\/[0-9a-f]{64}$/);
  });

  it("no sync response contains an inline data URI anywhere", async () => {
    /*
     * Checked over the serialised body rather than field by field, because the
     * ones that got missed first time were copies nested three levels down —
     * a goal's `currentTier` pointing at the same rung as its `tiers` array.
     */
    const res = await sync();
    const raw = JSON.stringify(res.body);
    const found = raw.match(/"data:[^"]{200,}"/g) ?? [];
    assert.equal(
      found.length,
      0,
      `${found.length} inline blobs survived in a sync payload`,
    );
  });

  it("serves the bytes back, immutable and for a year", async () => {
    const made = await call("/api/v1/habits", {
      method: "POST",
      body: { name: "more art", category: "Study", iconImageData: PNG },
    });
    const res = await sync();
    const habit = res.body.changed.habits.find((h: any) => h.id === made.body.id);
    const url = new URL(habit.iconImageUrl);

    const asset = await call(url.pathname, { protocol: false });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "image/png");
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
    assert.match(asset.headers.get("cache-control") ?? "", /max-age=31536000/);
    assert.ok(asset.etag, "an asset without an ETag cannot be revalidated");

    const again = await call(url.pathname, {
      protocol: false,
      headers: { "If-None-Match": asset.etag! },
    });
    assert.equal(again.status, 304);
  });

  it("does not require the protocol header, because an image loader sends none", async () => {
    const made = await call("/api/v1/habits", {
      method: "POST",
      body: { name: "loader art", category: "Study", iconImageData: PNG },
    });
    const res = await sync();
    const habit = res.body.changed.habits.find((h: any) => h.id === made.body.id);
    const asset = await call(new URL(habit.iconImageUrl).pathname, {
      protocol: false,
    });
    assert.equal(asset.status, 200);
  });

  it("still needs the token — this is the user's own artwork", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/v1/assets/${"a".repeat(64)}`),
    );
    assert.equal(res.status, 401);
  });

  it("404s a hash it does not hold, with something to read", async () => {
    const res = await call(`/api/v1/assets/${"b".repeat(64)}`, { protocol: false });
    assert.equal(res.status, 404);
    assert.ok(res.body.hint);
  });
});

describe("a cursor the server cannot honour", () => {
  it("is answered with the whole state rather than an error", async () => {
    /*
     * Deliberately not a 410. A client needs a reset path for its first run
     * anyway, so giving it a second one to implement would only add a way to
     * get it wrong — the same argument behind Replicache's `clear` patch op.
     */
    const res = await sync("someotherepoch.5");
    assert.equal(res.status, 200);
    assert.equal(res.body.reset, true);
    assert.ok(res.body.changed.tasks.length > 0);
  });

  it("treats a cursor from the future as unusable too", async () => {
    const current = (await sync()).body.cursor;
    const epoch = current.slice(0, current.lastIndexOf("."));
    const res = await sync(`${epoch}.999999`);
    assert.equal(res.body.reset, true);
  });

  it("rejects a malformed cursor by resetting, not by throwing", async () => {
    for (const bad of ["", "nonsense", ".", "5", "epoch.notanumber"]) {
      const res = await sync(bad);
      assert.equal(res.status, 200, `cursor ${JSON.stringify(bad)} broke the route`);
      assert.equal(res.body.reset, true);
    }
  });
});

describe("the life-day boundary", () => {
  it("re-sends the habits when the day has turned under a client", async () => {
    /*
     * The one moment an incremental protocol is most tempted to be wrong:
     * nobody writes anything at 04:00, but every habit's `completedToday` and
     * streak move, and a client told "nothing has changed" would sit there
     * showing yesterday. Simulated by rewinding the day the server last
     * answered for, which is what the clock passing the reset time does.
     */
    const before_ = (await sync()).body.cursor;
    const db = dbmod.getDb();
    const { sql } = await import("drizzle-orm");
    db.run(sql`UPDATE sync_state SET life_day = '1999-01-01' WHERE id = 1`);

    const res = await sync(before_);
    assert.equal(res.body.upToDate, false, "the day rolled and nothing was sent");
    assert.ok(
      (res.body.changed.habits ?? []).length > 0,
      "every habit's today-state moved; all of them must be re-sent",
    );
  });
});

describe("pushing writes", () => {
  const push = (body: unknown) =>
    call("/api/v1/sync/push", { method: "POST", body });

  it("applies a mutation and returns the delta it caused", async () => {
    const { habitId } = await seed();
    const start = await sync();
    const res = await push({
      clientId: "test-client-a",
      since: start.body.cursor,
      mutations: [
        {
          id: 1,
          name: "habit.complete",
          lifeDayDate: start.body.lifeDay.lifeDay,
          args: { habitId, source: "user" },
        },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.results[0].status, "applied");
    assert.equal(res.body.lastMutationId, 1);
    /*
     * The delta rides along so a client that just wrote is already current.
     * Before this, a write was followed by a full re-read of a day the client
     * had just changed one row of.
     */
    const habit = (res.body.sync.changed.habits ?? []).find(
      (h: any) => h.id === habitId,
    );
    assert.ok(habit, "the habit it completed must come back in the same response");
    assert.equal(habit.completedToday, true);
  });

  it("leaves the client current — the next poll is empty", async () => {
    const { habitId } = await seed();
    const start = await sync();
    const res = await push({
      clientId: "test-client-b",
      since: start.body.cursor,
      mutations: [
        {
          id: 1,
          name: "habit.complete",
          lifeDayDate: start.body.lifeDay.lifeDay,
          args: { habitId, source: "user" },
        },
      ],
    });
    const after_ = await sync(res.body.sync.cursor);
    assert.equal(after_.body.upToDate, true, "a client that just wrote must be current");
  });

  it("recognises a replayed mutation instead of applying it twice", async () => {
    const { habitId } = await seed();
    const start = await sync();
    const body = {
      clientId: "test-client-c",
      since: start.body.cursor,
      mutations: [
        {
          id: 1,
          name: "habit.complete",
          lifeDayDate: start.body.lifeDay.lifeDay,
          args: { habitId, source: "user" },
        },
      ],
    };
    const first = await push(body);
    assert.equal(first.body.results[0].status, "applied");
    const second = await push(body);
    assert.equal(
      second.body.results[0].status,
      "duplicate",
      "an offline queue drained twice must not pay twice",
    );
    assert.equal(second.body.lastMutationId, 1);
  });

  it("refuses a write stamped with a life-day that has passed", async () => {
    const { habitId } = await seed();
    const start = await sync();
    const res = await push({
      clientId: "test-client-d",
      since: start.body.cursor,
      mutations: [
        {
          id: 1,
          name: "habit.complete",
          lifeDayDate: "2020-01-01",
          args: { habitId, source: "user" },
        },
      ],
    });
    assert.equal(res.body.results[0].status, "staleLifeDay");
    assert.ok(res.body.results[0].error.includes("2020-01-01"));
    assert.equal(
      res.body.lastMutationId,
      1,
      "a stranded write must not block the queue behind it",
    );
  });

  it("lets a day-independent write through without a stamp", async () => {
    const start = await sync();
    const res = await push({
      clientId: "test-client-e",
      since: start.body.cursor,
      mutations: [{ id: 1, name: "settings.patch", args: { backupKeep: 11 } }],
    });
    assert.equal(res.body.results[0].status, "applied");
  });

  it("refuses the whole batch when a mutation number is missing", async () => {
    const start = await sync();
    const res = await push({
      clientId: "test-client-f",
      since: start.body.cursor,
      mutations: [{ id: 7, name: "settings.patch", args: { backupKeep: 12 } }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.lastMutationId, 0);
    assert.match(res.body.error, /Resend from 1/);
  });

  it("advances past a mutation nobody can ever apply", async () => {
    /*
     * The rule that is easiest to get wrong and bites much later: a permanently
     * invalid mutation must still move `lastMutationId`, or every write queued
     * behind it is stuck forever and the client is silently dead.
     */
    const start = await sync();
    const res = await push({
      clientId: "test-client-g",
      since: start.body.cursor,
      mutations: [{ id: 1, name: "habit.explode" as never, args: {} }],
    });
    assert.equal(res.body.results[0].status, "rejected");
    assert.equal(res.body.lastMutationId, 1);
  });

  it("reports a habit already done today as a duplicate, not a failure", async () => {
    const { habitId } = await seed();
    const start = await sync();
    const stamp = start.body.lifeDay.lifeDay;
    await push({
      clientId: "test-client-h",
      since: start.body.cursor,
      mutations: [
        { id: 1, name: "habit.complete", lifeDayDate: stamp, args: { habitId } },
      ],
    });
    const again = await push({
      clientId: "test-client-i",
      since: start.body.cursor,
      mutations: [
        { id: 1, name: "habit.complete", lifeDayDate: stamp, args: { habitId } },
      ],
    });
    assert.equal(
      again.body.results[0].status,
      "duplicate",
      "the tick is already on screen; this is a success from the user's side",
    );
  });

  it("keeps artwork out of its own response too", async () => {
    /*
     * The write path reintroduced the problem once. A mutation's `result` is
     * whatever the service function returned, and `completeHabit` returns the
     * habit — which arrived with 65 KB of base64 in it, straight past every
     * field-by-field projection on the read path.
     */
    const PNG =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
    const made = await call("/api/v1/habits", {
      method: "POST",
      body: { name: "art on a write", category: "Study", iconImageData: PNG },
    });
    const start = await sync();
    const res = await push({
      clientId: "test-client-art",
      since: start.body.cursor,
      mutations: [
        {
          id: 1,
          name: "habit.complete",
          lifeDayDate: start.body.lifeDay.lifeDay,
          args: { habitId: made.body.id, source: "user" },
        },
      ],
    });
    assert.equal(res.body.results[0].status, "applied");
    const raw = JSON.stringify(res.body);
    assert.equal(
      (raw.match(/"data:[^"]{200,}"/g) ?? []).length,
      0,
      "a push response must not carry inline artwork either",
    );
    assert.match(
      res.body.results[0].result.habit.iconImageUrl,
      /\/api\/v1\/assets\/[0-9a-f]{64}$/,
    );
  });

  it("needs a client id, because idempotency is per client", async () => {
    const res = await push({ clientId: "", mutations: [] });
    assert.equal(res.status, 409);
  });

  it("is refused outright for a client on an older protocol", async () => {
    const res = await call("/api/v1/sync/push", {
      method: "POST",
      body: { clientId: "old", mutations: [] },
      protocol: "3",
    });
    assert.equal(res.status, 426);
  });
});

describe("the route that caused all this", () => {
  it("GET /dashboard/today is gone", async () => {
    const res = await call("/api/v1/dashboard/today");
    assert.equal(res.status, 404);
  });
});
