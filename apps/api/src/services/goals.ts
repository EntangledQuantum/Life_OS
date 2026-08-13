import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  evaluateCondition,
  parseGoalCondition,
  type Goal,
  type GoalCondition,
  type GoalFactResolver,
  type GoalMetric,
  type GoalWindow,
} from "@life-os/shared";
import { computeStreaks, getDayResetTime, nowIso } from "./helpers.js";
import { propertyNumber } from "./properties.js";
import { fireAgentWebhook } from "./webhook.js";

type Row = typeof schema.goals.$inferSelect;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapGoal(row: Row): Goal {
  const conditionMetAt = row.conditionMetAt ?? null;
  const celebrationSeenAt = row.celebrationSeenAt ?? null;
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
    // The whole point: met but unwitnessed is *not* finished.
    celebrationPending: Boolean(conditionMetAt) && !celebrationSeenAt,
    conditionDetail: parseJson<string[]>(row.conditionDetailJson, []),
    emoji: row.emoji ?? "🎯",
    themeColor: row.themeColor ?? "#A78BFA",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listGoals(db: LifeOsDb): Goal[] {
  return db.select().from(schema.goals).all().map(mapGoal);
}

export function getGoal(db: LifeOsDb, id: string): Goal | null {
  const row = db.select().from(schema.goals).where(eq(schema.goals.id, id)).get();
  return row ? mapGoal(row) : null;
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
  },
): { goal: Goal } | { error: string } {
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
      createdAt: now,
      updatedAt: now,
    })
    .run();

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
  }>,
): Goal | { error: string } | null {
  const existing = db.select().from(schema.goals).where(eq(schema.goals.id, id)).get();
  if (!existing) return null;

  const { condition, ...rest } = input;
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
    .set({ ...rest, ...conditionPatch, updatedAt: nowIso() })
    .where(eq(schema.goals.id, id))
    .run();

  evaluateGoals(db);
  return getGoal(db, id);
}

export function deleteGoal(db: LifeOsDb, id: string) {
  db.delete(schema.goalHabitLinks).where(eq(schema.goalHabitLinks.goalId, id)).run();
  db.delete(schema.goals).where(eq(schema.goals.id, id)).run();
  return { ok: true };
}

/**
 * Mark the celebration as witnessed — the only path to `achieved`.
 * Until this is called the goal stays active no matter how true its condition is.
 */
export function markCelebrationSeen(db: LifeOsDb, id: string) {
  const goal = getGoal(db, id);
  if (!goal) return null;
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
    if (!goal.condition || !goal.autoCheck) continue;
    if (goal.status === "abandoned" || goal.status === "paused") continue;

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
