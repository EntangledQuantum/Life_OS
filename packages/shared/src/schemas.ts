import { z } from "zod";
import {
  CATEGORIES,
  GROWTH_STYLES,
  HABIT_GRAPHICS,
  LEGACY_GROWTH_STYLES,
  QUALITY_FLAGS,
  ACTIVITIES,
  ACCENT_THEMES,
  normalizeGrowthStyle,
  type GrowthStyle,
} from "./constants.js";
import { MAX_SVG_LENGTH } from "./svg.js";

/** Accepts `sprout`/`orb` plus the legacy `plant`/`water`/`both`, always yielding a GrowthStyle. */
const growthStyleSchema = z
  .enum([...GROWTH_STYLES, ...LEGACY_GROWTH_STYLES])
  .transform((v): GrowthStyle => normalizeGrowthStyle(v));

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const createHabitSchema = z.object({
  name: z.string().min(1).max(120),
  emoji: z.string().min(1).max(16).default("✨"),
  category: z.enum(CATEGORIES).or(z.string()).default("Custom"),
  frequencyRule: z.string().default("daily"),
  preferredTimeWindow: z.string().nullable().optional(),
  anchor: z.string().nullable().optional(),
  linkedGoalId: z.string().nullable().optional(),
  isTiny: z.boolean().default(true),
  /** Ignored on create if redistribute is true — pool assigns baseXp */
  baseXp: z.number().int().min(0).max(500).optional(),
  extraXp: z.number().int().min(0).max(500).default(0),
  xpWeight: z.number().int().min(1).max(100).default(1),
  /** Default true: rebalance daily pool across all active habits */
  redistribute: z.boolean().default(true),
  notes: z.string().nullable().optional(),
  themeColor: z.string().optional(),
  themeGraphic: z.enum(HABIT_GRAPHICS).optional(),
  iconKey: z.string().nullable().optional(),
});

export const updateHabitSchema = createHabitSchema.partial();

export const createDashboardCardSchema = z.object({
  /** 0 and 1 are content slots. Slot 2 is implied by kind:"agent-setup". */
  slot: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  kind: z.enum(["task", "agent-setup"]).default("task"),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).nullable().optional(),
  body: z.string().max(4000).nullable().optional(),
  emoji: z.string().max(16).nullable().optional(),
  themeColor: z.string().nullable().optional(),
  imageUrl: z.string().max(2000).nullable().optional(),
  imageData: z.string().max(2_000_000).nullable().optional(),
  /** Inline SVG markup; sanitized server-side and rendered sandboxed. */
  svg: z.string().max(MAX_SVG_LENGTH).nullable().optional(),
  status: z.enum(["active", "done", "hidden"]).default("active"),
  progress: z.number().int().min(0).max(100).default(0),
  ctaLabel: z.string().max(80).nullable().optional(),
  ctaLink: z.string().nullable().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
  xpOnComplete: z.number().int().min(0).max(500).default(0),
  webhookOnComplete: z.boolean().default(true),
});

export const updateDashboardCardSchema = createDashboardCardSchema.partial();

export const completeCardSchema = z.object({
  note: z.string().nullable().optional(),
  source: z.enum(["user", "agent"]).default("user"),
  progress: z.number().int().min(0).max(100).optional(),
});

export const completeHabitSchema = z.object({
  note: z.string().nullable().optional(),
  source: z.enum(["user", "agent"]).default("user"),
});

export const createStudySessionSchema = z.object({
  title: z.string().min(1).max(200),
  linkedBookSlug: z.string().nullable().optional(),
  linkedConceptSlug: z.string().nullable().optional(),
  durationMinutes: z.number().int().min(0).nullable().optional(),
  pages: z.number().int().min(0).nullable().optional(),
  qualityFlag: z.enum(QUALITY_FLAGS).default("normal"),
  note: z.string().nullable().optional(),
  generatedSummary: z.string().nullable().optional(),
  source: z.enum(["user", "agent"]).default("user"),
  blockId: z.string().nullable().optional(),
});

export const createScheduleBlockSchema = z.object({
  date: z.string().optional(),
  category: z.string().default("Study"),
  label: z.string().min(1),
  plannedStart: z.string().nullable().optional(),
  plannedEnd: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  source: z.enum(["user", "agent"]).default("agent"),
});

export const updateScheduleBlockSchema = createScheduleBlockSchema
  .partial()
  .extend({
    status: z.enum(["planned", "active", "done", "skipped"]).optional(),
    actualStart: z.string().nullable().optional(),
    actualEnd: z.string().nullable().optional(),
  });

export const createGoalSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  status: z
    .enum(["active", "paused", "achieved", "abandoned"])
    .default("active"),
  targetDate: z.string().nullable().optional(),
  whyItMatters: z.string().nullable().optional(),
  progressPct: z.number().min(0).max(100).default(0),
  linkedHabitIds: z.array(z.string()).optional(),
});

export const updateGoalSchema = createGoalSchema.partial();

export const createSleepLogSchema = z.object({
  date: z.string(),
  plannedWake: z.string().nullable().optional(),
  plannedSleepStart: z.string().nullable().optional(),
  actualWake: z.string().nullable().optional(),
  actualSleep: z.string().nullable().optional(),
  sleepQuality: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const activeSessionSchema = z.object({
  activity: z.enum(ACTIVITIES).or(z.string()),
  startedAt: z.string().optional(),
  blockId: z.string().nullable().optional(),
});

export const injectQuestSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  targetCount: z.number().int().min(1).default(1),
  xpBonus: z.number().int().min(0).default(50),
  forDate: z.string().nullable().optional(),
});

export const injectLightReviewSchema = z.object({
  prompt: z.string().min(1),
  forDate: z.string().optional(),
  link: z.string().nullable().optional(),
});

export const injectAgentEventSchema = z.object({
  kind: z
    .enum(["review", "task", "life", "study", "reminder", "other"])
    .default("task"),
  title: z.string().min(1),
  body: z.string().nullable().optional(),
  link: z.string().nullable().optional(),
  forDate: z.string().optional(),
  priority: z.number().int().default(0),
  /** Bonus XP awarded when the user completes it — outside the habit pool. */
  xpOnComplete: z.number().int().min(0).max(500).default(0),
});

export const updateSettingsSchema = z.object({
  gamificationEnabled: z.boolean().optional(),
  streaksEnabled: z.boolean().optional(),
  pointsEnabled: z.boolean().optional(),
  achievementsEnabled: z.boolean().optional(),
  questsEnabled: z.boolean().optional(),
  celebrationIntensity: z.enum(["full", "minimal", "off"]).optional(),
  accentTheme: z
    .enum(
      Object.keys(ACCENT_THEMES) as [
        keyof typeof ACCENT_THEMES,
        ...Array<keyof typeof ACCENT_THEMES>,
      ],
    )
    .optional(),
  reducedMotion: z.boolean().optional(),
  plannedWake: z.string().optional(),
  plannedSleepStart: z.string().optional(),
  plannedSleepEnd: z.string().optional(),
  quietHoursStart: z.string().optional(),
  quietHoursEnd: z.string().optional(),
  dayResetTime: z.string().optional(),
  storageMode: z.enum(["local", "supabase"]).optional(),
  supabaseUrl: z.string().nullable().optional(),
  supabaseKey: z.string().nullable().optional(),
  agentWebhookUrl: z.string().url().nullable().optional().or(z.literal("")),
  agentWebhookSecret: z.string().nullable().optional(),
});

export const updateGamificationConfigSchema = z.object({
  baseMultipliers: z
    .object({
      inspired: z.number().positive().optional(),
      feynman: z.number().positive().optional(),
      retrieval: z.number().positive().optional(),
      tinyHabit: z.number().positive().optional(),
      fullBlock: z.number().positive().optional(),
    })
    .optional(),
  dailyXpTarget: z.number().int().positive().max(10_000).optional(),
  growthStyle: growthStyleSchema.optional(),
  /** @deprecated pre-rename alias; folded into growthStyle server-side */
  nurtureStyle: growthStyleSchema.optional(),
});

export const createAchievementSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  emoji: z.string().default("🏆"),
  xpBonus: z.number().int().min(0).default(50),
});

export const setHabitThemeSchema = z.object({
  emoji: z.string().optional(),
  themeColor: z.string().optional(),
  themeGraphic: z.enum(HABIT_GRAPHICS).optional(),
  iconKey: z.string().nullable().optional(),
});
