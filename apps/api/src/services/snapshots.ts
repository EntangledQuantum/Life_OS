import { nanoid } from "nanoid";
import { and, eq, isNull } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  computeImprovementPulse,
  efficiencyPct,
  getDayBounds,
  type ImprovementPulse,
  type VsYesterday,
} from "@life-os/shared";
import {
  getLocalDayBounds,
  getProgressRow,
  loadGamificationConfig,
  nowIso,
} from "./helpers.js";

export function refreshTodaySnapshot(db: LifeOsDb) {
  const { start, end, dateStr, resetTime } = getLocalDayBounds(db);
  const config = loadGamificationConfig(db);

  const habitLogs = db
    .select()
    .from(schema.habitLogs)
    .where(isNull(schema.habitLogs.undoneAt))
    .all()
    .filter((l) => l.completedAt >= start && l.completedAt <= end);

  const study = db
    .select()
    .from(schema.studySessions)
    .all()
    .filter((s) => s.createdAt >= start && s.createdAt <= end);

  const habitsActive = db
    .select()
    .from(schema.habits)
    .where(and(eq(schema.habits.active, true), isNull(schema.habits.deletedAt)))
    .all();

  const completedIds = new Set(habitLogs.map((l) => l.habitId));
  const consistencyPct =
    habitsActive.length === 0
      ? 0
      : Math.round((completedIds.size / habitsActive.length) * 1000) / 10;

  /**
   * Every XP source that calls addXp() must also land here, or bonus XP would
   * raise lifetime total_xp while leaving today's efficiency, the growth meter,
   * and vs-yesterday untouched.
   */
  const inDay = (ts: string | null | undefined) =>
    Boolean(ts && ts >= start && ts <= end);

  const taskXp = db
    .select()
    .from(schema.tasks)
    .all()
    .filter((t) => t.status === "done" && inDay(t.completedAt))
    .reduce((a, t) => a + (t.xpOnComplete ?? 0), 0);

  const questXp = db
    .select()
    .from(schema.quests)
    .all()
    .filter((q) => inDay(q.completedAt))
    .reduce((a, q) => a + (q.xpBonus ?? 0), 0);

  const achievementXp = db
    .select()
    .from(schema.achievements)
    .all()
    .filter((a) => inDay(a.unlockedAt))
    .reduce((a, ach) => a + (ach.xpBonus ?? 0), 0);

  const totalXpEarned =
    habitLogs.reduce((a, l) => a + l.xpAwarded, 0) +
    study.reduce((a, s) => a + s.xpAwarded, 0) +
    taskXp +
    questXp +
    achievementXp;

  const studyMinutes = study.reduce((a, s) => a + (s.durationMinutes ?? 0), 0);

  const sleep = db
    .select()
    .from(schema.sleepLogs)
    .where(eq(schema.sleepLogs.date, dateStr))
    .get();
  const sleepScore = sleep?.sleepQuality ? sleep.sleepQuality * 20 : null;

  const snaps = db.select().from(schema.dailySnapshots).all();
  const byDate = new Map(snaps.map((s) => [s.date, s]));
  const consistencySeries: number[] = [];
  const xpSeries: number[] = [];
  for (let i = 6; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = getDayBounds(resetTime, d).dateStr;
    const s = byDate.get(key);
    consistencySeries.push(s?.consistencyPct ?? 0);
    xpSeries.push(s?.totalXpEarned ?? 0);
  }
  consistencySeries.push(consistencyPct);
  xpSeries.push(totalXpEarned);

  // Pass the configured pool so "target met" reflects this user's target,
  // not the library default.
  const { pulse, explanation } = computeImprovementPulse(
    consistencySeries,
    xpSeries,
    xpSeries.map(() => config.dailyXpTarget),
  );

  const existing = db
    .select()
    .from(schema.dailySnapshots)
    .where(eq(schema.dailySnapshots.date, dateStr))
    .get();

  if (existing) {
    db.update(schema.dailySnapshots)
      .set({
        totalXpEarned,
        habitsCompletedCount: completedIds.size,
        studyMinutes,
        sleepScore,
        consistencyPct,
        improvementPulse: pulse,
      })
      .where(eq(schema.dailySnapshots.id, existing.id))
      .run();
  } else {
    db.insert(schema.dailySnapshots)
      .values({
        id: nanoid(),
        date: dateStr,
        totalXpEarned,
        habitsCompletedCount: completedIds.size,
        studyMinutes,
        sleepScore,
        consistencyPct,
        improvementPulse: pulse,
        createdAt: nowIso(),
      })
      .run();
  }

  const progress = getProgressRow(db);
  db.update(schema.userProgress)
    .set({ lastImprovementPulse: pulse, updatedAt: nowIso() })
    .where(eq(schema.userProgress.id, progress.id))
    .run();

  return {
    pulse,
    explanation,
    consistencyPct,
    totalXpEarned,
    dateStr,
    dailyXpTarget: config.dailyXpTarget,
  };
}

export function getVsYesterday(db: LifeOsDb): VsYesterday {
  refreshTodaySnapshot(db);
  const { dateStr, resetTime } = getLocalDayBounds(db);
  const config = loadGamificationConfig(db);
  const yday = getDayBounds(
    resetTime,
    new Date(new Date(getLocalDayBounds(db).start).getTime() - 1000),
  ).dateStr;

  const t = db
    .select()
    .from(schema.dailySnapshots)
    .where(eq(schema.dailySnapshots.date, dateStr))
    .get();
  const y = db
    .select()
    .from(schema.dailySnapshots)
    .where(eq(schema.dailySnapshots.date, yday))
    .get();

  const num = (n: number | null | undefined) => n ?? 0;
  const target = config.dailyXpTarget;
  const effToday = efficiencyPct(num(t?.totalXpEarned), target);
  const effYday = efficiencyPct(num(y?.totalXpEarned), target);

  return {
    habitsCompleted: {
      today: num(t?.habitsCompletedCount),
      yesterday: num(y?.habitsCompletedCount),
      delta: num(t?.habitsCompletedCount) - num(y?.habitsCompletedCount),
    },
    xpEarned: {
      today: num(t?.totalXpEarned),
      yesterday: num(y?.totalXpEarned),
      delta: num(t?.totalXpEarned) - num(y?.totalXpEarned),
    },
    studyMinutes: {
      today: num(t?.studyMinutes),
      yesterday: num(y?.studyMinutes),
      delta: num(t?.studyMinutes) - num(y?.studyMinutes),
    },
    sleepScore: {
      today: t?.sleepScore ?? null,
      yesterday: y?.sleepScore ?? null,
      delta:
        t?.sleepScore != null && y?.sleepScore != null
          ? t.sleepScore - y.sleepScore
          : null,
    },
    efficiency: {
      today: effToday,
      yesterday: effYday,
      delta: Math.round((effToday - effYday) * 10) / 10,
    },
  };
}

export function getConsistencySeries(db: LifeOsDb, days = 7) {
  refreshTodaySnapshot(db);
  const { resetTime } = getLocalDayBounds(db);
  const out: { date: string; pct: number }[] = [];
  const snaps = db.select().from(schema.dailySnapshots).all();
  const map = new Map(snaps.map((s) => [s.date, s.consistencyPct]));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = getDayBounds(resetTime, d).dateStr;
    out.push({ date: key, pct: map.get(key) ?? 0 });
  }
  return out;
}

export function getXpSeries(db: LifeOsDb, days = 7) {
  refreshTodaySnapshot(db);
  const { resetTime } = getLocalDayBounds(db);
  const config = loadGamificationConfig(db);
  const snaps = db.select().from(schema.dailySnapshots).all();
  const map = new Map(snaps.map((s) => [s.date, s.totalXpEarned]));
  const out: { date: string; current: number; target: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = getDayBounds(resetTime, d).dateStr;
    out.push({
      date: key,
      current: map.get(key) ?? 0,
      target: config.dailyXpTarget,
    });
  }
  return out;
}

export function getPulse(db: LifeOsDb): {
  pulse: ImprovementPulse;
  explanation: string;
} {
  const r = refreshTodaySnapshot(db);
  return { pulse: r.pulse as ImprovementPulse, explanation: r.explanation };
}

export function getTodayXp(db: LifeOsDb): number {
  const r = refreshTodaySnapshot(db);
  return r.totalXpEarned;
}
