import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import type { AgentEvent } from "@life-os/shared";
import { addXp, getLocalDayBounds, nowIso } from "./helpers.js";
import { refreshTodaySnapshot } from "./snapshots.js";

function mapEvent(e: typeof schema.agentEvents.$inferSelect): AgentEvent {
  return {
    id: e.id,
    kind: e.kind as AgentEvent["kind"],
    title: e.title,
    body: e.body,
    link: e.link,
    forDate: e.forDate,
    status: e.status as AgentEvent["status"],
    priority: e.priority,
    xpOnComplete: (e as { xpOnComplete?: number }).xpOnComplete ?? 0,
    completedAt: e.completedAt,
    createdAt: e.createdAt,
  };
}

export function listAgentEvents(db: LifeOsDb, forDate?: string) {
  const date = forDate ?? getLocalDayBounds(db).dateStr;
  return db
    .select()
    .from(schema.agentEvents)
    .all()
    .filter((e) => e.forDate === date)
    .sort((a, b) => b.priority - a.priority)
    .map(mapEvent);
}

export function injectAgentEvent(
  db: LifeOsDb,
  input: {
    kind?: AgentEvent["kind"];
    title: string;
    body?: string | null;
    link?: string | null;
    forDate?: string;
    priority?: number;
    xpOnComplete?: number;
  },
) {
  const id = nanoid();
  const forDate = input.forDate ?? getLocalDayBounds(db).dateStr;
  db.insert(schema.agentEvents)
    .values({
      id,
      kind: input.kind ?? "task",
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      forDate,
      status: "pending",
      priority: input.priority ?? 0,
      xpOnComplete: input.xpOnComplete ?? 0,
      completedAt: null,
      createdAt: nowIso(),
    })
    .run();
  return mapEvent(
    db.select().from(schema.agentEvents).where(eq(schema.agentEvents.id, id)).get()!,
  );
}

export function completeAgentEvent(db: LifeOsDb, id: string) {
  const existing = db
    .select()
    .from(schema.agentEvents)
    .where(eq(schema.agentEvents.id, id))
    .get();
  if (!existing) return { error: "Event not found" as const };
  if (existing.status === "done") {
    return { event: mapEvent(existing), xpAwarded: 0, alreadyDone: true };
  }

  db.update(schema.agentEvents)
    .set({ status: "done", completedAt: nowIso() })
    .where(eq(schema.agentEvents.id, id))
    .run();

  // Bonus XP outside the habit pool, only when the agent attached a value.
  const xp = (existing as { xpOnComplete?: number }).xpOnComplete ?? 0;
  if (xp > 0) {
    addXp(db, xp);
    refreshTodaySnapshot(db);
  }

  return {
    event: mapEvent(
      db.select().from(schema.agentEvents).where(eq(schema.agentEvents.id, id)).get()!,
    ),
    xpAwarded: xp,
    alreadyDone: false,
  };
}

export function dismissAgentEvent(db: LifeOsDb, id: string) {
  db.update(schema.agentEvents)
    .set({ status: "dismissed", completedAt: nowIso() })
    .where(eq(schema.agentEvents.id, id))
    .run();
  return mapEvent(
    db.select().from(schema.agentEvents).where(eq(schema.agentEvents.id, id)).get()!,
  );
}
