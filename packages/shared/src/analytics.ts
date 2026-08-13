/**
 * The analytics contract.
 *
 * Lives in shared because both clients read it and the API writes it, and the
 * whole point of the payload is that every series arrives ready to draw — the
 * clients do no arithmetic on it beyond picking colours.
 */
/** One reading of a value that changes over time. */
export interface HistoryPoint {
  at: string;
  value: number;
}

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return (
    typeof value === "string" &&
    (ANALYTICS_RANGES as readonly string[]).includes(value)
  );
}

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
