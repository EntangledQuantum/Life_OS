import type {
  AccentThemeId,
  Activity,
  Category,
  GrowthStyle,
  HabitGraphic,
  ImprovementPulse,
  NotificationSoundId,
  QualityFlag,
  RepeatRule,
} from "./constants.js";
import type { GoalCondition } from "./conditions.js";
import type { CardControl } from "./webhooks.js";
import type { Task } from "./tasks.js";
import type { AgendaItem } from "./agenda.js";
import type { LifeDay } from "./time.js";

export type Source = "user" | "agent";

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  category: Category | string;
  frequencyRule: string;
  /**
   * "HH:mm" local, or null for no particular time.
   *
   * A habit with a time is on the timeline for that slot every day, derived
   * from this one row. It used to take a habit *and* a separate task to say
   * that, which gave the user two things to tick for one act and two places for
   * them to disagree.
   */
  scheduledTime: string | null;
  /** How long it takes. Only meaningful with `scheduledTime`. */
  durationMinutes: number | null;
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
  /**
   * Optional art. Both slots empty is the normal case and renders as it always
   * has — the emoji in a tinted square. See `ART_SPEC` for the dimensions.
   */
  iconImageUrl: string | null;
  iconImageData: string | null;
  backgroundImageUrl: string | null;
  backgroundImageData: string | null;
  /** Scrim over the background, 0.35–0.92. Null uses the default. */
  artOverlay: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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

/**
 * One rung of a goal's rarity ladder.
 *
 * A goal used to be a single line: one condition, met or not. That describes a
 * switch, not an achievement — "read 12 books" and "read 50 books" had to be
 * two unrelated goals with two unrelated celebrations, and nothing in the data
 * said the second was the harder version of the first.
 *
 * A tier is the same goal at a different height. Its own condition, its own
 * words, its own art, its own celebration. `rank` orders them from the bottom
 * up: 1 is the one you reach first, and the agent defines them in that order.
 */
export interface GoalTier {
  id: string;
  goalId: string;
  /** 1 = the first rung. Contiguous, ascending, at most `MAX_GOAL_TIERS`. */
  rank: number;
  /** What this rarity is called. The agent's word: "Bronze", "Mythic", "Ten". */
  label: string;
  /** Overrides the goal's title on this rung's card and celebration. */
  title: string | null;
  description: string | null;
  /** The bar for *this* rung. Each rung is a complete condition of its own. */
  condition: GoalCondition | null;
  /** Which celebration plays. See `CELEBRATION_THEMES`. */
  theme: string;
  themeColor: string | null;
  emoji: string | null;
  iconImageUrl: string | null;
  iconImageData: string | null;
  backgroundImageUrl: string | null;
  backgroundImageData: string | null;
  artOverlay: number | null;
  /** Progress toward this rung specifically, 0–100. */
  progressPct: number;
  /** First instant this rung's condition was true. */
  metAt: string | null;
  /** When the user actually watched this rung's celebration. */
  celebrationSeenAt: string | null;
  /** Met but unwitnessed — this rung still owes the user an animation. */
  celebrationPending: boolean;
  conditionDetail: string[];
  createdAt: string;
  updatedAt: string;
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
  /**
   * Optional art, same two slots and the same dimensions as a habit — one
   * picture works in either place.
   */
  iconImageUrl: string | null;
  iconImageData: string | null;
  backgroundImageUrl: string | null;
  backgroundImageData: string | null;
  artOverlay: number | null;
  /**
   * The rarity ladder, lowest rung first. Empty for a goal that is simply done
   * or not done, which stays the normal case.
   */
  tiers: GoalTier[];
  /** The highest rung already reached, or null. */
  currentTier: GoalTier | null;
  /** The rung being worked toward, or null once the top one is reached. */
  nextTier: GoalTier | null;
  /**
   * The lowest rung that has been reached but not yet witnessed — what the
   * celebration should be about. Null when there is nothing to play, and on
   * goals with no ladder, where the goal itself is the celebration.
   */
  pendingTier: GoalTier | null;
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
  /**
   * Minutes before a scheduled thing that you are notified — and the width of
   * the window that puts it on the front page. One number for both, because
   * "you should know about this now" and "this is on your plate now" are the
   * same statement.
   */
  reminderLeadMinutes: number;
  plannedWake: string;
  plannedSleepStart: string;
  plannedSleepEnd: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  /** Global life-day reset HH:mm — stats roll over at this time, not midnight */
  dayResetTime: string;
  /**
   * IANA zone these times are meant in, always resolved — never null on the way
   * out. An agent elsewhere needs it to schedule in the user's day rather than
   * its own; a client on this machine will find it already agrees.
   */
  timezone: string;
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
  /** The exact stretch `date` covers, and the zone it is in. */
  lifeDay: LifeDay;
  /**
   * **Today, as one list.** Habits with a time and tasks with a time, in time
   * order, then everything untimed.
   *
   * This is what the front page renders. `habits` and `tasks` below are still
   * here for the pages that manage them, but a client showing "what is on
   * today" from those two lists is rebuilding this — and will reintroduce the
   * duplicate it exists to remove.
   */
  agenda: AgendaItem[];
  /** The subset with no time on it: a pile to draw from, not a plan. */
  anytime: AgendaItem[];
  /**
   * Every open task. **This is the model.** `cards`, `agentEvents`,
   * `lightReviews` and `studyBlocks` used to be four near-identical lists here;
   * they are one list now, and a client that still asks for them is talking an
   * older protocol and gets a 426 rather than a quietly empty day.
   */
  tasks: Task[];
  /** What is current: inside the lead window, not past its own end. */
  current: Task[];
  /** Notifications that should fire now and have not yet. */
  dueReminders: Task[];
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
  studySessions: StudySession[];
  goals: Goal[];
  quests: Quest[];
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
