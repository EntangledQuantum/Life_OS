/**
 * Today, as one list.
 *
 * Habits and scheduled tasks were separate everywhere — separate lists on the
 * dashboard, separate lists on the phone, separate tools for the agent. To the
 * person looking at the screen they are the same thing: something to do, maybe
 * at a time, ticked when done. Keeping them apart is what produced the
 * duplicate: an agent that wanted "meditate at 07:00" made a habit for the
 * streak *and* a task for the time, and the user got two rows to tick for one
 * act. Ticking both paid out twice; ticking one left the other saying it never
 * happened.
 *
 * A habit carries its own time now, so it needs no companion task, and this
 * module is the read side that puts both kinds in one ordered list. Completing
 * an item routes to whichever record it came from — `source` says which.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  compareAgenda,
  lifeDayOf,
  resolveTimezone,
  type AgendaItem,
  type AgendaState,
  type HabitWithToday,
  type LifeDay,
  type Task,
  type TaskKind,
} from "@life-os/shared";
import { getDayResetTime, getSettingsRow, nowIso } from "./helpers.js";
import { listHabits } from "./habits.js";
import { listTasks } from "./tasks.js";

/** Which life-day it is here, and where its edges are. */
export function agendaLifeDay(db: LifeOsDb, now = new Date()): LifeDay {
  const row = getSettingsRow(db) as { timezone?: string | null };
  return lifeDayOf(now, getDayResetTime(db), resolveTimezone(row.timezone));
}

function leadMinutes(db: LifeOsDb): number {
  const row = getSettingsRow(db) as { reminderLeadMinutes?: number };
  const n = Number(row.reminderLeadMinutes);
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

/**
 * The instant a habit's `scheduledTime` lands on today.
 *
 * Built from the life-day's own start rather than from the calendar date, so a
 * habit at 01:00 belongs to the night of the day you have been awake through —
 * the same rule everything else here follows.
 */
function habitInstantToday(day: LifeDay, hhmm: string): string | null {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const start = new Date(day.lifeDayStart);
  const [rh, rm] = day.dayResetTime.split(":").map(Number);
  const resetMinutes = (rh ?? 4) * 60 + (rm ?? 0);
  const wanted = Number(m[1]) * 60 + Number(m[2]);

  /*
   * A time before the reset happens *after* midnight, at the far end of this
   * life-day: 01:00 with an 04:00 reset is 21 hours in, not three hours ago.
   * Getting this wrong would put a late-night habit on yesterday's ribbon.
   */
  const offset =
    wanted >= resetMinutes ? wanted - resetMinutes : wanted + 1440 - resetMinutes;
  return new Date(start.getTime() + offset * 60_000).toISOString();
}

/** Hours from the start of the life-day, for drawing a ribbon. */
function hoursInto(day: LifeDay, instant: string): number {
  const from = Date.parse(day.lifeDayStart);
  return (Date.parse(instant) - from) / 3_600_000;
}

function stateOf(
  at: string | null,
  durationMinutes: number | null,
  done: boolean,
  now: Date,
  lead: number,
): AgendaState {
  if (done) return "done";
  if (!at) return "anytime";
  const start = Date.parse(at);
  const end = start + (durationMinutes ?? 0) * 60_000;
  const ms = now.getTime();
  if (ms > end) return "overdue";
  if (start - ms <= lead * 60_000) return "now";
  return "upcoming";
}

function fromHabit(
  habit: HabitWithToday,
  day: LifeDay,
  now: Date,
  lead: number,
): AgendaItem {
  const at = habit.scheduledTime
    ? habitInstantToday(day, habit.scheduledTime)
    : null;
  const state = stateOf(at, habit.durationMinutes, habit.completedToday, now, lead);
  const startHour = at ? hoursInto(day, at) : null;
  return {
    id: `habit:${habit.id}`,
    source: "habit",
    refId: habit.id,
    title: habit.name,
    subtitle: null,
    emoji: habit.emoji,
    activityTag: habit.category ?? null,
    kind: null,
    at,
    durationMinutes: habit.durationMinutes,
    startHour,
    endHour:
      startHour === null ? null : startHour + (habit.durationMinutes ?? 30) / 60,
    state,
    done: habit.completedToday,
    xp: habit.baseXp + habit.extraXp,
    streak: habit.currentStreak,
    themeColor: habit.themeColor,
  };
}

function fromTask(task: Task, day: LifeDay, now: Date, lead: number): AgendaItem {
  const done = task.status === "done";
  const state = stateOf(task.eventAt, task.durationMinutes, done, now, lead);
  const startHour = task.eventAt ? hoursInto(day, task.eventAt) : null;
  return {
    id: `task:${task.id}`,
    source: "task",
    refId: task.id,
    title: task.title,
    subtitle: task.subtitle,
    emoji: task.emoji,
    activityTag: task.activityTag,
    kind: task.kind as TaskKind,
    at: task.eventAt,
    durationMinutes: task.durationMinutes,
    startHour,
    endHour:
      startHour === null ? null : startHour + (task.durationMinutes ?? 30) / 60,
    state,
    done,
    xp: task.xpOnComplete,
    streak: null,
    themeColor: task.themeColor,
  };
}

export interface Agenda {
  lifeDay: LifeDay;
  /** Everything for today, timed first and in time order. */
  items: AgendaItem[];
  /** Open work with no time on it. Inventory, not a plan for today. */
  anytime: AgendaItem[];
  counts: { total: number; done: number; timed: number; anytime: number };
}

/**
 * Everything on today's plate, from both tables.
 *
 * Tasks are filtered to this life-day: something scheduled for Thursday is not
 * on today's list, and something scheduled for yesterday has already been swept
 * to `missed` by `rolloverPastDays`. Untimed work comes back separately because
 * it is not part of the day's shape — it is a pile to draw from, not a plan.
 */
export function getAgenda(db: LifeOsDb, now = new Date()): Agenda {
  const day = agendaLifeDay(db, now);
  const lead = leadMinutes(db);

  const habitItems = listHabits(db)
    .filter((h) => h.active && !h.deletedAt)
    .map((h) => fromHabit(h as HabitWithToday, day, now, lead));

  const withinToday = (iso: string | null | undefined) =>
    Boolean(iso && iso >= day.lifeDayStart && iso < day.lifeDayEnd);

  const nowIsoString = now.toISOString();
  const taskItems: AgendaItem[] = [];
  for (const task of listTasks(db, {}, now)) {
    if (task.status === "dismissed" || task.status === "missed") continue;
    // A future showAt means no client is meant to display it yet.
    if (task.showAt && task.showAt > nowIsoString) continue;

    if (task.eventAt) {
      if (!withinToday(task.eventAt)) continue;
    } else if (task.status === "done") {
      // Untimed and already done: only today's completions belong here.
      if (!withinToday(task.completedAt)) continue;
    }
    taskItems.push(fromTask(task, day, now, lead));
  }

  const all = [...habitItems, ...taskItems];

  /*
   * Timed things sort by time and nothing else — including the done ones.
   * Sinking completions to the bottom reads fine as a to-do list and wrong as a
   * schedule: it put 07:30 after 22:00 and the morning disappeared under the
   * evening. What is done is shown as done; it is not moved.
   */
  const timed = all
    .filter((i) => i.at !== null)
    .sort((a, b) => a.at!.localeCompare(b.at!));

  // The untimed pile has no order of its own, so finished ones go to the end.
  const anytime = all.filter((i) => i.at === null).sort(compareAgenda);

  return {
    lifeDay: day,
    items: [...timed, ...anytime],
    anytime,
    counts: {
      total: all.length,
      done: all.filter((i) => i.done).length,
      timed: timed.length,
      anytime: anytime.length,
    },
  };
}

/**
 * Close out days that are over.
 *
 * A scheduled task used to stay `active` forever, so yesterday's leftovers sat
 * on today's list looking like today's work — and completing one paid today's
 * XP for something that was meant to happen yesterday. That inflates today and
 * quietly erases the fact that yesterday was missed.
 *
 * A day that has ended is closed. The row stays, marked `missed`: a record of
 * what was planned and not done, rather than a chore carried forward. Habits
 * need no equivalent — a habit is not done until it is logged, and a missing
 * log for a past day already *is* the record.
 *
 * Idempotent, and cheap enough to run on every read: it only touches rows whose
 * event is strictly before the current life-day began.
 */
export function rolloverPastDays(db: LifeOsDb, now = new Date()): number {
  const day = agendaLifeDay(db, now);
  const stale = db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.status, "active"),
        isNull(schema.tasks.completedAt),
        lt(schema.tasks.eventAt, day.lifeDayStart),
      ),
    )
    .all();

  if (stale.length === 0) return 0;

  const at = nowIso();
  for (const task of stale) {
    db.update(schema.tasks)
      .set({ status: "missed", updatedAt: at })
      .where(eq(schema.tasks.id, task.id))
      .run();
  }
  return stale.length;
}
