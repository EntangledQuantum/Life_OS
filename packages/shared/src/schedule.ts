/**
 * Scheduling rules for agent cards.
 *
 * A schedulable card has up to three instants, and they must run in this order:
 *
 *     showAt   <=   remindAt   <   eventAt
 *     (appears)     (pings)        (happens)
 *
 * The hard rule the product guarantees: **the user is always told about a thing
 * before the thing.** A reminder that fires at or after its own event is
 * useless, so the API rejects it rather than quietly reordering — an agent that
 * gets this wrong should find out immediately, not at 3am when the chime never
 * came.
 */
import { SPACED_OFFSETS_DAYS, type RepeatRule } from "./constants.js";

export interface CardSchedule {
  /** When the card becomes visible. Null = visible immediately. */
  showAt?: string | null;
  /** When the notification fires. Null = no notification. */
  remindAt?: string | null;
  /** When the thing actually happens. Null = the card is not time-bound. */
  eventAt?: string | null;
  /** How long the thing takes, once started. */
  durationMinutes?: number | null;
}

export interface ScheduleValidation {
  ok: boolean;
  errors: string[];
  /** Normalized ISO strings (or null), safe to persist when `ok`. */
  normalized: {
    showAt: string | null;
    remindAt: string | null;
    eventAt: string | null;
  };
}

function parseInstant(
  value: string | null | undefined,
  field: string,
  errors: string[],
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) {
    errors.push(`${field} is not a valid date-time (use ISO 8601)`);
    return null;
  }
  return ms;
}

/**
 * Check a card's three instants. Returns every problem at once rather than the
 * first, so an agent fixing a bad call only has to round-trip once.
 */
export function validateCardSchedule(input: CardSchedule): ScheduleValidation {
  const errors: string[] = [];
  const show = parseInstant(input.showAt, "showAt", errors);
  const remind = parseInstant(input.remindAt, "remindAt", errors);
  const event = parseInstant(input.eventAt, "eventAt", errors);

  if (
    input.durationMinutes !== null &&
    input.durationMinutes !== undefined &&
    (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 0)
  ) {
    errors.push("durationMinutes must be a positive number of minutes");
  }

  if (remind !== null && event !== null && remind >= event) {
    errors.push(
      "remindAt must be strictly before eventAt — a reminder that fires at or after its event is useless",
    );
  }
  if (show !== null && event !== null && show >= event) {
    errors.push(
      "showAt must be strictly before eventAt — the card has to be on screen before the thing happens",
    );
  }
  if (show !== null && remind !== null && show > remind) {
    errors.push(
      "showAt must be at or before remindAt — the card cannot ping while it is still hidden",
    );
  }
  if (remind !== null && event === null) {
    errors.push(
      "remindAt needs an eventAt to point at — set eventAt, or drop remindAt",
    );
  }

  const iso = (ms: number | null, raw: string | null | undefined) =>
    ms === null ? null : new Date(ms).toISOString() || String(raw);

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      showAt: iso(show, input.showAt),
      remindAt: iso(remind, input.remindAt),
      eventAt: iso(event, input.eventAt),
    },
  };
}

/** Is this card currently visible to the user? */
export function isCardVisible(
  card: { showAt?: string | null; status?: string },
  now = new Date(),
): boolean {
  if (card.status === "hidden") return false;
  if (!card.showAt) return true;
  const ms = new Date(card.showAt).getTime();
  return Number.isNaN(ms) ? true : ms <= now.getTime();
}

/**
 * How close a scheduled card has to be before it earns a place on the
 * dashboard. Everything else lives on the Timeline tab.
 *
 * The dashboard answers "what am I doing *now*"; a card three hours out is
 * planning, not doing, and pushing it into the same view is how a clean
 * dashboard turns back into a to-do list.
 */
export const IMMINENT_WINDOW_MINUTES = 15;

/**
 * Is this card about to happen (or already overdue)?
 *
 * True when the event lands within the next 15 minutes, when it has slipped
 * into the past unfinished, or when its reminder has already fired. A card with
 * no times at all is never imminent — it has nothing to be close to.
 */
export function isCardImminent(
  card: {
    status?: string;
    showAt?: string | null;
    remindAt?: string | null;
    eventAt?: string | null;
  },
  now = new Date(),
  windowMinutes = IMMINENT_WINDOW_MINUTES,
): boolean {
  if (card.status !== "active") return false;
  if (!isCardVisible(card, now)) return false;

  const ms = now.getTime();
  const at = (value: string | null | undefined) => {
    if (!value) return null;
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? null : t;
  };

  const event = at(card.eventAt);
  const remind = at(card.remindAt);

  if (event !== null) return event - ms <= windowMinutes * 60_000;
  // No event time, but the ping has landed — the user has been told, so it
  // belongs in front of them until they deal with it.
  return remind !== null && remind <= ms;
}

/** Is this card's reminder due (and not yet fired)? */
export function isReminderDue(
  card: { remindAt?: string | null; notifiedAt?: string | null; status?: string },
  now = new Date(),
): boolean {
  if (!card.remindAt || card.notifiedAt) return false;
  if (card.status === "done" || card.status === "hidden") return false;
  const ms = new Date(card.remindAt).getTime();
  return !Number.isNaN(ms) && ms <= now.getTime();
}

function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is `now` inside the user's quiet hours?
 *
 * Handles the window wrapping past midnight, which is the normal case here —
 * the default is 03:30 to 10:30, and a night owl's quiet hours almost always
 * straddle the date boundary. A start equal to the end means "no quiet hours"
 * rather than "always quiet", because the latter would silently mute the app
 * forever on a mis-set field.
 */
export function isWithinQuietHours(
  start: string,
  end: string,
  now = new Date(),
): boolean {
  const from = minutesOfDay(start);
  const to = minutesOfDay(end);
  if (from === null || to === null || from === to) return false;

  const at = now.getHours() * 60 + now.getMinutes();
  return from < to ? at >= from && at < to : at >= from || at < to;
}

/**
 * Where the next occurrence lands after completing occurrence `repeatIndex`.
 * Returns null when the card does not repeat, or when a spaced ladder is spent.
 */
export function nextOccurrence(
  rule: RepeatRule,
  from: Date,
  repeatIndex: number,
  offsets: readonly number[] = SPACED_OFFSETS_DAYS,
): Date | null {
  const next = new Date(from.getTime());
  switch (rule) {
    case "daily":
      next.setDate(next.getDate() + 1);
      return next;
    case "weekly":
      next.setDate(next.getDate() + 7);
      return next;
    case "spaced": {
      const days = offsets[repeatIndex];
      if (days === undefined) return null; // ladder finished — stop repeating
      next.setDate(next.getDate() + days);
      return next;
    }
    default:
      return null;
  }
}

/**
 * Shift a whole schedule to a new event time, preserving the lead times the
 * agent chose (e.g. "show 2h before, ping 10min before" survives repetition).
 */
export function shiftSchedule(
  schedule: CardSchedule,
  nextEventAt: Date,
): { showAt: string | null; remindAt: string | null; eventAt: string } {
  const event = schedule.eventAt ? new Date(schedule.eventAt).getTime() : null;
  const lead = (value: string | null | undefined) => {
    if (!value || event === null) return null;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms)) return null;
    return new Date(nextEventAt.getTime() - (event - ms)).toISOString();
  };
  return {
    showAt: lead(schedule.showAt),
    remindAt: lead(schedule.remindAt),
    eventAt: nextEventAt.toISOString(),
  };
}
