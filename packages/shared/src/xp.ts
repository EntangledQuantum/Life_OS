import type { GamificationConfig } from "./types.js";
import type { ImprovementPulse, QualityFlag } from "./constants.js";

export const DEFAULT_GAMIFICATION_CONFIG: GamificationConfig = {
  baseMultipliers: {
    inspired: 1.5,
    feynman: 1.6,
    retrieval: 1.4,
    tinyHabit: 1.1,
    fullBlock: 1.25,
  },
  /**
   * Fixed daily XP pool for habit completions (agent-editable).
   * Adding a habit does NOT increase this — base XP is redistributed by weight.
   */
  dailyXpTarget: 200,
  /** Growth-meter visual: sprout | orb */
  growthStyle: "sprout",
};

/**
 * Machine-readable description of the XP system, served at
 * `GET /api/v1/agent/xp-model` so agents can discover the rules instead of
 * guessing. Keep in sync with the maths below and with the agent skill.
 */
export const XP_MODEL_DOC = {
  summary:
    "A fixed daily XP pool is redistributed across active habits by weight. " +
    "Completing everything lands you at ~100% efficiency. Adding habits never " +
    "inflates the pool — it only re-slices it.",
  pool: {
    field: "dailyXpTarget",
    default: DEFAULT_GAMIFICATION_CONFIG.dailyXpTarget,
    setVia: "PATCH /api/v1/gamification/config",
    note: "This is the ONLY way to change the size of the pool.",
  },
  redistribution: {
    formula: "habit.baseXp = floor(dailyXpTarget * habit.xpWeight / sum(xpWeight of active habits))",
    remainder: "The last habit absorbs the rounding remainder so shares sum to dailyXpTarget.",
    triggers: [
      "POST /api/v1/habits (unless redistribute:false)",
      "DELETE /api/v1/habits/:id",
      "PATCH /api/v1/habits/:id when xpWeight, extraXp, or active changes",
      "PATCH /api/v1/gamification/config when dailyXpTarget changes",
      "POST /api/v1/habits/rebalance-xp (explicit)",
    ],
  },
  award: {
    habit:
      "xp = round(baseXp * tinyHabit? * fullBlock?) + extraXp  — extraXp is a bonus OUTSIDE the pool",
    card: "xp = card.xpOnComplete — a bonus outside the pool",
    event: "xp = event.xpOnComplete (default 0) — a bonus outside the pool",
    study: "xp = round(base * qualityMultiplier) using inspired/feynman/retrieval",
    floor: "Every award is clamped to a minimum of 1 XP.",
  },
  scoring: {
    efficiencyPct: "todayXpEarned / dailyXpTarget * 100 (can exceed 100 via bonuses)",
    improvementPct: "todayEfficiency - yesterdayEfficiency, in percentage points",
    levels: "None. Life OS has no levels and no social comparison — only you vs yesterday.",
  },
  pitfalls: [
    "Creating a habit with redistribute:false leaves baseXp uneven across habits.",
    "extraXp makes >100% efficiency reachable; that is intentional, not a bug.",
    "Raising habit count does not raise dailyXpTarget — PATCH the config if you want a bigger day.",
  ],
} as const;

/**
 * Redistribute daily pool across active habits by weight.
 * extraXp is NOT taken from the pool — it's awarded on top of baseXp.
 * Returns map habitId → baseXp share (sums ≈ dailyXpTarget).
 */
export function redistributeDailyXp(habits: {
  id: string;
  xpWeight?: number;
  active?: boolean;
}[], dailyXpTarget: number): Map<string, number> {
  const active = habits.filter((h) => h.active !== false);
  const out = new Map<string, number>();
  if (active.length === 0 || dailyXpTarget <= 0) return out;

  const weights = active.map((h) => Math.max(1, h.xpWeight ?? 1));
  const totalW = weights.reduce((a, b) => a + b, 0);
  let assigned = 0;
  active.forEach((h, i) => {
    const isLast = i === active.length - 1;
    const share = isLast
      ? Math.max(1, dailyXpTarget - assigned)
      : Math.max(1, Math.floor((dailyXpTarget * weights[i]!) / totalW));
    out.set(h.id, share);
    assigned += share;
  });
  return out;
}

export function awardXpForHabit(opts: {
  baseXp: number;
  extraXp?: number;
  isTiny: boolean;
  config?: GamificationConfig;
  fullBlock?: boolean;
}): number {
  const config = opts.config ?? DEFAULT_GAMIFICATION_CONFIG;
  let xp = opts.baseXp;
  if (opts.isTiny) xp = Math.round(xp * config.baseMultipliers.tinyHabit);
  if (opts.fullBlock) xp = Math.round(xp * config.baseMultipliers.fullBlock);
  xp += Math.max(0, opts.extraXp ?? 0);
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
          ? "Today's XP target met — growth is full."
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
