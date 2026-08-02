import { eq, isNull, and } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import { nanoid } from "nanoid";
import { addXp, nowIso } from "./helpers.js";

export function listAchievements(db: LifeOsDb) {
  return db.select().from(schema.achievements).all().map((a) => ({
    id: a.id,
    key: a.key,
    title: a.title,
    description: a.description,
    emoji: a.emoji,
    xpBonus: a.xpBonus,
    unlockedAt: a.unlockedAt,
  }));
}

export function createAchievement(
  db: LifeOsDb,
  input: {
    key: string;
    title: string;
    description: string;
    emoji?: string;
    xpBonus?: number;
  },
) {
  const id = nanoid();
  db.insert(schema.achievements)
    .values({
      id,
      key: input.key,
      title: input.title,
      description: input.description,
      emoji: input.emoji ?? "🏆",
      xpBonus: input.xpBonus ?? 50,
      unlockedAt: null,
    })
    .run();
  return listAchievements(db).find((a) => a.id === id)!;
}

function unlock(db: LifeOsDb, key: string) {
  const row = db
    .select()
    .from(schema.achievements)
    .where(eq(schema.achievements.key, key))
    .get();
  if (!row || row.unlockedAt) return null;
  const at = nowIso();
  db.update(schema.achievements)
    .set({ unlockedAt: at })
    .where(eq(schema.achievements.id, row.id))
    .run();
  if (row.xpBonus > 0) addXp(db, row.xpBonus);
  return { ...row, unlockedAt: at };
}

export function maybeUnlockAchievements(
  db: LifeOsDb,
  ctx: {
    habitCompleted?: boolean;
    isTiny?: boolean;
    streakRecovered?: boolean;
    habitName?: string;
    studyInspired?: boolean;
    studyAfter23?: boolean;
  },
) {
  const unlocked: ReturnType<typeof unlock>[] = [];

  if (ctx.habitCompleted) {
    unlocked.push(unlock(db, "first_complete"));
  }
  if (ctx.streakRecovered) {
    unlocked.push(unlock(db, "streak_recovered"));
  }
  if (ctx.studyInspired) {
    unlocked.push(unlock(db, "first_inspired"));
  }
  if (ctx.studyAfter23) {
    unlocked.push(unlock(db, "night_owl_study"));
  }

  // Count-based
  const logs = db
    .select()
    .from(schema.habitLogs)
    .where(isNull(schema.habitLogs.undoneAt))
    .all();

  if (ctx.isTiny) {
    const tinyHabits = db
      .select()
      .from(schema.habits)
      .where(and(eq(schema.habits.isTiny, true), isNull(schema.habits.deletedAt)))
      .all()
      .map((h) => h.id);
    const tinyCount = logs.filter((l) => tinyHabits.includes(l.habitId)).length;
    if (tinyCount >= 10) unlocked.push(unlock(db, "tiny_habit_master"));
  }

  if (ctx.habitName?.toLowerCase().includes("wake")) {
    const wake = db
      .select()
      .from(schema.habits)
      .all()
      .filter((h) => h.name.toLowerCase().includes("wake"));
    const wakeIds = new Set(wake.map((h) => h.id));
    const wakeCount = logs.filter((l) => wakeIds.has(l.habitId)).length;
    if (wakeCount >= 7) unlocked.push(unlock(db, "wake_7"));
  }

  if (ctx.habitName?.toLowerCase().includes("deep")) {
    const deep = db
      .select()
      .from(schema.habits)
      .all()
      .filter((h) => h.name.toLowerCase().includes("deep"));
    const deepIds = new Set(deep.map((h) => h.id));
    const deepCount = logs.filter((l) => deepIds.has(l.habitId)).length;
    if (deepCount >= 10) unlocked.push(unlock(db, "deep_work_10"));
  }

  return unlocked.filter(Boolean);
}
