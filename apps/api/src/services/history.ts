/**
 * Recording the past for the two things that only ever had a present.
 *
 * `daily_snapshots` already gives XP, habits, study and consistency a history.
 * Agent properties and goal progress had none: each is a single number
 * overwritten in place. "Books read: 14" does not answer "am I reading more
 * than I was in June" — and that question is the whole point of the analytics
 * page.
 *
 * Only writes when the value actually changes. A counter nobody touches costs
 * nothing, and a goal re-checked on every request does not write a row every
 * request.
 */
import { and, asc, eq, gte } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import type { HistoryPoint } from "@life-os/shared";
import { nowIso } from "./helpers.js";

/** Record a property's value, if it differs from the last one recorded. */
export function recordPropertyValue(
  db: LifeOsDb,
  uid: string,
  key: string,
  value: number | null,
): void {
  if (value === null || !Number.isFinite(value)) return;

  const last = db
    .select()
    .from(schema.propertyHistory)
    .where(eq(schema.propertyHistory.uid, uid))
    .all()
    .at(-1);
  if (last && last.value === value) return;

  db.insert(schema.propertyHistory)
    .values({ uid, key, value, at: nowIso() })
    .run();
}

/** Record a goal's progress, if it differs from the last one recorded. */
export function recordGoalProgress(
  db: LifeOsDb,
  goalId: string,
  pct: number,
): void {
  if (!Number.isFinite(pct)) return;

  const last = db
    .select()
    .from(schema.goalProgressHistory)
    .where(eq(schema.goalProgressHistory.goalId, goalId))
    .all()
    .at(-1);
  if (last && last.pct === pct) return;

  db.insert(schema.goalProgressHistory)
    .values({ goalId, pct, at: nowIso() })
    .run();
}

/**
 * A property's series over a window.
 *
 * The first point is carried in from *before* the window when one exists — a
 * counter that has not moved in three weeks should draw as a flat line at its
 * value, not as an empty chart.
 */
export function propertySeries(
  db: LifeOsDb,
  uid: string,
  since: string,
): HistoryPoint[] {
  const all = db
    .select()
    .from(schema.propertyHistory)
    .where(eq(schema.propertyHistory.uid, uid))
    .orderBy(asc(schema.propertyHistory.at))
    .all();

  const inWindow = all.filter((r) => r.at >= since);
  const before = all.filter((r) => r.at < since).at(-1);

  const points = inWindow.map((r) => ({ at: r.at, value: r.value }));
  if (before) points.unshift({ at: since, value: before.value });
  return points;
}

export function goalSeries(
  db: LifeOsDb,
  goalId: string,
  since: string,
): HistoryPoint[] {
  const all = db
    .select()
    .from(schema.goalProgressHistory)
    .where(
      and(
        eq(schema.goalProgressHistory.goalId, goalId),
        gte(schema.goalProgressHistory.at, since),
      ),
    )
    .orderBy(asc(schema.goalProgressHistory.at))
    .all();
  return all.map((r) => ({ at: r.at, value: r.pct }));
}
