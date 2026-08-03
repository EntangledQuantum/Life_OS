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

/** Resume the audio context on the first real user gesture. Idempotent. */
export function armAudio(): void {
  if (typeof window === "undefined" || unlocked) return;
  const unlock = () => {
    const c = audioContext();
    if (!c) return;
    void c.resume().then(() => {
      unlocked = c.state === "running";
    });
    if (unlocked) {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    }
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/**
 * Two-note rising chime. Short, unmistakable, and quiet enough not to make
 * someone jump — this fires while they are working.
 */
export function playChime(volume = 0.18): boolean {
  const c = audioContext();
  if (!c) return false;
  if (c.state === "suspended") void c.resume();
  if (c.state !== "running") return false;

  const now = c.currentTime;
  const notes = [
    { freq: 880, at: 0, dur: 0.18 },
    { freq: 1318.5, at: 0.16, dur: 0.34 },
  ];

  for (const note of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = note.freq;
    // Exponential decay: a hard stop would click.
    gain.gain.setValueAtTime(0.0001, now + note.at);
    gain.gain.exponentialRampToValueAtTime(volume, now + note.at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.dur);
    osc.connect(gain).connect(c.destination);
    osc.start(now + note.at);
    osc.stop(now + note.at + note.dur + 0.02);
  }
  return true;
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

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function showSystemNotification(title: string, body?: string): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return false;
  }
  try {
    new Notification(title, { body, tag: "lifeos-reminder", icon: "/icon.png" });
    return true;
  } catch {
    return false;
  }
}

export interface ReminderAlertOptions {
  title: string;
  body?: string | null;
  sound?: boolean;
  flash?: boolean;
}

/** Fire every channel a reminder is allowed to use. Returns what actually ran. */
export function fireReminderAlert(opts: ReminderAlertOptions): {
  sound: boolean;
  flash: boolean;
  system: boolean;
} {
  const sound = opts.sound !== false ? playChime() : false;
  let flash = false;
  if (opts.flash !== false) {
    flashScreen();
    flashTitle(opts.title);
    flash = true;
  }
  const system = showSystemNotification(opts.title, opts.body ?? undefined);
  return { sound, flash, system };
}
