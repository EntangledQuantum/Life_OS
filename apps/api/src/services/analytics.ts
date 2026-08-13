/**
 * Analytics.
 *
 * The old page was one XP chart, a list of category percentages, and a wall of
 * achievements — three snapshots of *now*, on a page whose only reason to exist
 * is the question "is this getting better or worse". Every series here carries
 * its own history, and where there is a target, the target is on the same axis
 * as the actual. A number without its target is not a measurement.
 *
 * Nothing here writes. It reads `daily_snapshots`, `habit_logs`, `tasks`,
 * `study_sessions` and the two history tables, all of which are recorded as
 * things happen.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  efficiencyPct,
  type AnalyticsPayload,
  type AnalyticsRange,
} from "@life-os/shared";
import {
  computeStreaks,
  getDayResetTime,
  getLocalDayBounds,
  loadGamificationConfig,
} from "./helpers.js";
import { goalSeries, propertySeries } from "./history.js";
import { listProperties } from "./properties.js";
import { listGoals } from "./goals.js";

const RANGE_DAYS: Record<AnalyticsRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

/** `YYYY-MM-DD` for a local date, `n` days back from today. */
function dayKeyBack(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function getAnalytics(
  db: LifeOsDb,
  range: AnalyticsRange = "30d",
): AnalyticsPayload {
  const config = loadGamificationConfig(db);
  const { dateStr: today } = getLocalDayBounds(db);
  const days = RANGE_DAYS[range];

  const snapshots = db
    .select()
    .from(schema.dailySnapshots)
    .all()
    .sort((a, b) => a.date.localeCompare(b.date));

  const from =
    days === null
      ? (snapshots[0]?.date ?? today)
      : dayKeyBack(days - 1);
  const sinceIso = new Date(`${from}T00:00:00`).toISOString();

  const habitsActive = db
    .select()
    .from(schema.habits)
    .where(and(eq(schema.habits.active, true), isNull(schema.habits.deletedAt)))
    .all();
  const resetTime = getDayResetTime(db);

  /* ---- daily: XP and efficiency against target ---------------------- */
  const inRange = snapshots.filter((s) => s.date >= from);
  const daily = inRange.map((s) => ({
    date: s.date,
    xp: s.totalXpEarned,
    xpTarget: config.dailyXpTarget,
    efficiencyPct: Math.round(efficiencyPct(s.totalXpEarned, config.dailyXpTarget)),
    efficiencyTarget: 100,
    habitsCompleted: s.habitsCompletedCount,
    habitsPossible: habitsActive.length,
    consistencyPct: s.consistencyPct,
    studyMinutes: s.studyMinutes,
  }));

  /* ---- per-habit rates ---------------------------------------------- */
  const allLogs = db
    .select()
    .from(schema.habitLogs)
    .where(isNull(schema.habitLogs.undoneAt))
    .all();
  const logs = allLogs.filter((l) => l.completedAt >= sinceIso);

  /** Local day key for a log, so a 1am completion lands on the right day. */
  const logDay = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  };

  const windowDays = inRange.map((s) => s.date);
  const habits = habitsActive
    .map((h) => {
      const mine = logs.filter((l) => l.habitId === h.id);
      /* Streak from the whole history, not just this window. */
      const allMine = allLogs.filter((l) => l.habitId === h.id);
      const doneDays = new Set(mine.map((l) => logDay(l.completedAt)));
      /*
       * A habit created last Tuesday should not be scored against the whole
       * 30 days — it did not exist for most of them, and reporting 23% for a
       * habit someone has never missed is worse than reporting nothing.
       */
      const createdDay = logDay(h.createdAt);
      const possible = windowDays.filter((d) => d >= createdDay);
      const history = possible.map((date) => ({ date, done: doneDays.has(date) }));

      return {
        id: h.id,
        name: h.name,
        emoji: h.emoji,
        themeColor: h.themeColor,
        ratePct:
          possible.length === 0
            ? 0
            : Math.round((history.filter((x) => x.done).length / possible.length) * 100),
        completions: mine.length,
        daysPossible: possible.length,
        currentStreak: computeStreaks(allMine, resetTime).current,
        history,
      };
    })
    .sort((a, b) => b.ratePct - a.ratePct);

  /* ---- schedule adherence -------------------------------------------- */
  const tasks = db
    .select()
    .from(schema.tasks)
    .all()
    .filter((t) => (t.eventAt ?? t.createdAt) >= sinceIso);

  const scheduled = tasks.filter((t) => t.eventAt);
  const completed = scheduled.filter((t) => t.status === "done" && t.completedAt);
  const completedLate = completed.filter((t) => {
    const due = new Date(t.eventAt!).getTime() + (t.durationMinutes ?? 0) * 60_000;
    return new Date(t.completedAt!).getTime() > due;
  });

  const adherenceByDay = new Map<string, { scheduled: number; completed: number }>();
  for (const t of scheduled) {
    const key = logDay(t.eventAt!);
    const row = adherenceByDay.get(key) ?? { scheduled: 0, completed: 0 };
    row.scheduled += 1;
    if (t.status === "done") row.completed += 1;
    adherenceByDay.set(key, row);
  }

  /* ---- study ---------------------------------------------------------- */
  const sessions = db
    .select()
    .from(schema.studySessions)
    .all()
    .filter((s) => s.createdAt >= sinceIso);

  const studyByDay = new Map<string, { minutes: number; sessions: number }>();
  for (const s of sessions) {
    const key = logDay(s.createdAt);
    const row = studyByDay.get(key) ?? { minutes: 0, sessions: 0 };
    row.minutes += s.durationMinutes ?? 0;
    row.sessions += 1;
    studyByDay.set(key, row);
  }

  /* ---- counters and goals --------------------------------------------- */
  const properties = listProperties(db)
    .filter((p) => p.kind === "counter" || p.kind === "number")
    .map((p) => {
      const series = propertySeries(db, p.uid, sinceIso);
      const first = series[0]?.value;
      const last = series.at(-1)?.value ?? p.value;
      return {
        uid: p.uid,
        key: p.key,
        label: p.label,
        unit: p.unit,
        current: p.value,
        delta:
          first === undefined || last === undefined || last === null
            ? null
            : last - first,
        series,
      };
    });

  const goals = listGoals(db)
    .filter((g) => g.status !== "abandoned")
    .map((g) => ({
      id: g.id,
      title: g.title,
      emoji: g.emoji,
      themeColor: g.themeColor,
      progressPct: g.progressPct,
      status: g.status,
      series: goalSeries(db, g.id, sinceIso),
    }));

  return {
    range,
    from,
    daily,
    habits,
    adherence: {
      scheduled: scheduled.length,
      completed: completed.length,
      completedLate: completedLate.length,
      dismissed: tasks.filter((t) => t.status === "dismissed").length,
      ratePct:
        scheduled.length === 0
          ? 0
          : Math.round((completed.length / scheduled.length) * 100),
      byDay: [...adherenceByDay.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    },
    study: {
      totalMinutes: sessions.reduce((a, s) => a + (s.durationMinutes ?? 0), 0),
      sessions: sessions.length,
      byDay: [...studyByDay.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    },
    properties,
    goals,
  };
}
