import type {
  AccentThemeId,
  Activity,
  Category,
  HabitGraphic,
  ImprovementPulse,
  QualityFlag,
} from "./constants.js";

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
  baseXp: number;
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
  status: "active" | "paused" | "achieved" | "abandoned";
  targetDate: string | null;
  whyItMatters: string | null;
  progressPct: number;
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
  kind: "review" | "task" | "life" | "study" | "reminder" | "other";
  title: string;
  body: string | null;
  link: string | null;
  forDate: string;
  status: "pending" | "done" | "dismissed";
  priority: number;
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
  nurtureStyle: "plant" | "water" | "both";
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
}

export interface GamificationConfig {
  baseMultipliers: {
    inspired: number;
    feynman: number;
    retrieval: number;
    tinyHabit: number;
    fullBlock: number;
  };
  dailyXpTarget: number;
  nurtureStyle: "plant" | "water" | "both";
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
  status: string;
}

export interface ActiveSession {
  activity: Activity | string;
  startedAt: string;
  blockId?: string | null;
}
