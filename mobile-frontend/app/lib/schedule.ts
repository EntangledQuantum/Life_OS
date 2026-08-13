/**
 * Port of packages/shared/src/schedule.ts quiet-hours helper.
 * Quiet hours can wrap past midnight (default 03:30–10:30).
 */

function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Start equal to end means no quiet hours (not always quiet).
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

export function isSilenced(settings: {
  doNotDisturb?: boolean;
  quietHoursSilent?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
} | null | undefined): boolean {
  if (!settings) return false;
  if (settings.doNotDisturb) return true;
  if (settings.quietHoursSilent === false) return false;
  if (!settings.quietHoursStart || !settings.quietHoursEnd) return false;
  return isWithinQuietHours(settings.quietHoursStart, settings.quietHoursEnd);
}

/** Default lead, matching the server's when settings have not loaded yet. */
export const DEFAULT_REMINDER_LEAD_MINUTES = 15;

/**
 * When a task's notification should fire.
 *
 * Port of `notifyAt` in packages/shared/src/schedule.ts. The agent almost never
 * sets `remindAt` — it sets `eventAt` and expects to be told beforehand — so
 * reading `remindAt` alone means most tasks are never pre-scheduled on the
 * phone, and the only notification you ever get is the one fired the moment you
 * happen to open the app. That was the bug.
 */
export function notifyAt(
  task: { remindAt: string | null; eventAt: string | null },
  leadMinutes = DEFAULT_REMINDER_LEAD_MINUTES,
): number | null {
  if (task.remindAt) {
    const at = new Date(task.remindAt).getTime();
    return Number.isNaN(at) ? null : at;
  }
  if (!task.eventAt) return null;
  const event = new Date(task.eventAt).getTime();
  if (Number.isNaN(event)) return null;
  const lead = Number.isFinite(leadMinutes) ? Math.max(0, leadMinutes) : 0;
  return event - lead * 60_000;
}

/**
 * Life-day bounds — port of getDayBounds from packages/shared/src/xp.ts.
 * Before reset time, still belongs to the previous life-day.
 */
export function getDayBounds(resetTime = "04:00", now = new Date()) {
  const [rh, rm] = resetTime.split(":").map(Number);
  const resetH = rh || 0;
  const resetM = rm || 0;

  const cursor = new Date(now);
  const todayReset = new Date(now);
  todayReset.setHours(resetH, resetM, 0, 0);

  let start: Date;
  if (cursor < todayReset) {
    start = new Date(todayReset);
    start.setDate(start.getDate() - 1);
  } else {
    start = todayReset;
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(end.getMilliseconds() - 1);

  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    dateStr: `${y}-${m}-${d}`,
    resetTime,
  };
}
