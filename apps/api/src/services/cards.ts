import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import type { DashboardCard } from "@life-os/shared";
import { addXp, nowIso } from "./helpers.js";
import { fireAgentWebhook } from "./webhook.js";

const MAX_CARDS = 2;

function mapCard(row: typeof schema.dashboardCards.$inferSelect): DashboardCard {
  let meta: Record<string, unknown> | null = null;
  if (row.metaJson) {
    try {
      meta = JSON.parse(row.metaJson) as Record<string, unknown>;
    } catch {
      meta = null;
    }
  }
  return {
    id: row.id,
    slot: (row.slot === 1 ? 1 : 0) as 0 | 1,
    title: row.title,
    subtitle: row.subtitle,
    body: row.body,
    emoji: row.emoji,
    themeColor: row.themeColor,
    imageUrl: row.imageUrl,
    imageData: row.imageData,
    status: row.status as DashboardCard["status"],
    progress: row.progress ?? 0,
    ctaLabel: row.ctaLabel,
    ctaLink: row.ctaLink,
    meta,
    xpOnComplete: row.xpOnComplete,
    webhookOnComplete: row.webhookOnComplete,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listCards(db: LifeOsDb): DashboardCard[] {
  return db
    .select()
    .from(schema.dashboardCards)
    .all()
    .sort((a, b) => a.slot - b.slot)
    .map(mapCard);
}

export function getCard(db: LifeOsDb, id: string) {
  const row = db
    .select()
    .from(schema.dashboardCards)
    .where(eq(schema.dashboardCards.id, id))
    .get();
  return row ? mapCard(row) : null;
}

function nextSlot(db: LifeOsDb): 0 | 1 | null {
  const used = new Set(
    db.select().from(schema.dashboardCards).all().map((c) => c.slot),
  );
  if (!used.has(0)) return 0;
  if (!used.has(1)) return 1;
  return null;
}

export function createCard(
  db: LifeOsDb,
  input: {
    slot?: 0 | 1;
    title: string;
    subtitle?: string | null;
    body?: string | null;
    emoji?: string | null;
    themeColor?: string | null;
    imageUrl?: string | null;
    imageData?: string | null;
    status?: "active" | "done" | "hidden";
    progress?: number;
    ctaLabel?: string | null;
    ctaLink?: string | null;
    meta?: Record<string, unknown> | null;
    xpOnComplete?: number;
    webhookOnComplete?: boolean;
  },
) {
  const existing = db.select().from(schema.dashboardCards).all();
  if (existing.length >= MAX_CARDS && input.slot === undefined) {
    return { error: `Max ${MAX_CARDS} dashboard cards` as const };
  }

  let slot = input.slot;
  if (slot === undefined) {
    const n = nextSlot(db);
    if (n === null) return { error: `Max ${MAX_CARDS} dashboard cards` as const };
    slot = n;
  }
  if (slot !== 0 && slot !== 1) {
    return { error: "slot must be 0 or 1" as const };
  }

  // Replace same slot if occupied
  const occupant = existing.find((c) => c.slot === slot);
  if (occupant) {
    db.delete(schema.dashboardCards)
      .where(eq(schema.dashboardCards.id, occupant.id))
      .run();
  }

  const id = nanoid();
  const now = nowIso();
  const imageUrl =
    input.imageUrl === "" || input.imageUrl === undefined
      ? null
      : input.imageUrl;

  db.insert(schema.dashboardCards)
    .values({
      id,
      slot,
      title: input.title,
      subtitle: input.subtitle ?? null,
      body: input.body ?? null,
      emoji: input.emoji ?? "📌",
      themeColor: input.themeColor ?? "#5B8CFF",
      imageUrl,
      imageData: input.imageData ?? null,
      status: input.status ?? "active",
      progress: input.progress ?? 0,
      ctaLabel: input.ctaLabel ?? null,
      ctaLink: input.ctaLink ?? null,
      metaJson: input.meta ? JSON.stringify(input.meta) : null,
      xpOnComplete: input.xpOnComplete ?? 0,
      webhookOnComplete: input.webhookOnComplete ?? true,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { card: getCard(db, id)! };
}

export function updateCard(
  db: LifeOsDb,
  id: string,
  input: Partial<{
    slot: 0 | 1;
    title: string;
    subtitle: string | null;
    body: string | null;
    emoji: string | null;
    themeColor: string | null;
    imageUrl: string | null;
    imageData: string | null;
    status: "active" | "done" | "hidden";
    progress: number;
    ctaLabel: string | null;
    ctaLink: string | null;
    meta: Record<string, unknown> | null;
    xpOnComplete: number;
    webhookOnComplete: boolean;
  }>,
) {
  const existing = db
    .select()
    .from(schema.dashboardCards)
    .where(eq(schema.dashboardCards.id, id))
    .get();
  if (!existing) return null;

  const { meta, imageUrl, ...rest } = input;
  db.update(schema.dashboardCards)
    .set({
      ...rest,
      ...(imageUrl !== undefined
        ? { imageUrl: imageUrl === "" ? null : imageUrl }
        : {}),
      ...(meta !== undefined
        ? { metaJson: meta ? JSON.stringify(meta) : null }
        : {}),
      updatedAt: nowIso(),
    })
    .where(eq(schema.dashboardCards.id, id))
    .run();

  return getCard(db, id);
}

export function deleteCard(db: LifeOsDb, id: string) {
  db.delete(schema.dashboardCards)
    .where(eq(schema.dashboardCards.id, id))
    .run();
  return { ok: true };
}

export async function completeCard(
  db: LifeOsDb,
  id: string,
  opts: { note?: string | null; source?: "user" | "agent"; progress?: number } = {},
) {
  const row = db
    .select()
    .from(schema.dashboardCards)
    .where(eq(schema.dashboardCards.id, id))
    .get();
  if (!row) return { error: "Card not found" as const };

  const now = nowIso();
  const xp = row.xpOnComplete > 0 ? row.xpOnComplete : 0;
  if (xp > 0) addXp(db, xp);

  db.update(schema.dashboardCards)
    .set({
      status: "done",
      progress: opts.progress ?? 100,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.dashboardCards.id, id))
    .run();

  const card = getCard(db, id)!;
  let webhook = { sent: false as boolean, status: undefined as number | undefined, error: undefined as string | undefined };

  if (row.webhookOnComplete) {
    webhook = await fireAgentWebhook(db, "card.complete", {
      card,
      note: opts.note ?? null,
      source: opts.source ?? "user",
      xpAwarded: xp,
    });
  }

  return { card, xpAwarded: xp, webhook };
}
