import { nanoid } from "nanoid";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  HABIT_COLOR_PALETTE,
  awardXpForHabit,
  type HabitGraphic,
} from "@life-os/shared";
import {
  addXp,
  computeStreaks,
  getLocalDayBounds,
  history7,
  loadGamificationConfig,
  mapHabit,
  nowIso,
  reverseXp,
} from "./helpers.js";
import { maybeUnlockAchievements } from "./achievements.js";
import { refreshTodaySnapshot } from "./snapshots.js";
import { bumpQuestProgress } from "./quests.js";

export function listHabits(db: LifeOsDb) {
  const rows = db
    .select()
    .from(schema.habits)
    .where(and(eq(schema.habits.active, true), isNull(schema.habits.deletedAt)))
    .all();
  return rows.map((r) => enrichHabit(db, r));
}

export function getHabit(db: LifeOsDb, id: string) {
  const row = db.select().from(schema.habits).where(eq(schema.habits.id, id)).get();
  if (!row || row.deletedAt) return null;
  return enrichHabit(db, row);
}

function enrichHabit(db: LifeOsDb, row: typeof schema.habits.$inferSelect) {
  const logs = db
    .select()
    .from(schema.habitLogs)
    .where(
      and(eq(schema.habitLogs.habitId, row.id), isNull(schema.habitLogs.undoneAt)),
    )
    .all();
  const { start, end, resetTime } = getLocalDayBounds(db);
  const todayLog = logs.find(
    (l) => l.completedAt >= start && l.completedAt <= end,
  );
  const streaks = computeStreaks(logs, resetTime);
  return {
    ...mapHabit(row),
    completedToday: Boolean(todayLog),
    todayLogId: todayLog?.id ?? null,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    history7: history7(logs, resetTime),
    totalCompletions: logs.length,
  };
}

export function createHabit(
  db: LifeOsDb,
  input: {
    name: string;
    emoji?: string;
    category?: string;
    frequencyRule?: string;
    preferredTimeWindow?: string | null;
    anchor?: string | null;
    linkedGoalId?: string | null;
    isTiny?: boolean;
    baseXp?: number;
    notes?: string | null;
    themeColor?: string;
    themeGraphic?: HabitGraphic;
    iconKey?: string | null;
  },
) {
  const existing = db
    .select()
    .from(schema.habits)
    .where(isNull(schema.habits.deletedAt))
    .all();
  const color =
    input.themeColor ??
    HABIT_COLOR_PALETTE[existing.length % HABIT_COLOR_PALETTE.length]!;
  const now = nowIso();
  const id = nanoid();
  db.insert(schema.habits)
    .values({
      id,
      name: input.name,
      emoji: input.emoji ?? "✨",
      category: input.category ?? "Custom",
      frequencyRule: input.frequencyRule ?? "daily",
      preferredTimeWindow: input.preferredTimeWindow ?? "any",
      anchor: input.anchor ?? null,
      linkedGoalId: input.linkedGoalId ?? null,
      isTiny: input.isTiny ?? true,
      baseXp: input.baseXp ?? 15,
      active: true,
      notes: input.notes ?? null,
      themeColor: color,
      themeGraphic: input.themeGraphic ?? "ring",
      iconKey: input.iconKey ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .run();
  return getHabit(db, id)!;
}

export function updateHabit(
  db: LifeOsDb,
  id: string,
  input: Partial<{
    name: string;
    emoji: string;
    category: string;
    frequencyRule: string;
    preferredTimeWindow: string | null;
    anchor: string | null;
    linkedGoalId: string | null;
    isTiny: boolean;
    baseXp: number;
    notes: string | null;
    themeColor: string;
    themeGraphic: HabitGraphic;
    iconKey: string | null;
    active: boolean;
  }>,
) {
  const existing = db.select().from(schema.habits).where(eq(schema.habits.id, id)).get();
  if (!existing || existing.deletedAt) return null;
  db.update(schema.habits)
    .set({
      ...input,
      updatedAt: nowIso(),
    })
    .where(eq(schema.habits.id, id))
    .run();
  return getHabit(db, id);
}

export function deleteHabit(db: LifeOsDb, id: string) {
  const existing = db.select().from(schema.habits).where(eq(schema.habits.id, id)).get();
  if (!existing) return false;
  db.update(schema.habits)
    .set({ deletedAt: nowIso(), active: false, updatedAt: nowIso() })
    .where(eq(schema.habits.id, id))
    .run();
  return true;
}

export function completeHabit(
  db: LifeOsDb,
  id: string,
  opts: { note?: string | null; source?: "user" | "agent" } = {},
) {
  const habit = db.select().from(schema.habits).where(eq(schema.habits.id, id)).get();
  if (!habit || habit.deletedAt) return { error: "Habit not found" as const };

  const enriched = enrichHabit(db, habit);
  if (enriched.completedToday) {
    return { error: "Already completed today" as const, habit: enriched };
  }

  const config = loadGamificationConfig(db);
  const xp = awardXpForHabit({
    baseXp: habit.baseXp,
    isTiny: habit.isTiny,
    config,
  });

  const logId = nanoid();
  const completedAt = nowIso();
  const prevStreak = enriched.currentStreak;

  db.insert(schema.habitLogs)
    .values({
      id: logId,
      habitId: id,
      completedAt,
      note: opts.note ?? null,
      source: opts.source ?? "user",
      xpAwarded: xp,
      undoneAt: null,
    })
    .run();

  const xpResult = addXp(db, xp);
  const after = enrichHabit(db, habit);
  const streakRecovered = prevStreak === 0 && after.currentStreak === 1 && after.totalCompletions > 1;

  const unlocked = maybeUnlockAchievements(db, {
    habitCompleted: true,
    isTiny: habit.isTiny,
    streakRecovered,
    habitName: habit.name,
  });

  bumpQuestProgress(db, 1);
  refreshTodaySnapshot(db);

  return {
    habit: after,
    logId,
    xpAwarded: xp,
    totalXp: xpResult.totalXp,
    streakRecovered,
    unlockedAchievements: unlocked,
  };
}

export function undoHabitCompletion(db: LifeOsDb, habitId: string) {
  const habit = db.select().from(schema.habits).where(eq(schema.habits.id, habitId)).get();
  if (!habit) return { error: "Habit not found" as const };

  const { start, end } = getLocalDayBounds(db);
  const log = db
    .select()
    .from(schema.habitLogs)
    .where(
      and(
        eq(schema.habitLogs.habitId, habitId),
        isNull(schema.habitLogs.undoneAt),
      ),
    )
    .orderBy(desc(schema.habitLogs.completedAt))
    .all()
    .find((l) => l.completedAt >= start && l.completedAt <= end);

  if (!log) return { error: "No completion today to undo" as const };

  db.update(schema.habitLogs)
    .set({ undoneAt: nowIso() })
    .where(eq(schema.habitLogs.id, log.id))
    .run();

  reverseXp(db, log.xpAwarded);
  refreshTodaySnapshot(db);

  return { habit: enrichHabit(db, habit), reversedXp: log.xpAwarded };
}

export function setHabitTheme(
  db: LifeOsDb,
  id: string,
  theme: {
    emoji?: string;
    themeColor?: string;
    themeGraphic?: HabitGraphic;
    iconKey?: string | null;
  },
) {
  return updateHabit(db, id, theme);
}
