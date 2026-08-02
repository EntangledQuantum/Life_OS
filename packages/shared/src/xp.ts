import type { GamificationConfig, QualityFlag } from "./types.js";
import type { ImprovementPulse } from "./constants.js";

export const DEFAULT_GAMIFICATION_CONFIG: GamificationConfig = {
  baseMultipliers: {
    inspired: 1.5,
    feynman: 1.6,
    retrieval: 1.4,
    tinyHabit: 1.1,
    fullBlock: 1.25,
  },
  /** Hermes-editable daily XP target for nurture visuals (water/plant full = 100%) */
  dailyXpTarget: 200,
  /** Nurture visual style for Improvement Pulse card */
  nurtureStyle: "plant",
};

export function awardXpForHabit(opts: {
  baseXp: number;
  isTiny: boolean;
  config?: GamificationConfig;
  fullBlock?: boolean;
}): number {
  const config = opts.config ?? DEFAULT_GAMIFICATION_CONFIG;
  let xp = opts.baseXp;
  if (opts.isTiny) xp = Math.round(xp * config.baseMultipliers.tinyHabit);
  if (opts.fullBlock) xp = Math.round(xp * config.baseMultipliers.fullBlock);
  return Math.max(1, xp);
}

export function awardXpForStudy(
  base: number,
  quality: QualityFlag,
  config: GamificationConfig = DEFAULT_GAMIFICATION_CONFIG,
): number {
  let mult = 1;
  if (quality === "inspired") mult = config.baseMultipliers.inspired;
  else if (quality === "feynman") mult = config.baseMultipliers.feynman;
  else if (quality === "retrieval") mult = config.baseMultipliers.retrieval;
  return Math.max(1, Math.round(base * mult));
}

/** % of today's XP target hit (capped at 100 for fill visuals; raw may exceed). */
export function efficiencyPct(dailyXp: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((dailyXp / target) * 1000) / 10;
}

/** Improvement vs yesterday's efficiency (percentage points). */
export function improvementPct(
  todayEfficiency: number,
  yesterdayEfficiency: number,
): number {
  return Math.round((todayEfficiency - yesterdayEfficiency) * 10) / 10;
}

export function computeImprovementPulse(
  recentConsistency: number[],
  recentXp: number[],
  recentTargets?: number[],
): { pulse: ImprovementPulse; explanation: string } {
  if (recentConsistency.length < 2) {
    return {
      pulse: "Stable",
      explanation: "Not enough history yet — keep logging.",
    };
  }

  const last = recentConsistency[recentConsistency.length - 1] ?? 0;
  const prev = recentConsistency[recentConsistency.length - 2] ?? 0;
  const avg =
    recentConsistency.reduce((a, b) => a + b, 0) / recentConsistency.length;
  const xpToday = recentXp[recentXp.length - 1] ?? 0;
  const xpYday = recentXp[recentXp.length - 2] ?? 0;
  const targetToday =
    recentTargets?.[recentTargets.length - 1] ??
    DEFAULT_GAMIFICATION_CONFIG.dailyXpTarget;
  const effToday = efficiencyPct(xpToday, targetToday);

  if (last >= prev + 8 || (xpToday > xpYday && last >= avg) || effToday >= 100) {
    return {
      pulse: "Improving",
      explanation:
        effToday >= 100
          ? "Today's XP target met — nurture is full."
          : "Consistency and output are trending up vs recent days.",
    };
  }
  if (last < avg - 15 && last < prev) {
    if (last > 0 && last >= prev - 5) {
      return {
        pulse: "Recovering",
        explanation: "You're rebuilding — small steps still count.",
      };
    }
    return {
      pulse: "Drifting",
      explanation: "A quieter stretch. No shame — restart with one tiny habit.",
    };
  }
  if (last < avg - 5 && xpToday >= xpYday * 0.8) {
    return {
      pulse: "Recovering",
      explanation: "Momentum is returning compared to the dip.",
    };
  }
  return {
    pulse: "Stable",
    explanation: "Holding steady relative to your recent baseline.",
  };
}

/**
 * Day key + bounds using a global reset time (e.g. "04:00").
 * Before reset time, still belongs to previous life-day.
 */
export function getDayBounds(resetTime = "00:00", now = new Date()) {
  const [rh, rm] = resetTime.split(":").map(Number);
  const resetH = rh || 0;
  const resetM = rm || 0;

  const cursor = new Date(now);
  const todayReset = new Date(now);
  todayReset.setHours(resetH, resetM, 0, 0);

  // If before today's reset, life-day started yesterday at reset
  let start: Date;
  if (cursor < todayReset) {
    start = new Date(todayReset);
    start.setDate(start.getDate() - 1);
  } else {
    start = todayReset;
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(end.getMilliseconds() - 1);

  const dateStr = lifeDateString(start);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    dateStr,
    resetTime,
  };
}

export function lifeDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** @deprecated use getDayBounds — midnight local only */
export function localDateString(d = new Date()): string {
  return lifeDateString(d);
}

export function yesterdayDateString(d = new Date(), resetTime = "00:00"): string {
  const { start } = getDayBounds(resetTime, d);
  const y = new Date(start);
  y.setDate(y.getDate() - 1);
  return lifeDateString(y);
}
