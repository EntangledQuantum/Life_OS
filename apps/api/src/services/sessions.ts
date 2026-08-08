import { eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import { getLocalDayBounds, nowIso } from "./helpers.js";

/**
 * The running session, and the record of what actually happened.
 *
 * `active_sessions` holds a single row that is replaced on every switch. On its
 * own that means the interval which just ended is discarded — so the part of
 * the day you have already lived could not be drawn, only the part that was
 * planned. Every mutation here also closes out and opens `activity_log` rows,
 * which is what makes the past recoverable.
 */

export interface ActiveSession {
  activity: string;
  startedAt: string;
  blockId: string | null;
  previousActivity: string | null;
  endsAt: string | null;
}

function readActive(db: LifeOsDb): ActiveSession | null {
  const row = db.select().from(schema.activeSessions).limit(1).get();
  if (!row) return null;
  const r = row as typeof row & {
    previousActivity?: string | null;
    endsAt?: string | null;
  };
  return {
    activity: row.activity,
    startedAt: row.startedAt,
    blockId: row.blockId ?? null,
    previousActivity: r.previousActivity ?? null,
    endsAt: r.endsAt ?? null,
  };
}

/** Close whatever interval is currently open. Safe to call when none is. */
function closeOpenLog(db: LifeOsDb, at: string): void {
  db.update(schema.activityLog)
    .set({ endedAt: at })
    .where(isNull(schema.activityLog.endedAt))
    .run();
}

function openLog(
  db: LifeOsDb,
  activity: string,
  at: string,
  blockId: string | null,
  source: "user" | "agent",
): void {
  db.insert(schema.activityLog)
    .values({
      id: nanoid(),
      date: getLocalDayBounds(db, new Date(at)).dateStr,
      activity,
      startedAt: at,
      endedAt: null,
      blockId,
      source,
    })
    .run();
}

/**
 * Switch what is running now. `previousActivity` and `endsAt` are only set by
 * timed sessions (see `startTimedSession`); a plain switch clears them, because
 * choosing something by hand means you meant to stay there.
 */
export function setActiveSession(
  db: LifeOsDb,
  activity: string,
  startedAt?: string,
  blockId?: string | null,
  opts: {
    previousActivity?: string | null;
    endsAt?: string | null;
    source?: "user" | "agent";
  } = {},
): ActiveSession {
  const started = startedAt ?? nowIso();

  closeOpenLog(db, started);
  db.delete(schema.activeSessions).run();
  db.insert(schema.activeSessions)
    .values({
      activity,
      startedAt: started,
      blockId: blockId ?? null,
      previousActivity: opts.previousActivity ?? null,
      endsAt: opts.endsAt ?? null,
    })
    .run();
  openLog(db, activity, started, blockId ?? null, opts.source ?? "user");

  return readActive(db)!;
}

/** Stop everything. The day simply has no activity from here until the next one. */
export function clearActiveSession(db: LifeOsDb): { ok: true } {
  closeOpenLog(db, nowIso());
  db.delete(schema.activeSessions).run();
  return { ok: true };
}

/**
 * Start a session that knows how to end: it remembers what it interrupted and
 * when it is due to finish, so `settleActiveSession` can hand the day back.
 */
export function startTimedSession(
  db: LifeOsDb,
  activity: string,
  durationMinutes: number | null,
  blockId: string | null,
  /**
   * What to return to afterwards. Pass this explicitly when something earlier
   * in the call has already changed the running session — `startBlock` does,
   * so reading it here would just find the session we are about to replace.
   */
  previousActivity?: string | null,
): ActiveSession {
  const current = readActive(db);
  const started = nowIso();
  const endsAt =
    durationMinutes && durationMinutes > 0
      ? new Date(Date.parse(started) + durationMinutes * 60_000).toISOString()
      : null;

  return setActiveSession(db, activity, started, blockId, {
    // Do not chain a timed session onto another timed session's "previous" —
    // returning two steps back is not something the user asked for.
    previousActivity:
      previousActivity !== undefined ? previousActivity : (current?.activity ?? null),
    endsAt,
  });
}

/**
 * End the running session and restore whatever it interrupted.
 * Returns the session that is running afterwards, or null if nothing is.
 */
export function endActiveSession(db: LifeOsDb): ActiveSession | null {
  const current = readActive(db);
  if (!current) return null;

  if (current.previousActivity) {
    // Hand the day back rather than dropping the user into nothing.
    return setActiveSession(db, current.previousActivity, nowIso(), null);
  }
  clearActiveSession(db);
  return null;
}

/**
 * Expire a timed session whose window has passed.
 *
 * Called on every dashboard read rather than from a timer: a personal app is
 * not running a scheduler at 3am, and reading is the only moment the answer
 * matters. Returns true when something changed.
 */
export function settleActiveSession(db: LifeOsDb, now = new Date()): boolean {
  const current = readActive(db);
  if (!current?.endsAt) return false;
  if (Date.parse(current.endsAt) > now.getTime()) return false;

  const at = current.endsAt;
  closeOpenLog(db, at);
  db.delete(schema.activeSessions).run();

  if (current.previousActivity) {
    db.insert(schema.activeSessions)
      .values({
        activity: current.previousActivity,
        startedAt: at,
        blockId: null,
        previousActivity: null,
        endsAt: null,
      })
      .run();
    openLog(db, current.previousActivity, at, null, "user");
  }
  return true;
}

export function getActiveSession(db: LifeOsDb): ActiveSession | null {
  return readActive(db);
}

export interface LoggedInterval {
  id: string;
  activity: string;
  startedAt: string;
  endedAt: string | null;
  blockId: string | null;
}

/** Everything actually done on a life-day, oldest first. */
export function listActivityLog(db: LifeOsDb, dateStr: string): LoggedInterval[] {
  return db
    .select()
    .from(schema.activityLog)
    .where(eq(schema.activityLog.date, dateStr))
    .all()
    .map((r) => ({
      id: r.id,
      activity: r.activity,
      startedAt: r.startedAt,
      endedAt: r.endedAt ?? null,
      blockId: r.blockId ?? null,
    }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
