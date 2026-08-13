import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  DEFAULT_GAMIFICATION_CONFIG,
  IMMINENT_WINDOW_MINUTES,
  isNotificationSound,
  type AccentThemeId,
  type AppSettings,
  type GamificationConfig,
  type NotificationSoundId,
} from "@life-os/shared";
import {
  getSettingsRow,
  loadGamificationConfig,
  nowIso,
} from "./helpers.js";
import { rebalanceHabitXp } from "./habits.js";

/** Fall back to the default chime rather than handing a client an unknown id. */
function normalizeSound(value: unknown): NotificationSoundId {
  return isNotificationSound(value) ? value : "chime";
}

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
    notificationSound: normalizeSound(
      (row as { notificationSound?: string }).notificationSound,
    ),
    doNotDisturb: (row as { doNotDisturb?: boolean }).doNotDisturb ?? false,
    quietHoursSilent:
      (row as { quietHoursSilent?: boolean }).quietHoursSilent ?? true,
    reminderLeadMinutes:
      (row as { reminderLeadMinutes?: number }).reminderLeadMinutes ??
      IMMINENT_WINDOW_MINUTES,
    plannedWake: row.plannedWake,
    plannedSleepStart: row.plannedSleepStart,
    plannedSleepEnd: row.plannedSleepEnd,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    dayResetTime: row.dayResetTime ?? "04:00",
    storageMode: row.storageMode as "local" | "supabase",
    supabaseUrl: row.supabaseUrl,
    supabaseKeySet: Boolean(row.supabaseKey),
    agentWebhookUrl: (row as { agentWebhookUrl?: string | null }).agentWebhookUrl ?? null,
    agentWebhookSecretSet: Boolean(
      (row as { agentWebhookSecret?: string | null }).agentWebhookSecret,
    ),
    backupsEnabled: (row as { backupsEnabled?: boolean }).backupsEnabled ?? true,
    backupIntervalHours:
      (row as { backupIntervalHours?: number }).backupIntervalHours ?? 6,
    backupKeep: (row as { backupKeep?: number }).backupKeep ?? 24,
    lastBackupAt: (row as { lastBackupAt?: string | null }).lastBackupAt ?? null,
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
    notificationSound: NotificationSoundId;
    doNotDisturb: boolean;
    quietHoursSilent: boolean;
    reminderLeadMinutes: number;
    plannedWake: string;
    plannedSleepStart: string;
    plannedSleepEnd: string;
    quietHoursStart: string;
    quietHoursEnd: string;
    dayResetTime: string;
    storageMode: "local" | "supabase";
    supabaseUrl: string | null;
    supabaseKey: string | null;
    agentWebhookUrl: string | null;
    agentWebhookSecret: string | null;
    backupsEnabled: boolean;
    backupIntervalHours: number;
    backupKeep: number;
  }>,
) {
  const row = getSettingsRow(db);
  const { supabaseKey, agentWebhookUrl, agentWebhookSecret, ...rest } = input;
  // A negative lead would notify you after the thing; a huge one would put
  // tomorrow on today's front page.
  if (rest.reminderLeadMinutes !== undefined) {
    const n = Number(rest.reminderLeadMinutes);
    rest.reminderLeadMinutes = Number.isFinite(n)
      ? Math.min(240, Math.max(0, Math.round(n)))
      : IMMINENT_WINDOW_MINUTES;
  }
  db.update(schema.settings)
    .set({
      ...rest,
      ...(supabaseKey !== undefined ? { supabaseKey } : {}),
      ...(agentWebhookUrl !== undefined
        ? { agentWebhookUrl: agentWebhookUrl === "" ? null : agentWebhookUrl }
        : {}),
      ...(agentWebhookSecret !== undefined
        ? { agentWebhookSecret: agentWebhookSecret || null }
        : {}),
      updatedAt: nowIso(),
    })
    .where(eq(schema.settings.id, row.id))
    .run();
  return getSettings(db);
}

export function getGamificationConfig(db: LifeOsDb): GamificationConfig {
  return loadGamificationConfig(db);
}

/**
 * Every field optional, including individual multipliers — an intersection with
 * `Partial<GamificationConfig>` would still demand a *complete* baseMultipliers.
 */
export type GamificationConfigPatch = {
  dailyXpTarget?: number;
  growthStyle?: GamificationConfig["growthStyle"];
  baseMultipliers?: Partial<GamificationConfig["baseMultipliers"]>;
  /** @deprecated pre-rename alias for growthStyle */
  nurtureStyle?: GamificationConfig["growthStyle"];
};

export function updateGamificationConfig(
  db: LifeOsDb,
  patch: GamificationConfigPatch,
) {
  const current = loadGamificationConfig(db);
  const { nurtureStyle, ...rest } = patch;
  const next: GamificationConfig = {
    ...current,
    ...rest,
    // Accept the legacy key so older agents can still switch the visual.
    growthStyle: rest.growthStyle ?? nurtureStyle ?? current.growthStyle,
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
  if (patch.dailyXpTarget !== undefined) {
    rebalanceHabitXp(db);
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
    agentProperties: db.select().from(schema.agentProperties).all(),
    dashboardCards: db.select().from(schema.dashboardCards).all(),
    dailySnapshots: db.select().from(schema.dailySnapshots).all(),
    userProgress: db.select().from(schema.userProgress).all(),
    settings: db.select().from(schema.settings).all(),
    gamificationConfig: db.select().from(schema.gamificationConfig).all(),
    specialEventCandidates: db.select().from(schema.specialEventCandidates).all(),
  };
}
