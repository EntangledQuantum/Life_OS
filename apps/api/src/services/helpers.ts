import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  DEFAULT_GAMIFICATION_CONFIG,
  getDayBounds,
  normalizeGrowthStyle,
  type GamificationConfig,
  type HabitGraphic,
} from "@life-os/shared";
import { desc, eq } from "drizzle-orm";

export function nowIso() {
  return new Date().toISOString();
}

export function getSettingsRow(db: LifeOsDb) {
  let row = db.select().from(schema.settings).limit(1).all()[0];
  if (!row) {
    db.insert(schema.settings)
      .values({ updatedAt: nowIso() })
      .run();
    row = db.select().from(schema.settings).limit(1).all()[0]!;
  }
  return row;
}

export function getDayResetTime(db: LifeOsDb): string {
  const row = getSettingsRow(db);
  return (row as { dayResetTime?: string }).dayResetTime ?? "04:00";
}

/** Life-day bounds using global reset time from settings */
export function getLocalDayBounds(db: LifeOsDb, date = new Date()) {
  const reset = getDayResetTime(db);
  return getDayBounds(reset, date);
}

/**
 * "HH:mm", or null for anything that is not one.
 *
 * Agents send "7:00", "07:00:00" and "7am" for the same instant. Storing what
 * arrives means every reader has to guess; normalising once here means a bad
 * value becomes "no particular time" rather than a habit that lands at an hour
 * nobody chose.
 */
export function normalizeClockTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Minutes, or null. Bounded at a day so a typo cannot draw a block that wraps
 * the ribbon several times.
 */
export function clampDuration(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(24 * 60, Math.round(n));
}

export function mapHabit(row: typeof schema.habits.$inferSelect) {
  const r = row as typeof row & { extraXp?: number; xpWeight?: number };
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    category: row.category,
    frequencyRule: row.frequencyRule,
    scheduledTime: normalizeClockTime(
      (row as { scheduledTime?: string | null }).scheduledTime,
    ),
    durationMinutes:
      (row as { durationMinutes?: number | null }).durationMinutes ?? null,
    preferredTimeWindow: row.preferredTimeWindow,
    anchor: row.anchor,
    linkedGoalId: row.linkedGoalId,
    isTiny: row.isTiny,
    baseXp: row.baseXp,
    extraXp: r.extraXp ?? 0,
    xpWeight: r.xpWeight ?? 1,
    active: row.active,
    notes: row.notes,
    themeColor: row.themeColor,
    themeGraphic: row.themeGraphic as HabitGraphic,
    iconKey: row.iconKey,
    /* Optional art, same slots and dimensions as a goal's or a card's. */
    iconImageUrl: row.iconImageUrl ?? null,
    iconImageData: row.iconImageData ?? null,
    backgroundImageUrl: row.backgroundImageUrl ?? null,
    backgroundImageData: row.backgroundImageData ?? null,
    artOverlay: row.artOverlay ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function loadGamificationConfig(db: LifeOsDb): GamificationConfig {
  const rows = db
    .select()
    .from(schema.gamificationConfig)
    .orderBy(desc(schema.gamificationConfig.id))
    .limit(1)
    .all();
  if (!rows[0]) return DEFAULT_GAMIFICATION_CONFIG;
  try {
    const stored = JSON.parse(rows[0].configJson) as Record<string, unknown>;
    const merged = { ...DEFAULT_GAMIFICATION_CONFIG, ...stored };
    // Configs written before the rename carry `nurtureStyle` (plant|water|both).
    return {
      ...merged,
      growthStyle: normalizeGrowthStyle(
        stored.growthStyle ?? stored.nurtureStyle ?? merged.growthStyle,
      ),
    };
  } catch {
    return DEFAULT_GAMIFICATION_CONFIG;
  }
}

export function getProgressRow(db: LifeOsDb) {
  let row = db.select().from(schema.userProgress).limit(1).all()[0];
  if (!row) {
    db.insert(schema.userProgress)
      .values({
        totalXp: 0,
        currentLevel: 1,
        lastImprovementPulse: "Stable",
        updatedAt: nowIso(),
      })
      .run();
    row = db.select().from(schema.userProgress).limit(1).all()[0]!;
  }
  return row;
}

export function addXp(db: LifeOsDb, amount: number) {
  const row = getProgressRow(db);
  const total = row.totalXp + amount;
  db.update(schema.userProgress)
    .set({ totalXp: total, updatedAt: nowIso() })
    .where(eq(schema.userProgress.id, row.id))
    .run();
  return { totalXp: total };
}

export function reverseXp(db: LifeOsDb, amount: number) {
  const row = getProgressRow(db);
  const total = Math.max(0, row.totalXp - amount);
  db.update(schema.userProgress)
    .set({ totalXp: total, updatedAt: nowIso() })
    .where(eq(schema.userProgress.id, row.id))
    .run();
  return { totalXp: total };
}

export function computeStreaks(
  logs: { completedAt: string }[],
  resetTime: string,
): { current: number; longest: number } {
  if (logs.length === 0) return { current: 0, longest: 0 };

  const days = new Set(
    logs.map((l) => getDayBounds(resetTime, new Date(l.completedAt)).dateStr),
  );
  const sorted = [...days].sort();

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]! + "T12:00:00");
    const cur = new Date(sorted[i]! + "T12:00:00");
    const diff = Math.round((cur.getTime() - prev.getTime()) / 86400000);
    if (diff === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  const today = getDayBounds(resetTime).dateStr;
  const yBounds = getDayBounds(resetTime, new Date(Date.now() - 86400000));
  const yday = yBounds.dateStr;
  let current = 0;
  let cursor: string | null = days.has(today)
    ? today
    : days.has(yday)
      ? yday
      : null;
  while (cursor && days.has(cursor)) {
    current += 1;
    const d = new Date(`${cursor}T12:00:00`);
    d.setDate(d.getDate() - 1);
    cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return { current, longest: Math.max(longest, current) };
}

export function history7(
  logs: { completedAt: string }[],
  resetTime: string,
): boolean[] {
  const days = new Set(
    logs.map((l) => getDayBounds(resetTime, new Date(l.completedAt)).dateStr),
  );
  const out: boolean[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(days.has(getDayBounds(resetTime, d).dateStr));
  }
  return out;
}

export function hourFromTime(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h + (m || 0) / 60;
}
