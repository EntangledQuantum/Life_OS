/**
 * Local copies of Life OS payload types.
 * Isolation contract: no imports from packages/* or apps/* — talk over HTTP only.
 * Source of truth: packages/shared/src/types.ts (keep in sync when the API moves).
 */

export type Source = "user" | "agent";
export type ImprovementPulse = "Improving" | "Stable" | "Recovering" | "Drifting";
export type GrowthStyle = "sprout" | "orb";
export type AccentThemeId = "nebula" | "quantum" | "terminal" | "ember";
export type NotificationSoundId =
  | "chime"
  | "bell"
  | "marimba"
  | "pulse"
  | "alert"
  | "none";
export type CardKind = "task" | "agent-setup" | "event" | "reminder";
export type CardSlot = -1 | 0 | 1 | 2;
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

export interface DashboardCard {
  id: string;
  slot: CardSlot;
  kind: CardKind;
  purpose: string | null;
  activityTag: Activity | string | null;
  showAt: string | null;
  remindAt: string | null;
  eventAt: string | null;
  durationMinutes: number | null;
  repeatRule: RepeatRule;
  repeatIndex: number;
  sound: boolean;
  flash: boolean;
  notifiedAt: string | null;
  linkedBlockId: string | null;
  title: string;
  subtitle: string | null;
  body: string | null;
  emoji: string | null;
  themeColor: string | null;
  imageUrl: string | null;
  imageData: string | null;
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

export interface AgentEvent {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  forDate: string;
  status: "pending" | "done" | "dismissed";
  priority: number;
  xpOnComplete: number;
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

export interface TimelineBlock {
  id: string;
  category: string;
  label: string;
  startHour: number;
  endHour: number;
  color: string;
  status: string;
}

export interface DashboardToday {
  date: string;
  dayResetTime: string;
  cards: DashboardCard[];
  upcoming: DashboardCard[];
  scheduled: DashboardCard[];
  dueReminders: DashboardCard[];
  pendingCelebrations: Goal[];
  properties: AgentProperty[];
  habits: HabitWithToday[];
  progress: UserProgress;
  vsYesterday: VsYesterday;
  pulse: ImprovementPulse;
  pulseExplanation: string;
  studyBlocks: unknown[];
  studySessions: unknown[];
  goals: Goal[];
  quests: unknown[];
  lightReviews: LightReview[];
  agentEvents: AgentEvent[];
  pendingEventCount: number;
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

export interface HealthResponse {
  ok: boolean;
  service: string;
  storage: string;
  host?: string;
  lan?: boolean;
}
