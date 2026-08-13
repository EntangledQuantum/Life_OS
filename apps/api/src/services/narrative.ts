/**
 * What actually happened, told rather than dumped.
 *
 * This exists because MCP and REST are different shapes and should stay that
 * way. The REST dashboard is built for a screen: one big payload, polled every
 * few seconds, every field present because some component might render it. An
 * agent asking "what happened ten days ago" through that surface has to fetch
 * a dashboard it cannot get for a past date, then tasks, then habit logs, then
 * study sessions, then reassemble them — twenty round-trips and a pile of JSON
 * to answer one question.
 *
 * So: one call, one day, already summarised, with a `story` line the agent can
 * quote back to the user without re-deriving it. And one call for a range, so
 * "how has this month gone" is not thirty calls.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import { efficiencyPct } from "@life-os/shared";
import { getDayResetTime, loadGamificationConfig } from "./helpers.js";

/** Bounds of a life-day, which starts at `dayResetTime` rather than midnight. */
function dayBounds(db: LifeOsDb, dateStr: string) {
  const reset = getDayResetTime(db);
  const [h, m] = reset.split(":").map(Number);
  const start = new Date(`${dateStr}T00:00:00`);
  start.setHours(h ?? 4, m ?? 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString(), reset };
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export interface DaySummary {
  date: string;
  /** One paragraph an agent can quote. Everything below is the evidence. */
  story: string;
  xp: { earned: number; target: number; efficiencyPct: number };
  habits: {
    done: number;
    total: number;
    completed: string[];
    missed: string[];
  };
  tasks: {
    scheduled: number;
    scheduledDone: number;
    completed: { title: string; at: string; late: boolean; wasScheduled: boolean }[];
    missed: { title: string; at: string }[];
    dismissed: string[];
  };
  study: { minutes: number; sessions: { title: string; minutes: number }[] };
  /** What the user actually said they were doing, from the activity log. */
  lived: { activity: string; from: string; to: string | null }[];
}

export function getDaySummary(db: LifeOsDb, dateStr: string): DaySummary {
  const { start, end } = dayBounds(db, dateStr);
  const config = loadGamificationConfig(db);
  const within = (ts: string | null | undefined) =>
    Boolean(ts && ts >= start && ts < end);

  /* ---- habits ------------------------------------------------------- */
  const activeHabits = db
    .select()
    .from(schema.habits)
    .where(and(eq(schema.habits.active, true), isNull(schema.habits.deletedAt)))
    .all();

  const logs = db
    .select()
    .from(schema.habitLogs)
    .where(isNull(schema.habitLogs.undoneAt))
    .all()
    .filter((l) => within(l.completedAt));

  const doneIds = new Set(logs.map((l) => l.habitId));
  const completedHabits = activeHabits.filter((h) => doneIds.has(h.id));
  const missedHabits = activeHabits.filter((h) => !doneIds.has(h.id));

  /* ---- tasks -------------------------------------------------------- */
  const allTasks = db.select().from(schema.tasks).all();
  const scheduled = allTasks.filter((t) => t.eventAt && within(t.eventAt));

  /*
   * Every completion today, scheduled or not. The two are counted separately
   * below: "23 of 23 scheduled things done" is a lie if 16 of those 23 were
   * things with no time on them that happened to be ticked off today.
   */
  const completed = allTasks
    .filter((t) => t.status === "done" && within(t.completedAt))
    .map((t) => {
      const due = t.eventAt
        ? new Date(t.eventAt).getTime() + (t.durationMinutes ?? 0) * 60_000
        : null;
      return {
        title: t.title,
        at: hhmm(t.completedAt!),
        late: due !== null && new Date(t.completedAt!).getTime() > due,
        /** Was this one of the things that had a time on it today? */
        wasScheduled: Boolean(t.eventAt && within(t.eventAt)),
      };
    });

  /*
   * Of the things scheduled *for this day*, how many are done — regardless of
   * when they were ticked off. Counting only same-day completions made a task
   * scheduled Monday and finished Wednesday look permanently missed on both
   * days, and disagreed with what /analytics reports for the same window.
   */
  const scheduledDone = scheduled.filter((t) => t.status === "done").length;

  const missed = scheduled
    .filter((t) => t.status === "active")
    .map((t) => ({ title: t.title, at: hhmm(t.eventAt!) }));

  const dismissed = allTasks
    .filter((t) => t.status === "dismissed" && within(t.updatedAt))
    .map((t) => t.title);

  /* ---- study and XP -------------------------------------------------- */
  const sessions = db
    .select()
    .from(schema.studySessions)
    .all()
    .filter((s) => within(s.createdAt));

  const snapshot = db
    .select()
    .from(schema.dailySnapshots)
    .all()
    .find((s) => s.date === dateStr);

  const earned =
    snapshot?.totalXpEarned ??
    logs.reduce((a, l) => a + l.xpAwarded, 0) +
      sessions.reduce((a, s) => a + s.xpAwarded, 0);

  const lived = db
    .select()
    .from(schema.activityLog)
    .all()
    .filter((a) => a.date === dateStr)
    .map((a) => ({
      activity: a.activity,
      from: hhmm(a.startedAt),
      to: a.endedAt ? hhmm(a.endedAt) : null,
    }));

  const eff = Math.round(efficiencyPct(earned, config.dailyXpTarget));
  const studyMinutes = sessions.reduce((a, s) => a + (s.durationMinutes ?? 0), 0);

  return {
    date: dateStr,
    story: tellDay({
      dateStr,
      eff,
      earned,
      target: config.dailyXpTarget,
      habitsDone: completedHabits.length,
      habitsTotal: activeHabits.length,
      missedHabits: missedHabits.map((h) => h.name),
      tasksDone: scheduledDone,
      tasksUnscheduled: completed.filter((c) => !c.wasScheduled).length,
      tasksScheduled: scheduled.length,
      missedTasks: missed.map((m) => m.title),
      lateCount: completed.filter((c) => c.late).length,
      studyMinutes,
    }),
    xp: { earned, target: config.dailyXpTarget, efficiencyPct: eff },
    habits: {
      done: completedHabits.length,
      total: activeHabits.length,
      completed: completedHabits.map((h) => h.name),
      missed: missedHabits.map((h) => h.name),
    },
    tasks: {
      scheduled: scheduled.length,
      /** Of those, how many are done — whenever they were actually ticked. */
      scheduledDone,
      completed,
      missed,
      dismissed,
    },
    study: {
      minutes: studyMinutes,
      sessions: sessions.map((s) => ({
        title: s.title,
        minutes: s.durationMinutes ?? 0,
      })),
    },
    lived,
  };
}

/**
 * The day in a sentence or three.
 *
 * Deliberately flat. It reports what happened and does not editorialise — no
 * "great job", no "you slipped". The agent talking to the user is better placed
 * to decide the tone than a string builder is, and a nothing-happened day must
 * not read as a telling-off.
 */
function tellDay(d: {
  dateStr: string;
  eff: number;
  earned: number;
  target: number;
  habitsDone: number;
  habitsTotal: number;
  missedHabits: string[];
  tasksDone: number;
  tasksUnscheduled: number;
  tasksScheduled: number;
  missedTasks: string[];
  lateCount: number;
  studyMinutes: number;
}): string {
  const parts: string[] = [];

  parts.push(
    `${d.earned} XP against a target of ${d.target} (${d.eff}% efficiency).`,
  );

  if (d.habitsTotal > 0) {
    parts.push(`${d.habitsDone} of ${d.habitsTotal} habits closed.`);
    if (d.missedHabits.length > 0 && d.missedHabits.length <= 4) {
      parts.push(`Missed: ${d.missedHabits.join(", ")}.`);
    }
  }

  if (d.tasksScheduled > 0) {
    parts.push(`${d.tasksDone} of ${d.tasksScheduled} scheduled things done.`);
    if (d.lateCount > 0) {
      parts.push(`${d.lateCount} finished after its window.`);
    }
    if (d.missedTasks.length > 0 && d.missedTasks.length <= 4) {
      parts.push(`Untouched: ${d.missedTasks.join(", ")}.`);
    }
  }
  if (d.tasksUnscheduled > 0) {
    parts.push(`${d.tasksUnscheduled} more done that had no time on them.`);
  }

  if (d.studyMinutes > 0) parts.push(`${d.studyMinutes} minutes of study.`);

  if (parts.length === 1 && d.earned === 0) {
    return `Nothing recorded on ${d.dateStr}.`;
  }
  return parts.join(" ");
}

export interface RangeSummary {
  from: string;
  to: string;
  days: number;
  story: string;
  totals: {
    xp: number;
    xpTarget: number;
    habitsCompleted: number;
    studyMinutes: number;
    tasksCompleted: number;
    tasksScheduled: number;
  };
  /** Habits sorted by how often they were actually closed. */
  habitRates: { name: string; done: number; days: number; ratePct: number }[];
  /** One line per day, so an agent can spot a pattern without another call. */
  daily: { date: string; xp: number; efficiencyPct: number; habits: string }[];
}

/** `YYYY-MM-DD`, `n` days back from a date. */
function backFrom(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * A window of days in one call.
 *
 * Capped at 90 days: past that the per-day detail stops being something a model
 * can hold, and the answer belongs in `/analytics` where it is aggregated.
 */
export function getRangeSummary(
  db: LifeOsDb,
  to: string,
  days: number,
): RangeSummary {
  const span = Math.max(1, Math.min(90, Math.floor(days)));
  const from = backFrom(to, span - 1);

  const summaries: DaySummary[] = [];
  for (let i = span - 1; i >= 0; i--) {
    summaries.push(getDaySummary(db, backFrom(to, i)));
  }

  const totals = summaries.reduce(
    (acc, s) => ({
      xp: acc.xp + s.xp.earned,
      xpTarget: acc.xpTarget + s.xp.target,
      habitsCompleted: acc.habitsCompleted + s.habits.done,
      studyMinutes: acc.studyMinutes + s.study.minutes,
      tasksCompleted: acc.tasksCompleted + s.tasks.scheduledDone,
      tasksScheduled: acc.tasksScheduled + s.tasks.scheduled,
    }),
    {
      xp: 0,
      xpTarget: 0,
      habitsCompleted: 0,
      studyMinutes: 0,
      tasksCompleted: 0,
      tasksScheduled: 0,
    },
  );

  /* Per-habit rates across the window. */
  const counts = new Map<string, number>();
  for (const s of summaries) {
    for (const name of s.habits.completed) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const name of s.habits.missed) {
      if (!counts.has(name)) counts.set(name, 0);
    }
  }
  const habitRates = [...counts.entries()]
    .map(([name, done]) => ({
      name,
      done,
      days: span,
      ratePct: Math.round((done / span) * 100),
    }))
    .sort((a, b) => b.ratePct - a.ratePct);

  const onTarget = summaries.filter((s) => s.xp.earned >= s.xp.target).length;
  const carrying = habitRates.filter((h) => h.ratePct >= 70).map((h) => h.name);
  const slipping = habitRates.filter((h) => h.ratePct <= 30).map((h) => h.name);

  const story = [
    `${from} to ${to}: ${totals.xp} XP against ${totals.xpTarget}, on target ${onTarget} of ${span} days.`,
    `${totals.tasksCompleted} of ${totals.tasksScheduled} scheduled things done.`,
    totals.studyMinutes > 0
      ? `${Math.round(totals.studyMinutes / 60)} hours of study.`
      : "No study recorded.",
    carrying.length > 0 ? `Holding: ${carrying.join(", ")}.` : "",
    slipping.length > 0 ? `Slipping: ${slipping.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    from,
    to,
    days: span,
    story,
    totals,
    habitRates,
    daily: summaries.map((s) => ({
      date: s.date,
      xp: s.xp.earned,
      efficiencyPct: s.xp.efficiencyPct,
      habits: `${s.habits.done}/${s.habits.total}`,
    })),
  };
}

/**
 * Free-text search across everything with a title.
 *
 * "When did I last read that chapter" should be one call, not a scan of every
 * table by hand.
 */
export function searchHistory(
  db: LifeOsDb,
  query: string,
  limit = 25,
): { kind: string; title: string; at: string | null; status: string }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const out: { kind: string; title: string; at: string | null; status: string }[] = [];

  for (const t of db.select().from(schema.tasks).all()) {
    const haystack = `${t.title} ${t.subtitle ?? ""} ${t.body ?? ""}`.toLowerCase();
    if (haystack.includes(q)) {
      out.push({
        kind: `task:${t.kind}`,
        title: t.title,
        at: t.completedAt ?? t.eventAt ?? t.createdAt,
        status: t.status,
      });
    }
  }

  for (const s of db.select().from(schema.studySessions).all()) {
    if (s.title.toLowerCase().includes(q)) {
      out.push({
        kind: "study",
        title: s.title,
        at: s.createdAt,
        status: "done",
      });
    }
  }

  for (const h of db.select().from(schema.habits).all()) {
    if (h.name.toLowerCase().includes(q)) {
      out.push({
        kind: "habit",
        title: h.name,
        at: h.createdAt,
        status: h.active ? "active" : "inactive",
      });
    }
  }

  return out
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, limit);
}
