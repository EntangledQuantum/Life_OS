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
