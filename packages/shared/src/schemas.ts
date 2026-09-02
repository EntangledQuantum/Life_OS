import { z } from "zod";
import {
  CATEGORIES,
  GROWTH_STYLES,
  HABIT_GRAPHICS,
  LEGACY_GROWTH_STYLES,
  QUALITY_FLAGS,
  ACTIVITIES,
  ACCENT_THEMES,
  NOTIFICATION_SOUND_IDS,
  REPEAT_RULES,
  normalizeGrowthStyle,
  type GrowthStyle,
} from "./constants.js";
import { MAX_SVG_LENGTH } from "./svg.js";
import { WEBHOOK_EVENTS, WEBHOOK_PRESETS } from "./webhooks.js";
import { TASK_KINDS, TASK_STATUSES } from "./tasks.js";
import { parseGoalCondition, type GoalCondition } from "./conditions.js";
import { isTimezone } from "./time.js";

/**
 * A goal condition, validated by the hand-written parser so agents get a list
 * of everything wrong at once instead of zod's first-failure union noise.
 */
const goalConditionSchema = z.unknown().superRefine((value, ctx) => {
  const parsed = parseGoalCondition(value);
  if (!parsed.ok) {
    for (const message of parsed.errors) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  }
}) as unknown as z.ZodType<GoalCondition>;

/** Accepts every historical name and always yields a current GrowthStyle. */
const growthStyleSchema = z
  .enum([...GROWTH_STYLES, ...LEGACY_GROWTH_STYLES])
  .transform((v): GrowthStyle => normalizeGrowthStyle(v));

/** "HH:mm" on a 24-hour clock. */
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm on a 24-hour clock");

export const createHabitSchema = z.object({
  name: z.string().min(1).max(120),
  emoji: z.string().min(1).max(16).default("✨"),
  category: z.enum(CATEGORIES).or(z.string()).default("Custom"),
  frequencyRule: z.string().default("daily"),
  /**
   * "HH:mm" — when in the day this happens. Null or absent means no particular
   * time.
   *
   * Setting this is what puts the habit on the timeline; there is no separate
   * task to create, and creating one alongside is the duplicate this replaced.
   */
  scheduledTime: clockTime.nullable().optional(),
  /** How long it takes. Only meaningful with `scheduledTime`. */
  durationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
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

/** ISO 8601 instant. Rejected early so agents get a clear message, not a NaN. */
const isoInstant = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), {
    message: "must be an ISO 8601 date-time, e.g. 2026-08-04T19:30:00Z",
  });

/**
 * A task's interactive control. Shape-checked here, range-checked in
 * `validateCardControl` — zod cannot express "value must sit inside min..max"
 * without a refinement that reports a worse message than the validator's.
 *
 * Declared above `createTaskSchema` because that schema references it, and a
 * `const` referenced before its initializer is a runtime error, not a type
 * error TypeScript would have caught.
 */
export const cardControlSchema = z.union([
  z.object({
    kind: z.literal("slider"),
    label: z.string().min(1).max(80),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    value: z.number().optional(),
    unit: z.string().max(16).optional(),
  }),
  z.object({
    kind: z.literal("button"),
    label: z.string().min(1).max(80),
    pressedAt: z.string().nullable().optional(),
  }),
]);

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

export const createGoalSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  /**
   * Note: you cannot set "achieved" here. A goal becomes achieved only when its
   * condition comes true *and* the user has seen the celebration.
   */
  status: z.enum(["active", "paused", "abandoned"]).default("active"),
  targetDate: z.string().nullable().optional(),
  whyItMatters: z.string().nullable().optional(),
  progressPct: z.number().min(0).max(100).default(0),
  linkedHabitIds: z.array(z.string()).optional(),
  ownerKind: z.enum(["agent", "user"]).default("agent"),
  /** Machine-checkable completion rule — see GOAL_CONDITION_SYNTAX. */
  condition: goalConditionSchema.nullable().optional(),
  autoCheck: z.boolean().default(true),
  emoji: z.string().max(16).default("🎯"),
  themeColor: z.string().max(32).default("#A78BFA"),
});

export const updateGoalSchema = createGoalSchema.partial();

/** Define an agent-owned internal property that goals can be written against. */
export const createAgentPropertySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "key must be lower_snake_case and start with a letter, e.g. books_read",
    ),
  label: z.string().min(1).max(120),
  kind: z.enum(["counter", "number", "text", "json"]).default("counter"),
  value: z.number().nullable().optional(),
  textValue: z.string().max(20_000).nullable().optional(),
  unit: z.string().max(32).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  createdBy: z.string().max(64).nullable().optional(),
});

export const updateAgentPropertySchema = createAgentPropertySchema
  .partial()
  .omit({ key: true });

export const incrementAgentPropertySchema = z.object({
  by: z.number().default(1),
});

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

/** A link the agent attached to a task — a chapter, a paper, a video. */
export const taskResourceSchema = z.object({
  label: z.string().min(1).max(120),
  url: z.string().min(1).max(2000),
  /** Free-form icon hint: "book", "video", "paper", "link". */
  kind: z.string().max(32).optional(),
});

export const createTaskSchema = z.object({
  kind: z.enum(TASK_KINDS).default("task"),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).nullable().optional(),
  body: z.string().max(8000).nullable().optional(),
  purpose: z.string().max(200).nullable().optional(),
  activityTag: z.enum(ACTIVITIES).nullable().optional(),
  showAt: isoInstant.nullable().optional(),
  eventAt: isoInstant.nullable().optional(),
  /** Override; normally derived from eventAt minus the user's lead. */
  remindAt: isoInstant.nullable().optional(),
  durationMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  repeatRule: z.enum(REPEAT_RULES).default("none"),
  repeatOffsetsDays: z
    .array(z.number().int().min(1).max(365))
    .max(20)
    .nullable()
    .optional(),
  xpOnComplete: z.number().int().min(0).max(500).default(0),
  webhookOnComplete: z.boolean().default(false),
  webhookOnInteract: z.boolean().default(false),
  /** Links and references — what a "study block" always was underneath. */
  resources: z.array(taskResourceSchema).max(30).nullable().optional(),
  /** The habit this task is about. A pointer only — neither completes the other. */
  habitId: z.string().nullable().optional(),
  /** The scheduled task this card explains. Same rule: a pointer, not a coupling. */
  linkedTaskId: z.string().nullable().optional(),
  /*
   * Layout and paint. Passed through loosely and normalised in
   * `normalizeCardStyle`, which drops anything it does not understand rather
   * than rejecting the card — the style is decoration, and a typo in a gradient
   * should not cost the user the card's actual content.
   */
  cardStyle: z.unknown().nullable().optional(),
  /** Pin to a front-page card slot. Null leaves it in the list. */
  slot: z.union([z.literal(0), z.literal(1)]).nullable().optional(),
  emoji: z.string().max(16).nullable().optional(),
  themeColor: z.string().max(32).nullable().optional(),
  imageUrl: z.string().max(2000).nullable().optional(),
  imageData: z.string().max(2_000_000).nullable().optional(),
  svg: z.string().max(MAX_SVG_LENGTH).nullable().optional(),
  ctaLabel: z.string().max(80).nullable().optional(),
  ctaLink: z.string().max(2000).nullable().optional(),
  control: cardControlSchema.nullable().optional(),
  progress: z.number().int().min(0).max(100).default(0),
  sound: z.boolean().default(true),
  flash: z.boolean().default(true),
  source: z.enum(["agent", "user"]).default("agent"),
  meta: z.record(z.unknown()).nullable().optional(),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(TASK_STATUSES).optional(),
});

export const cardInteractSchema = z.object({
  /** Required for a slider; ignored for a button. */
  value: z.number().optional(),
  pressed: z.boolean().optional(),
});

export const createWebhookTargetSchema = z.object({
  name: z.string().min(1).max(64),
  url: z.string().url(),
  preset: z.enum(WEBHOOK_PRESETS).optional(),
  secret: z.string().max(512).nullable().optional(),
  /** Empty or omitted means every event. */
  events: z.array(z.enum(WEBHOOK_EVENTS)).nullable().optional(),
  active: z.boolean().optional(),
});

export const updateWebhookTargetSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  url: z.string().url().optional(),
  preset: z.enum(WEBHOOK_PRESETS).optional(),
  secret: z.string().max(512).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).nullable().optional(),
  active: z.boolean().optional(),
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
  notificationSound: z.enum(NOTIFICATION_SOUND_IDS).optional(),
  doNotDisturb: z.boolean().optional(),
  quietHoursSilent: z.boolean().optional(),
  /** 0 = tell me at the time itself. Capped so tomorrow can't reach today. */
  reminderLeadMinutes: z.number().int().min(0).max(240).optional(),
  plannedWake: z.string().optional(),
  plannedSleepStart: z.string().optional(),
  plannedSleepEnd: z.string().optional(),
  quietHoursStart: z.string().optional(),
  quietHoursEnd: z.string().optional(),
  dayResetTime: z.string().optional(),
  /*
   * Checked against the platform's own zone table rather than a regex. A typo
   * like "Asia/Calcutta_" would otherwise be stored and then throw on every
   * date it was used for, a long way from the call that set it.
   */
  timezone: z
    .string()
    .refine(isTimezone, "Not an IANA timezone name, e.g. Asia/Kolkata")
    .nullable()
    .optional(),
  storageMode: z.enum(["local", "supabase"]).optional(),
  supabaseUrl: z.string().nullable().optional(),
  supabaseKey: z.string().nullable().optional(),
  agentWebhookUrl: z.string().url().nullable().optional().or(z.literal("")),
  agentWebhookSecret: z.string().nullable().optional(),
  backupsEnabled: z.boolean().optional(),
  backupIntervalHours: z.number().int().min(1).max(168).optional(),
  backupKeep: z.number().int().min(1).max(500).optional(),
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

/**
 * One-call instance setup. Every field is optional — an agent can reshape only
 * what it knows about and come back for the rest later.
 */
export const agentSetupSchema = z.object({
  replaceHabits: z.boolean().default(false),
  habits: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        emoji: z.string().max(16).optional(),
        category: z.enum(CATEGORIES).or(z.string()).optional(),
        isTiny: z.boolean().optional(),
        anchor: z.string().optional(),
        xpWeight: z.number().int().min(1).max(100).optional(),
        themeColor: z.string().optional(),
        themeGraphic: z.enum(HABIT_GRAPHICS).optional(),
      }),
    )
    .max(40)
    .optional(),
  dailyXpTarget: z.number().int().positive().max(10_000).optional(),
  growthStyle: growthStyleSchema.optional(),
  settings: updateSettingsSchema.optional(),
  agentName: z.string().max(64).optional(),
  agentSetupCard: z
    .object({
      title: z.string().max(200).optional(),
      subtitle: z.string().max(300).optional(),
      body: z.string().max(4000).optional(),
      svg: z.string().max(MAX_SVG_LENGTH).nullable().optional(),
      themeColor: z.string().max(32).optional(),
    })
    .optional(),
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
