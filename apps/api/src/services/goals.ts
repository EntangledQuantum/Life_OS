import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import { nowIso } from "./helpers.js";

export function listGoals(db: LifeOsDb) {
  return db
    .select()
    .from(schema.goals)
    .all()
    .map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      status: g.status as "active" | "paused" | "achieved" | "abandoned",
      targetDate: g.targetDate,
      whyItMatters: g.whyItMatters,
      progressPct: g.progressPct,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    }));
}

export function createGoal(
  db: LifeOsDb,
  input: {
    title: string;
    description?: string | null;
    status?: "active" | "paused" | "achieved" | "abandoned";
    targetDate?: string | null;
    whyItMatters?: string | null;
    progressPct?: number;
    linkedHabitIds?: string[];
  },
) {
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
      createdAt: now,
      updatedAt: now,
    })
    .run();

  for (const hid of input.linkedHabitIds ?? []) {
    db.insert(schema.goalHabitLinks)
      .values({ id: nanoid(), goalId: id, habitId: hid })
      .run();
  }

  return listGoals(db).find((g) => g.id === id)!;
}

export function updateGoal(
  db: LifeOsDb,
  id: string,
  input: Partial<{
    title: string;
    description: string | null;
    status: "active" | "paused" | "achieved" | "abandoned";
    targetDate: string | null;
    whyItMatters: string | null;
    progressPct: number;
  }>,
) {
  const existing = db.select().from(schema.goals).where(eq(schema.goals.id, id)).get();
  if (!existing) return null;
  db.update(schema.goals)
    .set({ ...input, updatedAt: nowIso() })
    .where(eq(schema.goals.id, id))
    .run();
  return listGoals(db).find((g) => g.id === id)!;
}

export function deleteGoal(db: LifeOsDb, id: string) {
  db.delete(schema.goals).where(eq(schema.goals.id, id)).run();
  return true;
}
