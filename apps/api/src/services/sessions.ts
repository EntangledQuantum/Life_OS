import { eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import { getLocalDayBounds, nowIso } from "./helpers.js";

/**
 * What you are doing right now, at the level the timeline cares about — Deep
 * Work, Study, Sleep, Life Admin. You set it by hand, from *Right now* on the
 * web and the picker on mobile, and it is the **only** thing that decides what
 * the ribbon behind the now-marker is made of.
 *
 * This is deliberately not connected to the things an agent schedules. A
 * scheduled card or a study block has a target time and a completion, and
 * nothing else; it never starts, never runs, and never changes what activity
 * you are in. Those two ideas used to be tangled together — a card you started
 * silently became your new default activity — and untangling them is the whole
 * point of this module being small.
 *
 * `active_sessions` holds a single row that is replaced on every switch, so on
 * its own the interval that just ended would be discarded. Every mutation here
 * also closes and opens `activity_log` rows, which is what makes the lived part
 * of the day drawable at all.
 */

export interface ActiveSession {
  activity: string;
  startedAt: string;
  blockId: string | null;
}

function readActive(db: LifeOsDb): ActiveSession | null {
  const row = db.select().from(schema.activeSessions).limit(1).get();
  if (!row) return null;
  return {
    activity: row.activity,
    startedAt: row.startedAt,
    blockId: row.blockId ?? null,
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

/** Switch what is running now. Stays put until you switch it again. */
export function setActiveSession(
  db: LifeOsDb,
  activity: string,
  startedAt?: string,
  blockId?: string | null,
  opts: { source?: "user" | "agent" } = {},
): ActiveSession {
  const started = startedAt ?? nowIso();

  closeOpenLog(db, started);
  db.delete(schema.activeSessions).run();
  db.insert(schema.activeSessions)
    .values({ activity, startedAt: started, blockId: blockId ?? null })
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
