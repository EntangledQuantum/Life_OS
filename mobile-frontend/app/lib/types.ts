/**
 * Local copies of Life OS payload types.
 * Isolation contract: no imports from packages/* or apps/* — talk over HTTP only.
 * Source of truth: packages/shared/src/types.ts (keep in sync when the API moves).
 */

export type Source = "user" | "agent";
export type ImprovementPulse = "Improving" | "Stable" | "Recovering" | "Drifting";
export type GrowthStyle = "bloom" | "arc" | "rings" | "sprout" | "orb";
export type AccentThemeId = "nebula" | "quantum" | "terminal" | "ember";
export type NotificationSoundId =
  | "chime"
  | "bell"
  | "marimba"
  | "pulse"
  | "alert"
  | "none";
import type { CardStyle } from "./card-style";

export type TaskKind = "task" | "study" | "review" | "reminder";
export type TaskStatus = "active" | "done" | "dismissed";
export type RepeatRule = "none" | "daily" | "weekly" | "spaced";
export type QualityFlag =
  | "normal"
  | "struggle"
  | "inspired"
  | "feynman"
  | "retrieval";
export type Activity =
  | "Deep Work"
  | "Study"
  | "Sleep"
  | "Exercise"
  | "Break"
  | "Life Admin"
  | "Exploration";

export const ACTIVITIES: Activity[] = [
  "Deep Work",
  "Study",
  "Sleep",
  "Exercise",
  "Break",
  "Life Admin",
  "Exploration",
];

export const ACCENT_HUES: Record<AccentThemeId, number> = {
  nebula: 224,
  quantum: 296,
  terminal: 150,
  ember: 38,
};

export const NOTIFICATION_SOUNDS: {
  id: NotificationSoundId;
  label: string;
  description: string;
}[] = [
  { id: "chime", label: "Chime", description: "Two rising notes." },
  { id: "bell", label: "Bell", description: "A single struck bell." },
  { id: "marimba", label: "Marimba", description: "Three soft wooden notes." },
  { id: "pulse", label: "Pulse", description: "Two low blips." },
  { id: "alert", label: "Alert", description: "Insistent and hard to miss." },
  { id: "none", label: "Silent", description: "Visual only." },
];

export interface HabitWithToday {
  id: string;
  name: string;
  emoji: string;
  category: string;
  frequencyRule: string;
  /**
   * "HH:mm" local, or null for no particular time.
   *
   * A habit with a time is on the timeline for that slot every day, from this
   * one row. It used to take a habit *and* a task to say that, which gave two
   * things to tick for one act.
   */
  scheduledTime: string | null;
  durationMinutes: number | null;
  preferredTimeWindow: string | null;
  anchor: string | null;
  linkedGoalId: string | null;
  isTiny: boolean;
  baseXp: number;
  extraXp: number;
  xpWeight: number;
  active: boolean;
  notes: string | null;
  themeColor: string;
  completedToday: boolean;
  todayLogId: string | null;
  currentStreak: number;
  longestStreak: number;
  history7: boolean[];
  totalCompletions: number;
}

/** A link the agent attached — a chapter, a paper, a video. */
export interface TaskResource {
  label: string;
  url: string;
  /** Free-form icon hint: "book", "video", "paper", "link". */
  kind?: string;
}

/**
 * The only unit of work in Life OS, alongside habits.
 *
 * Cards, agent events, light reviews and study blocks were four tables that
 * meant the same thing and supported different fields; they are one row now.
 * Every optional part — a time, a repeat, XP, links, a card presentation — is
 * a nullable field here.
 *
 * A task never starts. It has a target time and a completion, and completing it
 * does not change what activity you are in.
 */
export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  subtitle: string | null;
  /** Long form — instructions, a chapter list, what to actually do. */
  body: string | null;
  purpose: string | null;

  status: TaskStatus;
  activityTag: Activity | string | null;

  showAt: string | null;
  eventAt: string | null;
  durationMinutes: number | null;
  /** Explicit override; normally derived from eventAt minus the user's lead. */
  remindAt: string | null;
  notifiedAt: string | null;

  repeatRule: RepeatRule;
  repeatIndex: number;
  repeatOffsetsDays: number[] | null;

  xpOnComplete: number;
  webhookOnComplete: boolean;
  webhookOnInteract: boolean;

  /** The habit this task is about, if any. A pointer — neither completes the other. */
  habitId: string | null;
  /** The scheduled task this card explains. Same rule: a pointer, not a coupling. */
  linkedTaskId: string | null;
  /** Layout and paint for a pinned card. Null renders as cards always have. */
  cardStyle: CardStyle | null;
  /** Links and references. What a "study block" always was underneath. */
  resources: TaskResource[];

  /** Pinned to a front-page card slot (0 or 1). Null = not pinned. */
  slot: 0 | 1 | null;
  emoji: string | null;
  themeColor: string | null;
  imageUrl: string | null;
  imageData: string | null;
  svg: string | null;
  ctaLabel: string | null;
  ctaLink: string | null;
  control: CardControl | null;

  progress: number;
  sound: boolean;
  flash: boolean;

  source: Source;
  meta: Record<string, unknown> | null;

  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Is this task drawn as a card on the front page? */
export function isPinned(task: Pick<Task, "slot">): boolean {
  return task.slot === 0 || task.slot === 1;
}

/**
 * The agent status strip — "Hermes connected". It is a task only because
 * everything is; it has no completion and holds no slot.
 */
export function isAgentStatus(task: Pick<Task, "meta">): boolean {
  return Boolean(task.meta && "connected" in task.meta);
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: "active" | "paused" | "achieved" | "abandoned";
  targetDate: string | null;
  whyItMatters: string | null;
  progressPct: number;
  ownerKind: "agent" | "user";
  conditionMetAt: string | null;
  celebrationSeenAt: string | null;
  celebrationPending: boolean;
  conditionDetail: string[];
  emoji: string;
  themeColor: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProperty {
  uid: string;
  key: string;
  label: string;
  kind: "counter" | "number" | "text" | "json";
  value: number | null;
  textValue: string | null;
  unit: string | null;
  description: string | null;
}

export interface UserProgress {
  totalXp: number;
  dailyXp: number;
  dailyXpTarget: number;
  efficiencyPct: number;
  improvementPct: number;
  yesterdayEfficiencyPct: number;
  lastImprovementPulse: ImprovementPulse;
  growthStyle: GrowthStyle;
}

/**
 * `GET/PATCH /api/v1/gamification/config`. Separate from AppSettings on
 * purpose — this is the XP model, not display preferences.
 */
export interface GamificationConfig {
  dailyXpTarget: number;
  growthStyle: GrowthStyle;
  baseMultipliers: {
    inspired: number;
    feynman: number;
    retrieval: number;
    tinyHabit: number;
    fullBlock: number;
  };
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
  notificationSound: NotificationSoundId;
  doNotDisturb: boolean;
  quietHoursSilent: boolean;
  /**
   * Minutes before a scheduled thing that you are notified — and the window
   * that puts it in Quick log. One number for both.
   */
  reminderLeadMinutes: number;
  plannedWake: string;
  plannedSleepStart: string;
  plannedSleepEnd: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  dayResetTime: string;
  storageMode: "local" | "supabase";
  backupsEnabled: boolean;
  backupIntervalHours: number;
  backupKeep: number;
  lastBackupAt: string | null;
}

export interface VsMetric {
  today: number;
  yesterday: number;
  delta: number;
}

export interface VsYesterday {
  habitsCompleted: VsMetric;
  xpEarned: VsMetric;
  studyMinutes: VsMetric;
  sleepScore: {
    today: number | null;
    yesterday: number | null;
    delta: number | null;
  };
  efficiency: VsMetric;
}

/**
 * An agent-placed widget on a card. Mirrors `CardControl` in the shared
 * package — this client does not import from the monorepo (see AGENTS.md), so
 * the contract is restated rather than shared.
 */
export type CardControl =
  | {
      kind: "slider";
      label: string;
      min: number;
      max: number;
      step?: number;
      value: number;
      unit?: string;
    }
  | { kind: "button"; label: string; pressedAt?: string | null };

export interface TimelineBlock {
  id: string;
  category: string;
  label: string;
  startHour: number;
  endHour: number;
  color: string;
  status: string;
  /**
   * True behind the now-marker — this is what you actually did, from the
   * activity log. False ahead of it, where the ribbon is only the plan. The two
   * must be drawn differently or the day reads as already lived.
   */
  actual: boolean;
}

/* ------------------------------------------------------------- agenda */

export type AgendaSource = "habit" | "task";

export type AgendaState = "upcoming" | "now" | "done" | "overdue" | "anytime";

/**
 * One row of today, whatever table it came from.
 *
 * Habits and scheduled tasks were rendered as two lists, which is what made it
 * reasonable for an agent to create one of each for the same act. `source` says
 * which record a tick lands on.
 */
export interface AgendaItem {
  id: string;
  source: AgendaSource;
  refId: string;
  title: string;
  subtitle: string | null;
  emoji: string | null;
  activityTag: string | null;
  kind: TaskKind | null;
  at: string | null;
  durationMinutes: number | null;
  startHour: number | null;
  endHour: number | null;
  state: AgendaState;
  done: boolean;
  xp: number;
  streak: number | null;
  /** The habit this row concerns — itself for a habit, the link for a task. */
  habitId: string | null;
  themeColor: string | null;
}

/** The exact stretch a life-day covers, and the zone it is in. */
export interface LifeDay {
  lifeDay: string;
  lifeDayStart: string;
  lifeDayEnd: string;
  dayResetTime: string;
  timezone: string;
}

export interface DashboardToday {
  date: string;
  dayResetTime: string;
  lifeDay: LifeDay;
  /** Today as one list — this is what the home screen renders. */
  agenda: AgendaItem[];
  /** The untimed subset: a pile to draw from, not a plan. */
  anytime: AgendaItem[];
  /** Every open task. This is the model — there is nothing else alongside it. */
  tasks: Task[];
  /** What is current: inside the lead window, not past its own end. */
  current: Task[];
  /** Notifications that should fire now and have not yet. */
  dueReminders: Task[];
  pendingCelebrations: Goal[];
  properties: AgentProperty[];
  habits: HabitWithToday[];
  progress: UserProgress;
  vsYesterday: VsYesterday;
  pulse: ImprovementPulse;
  pulseExplanation: string;
  studySessions: unknown[];
  goals: Goal[];
  quests: unknown[];
  achievements: unknown[];
  consistency7: { date: string; pct: number }[];
  xpSeries7: { date: string; current: number; target: number }[];
  activeSession: {
    activity: Activity | string;
    startedAt: string;
    blockId?: string | null;
  } | null;
  timeline: TimelineBlock[];
}

/**
 * What the server sends back on a 426. The app is older than the API and no
 * amount of retrying will fix it — the only move is to install a new build.
 */
export interface ProtocolMismatch {
  error: string;
  hint: string;
  clientProtocol: number;
  serverProtocol: number;
  minProtocol: number;
  downloadUrl: string;
}

/*
 * The analytics contract, restated.
 *
 * This client does not import from the monorepo (see AGENTS.md), so the shape
 * is copied rather than shared. Source of truth: packages/shared/src/analytics.ts
 */
/** One reading of a value that changes over time. */
export interface HistoryPoint {
  at: string;
  value: number;
}

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export interface AnalyticsPayload {
  range: AnalyticsRange;
  /** First day included, `YYYY-MM-DD`. */
  from: string;
  /** XP and efficiency against their target, one point per day. */
  daily: {
    date: string;
    xp: number;
    xpTarget: number;
    efficiencyPct: number;
    /** 100 — the line efficiency is measured against. */
    efficiencyTarget: number;
    habitsCompleted: number;
    habitsPossible: number;
    consistencyPct: number;
    studyMinutes: number;
  }[];
  /** Per-habit completion rate over the window, hardest-carrying first. */
  habits: {
    id: string;
    name: string;
    emoji: string;
    themeColor: string;
    /** Days completed ÷ days the habit existed and was active. */
    ratePct: number;
    completions: number;
    daysPossible: number;
    currentStreak: number;
    /** One entry per day in the window: completed or not. */
    history: { date: string; done: boolean }[];
  }[];
  /** Scheduled vs completed, and how much was completed late. */
  adherence: {
    scheduled: number;
    completed: number;
    completedLate: number;
    dismissed: number;
    /** Completed ÷ scheduled, as a percentage. */
    ratePct: number;
    byDay: { date: string; scheduled: number; completed: number }[];
  };
  study: {
    totalMinutes: number;
    sessions: number;
    byDay: { date: string; minutes: number; sessions: number }[];
  };
  /** Every agent counter and how it moved. */
  properties: {
    uid: string;
    key: string;
    label: string;
    unit: string | null;
    current: number | null;
    /** Change across the window. Null when there is nothing to compare to. */
    delta: number | null;
    series: HistoryPoint[];
  }[];
  /** Goal progression curves. */
  goals: {
    id: string;
    title: string;
    emoji: string;
    themeColor: string;
    progressPct: number;
    status: string;
    series: HistoryPoint[];
  }[];
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  storage: string;
  host?: string;
  lan?: boolean;
}
