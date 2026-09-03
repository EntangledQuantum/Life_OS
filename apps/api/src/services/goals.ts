import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  CELEBRATION_THEMES,
  MAX_GOAL_TIERS,
  evaluateCondition,
  parseGoalCondition,
  type CelebrationTheme,
  type Goal,
  type GoalCondition,
  type GoalFactResolver,
  type GoalMetric,
  type GoalTier,
  type GoalWindow,
} from "@life-os/shared";
import { computeStreaks, getDayResetTime, nowIso } from "./helpers.js";
import { recordGoalProgress } from "./history.js";
import { propertyNumber } from "./properties.js";
import { fireAgentWebhook } from "./webhook.js";

type Row = typeof schema.goals.$inferSelect;
type TierRow = typeof schema.goalTiers.$inferSelect;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapTier(row: TierRow): GoalTier {
  const metAt = row.metAt ?? null;
  const celebrationSeenAt = row.celebrationSeenAt ?? null;
  return {
    id: row.id,
    goalId: row.goalId,
    rank: row.rank,
    label: row.label,
    title: row.title ?? null,
    description: row.description ?? null,
    condition: parseJson<GoalCondition | null>(row.conditionJson, null),
    theme: row.theme ?? "spark",
    themeColor: row.themeColor ?? null,
    emoji: row.emoji ?? null,
    iconImageUrl: row.iconImageUrl ?? null,
    iconImageData: row.iconImageData ?? null,
    backgroundImageUrl: row.backgroundImageUrl ?? null,
    backgroundImageData: row.backgroundImageData ?? null,
    artOverlay: row.artOverlay ?? null,
    progressPct: row.progressPct ?? 0,
    metAt,
    celebrationSeenAt,
    // Same rule as a goal: met but unwitnessed is not finished.
    celebrationPending: Boolean(metAt) && !celebrationSeenAt,
    conditionDetail: parseJson<string[]>(row.conditionDetailJson, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A goal's rungs, always lowest first — every consumer depends on that order. */
export function listTiers(db: LifeOsDb, goalId: string): GoalTier[] {
  return db
    .select()
    .from(schema.goalTiers)
    .where(eq(schema.goalTiers.goalId, goalId))
    .all()
    .map(mapTier)
    .sort((a, b) => a.rank - b.rank);
}

function mapGoal(row: Row, tiers: GoalTier[] = []): Goal {
  const conditionMetAt = row.conditionMetAt ?? null;
  const celebrationSeenAt = row.celebrationSeenAt ?? null;
  /*
   * The rung the user is standing on, and the one above it. Derived rather
   * than stored: two fields that must agree with the tier rows are two fields
   * that can disagree with them.
   */
  const reached = tiers.filter((t) => t.metAt);
  const currentTier = reached.length > 0 ? reached[reached.length - 1]! : null;
  const nextTier = tiers.find((t) => !t.metAt) ?? null;
  /* Lowest first: a ladder is climbed in order, and so are its celebrations. */
  const pendingTier = tiers.find((t) => t.celebrationPending) ?? null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as Goal["status"],
    targetDate: row.targetDate,
    whyItMatters: row.whyItMatters,
    progressPct: row.progressPct,
    ownerKind: (row.ownerKind as Goal["ownerKind"]) ?? "agent",
    condition: parseJson<GoalCondition | null>(row.conditionJson, null),
    autoCheck: row.autoCheck ?? true,
    conditionMetAt,
    celebrationSeenAt,
    /*
     * The whole point: met but unwitnessed is *not* finished.
     *
     * On a tiered goal the rungs own this — the goal itself is only pending
     * once the top rung has been witnessed, which is what makes a five-tier
     * goal play five celebrations instead of one.
     */
    celebrationPending:
      tiers.length > 0
        ? tiers.some((t) => t.celebrationPending)
        : Boolean(conditionMetAt) && !celebrationSeenAt,
    conditionDetail: parseJson<string[]>(row.conditionDetailJson, []),
    emoji: row.emoji ?? "🎯",
    themeColor: row.themeColor ?? "#A78BFA",
    iconImageUrl: row.iconImageUrl ?? null,
    iconImageData: row.iconImageData ?? null,
    backgroundImageUrl: row.backgroundImageUrl ?? null,
    backgroundImageData: row.backgroundImageData ?? null,
    artOverlay: row.artOverlay ?? null,
    tiers,
    currentTier,
    nextTier,
    pendingTier,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * What an agent sends for one rung.
 *
 * `rank` is optional: the array order *is* the ladder, bottom first, which is
 * the thing agents get right without being told. A supplied rank is honoured so
 * a ladder can be written out of order, but the ranks that land in the database
 * are always 1..n, contiguous.
 */
export interface TierInput {
  rank?: number;
  label: string;
  title?: string | null;
  description?: string | null;
  condition?: GoalCondition | null;
  theme?: string;
  themeColor?: string | null;
  emoji?: string | null;
  iconImageUrl?: string | null;
  iconImageData?: string | null;
  backgroundImageUrl?: string | null;
  backgroundImageData?: string | null;
  artOverlay?: number | null;
}

/** Shared by goals, habits and tiers — a scrim you cannot read through is a bug. */
function clampOverlay(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(0.92, Math.max(0.35, n));
}

/**
 * Reject a ladder that cannot mean anything, before any of it is written.
 *
 * A bad *style* field on a card is dropped silently because the style is
 * decoration. A tier is not decoration — it is the definition of what counts as
 * having got there — so a ladder that is malformed comes back as an error the
 * agent can read and fix, rather than half-applied.
 */
function validateTiers(tiers: TierInput[]): string | null {
  if (tiers.length > MAX_GOAL_TIERS) {
    return `A goal can have at most ${MAX_GOAL_TIERS} tiers; got ${tiers.length}. Five rungs is the limit on purpose — more is a progress bar, not a set of rarities.`;
  }
  const seen = new Set<number>();
  for (const [i, tier] of tiers.entries()) {
    const at = `tier ${i + 1}`;
    if (!tier.label || !tier.label.trim()) {
      return `${at}: every tier needs a label — the word for this rarity.`;
    }
    if (tier.rank !== undefined) {
      if (!Number.isInteger(tier.rank) || tier.rank < 1 || tier.rank > MAX_GOAL_TIERS) {
        return `${at}: rank must be a whole number from 1 to ${MAX_GOAL_TIERS}.`;
      }
      if (seen.has(tier.rank)) return `${at}: two tiers claim rank ${tier.rank}.`;
      seen.add(tier.rank);
    }
    if (
      tier.theme &&
      !(CELEBRATION_THEMES as readonly string[]).includes(tier.theme)
    ) {
      return `${at}: unknown theme "${tier.theme}". One of: ${CELEBRATION_THEMES.join(", ")}.`;
    }
    if (tier.condition) {
      const parsed = parseGoalCondition(tier.condition);
      if (!parsed.ok) {
        return `${at} (${tier.label}): invalid condition — ${parsed.errors.join("; ")}`;
      }
    }
  }
  if (seen.size > 0 && seen.size !== tiers.length) {
    return "Either give every tier a rank or none of them — a half-ranked ladder has no defined order.";
  }
  return null;
}

/**
 * Replace a goal's ladder.
 *
 * Replace, not merge, because a ladder is one object: rungs are defined
 * relative to each other, and patching rung 3 of a ladder the agent no longer
 * remembers is how you end up with "Gold" below "Bronze".
 *
 * What survives a rewrite is what the *user* did: a rung that was already
 * reached, at the same rank and label, keeps its `metAt` and
 * `celebrationSeenAt`. Rewriting the wording of a tier someone earned last
 * month must not make them earn it again, and must not replay its celebration.
 */
function writeTiers(db: LifeOsDb, goalId: string, tiers: TierInput[]): void {
  const previous = listTiers(db, goalId);
  const now = nowIso();

  db.delete(schema.goalTiers).where(eq(schema.goalTiers.goalId, goalId)).run();
  if (tiers.length === 0) return;

  const ordered = tiers.every((t) => t.rank !== undefined)
    ? [...tiers].sort((a, b) => a.rank! - b.rank!)
    : tiers;

  ordered.forEach((tier, index) => {
    const rank = index + 1;
    // Same rung, same name: the user's history at that rung is theirs to keep.
    const carried = previous.find((p) => p.rank === rank && p.label === tier.label);
    db.insert(schema.goalTiers)
      .values({
        id: carried?.id ?? nanoid(),
        goalId,
        rank,
        label: tier.label.trim(),
        title: tier.title ?? null,
        description: tier.description ?? null,
        conditionJson: tier.condition ? JSON.stringify(tier.condition) : null,
        theme: ((tier.theme ?? "spark") as CelebrationTheme),
        themeColor: tier.themeColor ?? null,
        emoji: tier.emoji ?? null,
        iconImageUrl: tier.iconImageUrl ?? null,
        iconImageData: tier.iconImageData ?? null,
        backgroundImageUrl: tier.backgroundImageUrl ?? null,
        backgroundImageData: tier.backgroundImageData ?? null,
        artOverlay: clampOverlay(tier.artOverlay),
        progressPct: carried?.progressPct ?? 0,
        metAt: carried?.metAt ?? null,
        celebrationSeenAt: carried?.celebrationSeenAt ?? null,
        conditionDetailJson: carried
          ? JSON.stringify(carried.conditionDetail)
          : null,
        createdAt: carried?.createdAt ?? now,
        updatedAt: now,
      })
      .run();
  });
}

export function listGoals(db: LifeOsDb): Goal[] {
  /*
   * One read of every rung rather than one query per goal. A dashboard poll
   * lists goals on every tick, and N+1 against SQLite in-process is cheap but
   * pointless.
   */
  const allTiers = db.select().from(schema.goalTiers).all().map(mapTier);
  const byGoal = new Map<string, GoalTier[]>();
  for (const tier of allTiers) {
    const list = byGoal.get(tier.goalId) ?? [];
    list.push(tier);
    byGoal.set(tier.goalId, list);
  }
  for (const list of byGoal.values()) list.sort((a, b) => a.rank - b.rank);

  return db
    .select()
    .from(schema.goals)
    .all()
    .map((row) => mapGoal(row, byGoal.get(row.id) ?? []));
}

export function getGoal(db: LifeOsDb, id: string): Goal | null {
  const row = db.select().from(schema.goals).where(eq(schema.goals.id, id)).get();
  return row ? mapGoal(row, listTiers(db, id)) : null;
}

/** Goals whose condition is true but whose celebration nobody has watched yet. */
export function pendingCelebrations(db: LifeOsDb): Goal[] {
  return listGoals(db).filter((g) => g.celebrationPending);
}

export function createGoal(
  db: LifeOsDb,
  input: {
    title: string;
    description?: string | null;
    status?: "active" | "paused" | "abandoned";
    targetDate?: string | null;
    whyItMatters?: string | null;
    progressPct?: number;
    linkedHabitIds?: string[];
    ownerKind?: "agent" | "user";
    condition?: GoalCondition | null;
    autoCheck?: boolean;
    emoji?: string;
    themeColor?: string;
    iconImageUrl?: string | null;
    iconImageData?: string | null;
    backgroundImageUrl?: string | null;
    backgroundImageData?: string | null;
    artOverlay?: number | null;
    /** The rarity ladder, bottom rung first. Optional; most goals have none. */
    tiers?: TierInput[];
  },
): { goal: Goal } | { error: string } {
  if (input.tiers) {
    const problem = validateTiers(input.tiers);
    if (problem) return { error: problem };
  }
  if (input.condition) {
    const parsed = parseGoalCondition(input.condition);
    if (!parsed.ok) {
      return { error: `Invalid condition: ${parsed.errors.join("; ")}` };
    }
  }

  const id = nanoid();
  const now = nowIso();
  db.insert(schema.goals)
    .values({
      id,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "active",
      targetDate: input.targetDate ?? null,
      whyItMatters: input.whyItMatters ?? null,
      progressPct: input.progressPct ?? 0,
      ownerKind: input.ownerKind ?? "agent",
      conditionJson: input.condition ? JSON.stringify(input.condition) : null,
      autoCheck: input.autoCheck ?? true,
      conditionMetAt: null,
      celebrationSeenAt: null,
      conditionDetailJson: null,
      emoji: input.emoji ?? "🎯",
      themeColor: input.themeColor ?? "#A78BFA",
      iconImageUrl: input.iconImageUrl ?? null,
      iconImageData: input.iconImageData ?? null,
      backgroundImageUrl: input.backgroundImageUrl ?? null,
      backgroundImageData: input.backgroundImageData ?? null,
      artOverlay: clampOverlay(input.artOverlay),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  if (input.tiers?.length) writeTiers(db, id, input.tiers);

  for (const hid of input.linkedHabitIds ?? []) {
    db.insert(schema.goalHabitLinks)
      .values({ id: nanoid(), goalId: id, habitId: hid })
      .run();
  }

  // Evaluate straight away: a goal whose bar is already cleared should not have
  // to wait for the next unrelated write to notice.
  evaluateGoals(db);
  return { goal: getGoal(db, id)! };
}

export function updateGoal(
  db: LifeOsDb,
  id: string,
  input: Partial<{
    title: string;
    description: string | null;
    status: "active" | "paused" | "abandoned";
    targetDate: string | null;
    whyItMatters: string | null;
    progressPct: number;
    ownerKind: "agent" | "user";
    condition: GoalCondition | null;
    autoCheck: boolean;
    emoji: string;
    themeColor: string;
    iconImageUrl: string | null;
    iconImageData: string | null;
    backgroundImageUrl: string | null;
    backgroundImageData: string | null;
    artOverlay: number | null;
    /** Replaces the whole ladder. `[]` removes it. Omit to leave it alone. */
    tiers: TierInput[];
  }>,
): Goal | { error: string } | null {
  const existing = db.select().from(schema.goals).where(eq(schema.goals.id, id)).get();
  if (!existing) return null;

  const { condition, tiers, artOverlay, ...rest } = input;
  if (tiers !== undefined) {
    const problem = validateTiers(tiers);
    if (problem) return { error: problem };
  }
  let conditionPatch: { conditionJson: string | null } | Record<string, never> = {};
  if (condition !== undefined) {
    if (condition === null) {
      conditionPatch = { conditionJson: null };
    } else {
      const parsed = parseGoalCondition(condition);
      if (!parsed.ok) {
        return { error: `Invalid condition: ${parsed.errors.join("; ")}` };
      }
      conditionPatch = { conditionJson: JSON.stringify(condition) };
    }
  }

  db.update(schema.goals)
    .set({
      ...rest,
      ...conditionPatch,
      ...(artOverlay !== undefined ? { artOverlay: clampOverlay(artOverlay) } : {}),
      updatedAt: nowIso(),
    })
    .where(eq(schema.goals.id, id))
    .run();

  if (tiers !== undefined) writeTiers(db, id, tiers);

  evaluateGoals(db);
  return getGoal(db, id);
}

export function deleteGoal(db: LifeOsDb, id: string) {
  db.delete(schema.goalTiers).where(eq(schema.goalTiers.goalId, id)).run();
  db.delete(schema.goalHabitLinks).where(eq(schema.goalHabitLinks.goalId, id)).run();
  db.delete(schema.goals).where(eq(schema.goals.id, id)).run();
  return { ok: true };
}

/**
 * Witness one rung.
 *
 * The top rung is the goal: claiming it finishes the whole thing, sets
 * `achieved` and fires `goal.achieved`, exactly as a goal with no ladder does
 * when its single condition is claimed. Every rung below it fires `goal.tier`
 * and leaves the goal running — that is the point of a ladder.
 */
function claimTier(db: LifeOsDb, goal: Goal, tier: GoalTier) {
  const now = nowIso();
  db.update(schema.goalTiers)
    .set({ celebrationSeenAt: tier.celebrationSeenAt ?? now, updatedAt: now })
    .where(eq(schema.goalTiers.id, tier.id))
    .run();

  const isTop = tier.rank === goal.tiers[goal.tiers.length - 1]?.rank;
  if (isTop) {
    db.update(schema.goals)
      .set({
        conditionMetAt: goal.conditionMetAt ?? tier.metAt ?? now,
        celebrationSeenAt: goal.celebrationSeenAt ?? now,
        status: "achieved",
        progressPct: 100,
        updatedAt: now,
      })
      .where(eq(schema.goals.id, goal.id))
      .run();
  }

  const after = getGoal(db, goal.id)!;
  const claimed = after.tiers.find((t) => t.id === tier.id)!;

  void fireAgentWebhook(db, "goal.tier", {
    goal: after,
    title: after.title,
    tier: claimed,
    tierLabel: claimed.label,
    tierRank: claimed.rank,
    isTopTier: isTop,
  });
  if (isTop) {
    void fireAgentWebhook(db, "goal.achieved", { goal: after, title: after.title });
  }

  return { goal: after };
}

/**
 * Mark the celebration as witnessed — the only path to `achieved`.
 * Until this is called the goal stays active no matter how true its condition is.
 */
export function markCelebrationSeen(db: LifeOsDb, id: string, tierId?: string) {
  const goal = getGoal(db, id);
  if (!goal) return null;

  /*
   * A tiered goal is claimed one rung at a time.
   *
   * `tierId` is optional, and omitting it claims the lowest rung still owed —
   * which is what a client that predates tiers does, so an old build walks the
   * ladder correctly one celebration per claim instead of skipping to the top.
   */
  if (goal.tiers.length > 0) {
    const tier = tierId
      ? goal.tiers.find((t) => t.id === tierId)
      : goal.tiers.find((t) => t.celebrationPending);
    if (!tier) {
      return { error: "No tier is waiting to be celebrated" as const };
    }
    if (!tier.metAt) {
      return { error: `"${tier.label}" has not been reached yet — nothing to celebrate` as const };
    }
    return claimTier(db, goal, tier);
  }

  if (!goal.conditionMetAt) {
    return { error: "Goal condition has not been met yet — nothing to celebrate" as const };
  }
  const now = nowIso();
  db.update(schema.goals)
    .set({
      celebrationSeenAt: goal.celebrationSeenAt ?? now,
      status: "achieved",
      progressPct: 100,
      updatedAt: now,
    })
    .where(eq(schema.goals.id, id))
    .run();

  const achieved = getGoal(db, id)!;
  /*
   * Fired here rather than when the condition first evaluated true: a goal is
   * not finished until the user has actually seen the celebration, and telling
   * the agent "achieved" before that would have it congratulate them for
   * something they have not been shown yet.
   */
  void fireAgentWebhook(db, "goal.achieved", {
    goal: achieved,
    title: achieved.title,
  });

  return { goal: achieved };
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function windowStart(window: GoalWindow, now = new Date()): number {
  const d = new Date(now.getTime());
  switch (window) {
    case "7d":
      d.setDate(d.getDate() - 7);
      return d.getTime();
    case "30d":
      d.setDate(d.getDate() - 30);
      return d.getTime();
    case "90d":
      d.setDate(d.getDate() - 90);
      return d.getTime();
    case "year":
      d.setFullYear(d.getFullYear() - 1);
      return d.getTime();
    default:
      return 0;
  }
}

function inWindow(ts: string | null | undefined, from: number): boolean {
  if (!ts) return false;
  const ms = new Date(ts).getTime();
  return !Number.isNaN(ms) && ms >= from;
}

/** Reads live app state for the built-in metrics. */
export function buildFactResolver(db: LifeOsDb): GoalFactResolver {
  return {
    property: (key) => propertyNumber(db, key),
    metric: (metric: GoalMetric, opts) => {
      const from = windowStart(opts.window);
      switch (metric) {
        case "total_xp": {
          if (opts.window === "all") {
            const row = db.select().from(schema.userProgress).limit(1).get();
            return row?.totalXp ?? 0;
          }
          return db
            .select()
            .from(schema.dailySnapshots)
            .all()
            .filter((s) => inWindow(`${s.date}T12:00:00`, from))
            .reduce((sum, s) => sum + s.totalXpEarned, 0);
        }
        case "habit_completions": {
          return db
            .select()
            .from(schema.habitLogs)
            .all()
            .filter(
              (l) =>
                !l.undoneAt &&
                (!opts.habitId || l.habitId === opts.habitId) &&
                (opts.window === "all" || inWindow(l.completedAt, from)),
            ).length;
        }
        case "habit_streak": {
          const logs = db
            .select()
            .from(schema.habitLogs)
            .all()
            .filter((l) => !l.undoneAt && l.habitId === opts.habitId);
          return computeStreaks(logs, getDayResetTime(db)).current;
        }
        case "study_minutes": {
          return db
            .select()
            .from(schema.studySessions)
            .all()
            .filter((s) => opts.window === "all" || inWindow(s.createdAt, from))
            .reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
        }
        /*
         * `cards_completed` is the old spelling and still counts, because it is
         * baked into goals people already have. Both read `tasks` — the table
         * it used to read stopped being written, which would have quietly
         * frozen every goal counting completions.
         */
        case "tasks_completed":
        case "cards_completed": {
          return db
            .select()
            .from(schema.tasks)
            .all()
            .filter(
              (t) =>
                t.status === "done" &&
                (opts.window === "all" || inWindow(t.completedAt, from)),
            ).length;
        }
        case "days_active": {
          return db
            .select()
            .from(schema.dailySnapshots)
            .all()
            .filter(
              (s) =>
                s.totalXpEarned > 0 &&
                (opts.window === "all" || inWindow(`${s.date}T12:00:00`, from)),
            ).length;
        }
      }
    },
  };
}

export interface GoalEvaluation {
  id: string;
  title: string;
  progressPct: number;
  met: boolean;
  /** True only on the transition — the run that first saw the condition come true. */
  newlyMet: boolean;
  detail: string[];
}

/**
 * Re-check one goal's ladder.
 *
 * Two rules do all the work here.
 *
 * **A higher rung implies every lower one.** The agent defines a ladder bottom
 * to top, so reaching rung 3 means rungs 1 and 2 were passed on the way, even
 * if their conditions are worded differently or were never separately true —
 * "read 50 books" cannot be true while "read 12 books" is false. Without this a
 * goal could sit with its top rung lit and a gap underneath, and the user would
 * be owed celebrations for rungs they had visibly already cleared.
 *
 * **The goal's own progress is the ladder's.** Rungs cleared, plus how far up
 * the next one you are, over the total. A five-tier goal with two rungs behind
 * you and the third half-done reads 50%, which is what a progress bar on a
 * ladder should mean.
 */
function evaluateTiers(
  db: LifeOsDb,
  goal: Goal,
  resolver: GoalFactResolver,
  now: string,
): GoalEvaluation {
  const results = goal.tiers.map((tier) => {
    if (!tier.condition) {
      return { tier, met: Boolean(tier.metAt), progressPct: tier.progressPct, detail: tier.conditionDetail };
    }
    try {
      const r = evaluateCondition(tier.condition, resolver);
      return { tier, met: r.met, progressPct: Math.round(r.progressPct), detail: r.detail };
    } catch {
      // A malformed rung is left exactly as it was, like a malformed goal.
      return { tier, met: Boolean(tier.metAt), progressPct: tier.progressPct, detail: tier.conditionDetail };
    }
  });

  // Bottom-up implication: everything below the highest cleared rung is cleared.
  let highestMet = -1;
  results.forEach((r, i) => {
    if (r.met) highestMet = i;
  });

  let newlyMet = false;
  results.forEach((r, i) => {
    const implied = i <= highestMet;
    const met = r.met || implied;
    const first = met && !r.tier.metAt;
    if (first) newlyMet = true;

    const detailJson = JSON.stringify(r.detail);
    const changed =
      first ||
      Math.round(r.progressPct) !== Math.round(r.tier.progressPct) ||
      detailJson !== JSON.stringify(r.tier.conditionDetail);
    if (!changed) return;

    db.update(schema.goalTiers)
      .set({
        // An implied rung reads 100: it was cleared, whatever its own sum says.
        progressPct: met ? 100 : Math.max(0, Math.min(99, Math.round(r.progressPct))),
        conditionDetailJson: detailJson,
        ...(first ? { metAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(schema.goalTiers.id, r.tier.id))
      .run();
  });

  const total = results.length;
  const cleared = highestMet + 1;
  const nextProgress = cleared < total ? Math.max(0, Math.min(99, results[cleared]!.progressPct)) : 0;
  const progressPct = Math.round(((cleared + nextProgress / 100) / total) * 100);

  /*
   * The goal itself is met when the top rung is. `conditionMetAt` is what the
   * rest of the app reads for "this is finished", and on a ladder that means
   * the whole ladder — not the first rung of it.
   */
  const topMet = cleared === total;
  const goalNewlyMet = topMet && !goal.conditionMetAt;
  if (progressPct !== Math.round(goal.progressPct) || goalNewlyMet) {
    db.update(schema.goals)
      .set({
        progressPct,
        ...(goalNewlyMet ? { conditionMetAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(schema.goals.id, goal.id))
      .run();
    recordGoalProgress(db, goal.id, progressPct);
  }

  return {
    id: goal.id,
    title: goal.title,
    progressPct,
    met: topMet,
    newlyMet: newlyMet || goalNewlyMet,
    detail: results.flatMap((r) =>
      r.tier.metAt || r.met ? [`${r.tier.label}: reached`] : [`${r.tier.label}: ${Math.round(r.progressPct)}%`],
    ),
  };
}

/**
 * Re-check every auto-checked goal. Called after any mutating request, so a
 * goal fires the moment the thing that completes it is recorded, whatever wrote
 * it — HTTP, MCP, or the user tapping a habit.
 *
 * Crossing the line sets `conditionMetAt` but deliberately does *not* set
 * `status = achieved`. That happens in `markCelebrationSeen`, once the user has
 * actually watched the animation.
 */
export function evaluateGoals(db: LifeOsDb): GoalEvaluation[] {
  let resolver: GoalFactResolver;
  try {
    resolver = buildFactResolver(db);
  } catch {
    // A half-migrated database should never take down the request that touched it.
    return [];
  }

  const out: GoalEvaluation[] = [];
  const now = nowIso();

  for (const goal of listGoals(db)) {
    if (goal.status === "abandoned" || goal.status === "paused") continue;

    /*
     * A tiered goal's progress is the ladder's, not a single condition's.
     * Evaluated first so `evaluateTiers` can also answer for the goal itself.
     */
    if (goal.tiers.length > 0 && goal.autoCheck) {
      out.push(evaluateTiers(db, goal, resolver, now));
      continue;
    }

    if (!goal.condition || !goal.autoCheck) continue;

    let result;
    try {
      result = evaluateCondition(goal.condition, resolver);
    } catch {
      continue; // malformed condition: leave the goal untouched
    }

    const progressPct = Math.round(result.progressPct);
    const newlyMet = result.met && !goal.conditionMetAt;

    const patch: Partial<typeof schema.goals.$inferInsert> = {
      progressPct,
      conditionDetailJson: JSON.stringify(result.detail),
      updatedAt: now,
    };
    if (newlyMet) patch.conditionMetAt = now;

    const changed =
      newlyMet ||
      progressPct !== Math.round(goal.progressPct) ||
      JSON.stringify(result.detail) !== JSON.stringify(goal.conditionDetail);

    if (changed) {
      db.update(schema.goals)
        .set(patch)
        .where(eq(schema.goals.id, goal.id))
        .run();
      /*
       * Only inside `changed`. This loop runs after every write in the app, so
       * recording unconditionally would put a row in for every request and bury
       * the actual movement in noise.
       */
      recordGoalProgress(db, goal.id, progressPct);
    }

    out.push({
      id: goal.id,
      title: goal.title,
      progressPct,
      met: result.met,
      newlyMet,
      detail: result.detail,
    });
  }

  return out;
}
