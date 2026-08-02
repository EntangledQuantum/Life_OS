import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import type { ScheduleBlock, Source } from "@life-os/shared";
import { getLocalDayBounds, nowIso } from "./helpers.js";
import { createStudySession } from "./study.js";

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

/** Start block → Right Now session */
export function startBlock(db: LifeOsDb, id: string) {
  const block = db
    .select()
    .from(schema.scheduleBlocks)
    .where(eq(schema.scheduleBlocks.id, id))
    .get();
  if (!block) return { error: "Block not found" as const };

  const started = nowIso();
  db.update(schema.scheduleBlocks)
    .set({ status: "active", actualStart: started })
    .where(eq(schema.scheduleBlocks.id, id))
    .run();

  db.delete(schema.activeSessions).run();
  db.insert(schema.activeSessions)
    .values({
      activity: block.category,
      startedAt: started,
      blockId: id,
    })
    .run();

  return {
    block: mapBlock(
      db.select().from(schema.scheduleBlocks).where(eq(schema.scheduleBlocks.id, id)).get()!,
    ),
    activeSession: { activity: block.category, startedAt: started, blockId: id },
  };
}

/** Complete block — duration from active session or planned window */
export function completeBlock(db: LifeOsDb, id: string) {
  const block = db
    .select()
    .from(schema.scheduleBlocks)
    .where(eq(schema.scheduleBlocks.id, id))
    .get();
  if (!block) return { error: "Block not found" as const };

  const active = db.select().from(schema.activeSessions).limit(1).get();
  const ended = nowIso();
  let actualStart = block.actualStart;
  if (active?.blockId === id) {
    actualStart = active.startedAt;
  }
  if (!actualStart) actualStart = ended;

  const durationMs = new Date(ended).getTime() - new Date(actualStart).getTime();
  const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

  db.update(schema.scheduleBlocks)
    .set({
      status: "done",
      actualStart,
      actualEnd: ended,
      completedAt: ended,
    })
    .where(eq(schema.scheduleBlocks.id, id))
    .run();

  if (active?.blockId === id) {
    db.delete(schema.activeSessions).run();
  }

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

  return {
    block: mapBlock(
      db.select().from(schema.scheduleBlocks).where(eq(schema.scheduleBlocks.id, id)).get()!,
    ),
    durationMinutes,
    study: studyResult,
  };
}
