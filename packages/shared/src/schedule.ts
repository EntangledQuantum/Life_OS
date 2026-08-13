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
 * How far ahead of a thing the user is told about it, and how close it has to
 * be before it earns a place on the front page. One number, because they are
 * the same idea: the window in which a scheduled thing is your problem.
 *
 * The dashboard answers "what am I doing *now*"; a card three hours out is
 * planning, not doing, and pushing it into the same view is how a clean
 * dashboard turns back into a to-do list.
 */
export const IMMINENT_WINDOW_MINUTES = 15;

/** @deprecated spelling kept for callers; use `IMMINENT_WINDOW_MINUTES`. */
export const DEFAULT_REMINDER_LEAD_MINUTES = IMMINENT_WINDOW_MINUTES;

function instant(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * When this card should ping.
 *
 * `remindAt` if the agent set one explicitly, otherwise derived from `eventAt`
 * minus the user's lead. Deriving it matters: `remindAt` is optional and most
 * agents only set `eventAt`, which used to mean the card was never scheduled on
 * the phone and never appeared in `dueReminders` — so it either fired late, the
 * next time the app happened to open, or not at all.
 */
export function notifyAt(
  card: { remindAt?: string | null; eventAt?: string | null },
  leadMinutes = IMMINENT_WINDOW_MINUTES,
): string | null {
  if (card.remindAt) return card.remindAt;
  const event = instant(card.eventAt);
  if (event === null) return null;
  const lead = Number.isFinite(leadMinutes) ? Math.max(0, leadMinutes) : 0;
  return new Date(event - lead * 60_000).toISOString();
}

/**
 * How long a task with no stated duration stays current after its time.
 *
 * Not zero. A task at 14:00 with no length is still your problem at 14:05 —
 * expiring it the instant its time arrives means it appears and disappears in
 * the same breath, and the one moment you actually wanted to see it is the one
 * moment it is gone.
 */
export const DEFAULT_TASK_WINDOW_MINUTES = 120;

/**
 * When a scheduled thing stops being current. Its own window, not its
 * completion: something you were meant to do at 09:00 for 30 minutes is no
 * longer *now* at 10:00, whether or not you ticked it off. Otherwise every
 * missed item piles up on the front page forever, which is exactly the to-do
 * list this app refuses to be.
 */
export function expiresAt(card: {
  eventAt?: string | null;
  durationMinutes?: number | null;
}): number | null {
  const event = instant(card.eventAt);
  if (event === null) return null;
  const mins =
    card.durationMinutes && card.durationMinutes > 0
      ? card.durationMinutes
      : DEFAULT_TASK_WINDOW_MINUTES;
  return event + mins * 60_000;
}

/**
 * Is this card current — close enough to be on the front page, and not yet
 * past its own window?
 */
export function isCardImminent(
  card: {
    status?: string;
    showAt?: string | null;
    remindAt?: string | null;
    eventAt?: string | null;
    durationMinutes?: number | null;
  },
  now = new Date(),
  windowMinutes = IMMINENT_WINDOW_MINUTES,
): boolean {
  if (card.status !== "active") return false;
  if (!isCardVisible(card, now)) return false;

  const ms = now.getTime();
  const event = instant(card.eventAt);

  if (event !== null) {
    const gone = expiresAt(card);
    if (gone !== null && ms > gone) return false;
    return event - ms <= windowMinutes * 60_000;
  }

  // No event time, but the ping has landed — the user has been told, so it
  // belongs in front of them until they deal with it.
  const ping = instant(notifyAt(card, windowMinutes));
  return ping !== null && ping <= ms;
}

/**
 * How long a reminder with no time at all stays worth firing, measured from
 * when it was set to ping.
 */
export const REMINDER_SHELF_LIFE_MINUTES = 120;

/**
 * Is this task's notification due — and still worth firing?
 *
 * Two bounds, not one. The lower is the notify instant; the upper is the end of
 * the task's own window. Without the upper bound, every past task that was
 * never notified stays due forever, so they all fire at once the next time a
 * client polls — which is exactly what "my phone only notifies me when I open
 * the app" looks like from the inside. On real data that was 34 at once.
 *
 * A notification is a nudge toward something about to happen. Well past its
 * moment it stops being a nudge and becomes an accusation about yesterday.
 */
export function isReminderDue(
  card: {
    remindAt?: string | null;
    eventAt?: string | null;
    durationMinutes?: number | null;
    notifiedAt?: string | null;
    status?: string;
  },
  now = new Date(),
  leadMinutes = IMMINENT_WINDOW_MINUTES,
): boolean {
  if (card.notifiedAt) return false;
  if (card.status === "done" || card.status === "hidden") return false;
  if (card.status === "dismissed") return false;

  const ping = instant(notifyAt(card, leadMinutes));
  if (ping === null) return false;

  const ms = now.getTime();
  if (ping > ms) return false;

  const gone = expiresAt(card);
  const deadline =
    gone === null ? ping + REMINDER_SHELF_LIFE_MINUTES * 60_000 : gone;
  return ms <= deadline;
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
