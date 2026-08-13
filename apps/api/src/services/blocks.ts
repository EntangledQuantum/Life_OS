import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import type { ScheduleBlock, Source } from "@life-os/shared";
import { getLocalDayBounds, nowIso } from "./helpers.js";
import { createStudySession } from "./study.js";
import { fireAgentWebhook } from "./webhook.js";

function mapBlock(b: typeof schema.scheduleBlocks.$inferSelect): ScheduleBlock {
  return {
    id: b.id,
    date: b.date,
    category: b.category,
    label: b.label,
    plannedStart: b.plannedStart,
    plannedEnd: b.plannedEnd,
    actualStart: b.actualStart,
    actualEnd: b.actualEnd,
    status: (b.status as ScheduleBlock["status"]) ?? "planned",
    source: (b.source as Source) ?? "agent",
    notes: b.notes ?? null,
    completedAt: b.completedAt ?? null,
  };
}

export function listBlocks(db: LifeOsDb, forDate?: string) {
  const date = forDate ?? getLocalDayBounds(db).dateStr;
  return db
    .select()
    .from(schema.scheduleBlocks)
    .all()
    .filter((b) => b.date === date)
    .map(mapBlock);
}

export function listStudyBlocks(db: LifeOsDb, forDate?: string) {
  return listBlocks(db, forDate).filter(
    (b) => b.category.toLowerCase() === "study",
  );
}

export function createBlock(
  db: LifeOsDb,
  input: {
    date?: string;
    category?: string;
    label: string;
    plannedStart?: string | null;
    plannedEnd?: string | null;
    notes?: string | null;
    source?: Source;
  },
) {
  const id = nanoid();
  const date = input.date ?? getLocalDayBounds(db).dateStr;
  db.insert(schema.scheduleBlocks)
    .values({
      id,
      date,
      category: input.category ?? "Study",
      label: input.label,
      plannedStart: input.plannedStart ?? null,
      plannedEnd: input.plannedEnd ?? null,
      actualStart: null,
      actualEnd: null,
      status: "planned",
      source: input.source ?? "agent",
      notes: input.notes ?? null,
      completedAt: null,
      createdAt: nowIso(),
    })
    .run();
  return mapBlock(
    db.select().from(schema.scheduleBlocks).where(eq(schema.scheduleBlocks.id, id)).get()!,
  );
}

export function updateBlock(
  db: LifeOsDb,
  id: string,
  input: Partial<{
    category: string;
    label: string;
    plannedStart: string | null;
    plannedEnd: string | null;
    actualStart: string | null;
    actualEnd: string | null;
    status: ScheduleBlock["status"];
    notes: string | null;
  }>,
) {
  const existing = db
    .select()
    .from(schema.scheduleBlocks)
    .where(eq(schema.scheduleBlocks.id, id))
    .get();
  if (!existing) return null;
  db.update(schema.scheduleBlocks)
    .set({ ...input })
    .where(eq(schema.scheduleBlocks.id, id))
    .run();
  return mapBlock(
    db.select().from(schema.scheduleBlocks).where(eq(schema.scheduleBlocks.id, id)).get()!,
  );
}

export function deleteBlock(db: LifeOsDb, id: string) {
  db.delete(schema.scheduleBlocks).where(eq(schema.scheduleBlocks.id, id)).run();
  return { ok: true };
}

/** Minutes between two `HH:mm` strings, wrapping past midnight. */
function plannedMinutes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h! * 60 + m! : null;
  };
  const a = toMin(start);
  const b = toMin(end);
  if (a === null || b === null) return null;
  return b > a ? b - a : b + 24 * 60 - a;
}

/**
 * Complete a block.
 *
 * There is no start, so there is no elapsed time to measure — the duration is
 * the window the agent planned. That is the honest number anyway: the old code
 * timed you from whenever you happened to press Start, which meant a block you
 * forgot to start was recorded as one minute long, and one you forgot to finish
 * ran until you noticed.
 */
export function completeBlock(db: LifeOsDb, id: string) {
  const block = db
    .select()
    .from(schema.scheduleBlocks)
    .where(eq(schema.scheduleBlocks.id, id))
    .get();
  if (!block) return { error: "Block not found" as const };

  const ended = nowIso();
  const durationMinutes =
    plannedMinutes(block.plannedStart, block.plannedEnd) ?? 30;

  db.update(schema.scheduleBlocks)
    .set({
      status: "done",
      // Kept for rows that were started under the old model; never set now.
      actualStart: block.actualStart,
      actualEnd: ended,
      completedAt: ended,
    })
    .where(eq(schema.scheduleBlocks.id, id))
    .run();

  let studyResult = null;
  if (block.category.toLowerCase() === "study") {
    studyResult = createStudySession(db, {
      title: block.label,
      durationMinutes,
      qualityFlag: "normal",
      source: "user",
      blockId: id,
    });
  }

  const completed = mapBlock(
    db.select().from(schema.scheduleBlocks).where(eq(schema.scheduleBlocks.id, id)).get()!,
  );

  if ((block as { webhookOnComplete?: boolean }).webhookOnComplete) {
    const event = completed.category.toLowerCase() === "study"
      ? "study.complete"
      : "block.complete";
    void fireAgentWebhook(db, event, {
      block: completed,
      label: completed.label,
      durationMinutes,
      study: studyResult,
    });
  }

  return { block: completed, durationMinutes, study: studyResult };
}
