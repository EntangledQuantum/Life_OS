/**
 * Which clock everyone is on.
 *
 * Life OS stores instants as ISO strings and derives every day boundary from
 * the machine's local zone. That is right, and invisible, while the only
 * readers are the dashboard and the phone — they sit in the same zone as the
 * server, so nobody has to say which one it is.
 *
 * An agent reading the same data from a container does not. It runs in UTC,
 * and nothing in what it was handed said otherwise, so it schedules "tomorrow
 * at 09:00" in its own zone and buckets completions into a different day than
 * the app does. Neither side is wrong; they were never told they disagreed.
 *
 * So the zone becomes an explicit, resolved value on the way out, and the
 * life-day is reported with its actual bounds rather than left to be re-derived
 * from a reset time and a guess.
 */

/** Whether the platform recognises this as an IANA zone name. */
export function isTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    // Throws RangeError on anything Intl does not know.
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** This machine's zone, or UTC if the platform will not say. */
export function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * The zone to use: what was configured, else this machine's.
 *
 * A stored value that is no longer valid — a zone renamed, or a database moved
 * between platforms — falls back rather than throwing. A bad zone should not be
 * able to take down every date in the app.
 */
export function resolveTimezone(configured: string | null | undefined): string {
  return isTimezone(configured) ? configured : systemTimezone();
}

/** The wall-clock parts of an instant, as read in a given zone. */
function partsIn(instant: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // `24` shows up at midnight in some ICU versions; it means hour zero.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute ?? "0"),
    second: Number(parts.second ?? "0"),
  };
}

/**
 * How far ahead of UTC a zone is at a given instant, in milliseconds.
 *
 * There is no API for this, so it is derived: format the instant in the zone,
 * read the result back as if it were UTC, and the difference is the offset.
 */
function offsetAt(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Drop sub-second noise, which formatToParts does not carry.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export interface LifeDay {
  /** The life-day this instant belongs to, YYYY-MM-DD. */
  lifeDay: string;
  /** When that day began, as an instant. */
  lifeDayStart: string;
  /** When it ends — exclusive, so a completion at exactly this is tomorrow. */
  lifeDayEnd: string;
  /** The reset time it was computed from, HH:mm. */
  dayResetTime: string;
  /** The zone the dates above are in. */
  timezone: string;
}

/**
 * Which life-day an instant falls in.
 *
 * The life-day starts at `dayResetTime` (04:00 by default), not midnight, so
 * finishing something at 01:00 counts for the day you have been awake through
 * rather than the one that started an hour ago. This is the rule agents get
 * wrong most often, which is why it is reported rather than described.
 */
export function lifeDayOf(
  instant: Date,
  dayResetTime: string,
  timezone: string,
): LifeDay {
  const [rh, rm] = dayResetTime.split(":").map(Number);
  const resetHour = Number.isFinite(rh) ? (rh as number) : 4;
  const resetMinute = Number.isFinite(rm) ? (rm as number) : 0;

  const local = partsIn(instant, timezone);
  const beforeReset =
    local.hour < resetHour ||
    (local.hour === resetHour && local.minute < resetMinute);

  // Before the reset the calendar has rolled over but the life-day has not.
  const dayKey = beforeReset ? addDays(local.date, -1) : local.date;

  return {
    lifeDay: dayKey,
    lifeDayStart: startOfLifeDay(dayKey, dayResetTime, timezone),
    lifeDayEnd: startOfLifeDay(addDays(dayKey, 1), dayResetTime, timezone),
    dayResetTime,
    timezone,
  };
}

/** `YYYY-MM-DD` shifted by whole days, without touching any timezone. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The bounds of a named life-day, without needing an instant inside it. */
export function lifeDayBounds(
  dateStr: string,
  dayResetTime: string,
  timezone: string,
): LifeDay {
  return {
    lifeDay: dateStr,
    lifeDayStart: startOfLifeDay(dateStr, dayResetTime, timezone),
    lifeDayEnd: startOfLifeDay(addDays(dateStr, 1), dayResetTime, timezone),
    dayResetTime,
    timezone,
  };
}

/**
 * The instant a life-day begins, as an ISO string.
 *
 * There is no way to build a Date from wall-clock-in-a-zone directly, so this
 * converges on it: treat the wall-clock time as UTC, measure how far off the
 * zone actually is at that instant, correct, and check the correction did not
 * itself cross a DST boundary. Two rounds settle every real case.
 *
 * A fixed offset would be wrong twice a year, and whole-hour guessing would be
 * wrong permanently for the half- and quarter-hour zones — India, Nepal, parts
 * of Australia.
 */
export function startOfLifeDay(
  dateStr: string,
  dayResetTime: string,
  timezone: string,
): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [rh, rm] = dayResetTime.split(":").map(Number);
  const wall = Date.UTC(
    y ?? 1970,
    (m ?? 1) - 1,
    d ?? 1,
    Number.isFinite(rh) ? (rh as number) : 4,
    Number.isFinite(rm) ? (rm as number) : 0,
    0,
    0,
  );

  let utc = wall - offsetAt(new Date(wall), timezone);
  for (let i = 0; i < 2; i++) {
    const corrected = wall - offsetAt(new Date(utc), timezone);
    if (corrected === utc) break;
    utc = corrected;
  }

  return new Date(utc).toISOString();
}
