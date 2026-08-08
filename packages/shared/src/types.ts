import type {
  AccentThemeId,
  Activity,
  CardKind,
  Category,
  GrowthStyle,
  HabitGraphic,
  ImprovementPulse,
  NotificationSoundId,
  QualityFlag,
  RepeatRule,
} from "./constants.js";
import type { GoalCondition } from "./conditions.js";

export type Source = "user" | "agent";

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  category: Category | string;
  frequencyRule: string;
  preferredTimeWindow: string | null;
  anchor: string | null;
  linkedGoalId: string | null;
  isTiny: boolean;
  /** Share of daily XP pool after redistribution */
  baseXp: number;
  /** Bonus XP outside the pool (agent-set) */
  extraXp: number;
  /** Weight for pool redistribution */
  xpWeight: number;
  active: boolean;
  notes: string | null;
  themeColor: string;
  themeGraphic: HabitGraphic;
  iconKey: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Card slots. `0` and `1` are the two agent content cards; `2` is the reserved
 * singleton slot for the agent setup card, which does not consume a content
 * slot; `-1` marks an unpinned scheduled card (event/reminder) living in the
 * Upcoming rail rather than on the front page.
 */
export type CardSlot = -1 | 0 | 1 | 2;

/** @see CardKind — kept as an alias because it is part of the public API surface. */
export type DashboardCardKind = CardKind;

/** Agent-owned card: pinned content, the setup card, or a scheduled event/reminder. */
export interface DashboardCard {
  id: string;
  slot: CardSlot;
  kind: DashboardCardKind;
  /**
   * What this card is *for*, in the agent's own words ("spaced-repetition
   * review", "evening wind-down nudge"). Free text — it is the card's function,
   * not its category; `activityTag` carries the category.
   */
  purpose: string | null;
  /** Which bucket of the day this belongs to; starting the card activates it. */
  activityTag: Activity | null;
  /** Card is hidden until this instant. Null = visible now. */
  showAt: string | null;
  /** Notification fires at this instant. Always strictly before `eventAt`. */
  remindAt: string | null;
  /** When the thing actually happens. */
  eventAt: string | null;
  /** How long it takes once started — drives the timeline block. */
  durationMinutes: number | null;
  repeatRule: RepeatRule;
  /** Position on the spaced-repetition ladder. */
  repeatIndex: number;
  /** Custom spaced ladder in days; null uses SPACED_OFFSETS_DAYS. */
  repeatOffsetsDays: number[] | null;
  /** Play a chime when the reminder fires. */
  sound: boolean;
  /** Flash the card (and the tab) until it is dealt with. */
  flash: boolean;
  /** Set once the client has actually fired the notification. */
  notifiedAt: string | null;
  /** Timeline block created when the user started this card. */
  linkedBlockId: string | null;
  title: string;
  subtitle: string | null;
  body: string | null;
  emoji: string | null;
  themeColor: string | null;
  imageUrl: string | null;
  imageData: string | null;
  /** Sanitized inline SVG markup supplied by the agent (rendered sandboxed) */
  svg: string | null;
  status: "active" | "done" | "hidden";
  progress: number;
  ctaLabel: string | null;
  ctaLink: string | null;
  meta: Record<string, unknown> | null;
  xpOnComplete: number;
  webhookOnComplete: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HabitLog {
  id: string;
  habitId: string;
  completedAt: string;
  note: string | null;
  source: Source;
  xpAwarded: number;
  undoneAt: string | null;
}

export interface HabitWithToday extends Habit {
  completedToday: boolean;
  todayLogId: string | null;
  currentStreak: number;
  longestStreak: number;
  history7: boolean[];
  totalCompletions: number;
}

export interface StudySession {
  id: string;
  title: string;
  linkedBookSlug: string | null;
  linkedConceptSlug: string | null;
  durationMinutes: number | null;
  pages: number | null;
  qualityFlag: QualityFlag;
  note: string | null;
  generatedSummary: string | null;
  source: Source;
  createdAt: string;
  /** Linked schedule block if completed from timeline */
  blockId?: string | null;
}

/** Agent-defined time block on the day timeline */
export interface ScheduleBlock {
  id: string;
  date: string;
  category: string;
  label: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  status: "planned" | "active" | "done" | "skipped";
  source: Source;
  notes: string | null;
  completedAt: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  /**
   * `achieved` is only reached *after the user has seen the celebration*.
   * A goal whose condition is already true but whose animation has not played
   * stays `active` with `conditionMetAt` set — see `celebrationPending`.
   */
  status: "active" | "paused" | "achieved" | "abandoned";
  targetDate: string | null;
  whyItMatters: string | null;
  progressPct: number;
  /** Goals are the agent's job; `user` only appears on hand-written legacy rows. */
  ownerKind: "agent" | "user";
  /** Machine-checkable completion rule. Null = manual progress only. */
  condition: GoalCondition | null;
  /** Re-check after every database change (default true). */
  autoCheck: boolean;
  /** First instant the condition evaluated true. */
  conditionMetAt: string | null;
  /** When the user actually watched the celebration. */
  celebrationSeenAt: string | null;
  /** Condition met but not yet witnessed — the dashboard must show the animation. */
  celebrationPending: boolean;
  /** Leaf-by-leaf trace from the last evaluation. */
  conditionDetail: string[];
  emoji: string;
  themeColor: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An agent-defined internal property: a named value the agent maintains itself
 * (books read, chapters revised, gym sessions) that goals can be written
 * against. Every property has a stable `uid` so agents can key their own
 * records to it even if the human-readable `key` is later relabelled.
 */
export interface AgentProperty {
  /** Stable unique id, never reused. */
  uid: string;
  /** Human-typed slug used in conditions, e.g. "books_read". */
  key: string;
  label: string;
  kind: "counter" | "number" | "text" | "json";
  /** Numeric value for counter/number kinds. */
  value: number | null;
  /** Raw value for text/json kinds. */
  textValue: string | null;
  unit: string | null;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Achievement {
  id: string;
  key: string;
  title: string;
  description: string;
  emoji: string;
  xpBonus: number;
  unlockedAt: string | null;
}

export interface Quest {
  id: string;
  title: string;
  description: string | null;
  targetCount: number;
  progressCount: number;
  xpBonus: number;
  forDate: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface LightReview {
  id: string;
  prompt: string;
  forDate: string;
  completedAt: string | null;
  createdAt: string;
  link?: string | null;
}

/** Hermes-injected live task / review / reminder */
export interface AgentEvent {
  id: string;
  kind:
    | "review"
    | "task"
    | "life"
    | "study"
    | "reminder"
    | "exploration"
    | "other";
  title: string;
  body: string | null;
  link: string | null;
  forDate: string;
  status: "pending" | "done" | "dismissed";
  priority: number;
  /** Bonus XP on complete, outside the habit pool */
  xpOnComplete: number;
  completedAt: string | null;
  createdAt: string;
}

/** No levels — efficiency & improvement only */
export interface UserProgress {
  totalXp: number;
  dailyXp: number;
  dailyXpTarget: number;
  efficiencyPct: number;
  improvementPct: number;
  yesterdayEfficiencyPct: number;
  lastImprovementPulse: ImprovementPulse;
  /** Growth-meter style (renamed from nurtureStyle) */
  growthStyle: GrowthStyle;
  /** @deprecated mirror of growthStyle for pre-rename clients */
  nurtureStyle: GrowthStyle;
}

export interface AppSettings {
  gamificationEnabled: boolean;
  streaksEnabled: boolean;
  pointsEnabled: boolean;
  achievementsEnabled: boolean;
  questsEnabled: boolean;
  celebrationIntensity: "full" | "minimal" | "off";
  accentTheme: AccentThemeId;
  reducedMotion: boolean;
  /** Which chime a reminder plays. `none` = visual only. */
  notificationSound: NotificationSoundId;
  /**
   * Suppress the interruption, not the information: no sound, no screen flash,
   * no OS notification. Reminders still appear and stay visibly urgent.
   */
  doNotDisturb: boolean;
  /** Treat quietHoursStart–quietHoursEnd as an automatic do-not-disturb window. */
  quietHoursSilent: boolean;
  plannedWake: string;
  plannedSleepStart: string;
  plannedSleepEnd: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  /** Global life-day reset HH:mm — stats roll over at this time, not midnight */
  dayResetTime: string;
  storageMode: "local" | "supabase";
  supabaseUrl: string | null;
  supabaseKeySet: boolean;
  agentWebhookUrl: string | null;
  agentWebhookSecretSet: boolean;
  /** Periodic snapshots of the SQLite file into data/backups/. */
  backupsEnabled: boolean;
  backupIntervalHours: number;
  /** How many snapshots to keep before the oldest is pruned. */
  backupKeep: number;
  lastBackupAt: string | null;
}

export interface GamificationConfig {
  baseMultipliers: {
    inspired: number;
    feynman: number;
    retrieval: number;
    tinyHabit: number;
    fullBlock: number;
  };
  /** Fixed daily XP pool redistributed across active habits by weight */
  dailyXpTarget: number;
  /** Growth-meter style (renamed from nurtureStyle) */
  growthStyle: GrowthStyle;
}

export interface DailySnapshot {
  date: string;
  totalXpEarned: number;
  habitsCompletedCount: number;
  studyMinutes: number;
  sleepScore: number | null;
  consistencyPct: number;
  improvementPulse: ImprovementPulse | null;
  dailyXpTarget?: number;
}

export interface VsYesterday {
  habitsCompleted: { today: number; yesterday: number; delta: number };
  xpEarned: { today: number; yesterday: number; delta: number };
  studyMinutes: { today: number; yesterday: number; delta: number };
  sleepScore: {
    today: number | null;
    yesterday: number | null;
    delta: number | null;
  };
  efficiency: { today: number; yesterday: number; delta: number };
}

export interface DashboardToday {
  date: string;
  dayResetTime: string;
  /** Up to 2 agent custom cards for the front page (plus the setup card) */
  cards: DashboardCard[];
  /**
   * Scheduled cards about to happen — within 15 minutes, overdue, or already
   * pinged. This is what the dashboard shows; everything further out is
   * planning and belongs on the Timeline tab.
   */
  upcoming: DashboardCard[];
  /** Every visible scheduled card, soonest first. Powers the Timeline tab. */
  scheduled: DashboardCard[];
  /** Reminders whose remindAt has passed and that have not chimed yet. */
  dueReminders: DashboardCard[];
  /**
   * Goals whose condition is true but whose celebration the user has not seen.
   * The dashboard must play the animation; the goal is not finished until it has.
   */
  pendingCelebrations: Goal[];
  /** Agent-defined counters, so the UI (and agents) can see the live values. */
  properties: AgentProperty[];
  habits: HabitWithToday[];
  progress: UserProgress;
  vsYesterday: VsYesterday;
  pulse: ImprovementPulse;
  pulseExplanation: string;
  studyBlocks: ScheduleBlock[];
  studySessions: StudySession[];
  goals: Goal[];
  quests: Quest[];
  lightReviews: LightReview[];
  agentEvents: AgentEvent[];
  pendingEventCount: number;
  achievements: Achievement[];
  consistency7: { date: string; pct: number }[];
  xpSeries7: { date: string; current: number; target: number }[];
  activeSession: {
    activity: Activity | string;
    startedAt: string;
    blockId?: string | null;
  } | null;
  timeline: TimelineBlock[];
}

export interface TimelineBlock {
  id: string;
  category: string;
  label: string;
  startHour: number;
  endHour: number;
  color: string;
  /** `planned` | `active` | `done` | `unlogged` */
  status: string;
  /**
   * True for the part of the ribbon behind the now-marker: what was actually
   * done, from the activity log. False ahead of it, where the ribbon is the
   * plan. Clients should render the two differently — solid for lived, faded
   * or outlined for planned.
   */
  actual: boolean;
}

export interface ActiveSession {
  activity: Activity | string;
  startedAt: string;
  blockId?: string | null;
}
