/**
 * Reminder notifications: sound, screen flash, tab-title flash, and (when the
 * user has granted it) a real OS notification.
 *
 * The chime is synthesized rather than shipped as an audio file — no asset to
 * 404, no extra request, and it works identically on the GitHub Pages build.
 *
 * Browsers refuse to start audio until the user has interacted with the page,
 * so we resume the context on the first click/keypress and remember whether it
 * ever succeeded. When it hasn't, reminders still flash — the visual channel is
 * never allowed to depend on the audio one.
 */

let ctx: AudioContext | null = null;
let unlocked = false;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** Have the listeners already been attached? Guards against double-arming. */
let armed = false;

/**
 * Resume the audio context on the first real user gesture. Idempotent.
 *
 * The bookkeeping has to happen *inside* the promise. `resume()` is async, so a
 * check placed after it read `unlocked` while it was still false, every time —
 * the listeners were never removed, and `unlocked` never reflected reality for
 * anything else that asked.
 */
export function armAudio(): void {
  if (typeof window === "undefined" || unlocked || armed) return;

  const unlock = () => {
    const c = audioContext();
    if (!c) return;
    void c.resume().then(() => {
      if (c.state !== "running") return;
      unlocked = true;
      armed = false;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    });
  };

  armed = true;
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** Whether audio has actually been unlocked by a gesture. */
export function audioReady(): boolean {
  return unlocked;
}

interface Note {
  freq: number;
  /** Offset from the start of the sound, seconds. */
  at: number;
  dur: number;
  type?: OscillatorType;
  /** Relative loudness within the sound, 0–1. */
  level?: number;
}

/**
 * The sound designs. Each is a handful of decaying oscillators — enough
 * character to tell them apart, cheap enough to fire on a timer.
 *
 * Kept in this shape (rather than as bespoke functions) so a future client can
 * read the same table and map the ids onto native system sounds instead.
 */
const SOUNDS: Record<string, Note[]> = {
  // Two rising notes. The default: clear without being startling.
  chime: [
    { freq: 880, at: 0, dur: 0.18 },
    { freq: 1318.5, at: 0.16, dur: 0.34 },
  ],
  // A struck bell: fundamental plus a slightly inharmonic partial, long tail.
  bell: [
    { freq: 660, at: 0, dur: 1.5 },
    { freq: 1650, at: 0, dur: 0.9, level: 0.35 },
    { freq: 990, at: 0.01, dur: 1.2, level: 0.2 },
  ],
  // Three soft wooden notes. Triangle waves and fast decay read as "mallet".
  marimba: [
    { freq: 523.25, at: 0, dur: 0.28, type: "triangle" },
    { freq: 659.25, at: 0.11, dur: 0.28, type: "triangle" },
    { freq: 783.99, at: 0.22, dur: 0.42, type: "triangle" },
  ],
  // Two low blips. Discreet enough for a shared room.
  pulse: [
    { freq: 220, at: 0, dur: 0.09, type: "square", level: 0.5 },
    { freq: 220, at: 0.15, dur: 0.09, type: "square", level: 0.5 },
  ],
  // Insistent. For the things you must not sleep through.
  alert: [
    { freq: 1046.5, at: 0, dur: 0.12, type: "square", level: 0.7 },
    { freq: 1318.5, at: 0.14, dur: 0.12, type: "square", level: 0.7 },
    { freq: 1046.5, at: 0.28, dur: 0.12, type: "square", level: 0.7 },
    { freq: 1318.5, at: 0.42, dur: 0.3, type: "square", level: 0.7 },
  ],
};

/**
 * Play a reminder sound by id. Returns false when nothing was heard — silent
 * by choice, no audio context, or the browser still waiting for a gesture.
 * Callers must never let the visual channel depend on this.
 */
export function playSound(id = "chime", volume = 0.18): boolean {
  if (id === "none") return false;
  const notes = SOUNDS[id] ?? SOUNDS.chime!;

  const c = audioContext();
  if (!c) return false;
  if (c.state === "suspended") void c.resume();
  if (c.state !== "running") return false;

  const now = c.currentTime;
  for (const note of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = note.type ?? "sine";
    osc.frequency.value = note.freq;

    const peak = Math.max(0.0002, volume * (note.level ?? 1));
    // Exponential decay: a hard stop would click.
    gain.gain.setValueAtTime(0.0001, now + note.at);
    gain.gain.exponentialRampToValueAtTime(peak, now + note.at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.dur);

    osc.connect(gain).connect(c.destination);
    osc.start(now + note.at);
    osc.stop(now + note.at + note.dur + 0.02);
  }
  return true;
}

/** @deprecated use `playSound(id)` — kept so existing call sites keep working. */
export function playChime(volume = 0.18): boolean {
  return playSound("chime", volume);
}

/** A brief accent wash across the viewport. Respects reduced motion. */
export function flashScreen(): void {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const el = document.createElement("div");
  el.className = "reminder-flash";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 1400);
}

let titleTimer: number | null = null;
let originalTitle = "";

/** Alternate the tab title so a backgrounded tab still gets noticed. */
export function flashTitle(message: string, cycles = 10): void {
  if (typeof document === "undefined") return;
  if (titleTimer !== null) {
    window.clearInterval(titleTimer);
  } else {
    originalTitle = document.title;
  }

  let n = 0;
  titleTimer = window.setInterval(() => {
    document.title = n % 2 === 0 ? `🔔 ${message}` : originalTitle;
    n += 1;
    if (n >= cycles * 2) stopTitleFlash();
  }, 800);
}

export function stopTitleFlash(): void {
  if (typeof document === "undefined" || titleTimer === null) return;
  window.clearInterval(titleTimer);
  titleTimer = null;
  document.title = originalTitle || document.title;
}

/**
 * Ask for notification permission.
 *
 * **Call this from a real click and nothing else.** It used to be called from a
 * mount effect, and browsers increasingly refuse a permission prompt with no
 * user gesture behind it — silently. Permission stayed `default` forever,
 * `showSystemNotification` returned false forever, and the whole feature looked
 * broken with nothing in the console to say why.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Current permission, for UI that needs to show where things stand. */
export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/**
 * Show an OS notification.
 *
 * `onClick` is what makes the notification actionable rather than decorative:
 * clicking it focuses the tab and hands back the card id, so the app can open
 * the Timeline with that thing in front of you and one button to finish it.
 */
export function showSystemNotification(
  title: string,
  body?: string,
  opts: { tag?: string; onClick?: () => void } = {},
): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return false;
  }
  try {
    const n = new Notification(title, {
      body,
      // Per-card tag: a shared tag makes each new reminder replace the last,
      // so two things landing together would only ever show one.
      tag: opts.tag ?? "lifeos-reminder",
      icon: notificationIcon(),
    });
    n.onclick = () => {
      window.focus();
      n.close();
      opts.onClick?.();
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * The icon lives under the deploy's base path, which is not `/` on GitHub
 * Pages — a hardcoded `/icon.png` 404s there and the notification renders with
 * the browser's generic icon.
 */
function notificationIcon(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base.endsWith("/") ? base : `${base}/`}icon.png`;
}

export interface ReminderAlertOptions {
  title: string;
  body?: string | null;
  /** The card's own switches. */
  sound?: boolean;
  flash?: boolean;
  /** Which chime to play, from settings. */
  soundId?: string;
  /** Distinguishes one reminder from another in the OS notification stack. */
  tag?: string;
  /** Where clicking the notification should take the user. */
  onClick?: () => void;
  /**
   * Do-not-disturb (manual or quiet hours). Suppresses every interrupting
   * channel while leaving the reminder itself on screen — you see it when you
   * look, you just are not yanked out of what you were doing.
   */
  silent?: boolean;
}

/** Fire every channel a reminder is allowed to use. Returns what actually ran. */
export function fireReminderAlert(opts: ReminderAlertOptions): {
  sound: boolean;
  flash: boolean;
  system: boolean;
} {
  if (opts.silent) return { sound: false, flash: false, system: false };

  const sound =
    opts.sound !== false ? playSound(opts.soundId ?? "chime") : false;
  let flash = false;
  if (opts.flash !== false) {
    flashScreen();
    flashTitle(opts.title);
    flash = true;
  }
  const system = showSystemNotification(opts.title, opts.body ?? undefined, {
    tag: opts.tag,
    onClick: opts.onClick,
  });
  return { sound, flash, system };
}
