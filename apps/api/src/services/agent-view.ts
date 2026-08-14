/**
 * The same data, answered for an agent rather than for a screen.
 *
 * Two failures from real use are behind this file, and both look like bugs in
 * the database from the outside.
 *
 * **Things vanish after you create them.** A task with a future `showAt` is
 * stored and then omitted from every read a client makes, because a client is
 * showing today and the task is not for today. An agent creating next week's
 * schedule writes thirty rows, reads back nothing, concludes the writes failed,
 * and writes them again. Nothing said the row was hidden rather than missing.
 *
 * **Untimed work reads as immediate work.** Anything with no `eventAt` sits in
 * the open list forever, which is right for a screen — it is genuinely
 * outstanding — and badly wrong as an answer to "what is on today". A migrated
 * spaced-repetition backlog turned into seventeen items that looked due now and
 * were not due at all.
 *
 * So: visibility is stated rather than implied, and open work is split by
 * whether it has a time on it instead of being one flat list.
 */
import type { LifeOsDb } from "@life-os/db";
import {
  isCardImminent,
  lifeDayOf,
  resolveTimezone,
  type LifeDay,
  type Task,
} from "@life-os/shared";
import { getSettingsRow, getDayResetTime } from "./helpers.js";
import { listTasks } from "./tasks.js";

/* ------------------------------------------------------------- life-day */

/** Which life-day it is here, and exactly where its edges are. */
export function currentLifeDay(db: LifeOsDb, now = new Date()): LifeDay {
  const row = getSettingsRow(db) as { timezone?: string | null };
  return lifeDayOf(now, getDayResetTime(db), resolveTimezone(row.timezone));
}

/* ----------------------------------------------------------- visibility */

export type VisibilityState =
  /** In every read, right now. */
  | "visible"
  /** Stored and correct, but no client will show it until `showAt`. */
  | "hidden_until_show_at"
  /** Not active, so it appears only in reads that ask for its status. */
  | "not_active";

export interface Visibility {
  state: VisibilityState;
  /** When it starts appearing, if it is not appearing yet. */
  visibleFrom: string | null;
  /** The same thing in minutes, because "in 3 days" is easier to sanity-check. */
  visibleInMinutes: number | null;
  /** Plain English, so a tool result explains itself without the docs. */
  note: string;
}

/**
 * Why a task is or is not in the lists.
 *
 * Returned on every create, so "I wrote it and then could not find it" is
 * answered at the moment it would otherwise start.
 */
export function describeVisibility(task: Task, now = new Date()): Visibility {
  if (task.status !== "active") {
    return {
      state: "not_active",
      visibleFrom: null,
      visibleInMinutes: null,
      note: `Status is ${task.status}, so it only appears in reads that ask for that status.`,
    };
  }

  const showAt = task.showAt ? new Date(task.showAt) : null;
  if (showAt && showAt.getTime() > now.getTime()) {
    const minutes = Math.round((showAt.getTime() - now.getTime()) / 60_000);
    return {
      state: "hidden_until_show_at",
      visibleFrom: task.showAt,
      visibleInMinutes: minutes,
      note:
        `Stored, but hidden until ${task.showAt}. It will not appear in task lists, ` +
        `the dashboard, or the phone before then — that is the showAt working, not a failed write.`,
    };
  }

  return {
    state: "visible",
    visibleFrom: null,
    visibleInMinutes: null,
    note: "Appears in reads now.",
  };
}

/** A created task, with the answer to "so where is it?" attached. */
export function withVisibility(task: Task, now = new Date()) {
  return { ...task, visibility: describeVisibility(task, now) };
}

/* ------------------------------------------------------------- workload */

export interface Workload {
  lifeDay: LifeDay;
  /**
   * Close enough to now to be the answer to "what should I be doing" — inside
   * the notification lead and not past its own end.
   */
  due: Task[];
  /** Has a time, still ahead, within the horizon asked for. */
  upcoming: Task[];
  /** Had a time, and it went past without a completion. */
  missed: Task[];
  /**
   * Open, active, and with **no time on it at all**.
   *
   * This is inventory, not today. A spaced-repetition catalogue lands here, and
   * treating it as the day's workload is how "today" grew to seventeen items
   * that were not due.
   */
  backlog: Task[];
  /** Stored but not yet showing anywhere. Counted so it is never a surprise. */
  hidden: Task[];
  counts: {
    due: number;
    upcoming: number;
    missed: number;
    backlog: number;
    hidden: number;
  };
  /** One line to quote, so the split does not have to be re-derived. */
  story: string;
}

/**
 * Everything open, sorted into the four questions an agent actually asks.
 *
 * `horizonDays` bounds `upcoming` only. The other buckets are what they are.
 */
export function getWorkload(
  db: LifeOsDb,
  { horizonDays = 7, now = new Date() }: { horizonDays?: number; now?: Date } = {},
): Workload {
  const lifeDay = currentLifeDay(db, now);
  const lead = leadMinutes(db);
  const horizonEnd = now.getTime() + horizonDays * 24 * 60 * 60_000;

  // Every active task, hidden ones included — the whole point is to show what a
  // screen-shaped read leaves out.
  const active = listTasks(db, { status: "active" }, now);

  const hidden: Task[] = [];
  const due: Task[] = [];
  const upcoming: Task[] = [];
  const missed: Task[] = [];
  const backlog: Task[] = [];

  for (const task of active) {
    if (describeVisibility(task, now).state === "hidden_until_show_at") {
      hidden.push(task);
      continue;
    }

    if (!task.eventAt) {
      /*
       * No event time. It may still have been pinged — a reminder with only a
       * remindAt is due when that lands — but with nothing at all it is
       * inventory.
       */
      if (isCardImminent(task, now, lead)) due.push(task);
      else backlog.push(task);
      continue;
    }

    const event = new Date(task.eventAt).getTime();
    const ends = event + (task.durationMinutes ?? 0) * 60_000;

    if (isCardImminent(task, now, lead)) due.push(task);
    else if (event > now.getTime()) {
      if (event <= horizonEnd) upcoming.push(task);
    } else if (ends < now.getTime()) missed.push(task);
  }

  const counts = {
    due: due.length,
    upcoming: upcoming.length,
    missed: missed.length,
    backlog: backlog.length,
    hidden: hidden.length,
  };

  return { lifeDay, due, upcoming, missed, backlog, hidden, counts, story: tell(counts, horizonDays) };
}

function tell(c: Workload["counts"], horizonDays: number): string {
  const parts = [
    `${c.due} due now`,
    `${c.upcoming} scheduled in the next ${horizonDays} day${horizonDays === 1 ? "" : "s"}`,
  ];
  if (c.missed) parts.push(`${c.missed} went past without being done`);
  if (c.backlog) {
    parts.push(
      `${c.backlog} open with no time on ${c.backlog === 1 ? "it" : "them"} — inventory, not today's work`,
    );
  }
  if (c.hidden) parts.push(`${c.hidden} stored but not visible yet`);
  return `${parts.join(", ")}.`;
}

function leadMinutes(db: LifeOsDb): number {
  const row = getSettingsRow(db) as { reminderLeadMinutes?: number };
  const n = Number(row.reminderLeadMinutes);
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

/* --------------------------------------------------------------- cleanup */

export interface CleanupFilter {
  status?: Task["status"];
  kind?: Task["kind"];
  /** Only tasks created before this instant. */
  createdBefore?: string;
  /** Only tasks with no eventAt — the shape migration leftovers take. */
  untimedOnly?: boolean;
  /** Only tasks whose title contains this, case-insensitive. */
  titleContains?: string;
}

/** Which tasks a cleanup filter selects. Never writes. */
export function selectForCleanup(db: LifeOsDb, filter: CleanupFilter): Task[] {
  let rows = listTasks(db, { status: filter.status ?? "active", kind: filter.kind });

  if (filter.untimedOnly) rows = rows.filter((t) => !t.eventAt);
  if (filter.createdBefore) {
    rows = rows.filter((t) => t.createdAt < filter.createdBefore!);
  }
  if (filter.titleContains) {
    const needle = filter.titleContains.toLowerCase();
    rows = rows.filter((t) => t.title.toLowerCase().includes(needle));
  }
  return rows;
}
