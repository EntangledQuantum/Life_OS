import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  sanitizeSvg,
  type CardSlot,
  type DashboardCard,
  type DashboardCardKind,
} from "@life-os/shared";
import { addXp, nowIso } from "./helpers.js";
import { fireAgentWebhook } from "./webhook.js";

type WebhookResult = Awaited<ReturnType<typeof fireAgentWebhook>>;

/** Content cards the agent may show on the front page. */
const MAX_CONTENT_CARDS = 2;
/** Reserved singleton slot for the agent setup card — not a content slot. */
const SETUP_SLOT = 2 as const;

function mapCard(row: typeof schema.dashboardCards.$inferSelect): DashboardCard {
  let meta: Record<string, unknown> | null = null;
  if (row.metaJson) {
    try {
      meta = JSON.parse(row.metaJson) as Record<string, unknown>;
    } catch {
      meta = null;
    }
  }
  const slot = (row.slot === 2 ? 2 : row.slot === 1 ? 1 : 0) as CardSlot;
  return {
    id: row.id,
    slot,
    kind: ((row as { kind?: string }).kind === "agent-setup"
      ? "agent-setup"
      : "task") as DashboardCardKind,
    svg: (row as { svg?: string | null }).svg ?? null,
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

function nextContentSlot(db: LifeOsDb): 0 | 1 | null {
  const used = new Set(
    db
      .select()
      .from(schema.dashboardCards)
      .all()
      .filter((c) => c.slot !== SETUP_SLOT)
      .map((c) => c.slot),
  );
  if (!used.has(0)) return 0;
  if (!used.has(1)) return 1;
  return null;
}

export function createCard(
  db: LifeOsDb,
  input: {
    slot?: CardSlot;
    kind?: DashboardCardKind;
    title: string;
    subtitle?: string | null;
    body?: string | null;
    emoji?: string | null;
    themeColor?: string | null;
    imageUrl?: string | null;
    imageData?: string | null;
    svg?: string | null;
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
  const kind: DashboardCardKind =
    input.kind === "agent-setup" || input.slot === SETUP_SLOT
      ? "agent-setup"
      : "task";

  // The setup card is a singleton living outside the two content slots.
  let slot: CardSlot;
  if (kind === "agent-setup") {
    slot = SETUP_SLOT;
  } else if (input.slot === 0 || input.slot === 1) {
    slot = input.slot;
  } else {
    const n = nextContentSlot(db);
    if (n === null) {
      return {
        error:
          `Max ${MAX_CONTENT_CARDS} content cards — pass slot 0 or 1 to replace one` as const,
      };
    }
    slot = n;
  }

  const sanitized = sanitizeSvg(input.svg);
  if (input.svg && !sanitized.svg) {
    return { error: `Invalid svg: ${sanitized.notes.join("; ")}` as const };
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
      kind,
      title: input.title,
      subtitle: input.subtitle ?? null,
      body: input.body ?? null,
      emoji: input.emoji ?? (kind === "agent-setup" ? "🤖" : "📌"),
      themeColor: input.themeColor ?? "#5B8CFF",
      imageUrl,
      imageData: input.imageData ?? null,
      svg: sanitized.svg,
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

  return { card: getCard(db, id)!, svgNotes: sanitized.notes };
}

export function updateCard(
  db: LifeOsDb,
  id: string,
  input: Partial<{
    slot: CardSlot;
    kind: DashboardCardKind;
    title: string;
    subtitle: string | null;
    body: string | null;
    emoji: string | null;
    themeColor: string | null;
    imageUrl: string | null;
    imageData: string | null;
    svg: string | null;
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

  const { meta, imageUrl, svg, ...rest } = input;

  let svgPatch: { svg: string | null } | Record<string, never> = {};
  if (svg !== undefined) {
    if (svg === null || svg === "") {
      svgPatch = { svg: null };
    } else {
      const sanitized = sanitizeSvg(svg);
      if (!sanitized.svg) {
        return { error: `Invalid svg: ${sanitized.notes.join("; ")}` as const };
      }
      svgPatch = { svg: sanitized.svg };
    }
  }

  db.update(schema.dashboardCards)
    .set({
      ...rest,
      ...svgPatch,
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
  let webhook: WebhookResult = { sent: false, error: "webhook_disabled" };

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
