import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import { addXp, getLocalDayBounds, nowIso } from "./helpers.js";

export function listQuests(db: LifeOsDb, forDate?: string) {
  const date = forDate ?? getLocalDayBounds(db).dateStr;
  return db
    .select()
    .from(schema.quests)
    .all()
    .filter((q) => !q.forDate || q.forDate === date)
    .map((q) => ({
      id: q.id,
      title: q.title,
      description: q.description,
      targetCount: q.targetCount,
      progressCount: q.progressCount,
      xpBonus: q.xpBonus,
      forDate: q.forDate,
      completedAt: q.completedAt,
      createdAt: q.createdAt,
    }));
}

export function injectQuest(
  db: LifeOsDb,
  input: {
    title: string;
    description?: string | null;
    targetCount?: number;
    xpBonus?: number;
    forDate?: string | null;
  },
) {
  const id = nanoid();
  const now = nowIso();
  db.insert(schema.quests)
    .values({
      id,
      title: input.title,
      description: input.description ?? null,
      targetCount: input.targetCount ?? 1,
      progressCount: 0,
      xpBonus: input.xpBonus ?? 50,
      forDate: input.forDate ?? getLocalDayBounds(db).dateStr,
      completedAt: null,
      createdAt: now,
    })
    .run();
  return listQuests(db).find((q) => q.id === id)!;
}

export function bumpQuestProgress(db: LifeOsDb, by = 1) {
  const quests = listQuests(db);
  for (const q of quests) {
    if (q.completedAt) continue;
    const next = Math.min(q.targetCount, q.progressCount + by);
    const done = next >= q.targetCount;
    db.update(schema.quests)
      .set({
        progressCount: next,
        completedAt: done ? nowIso() : null,
      })
      .where(eq(schema.quests.id, q.id))
      .run();
    if (done && !q.completedAt) {
      addXp(db, q.xpBonus);
    }
  }
}

export function injectLightReview(
  db: LifeOsDb,
  input: { prompt: string; forDate?: string; link?: string | null },
) {
  const id = nanoid();
  const forDate = input.forDate ?? getLocalDayBounds(db).dateStr;
  db.insert(schema.lightReviews)
    .values({
      id,
      prompt: input.prompt,
      forDate,
      link: input.link ?? null,
      completedAt: null,
      createdAt: nowIso(),
    })
    .run();
  return db.select().from(schema.lightReviews).where(eq(schema.lightReviews.id, id)).get()!;
}

export function listLightReviews(db: LifeOsDb, forDate?: string) {
  const date = forDate ?? getLocalDayBounds(db).dateStr;
  return db
    .select()
    .from(schema.lightReviews)
    .all()
    .filter((r) => r.forDate === date)
    .map((r) => ({
      id: r.id,
      prompt: r.prompt,
      forDate: r.forDate,
      link: (r as { link?: string | null }).link ?? null,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    }));
}

export function completeLightReview(db: LifeOsDb, id: string) {
  db.update(schema.lightReviews)
    .set({ completedAt: nowIso() })
    .where(eq(schema.lightReviews.id, id))
    .run();
  return db.select().from(schema.lightReviews).where(eq(schema.lightReviews.id, id)).get();
}
