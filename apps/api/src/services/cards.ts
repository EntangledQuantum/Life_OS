import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { LifeOsDb } from "@life-os/db";
import * as schema from "@life-os/db";
import {
  IMMINENT_WINDOW_MINUTES,
  SPACED_OFFSETS_DAYS,
  UNPINNED_SLOT,
  isCardImminent,
  isReminderDue,
  nextOccurrence,
  sanitizeSvg,
  shiftSchedule,
  validateCardSchedule,
  type Activity,
  type CardSlot,
  type DashboardCard,
  type DashboardCardKind,
  type RepeatRule,
} from "@life-os/shared";
import { addXp, getLocalDayBounds, getSettingsRow, nowIso } from "./helpers.js";
import { fireAgentWebhook } from "./webhook.js";

type WebhookResult = Awaited<ReturnType<typeof fireAgentWebhook>>;

/** Pinned content cards the agent may show on the front page. */
const MAX_CONTENT_CARDS = 2;
/** Reserved singleton slot for the agent setup card — not a content slot. */
const SETUP_SLOT = 2 as const;
/**
 * Ceiling on live scheduled cards. Unpinned cards do not compete for screen
 * space, but an agent in a loop shouldn't be able to fill the disk either.
 */
const MAX_SCHEDULED_CARDS = 200;

/** Kinds that live in the Upcoming rail instead of a front-page slot. */
function isScheduledKind(kind: DashboardCardKind): boolean {
  return kind === "event" || kind === "reminder";
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapCard(row: typeof schema.dashboardCards.$inferSelect): DashboardCard {
  const slot = ([-1, 0, 1, 2].includes(row.slot) ? row.slot : 0) as CardSlot;
  return {
    id: row.id,
    slot,
    kind: (row.kind ?? "task") as DashboardCardKind,
    purpose: row.purpose ?? null,
    activityTag: (row.activityTag as Activity | null) ?? null,
    showAt: row.showAt ?? null,
    remindAt: row.remindAt ?? null,
    eventAt: row.eventAt ?? null,
    durationMinutes: row.durationMinutes ?? null,
    repeatRule: (row.repeatRule as RepeatRule) ?? "none",
    repeatIndex: row.repeatIndex ?? 0,
    repeatOffsetsDays: parseJson<number[] | null>(row.repeatOffsetsJson, null),
    sound: row.sound ?? true,
    flash: row.flash ?? true,
    notifiedAt: row.notifiedAt ?? null,
    linkedBlockId: row.linkedBlockId ?? null,
    svg: row.svg ?? null,
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
    meta: parseJson<Record<string, unknown> | null>(row.metaJson, null),
    xpOnComplete: row.xpOnComplete,
    webhookOnComplete: row.webhookOnComplete,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Every card, pinned and scheduled. */
export function listCards(db: LifeOsDb): DashboardCard[] {
  return db
    .select()
    .from(schema.dashboardCards)
    .all()
    .map(mapCard)
    .sort((a, b) => a.slot - b.slot || (a.eventAt ?? "").localeCompare(b.eventAt ?? ""));
}

/** Front-page cards only: the two content slots plus the setup card. */
export function listPinnedCards(db: LifeOsDb): DashboardCard[] {
  return listCards(db).filter((c) => c.slot >= 0);
}

/**
 * Scheduled cards that should be on screen now: showAt has passed (or was never
 * set) and the card is still open. Soonest event first.
 */
export function listUpcomingCards(db: LifeOsDb, now = new Date()): DashboardCard[] {
  return listCards(db)
    .filter((c) => isScheduledKind(c.kind) && c.status === "active")
    .filter((c) => !c.showAt || new Date(c.showAt).getTime() <= now.getTime())
    .sort((a, b) => {
      if (!a.eventAt) return 1;
      if (!b.eventAt) return -1;
      return a.eventAt.localeCompare(b.eventAt);
    });
}

/**
 * Scheduled cards close enough to belong on the dashboard: due within 15
 * minutes, overdue, or already pinged. Everything further out is planning and
 * lives on the Timeline tab instead.
 */
export function listImminentCards(db: LifeOsDb, now = new Date()): DashboardCard[] {
  const lead = reminderLead(db);
  return listUpcomingCards(db, now).filter((c) => isCardImminent(c, now, lead));
}

/** Cards whose notification is due and which have not chimed yet. */
export function listDueReminders(db: LifeOsDb, now = new Date()): DashboardCard[] {
  const lead = reminderLead(db);
  return listCards(db).filter((c) => isReminderDue(c, now, lead));
}

/**
 * How many minutes ahead the user wants to be told. Read per call rather than
 * cached: this is a single-user SQLite app, the row is already in page cache,
 * and a stale lead would silently change when notifications fire.
 */
function reminderLead(db: LifeOsDb): number {
  const row = getSettingsRow(db) as { reminderLeadMinutes?: number };
  const n = Number(row.reminderLeadMinutes);
  return Number.isFinite(n) && n >= 0 ? n : IMMINENT_WINDOW_MINUTES;
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
      .filter((c) => c.slot === 0 || c.slot === 1)
      .map((c) => c.slot),
  );
  if (!used.has(0)) return 0;
  if (!used.has(1)) return 1;
  return null;
}

export interface CardScheduleInput {
  purpose?: string | null;
  activityTag?: Activity | null;
  showAt?: string | null;
  remindAt?: string | null;
  eventAt?: string | null;
  durationMinutes?: number | null;
  repeatRule?: RepeatRule;
  repeatOffsetsDays?: number[] | null;
  sound?: boolean;
  flash?: boolean;
}

export interface CreateCardInput extends CardScheduleInput {
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
}

export function createCard(
  db: LifeOsDb,
  input: CreateCardInput,
): { card: DashboardCard; svgNotes: string[] } | { error: string } {
  const existing = db.select().from(schema.dashboardCards).all();

  let kind: DashboardCardKind;
  if (input.kind && input.kind !== "task") {
    kind = input.kind;
  } else if (input.slot === SETUP_SLOT) {
    kind = "agent-setup";
  } else if (input.eventAt || input.remindAt) {
    // A card with a time on it is a scheduled card even if the agent forgot to
    // say so — otherwise it would silently evict a pinned front-page card.
    kind = input.remindAt && !input.durationMinutes ? "reminder" : "event";
  } else {
    kind = "task";
  }

  const schedule = validateCardSchedule(input);
  if (!schedule.ok) {
    return { error: `Invalid schedule: ${schedule.errors.join("; ")}` };
  }
  if (kind === "reminder" && !input.remindAt) {
    return { error: "A reminder card needs remindAt (and the eventAt it points at)" };
  }
  if (input.repeatRule && input.repeatRule !== "none" && !input.eventAt) {
    return { error: "repeatRule needs eventAt — there is nothing to repeat without a first occurrence" };
  }

  let slot: CardSlot;
  if (kind === "agent-setup") {
    slot = SETUP_SLOT;
  } else if (isScheduledKind(kind)) {
    const live = existing.filter((c) => c.slot === UNPINNED_SLOT && c.status === "active");
    if (live.length >= MAX_SCHEDULED_CARDS) {
      return {
        error: `Max ${MAX_SCHEDULED_CARDS} live scheduled cards — complete or delete some first`,
      };
    }
    slot = UNPINNED_SLOT;
  } else if (input.slot === 0 || input.slot === 1) {
    slot = input.slot;
  } else {
    const n = nextContentSlot(db);
    if (n === null) {
      return {
        error: `Max ${MAX_CONTENT_CARDS} pinned content cards — pass slot 0 or 1 to replace one, or use kind:"event"/"reminder" for scheduled cards`,
      };
    }
    slot = n;
  }

  const sanitized = sanitizeSvg(input.svg);
  if (input.svg && !sanitized.svg) {
    return { error: `Invalid svg: ${sanitized.notes.join("; ")}` };
  }

  // Pinned slots hold exactly one card; scheduled cards stack up instead.
  if (slot >= 0) {
    const occupant = existing.find((c) => c.slot === slot);
    if (occupant) {
      db.delete(schema.dashboardCards)
        .where(eq(schema.dashboardCards.id, occupant.id))
        .run();
    }
  }

  const id = nanoid();
  const now = nowIso();
  const imageUrl =
    input.imageUrl === "" || input.imageUrl === undefined ? null : input.imageUrl;

  db.insert(schema.dashboardCards)
    .values({
      id,
      slot,
      kind,
      purpose: input.purpose ?? null,
      activityTag: input.activityTag ?? null,
      showAt: schedule.normalized.showAt,
      remindAt: schedule.normalized.remindAt,
      eventAt: schedule.normalized.eventAt,
      durationMinutes: input.durationMinutes ?? null,
      repeatRule: input.repeatRule ?? "none",
      repeatIndex: 0,
      repeatOffsetsJson: input.repeatOffsetsDays
        ? JSON.stringify(input.repeatOffsetsDays)
        : null,
      sound: input.sound ?? true,
      flash: input.flash ?? true,
      notifiedAt: null,
      linkedBlockId: null,
      title: input.title,
      subtitle: input.subtitle ?? null,
      body: input.body ?? null,
      emoji:
        input.emoji ??
        (kind === "agent-setup"
          ? "🤖"
          : kind === "reminder"
            ? "🔔"
            : kind === "event"
              ? "🗓️"
              : "📌"),
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
  input: Partial<CreateCardInput>,
): DashboardCard | { error: string } | null {
  const existing = db
    .select()
    .from(schema.dashboardCards)
    .where(eq(schema.dashboardCards.id, id))
    .get();
  if (!existing) return null;

  const {
    meta,
    imageUrl,
    svg,
    repeatOffsetsDays,
    showAt,
    remindAt,
    eventAt,
    durationMinutes,
    ...rest
  } = input;

  // Validate the *resulting* schedule, not just the fields being patched —
  // moving eventAt earlier can invalidate a remindAt that was already stored.
  const merged = {
    showAt: showAt !== undefined ? showAt : existing.showAt,
    remindAt: remindAt !== undefined ? remindAt : existing.remindAt,
    eventAt: eventAt !== undefined ? eventAt : existing.eventAt,
    durationMinutes:
      durationMinutes !== undefined ? durationMinutes : existing.durationMinutes,
  };
  const schedule = validateCardSchedule(merged);
  if (!schedule.ok) {
    return { error: `Invalid schedule: ${schedule.errors.join("; ")}` };
  }

  let svgPatch: { svg: string | null } | Record<string, never> = {};
  if (svg !== undefined) {
    if (svg === null || svg === "") {
      svgPatch = { svg: null };
    } else {
      const sanitized = sanitizeSvg(svg);
      if (!sanitized.svg) {
        return { error: `Invalid svg: ${sanitized.notes.join("; ")}` };
      }
      svgPatch = { svg: sanitized.svg };
    }
  }

  const scheduleChanged =
    schedule.normalized.remindAt !== (existing.remindAt ?? null) ||
    schedule.normalized.eventAt !== (existing.eventAt ?? null);

  db.update(schema.dashboardCards)
    .set({
      ...rest,
      ...svgPatch,
      showAt: schedule.normalized.showAt,
      remindAt: schedule.normalized.remindAt,
      eventAt: schedule.normalized.eventAt,
      durationMinutes: merged.durationMinutes ?? null,
      // Re-arm the chime when the agent moves the reminder.
      ...(scheduleChanged ? { notifiedAt: null } : {}),
      ...(repeatOffsetsDays !== undefined
        ? {
            repeatOffsetsJson: repeatOffsetsDays
              ? JSON.stringify(repeatOffsetsDays)
              : null,
          }
        : {}),
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

/**
 * Record that the client actually chimed, so the reminder fires once rather
 * than on every poll. The card keeps flashing until it is completed — being
 * told about a thing is not the same as dealing with it.
 */
export function markCardNotified(db: LifeOsDb, id: string) {
  const card = getCard(db, id);
  if (!card) return { error: "Card not found" as const };
  db.update(schema.dashboardCards)
    .set({ notifiedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(schema.dashboardCards.id, id))
    .run();
  return { card: getCard(db, id)! };
}

/**
 * Complete a card. Recurring cards spawn their next occurrence as a *new* row,
 * so the completed one stays in history (and keeps counting toward XP and the
 * cards_completed metric) instead of being silently rewound.
 */
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

  const card = mapCard(row);
  const now = nowIso();

  /*
   * Completing a card does not touch what you are doing. The activity you are
   * in is set by hand and stays where you put it; a card is a thing with a
   * target time and a done flag, and nothing else.
   */

  const xp = card.xpOnComplete > 0 ? card.xpOnComplete : 0;
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

  let nextCard: DashboardCard | null = null;
  if (card.repeatRule !== "none" && card.eventAt) {
    const next = nextOccurrence(
      card.repeatRule,
      new Date(card.eventAt),
      card.repeatIndex,
      card.repeatOffsetsDays ?? SPACED_OFFSETS_DAYS,
    );
    if (next) {
      const shifted = shiftSchedule(card, next);
      const created = createCard(db, {
        kind: card.kind,
        purpose: card.purpose,
        activityTag: card.activityTag,
        showAt: shifted.showAt,
        remindAt: shifted.remindAt,
        eventAt: shifted.eventAt,
        durationMinutes: card.durationMinutes,
        repeatRule: card.repeatRule,
        repeatOffsetsDays: card.repeatOffsetsDays,
        sound: card.sound,
        flash: card.flash,
        title: card.title,
        subtitle: card.subtitle,
        body: card.body,
        emoji: card.emoji,
        themeColor: card.themeColor,
        svg: card.svg,
        ctaLabel: card.ctaLabel,
        ctaLink: card.ctaLink,
        meta: card.meta,
        xpOnComplete: card.xpOnComplete,
        webhookOnComplete: card.webhookOnComplete,
      });
      if ("card" in created) {
        db.update(schema.dashboardCards)
          .set({ repeatIndex: card.repeatIndex + 1 })
          .where(eq(schema.dashboardCards.id, created.card.id))
          .run();
        nextCard = getCard(db, created.card.id);
      }
    }
  }

  const completed = getCard(db, id)!;
  let webhook: WebhookResult = { sent: false, error: "webhook_disabled" };

  if (row.webhookOnComplete) {
    webhook = await fireAgentWebhook(db, "card.complete", {
      card: completed,
      note: opts.note ?? null,
      source: opts.source ?? "user",
      xpAwarded: xp,
      nextOccurrence: nextCard,
    });
  }

  return { card: completed, xpAwarded: xp, webhook, nextOccurrence: nextCard };
}
