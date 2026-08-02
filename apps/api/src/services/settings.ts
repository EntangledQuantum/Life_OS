import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  DEFAULT_GAMIFICATION_CONFIG,
  type AccentThemeId,
  type AppSettings,
  type GamificationConfig,
} from "@life-os/shared";
import {
  getSettingsRow,
  loadGamificationConfig,
  nowIso,
} from "./helpers.js";

export function getSettings(db: LifeOsDb): AppSettings {
  const row = getSettingsRow(db) as typeof schema.settings.$inferSelect & {
    dayResetTime?: string;
  };
  return {
    gamificationEnabled: row.gamificationEnabled,
    streaksEnabled: row.streaksEnabled,
    pointsEnabled: row.pointsEnabled,
    achievementsEnabled: row.achievementsEnabled,
    questsEnabled: row.questsEnabled,
    celebrationIntensity: row.celebrationIntensity as "full" | "minimal" | "off",
    accentTheme: row.accentTheme as AccentThemeId,
    reducedMotion: row.reducedMotion,
    plannedWake: row.plannedWake,
    plannedSleepStart: row.plannedSleepStart,
    plannedSleepEnd: row.plannedSleepEnd,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    dayResetTime: row.dayResetTime ?? "04:00",
    storageMode: row.storageMode as "local" | "supabase",
    supabaseUrl: row.supabaseUrl,
    supabaseKeySet: Boolean(row.supabaseKey),
  };
}

export function updateSettings(
  db: LifeOsDb,
  input: Partial<{
    gamificationEnabled: boolean;
    streaksEnabled: boolean;
    pointsEnabled: boolean;
    achievementsEnabled: boolean;
    questsEnabled: boolean;
    celebrationIntensity: "full" | "minimal" | "off";
    accentTheme: AccentThemeId;
    reducedMotion: boolean;
    plannedWake: string;
    plannedSleepStart: string;
    plannedSleepEnd: string;
    quietHoursStart: string;
    quietHoursEnd: string;
    dayResetTime: string;
    storageMode: "local" | "supabase";
    supabaseUrl: string | null;
    supabaseKey: string | null;
  }>,
) {
  const row = getSettingsRow(db);
  const { supabaseKey, ...rest } = input;
  db.update(schema.settings)
    .set({
      ...rest,
      ...(supabaseKey !== undefined ? { supabaseKey } : {}),
      updatedAt: nowIso(),
    })
    .where(eq(schema.settings.id, row.id))
    .run();
  return getSettings(db);
}

export function getGamificationConfig(db: LifeOsDb): GamificationConfig {
  return loadGamificationConfig(db);
}

export function updateGamificationConfig(
  db: LifeOsDb,
  patch: Partial<GamificationConfig> & {
    baseMultipliers?: Partial<GamificationConfig["baseMultipliers"]>;
  },
) {
  const current = loadGamificationConfig(db);
  const next: GamificationConfig = {
    ...current,
    ...patch,
    baseMultipliers: {
      ...current.baseMultipliers,
      ...(patch.baseMultipliers ?? {}),
    },
  };
  const existing = db.select().from(schema.gamificationConfig).limit(1).get();
  if (existing) {
    db.update(schema.gamificationConfig)
      .set({ configJson: JSON.stringify(next), updatedAt: nowIso() })
      .where(eq(schema.gamificationConfig.id, existing.id))
      .run();
  } else {
    db.insert(schema.gamificationConfig)
      .values({
        configJson: JSON.stringify(next ?? DEFAULT_GAMIFICATION_CONFIG),
        updatedAt: nowIso(),
      })
      .run();
  }
  return next;
}

export function exportAll(db: LifeOsDb) {
  return {
    exportedAt: nowIso(),
    habits: db.select().from(schema.habits).all(),
    habitLogs: db.select().from(schema.habitLogs).all(),
    studySessions: db.select().from(schema.studySessions).all(),
    goals: db.select().from(schema.goals).all(),
    sleepLogs: db.select().from(schema.sleepLogs).all(),
    scheduleBlocks: db.select().from(schema.scheduleBlocks).all(),
    achievements: db.select().from(schema.achievements).all(),
    quests: db.select().from(schema.quests).all(),
    lightReviews: db.select().from(schema.lightReviews).all(),
    agentEvents: db.select().from(schema.agentEvents).all(),
    dailySnapshots: db.select().from(schema.dailySnapshots).all(),
    userProgress: db.select().from(schema.userProgress).all(),
    settings: db.select().from(schema.settings).all(),
    gamificationConfig: db.select().from(schema.gamificationConfig).all(),
    specialEventCandidates: db.select().from(schema.specialEventCandidates).all(),
  };
}
