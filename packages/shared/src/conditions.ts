/**
 * Goal conditions.
 *
 * Goals in Life OS are set by the *agent*, not the user — the user should never
 * have to sit down and decide what to want. The agent writes a machine-checkable
 * condition ("read 10 books this year"), and the system re-checks it after every
 * change to the database. When it comes true the goal is *met*, but it is not
 * *finished* until the user has actually seen the celebration.
 *
 * A condition reads either:
 *   - an agent-defined property (a counter the agent pushes to itself), or
 *   - a built-in metric the app already tracks.
 *
 * and combines them with `all` / `any`.
 */

export const COMPARE_OPS = [">=", ">", "<=", "<", "==", "!="] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

/** Metrics the app computes itself — no agent bookkeeping required. */
export const GOAL_METRICS = [
  "total_xp",
  "habit_completions",
  "habit_streak",
  "study_minutes",
  "cards_completed",
  "days_active",
] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

/** Time window a metric is measured over. */
export const GOAL_WINDOWS = ["all", "7d", "30d", "90d", "year"] as const;
export type GoalWindow = (typeof GOAL_WINDOWS)[number];

export type GoalCondition =
  | {
      type: "property";
      /** Key of an agent-defined property, e.g. "books_read". */
      key: string;
      op: CompareOp;
      value: number;
    }
  | {
      type: "metric";
      metric: GoalMetric;
      op: CompareOp;
      value: number;
      /** Required for habit_completions / habit_streak. */
      habitId?: string;
      /** Defaults to "all". */
      window?: GoalWindow;
    }
  | { type: "all"; of: GoalCondition[] }
  | { type: "any"; of: GoalCondition[] };

export interface GoalFactResolver {
  /** Current numeric value of an agent property, or null if undefined. */
  property(key: string): number | null;
  metric(
    metric: GoalMetric,
    opts: { habitId?: string; window: GoalWindow },
  ): number;
}

export interface ConditionResult {
  met: boolean;
  /** 0–100. For `all` this is the weakest leg; for `any`, the strongest. */
  progressPct: number;
  /** Human-readable leaf-by-leaf trace, useful in the UI and for agents. */
  detail: string[];
}

function compare(current: number, op: CompareOp, target: number): boolean {
  switch (op) {
    case ">=":
      return current >= target;
    case ">":
      return current > target;
    case "<=":
      return current <= target;
    case "<":
      return current < target;
    case "==":
      return current === target;
    case "!=":
      return current !== target;
  }
}

/**
 * Progress toward a leaf condition.
 *
 * Only "reach a number" comparisons have a meaningful ratio; for the others a
 * condition is either satisfied or it is not, so we report 0 or 100 rather than
 * inventing a curve.
 */
function leafProgress(current: number, op: CompareOp, target: number): number {
  if (op === ">=" || op === ">") {
    if (target <= 0) return compare(current, op, target) ? 100 : 0;
    return Math.max(0, Math.min(100, (current / target) * 100));
  }
  return compare(current, op, target) ? 100 : 0;
}

export function evaluateCondition(
  condition: GoalCondition,
  resolver: GoalFactResolver,
): ConditionResult {
  switch (condition.type) {
    case "property": {
      const raw = resolver.property(condition.key);
      const current = raw ?? 0;
      const met = raw === null ? false : compare(current, condition.op, condition.value);
      return {
        met,
        progressPct: raw === null ? 0 : leafProgress(current, condition.op, condition.value),
        detail: [
          raw === null
            ? `property "${condition.key}" is not defined yet`
            : `${condition.key} = ${current} (needs ${condition.op} ${condition.value})`,
        ],
      };
    }
    case "metric": {
      const window = condition.window ?? "all";
      const current = resolver.metric(condition.metric, {
        habitId: condition.habitId,
        window,
      });
      return {
        met: compare(current, condition.op, condition.value),
        progressPct: leafProgress(current, condition.op, condition.value),
        detail: [
          `${condition.metric}${window === "all" ? "" : `[${window}]`} = ${current} (needs ${condition.op} ${condition.value})`,
        ],
      };
    }
    case "all": {
      const parts = condition.of.map((c) => evaluateCondition(c, resolver));
      return {
        met: parts.every((p) => p.met),
        progressPct: parts.length
          ? Math.min(...parts.map((p) => p.progressPct))
          : 100,
        detail: parts.flatMap((p) => p.detail),
      };
    }
    case "any": {
      const parts = condition.of.map((c) => evaluateCondition(c, resolver));
      return {
        met: parts.some((p) => p.met),
        progressPct: parts.length
          ? Math.max(...parts.map((p) => p.progressPct))
          : 0,
        detail: parts.flatMap((p) => p.detail),
      };
    }
  }
}

/**
 * Validate an untrusted condition tree, collecting every problem.
 * Returns the typed condition when valid so callers can persist it as-is.
 */
export function parseGoalCondition(
  input: unknown,
  path = "condition",
): { ok: true; condition: GoalCondition } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const walk = (node: unknown, at: string): void => {
    if (typeof node !== "object" || node === null) {
      errors.push(`${at} must be an object`);
      return;
    }
    const n = node as Record<string, unknown>;
    switch (n.type) {
      case "property": {
        if (typeof n.key !== "string" || !n.key.trim()) {
          errors.push(`${at}.key must be a non-empty property key`);
        }
        if (!COMPARE_OPS.includes(n.op as CompareOp)) {
          errors.push(`${at}.op must be one of ${COMPARE_OPS.join(" ")}`);
        }
        if (typeof n.value !== "number" || Number.isNaN(n.value)) {
          errors.push(`${at}.value must be a number`);
        }
        return;
      }
      case "metric": {
        if (!GOAL_METRICS.includes(n.metric as GoalMetric)) {
          errors.push(`${at}.metric must be one of ${GOAL_METRICS.join(" | ")}`);
        }
        if (!COMPARE_OPS.includes(n.op as CompareOp)) {
          errors.push(`${at}.op must be one of ${COMPARE_OPS.join(" ")}`);
        }
        if (typeof n.value !== "number" || Number.isNaN(n.value)) {
          errors.push(`${at}.value must be a number`);
        }
        if (
          (n.metric === "habit_completions" || n.metric === "habit_streak") &&
          typeof n.habitId !== "string"
        ) {
          errors.push(`${at}.habitId is required for metric "${String(n.metric)}"`);
        }
        if (n.window !== undefined && !GOAL_WINDOWS.includes(n.window as GoalWindow)) {
          errors.push(`${at}.window must be one of ${GOAL_WINDOWS.join(" | ")}`);
        }
        return;
      }
      case "all":
      case "any": {
        if (!Array.isArray(n.of) || n.of.length === 0) {
          errors.push(`${at}.of must be a non-empty array of conditions`);
          return;
        }
        n.of.forEach((child, i) => walk(child, `${at}.of[${i}]`));
        return;
      }
      default:
        errors.push(
          `${at}.type must be "property", "metric", "all" or "any" (got ${JSON.stringify(n.type)})`,
        );
    }
  };

  walk(input, path);
  return errors.length
    ? { ok: false, errors }
    : { ok: true, condition: input as GoalCondition };
}

/** Copy-pasteable examples handed to agents through the API and MCP. */
export const GOAL_CONDITION_SYNTAX = {
  summary:
    "A goal is a condition the agent writes and the system re-checks after every database change. " +
    "Read agent-defined properties with {type:'property'} and built-in stats with {type:'metric'}. " +
    "When the condition first comes true the goal is MET, but it only becomes ACHIEVED once the " +
    "user has seen the celebration animation.",
  pushingData:
    "Define a property once, then push to it: POST /api/v1/properties {key,label,kind:'counter'} " +
    "then POST /api/v1/properties/<key>/increment {by:1}. Every property has a stable uid you can " +
    "store alongside your own records.",
  examples: [
    {
      goal: "Read 10 books this year",
      property: { key: "books_read", label: "Books finished", kind: "counter" },
      condition: { type: "property", key: "books_read", op: ">=", value: 10 },
    },
    {
      goal: "Hold a 30-day meditation streak",
      condition: {
        type: "metric",
        metric: "habit_streak",
        habitId: "<habit id>",
        op: ">=",
        value: 30,
      },
    },
    {
      goal: "40 hours of study this month, without dropping the morning habit",
      condition: {
        type: "all",
        of: [
          { type: "metric", metric: "study_minutes", window: "30d", op: ">=", value: 2400 },
          { type: "metric", metric: "habit_streak", habitId: "<habit id>", op: ">=", value: 20 },
        ],
      },
    },
  ],
  operators: COMPARE_OPS,
  metrics: GOAL_METRICS,
  windows: GOAL_WINDOWS,
} as const;
