import { Platform } from "react-native";
import type { NotificationSoundId, Task } from "./types";
import { DEFAULT_REMINDER_LEAD_MINUTES, notifyAt } from "./schedule";

const isNative = Platform.OS === "ios" || Platform.OS === "android";

/** Lazy-load expo-notifications so web SSR/bundle does not touch localStorage. */
async function Notifications() {
  if (!isNative) return null;
  return import("expo-notifications");
}

let handlerInstalled = false;

async function ensureHandler(): Promise<void> {
  if (handlerInstalled || !isNative) return;
  const N = await Notifications();
  if (!N) return;
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  handlerInstalled = true;
}

/**
 * The channel for a sound id.
 *
 * **One channel per sound, and that is not a style choice.** An Android
 * channel's sound is fixed when the channel is created and cannot be changed
 * afterwards — the OS owns it from that point on, precisely so an app cannot
 * take a user's notification settings back. Three shared channels meant
 * changing the sound in Settings did nothing at all.
 */
function channelForSound(soundId: NotificationSoundId): string {
  return soundId === "none" ? "lifeos-silent" : `lifeos-${soundId}`;
}

/** Every sound that ships as a WAV asset — see `scripts/build-sounds.mjs`. */
const SOUND_FILES: Record<string, string> = {
  chime: "chime.wav",
  bell: "bell.wav",
  marimba: "marimba.wav",
  pulse: "pulse.wav",
  alert: "alert.wav",
};

/** Alert is meant to wake you; the rest are meant to be noticed. */
const CHANNEL_SHAPE: Record<
  string,
  { name: string; vibration: number[]; light: string; max?: boolean }
> = {
  chime: { name: "Reminders · chime", vibration: [0, 180, 100, 180], light: "#7C9CFF" },
  bell: { name: "Reminders · bell", vibration: [0, 180, 100, 180], light: "#7C9CFF" },
  marimba: { name: "Reminders · marimba", vibration: [0, 160, 90, 160], light: "#C084FC" },
  pulse: { name: "Reminders · pulse", vibration: [0, 120, 80, 120], light: "#64748B" },
  alert: {
    name: "Reminders · alert",
    vibration: [0, 250, 120, 250, 120, 250],
    light: "#FB923C",
    max: true,
  },
};

/**
 * Create every channel, once.
 *
 * All of them, not just the selected one: the user can switch sound at any
 * time, and a channel created lazily at that moment would be created *after*
 * notifications had already been scheduled against it. Creating them up front
 * also puts them all in the system's notification settings, where the user can
 * override anything we chose — which is whose decision it should be.
 */
export async function ensureNotificationChannels(
  soundId: NotificationSoundId = "chime",
): Promise<void> {
  if (Platform.OS !== "android") return;
  await ensureHandler();
  const N = await Notifications();
  if (!N) return;

  for (const [id, file] of Object.entries(SOUND_FILES)) {
    const shape = CHANNEL_SHAPE[id]!;
    await N.setNotificationChannelAsync(channelForSound(id as NotificationSoundId), {
      name: shape.name,
      importance: shape.max ? N.AndroidImportance.MAX : N.AndroidImportance.HIGH,
      vibrationPattern: shape.vibration,
      lightColor: shape.light,
      // Base filename only — the file is registered through the
      // expo-notifications config plugin's `sounds` array in app.json.
      sound: file,
    });
  }

  await N.setNotificationChannelAsync("lifeos-silent", {
    name: "Reminders · silent",
    importance: N.AndroidImportance.DEFAULT,
    sound: null,
    vibrationPattern: [0],
  });

  void soundId;
}

/**
 * Call `handler` when the user taps a Life OS notification, with the card id it
 * carried. Returns an unsubscribe function (or null off-device).
 *
 * Registration is async because `expo-notifications` is lazily imported, so the
 * returned closure has to be able to cancel a subscription that may not exist
 * yet — hence the flag rather than just returning `sub.remove`.
 */
export function onNotificationTapped(
  handler: (taskId: string | null) => void,
): (() => void) | null {
  if (!isNative) return null;

  let cancelled = false;
  let remove: (() => void) | null = null;

  void (async () => {
    const N = await Notifications();
    if (!N || cancelled) return;

    const taskIdOf = (response: {
      notification: { request: { content: { data?: unknown } } };
    }): string | null => {
      const data = response.notification.request.content.data as
        | { taskId?: string }
        | undefined;
      return data?.taskId ?? null;
    };

    /*
     * The tap that *launched* the app.
     *
     * The listener below only fires while the app is already running, so on a
     * cold start — which is the common case, since the notification is the
     * reason the app is opening at all — nothing ever arrived, and the user
     * landed on Today wondering what they had been told about. Expo keeps the
     * launching response for exactly this.
     */
    const initial = N.getLastNotificationResponse();
    if (initial && !cancelled) handler(taskIdOf(initial));

    const sub = N.addNotificationResponseReceivedListener((response) => {
      handler(taskIdOf(response));
    });
    if (cancelled) sub.remove();
    else remove = () => sub.remove();
  })();

  return () => {
    cancelled = true;
    remove?.();
  };
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNative) return false;
  await ensureHandler();
  const N = await Notifications();
  if (!N) return false;
  const current = await N.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await N.requestPermissionsAsync();
  return asked.granted;
}

export async function fireLocalReminder(opts: {
  task: Task;
  soundId: NotificationSoundId;
  silent: boolean;
}): Promise<void> {
  const { task, soundId, silent } = opts;
  if (silent || !isNative) return;

  await ensureHandler();
  const N = await Notifications();
  if (!N) return;

  const when = task.eventAt
    ? new Date(task.eventAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const channelId =
    soundId === "none" ? "lifeos-silent" : channelForSound(soundId);

  await N.scheduleNotificationAsync({
    content: {
      title: `${task.emoji ? `${task.emoji} ` : ""}${task.title}`,
      body:
        task.subtitle ??
        task.purpose ??
        (when ? `Starts at ${when}` : "Reminder from Life OS"),
      // iOS takes the filename here; Android takes it from the channel.
      sound: soundId === "none" ? false : (SOUND_FILES[soundId] ?? "default"),
      data: { taskId: task.id, kind: "reminder" },
    },
    /*
     * The channel belongs on the **trigger**, not on the content.
     * `NotificationContentInput` has no `channelId` — it was being passed
     * there and silently dropped, so every notification landed on the default
     * channel and the user's chosen sound never played. A bare `{ channelId }`
     * is `ChannelAwareTriggerInput`: deliver immediately, on this channel.
     */
    trigger: Platform.OS === "android" ? { channelId } : null,
  });
}

/** How far ahead we pre-register notifications with the OS. */
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The set we last handed to the OS. Re-registering an identical set is not
 * free: this runs on every dashboard poll, and cancelling then re-adding a
 * notification that is about to fire is a good way to lose it. So we only touch
 * the OS when the intended set actually changes.
 */
let lastScheduledKey = "";

/**
 * Pre-register local notifications so a backgrounded — or closed — app still
 * fires on time. The caller still POSTs `/notified` when the app next reaches
 * the server, which is what stops it firing twice.
 *
 * The instant comes from `notifyAt`, not from `remindAt` alone. Agents set
 * `eventAt` and expect a warning beforehand; reading `remindAt` alone meant
 * almost nothing was ever pre-registered, and the only notification you ever
 * saw was the one fired at the moment you opened the app.
 */
export async function scheduleUpcomingReminders(
  tasks: Task[],
  soundId: NotificationSoundId,
  silent: boolean,
  leadMinutes: number = DEFAULT_REMINDER_LEAD_MINUTES,
): Promise<void> {
  if (!isNative) return;

  const now = Date.now();
  const wanted = silent
    ? []
    : tasks
        .filter((t) => t.status === "active" && !t.notifiedAt)
        .map((t) => ({ task: t, at: notifyAt(t, leadMinutes) }))
        .filter(
          (x): x is { task: Task; at: number } =>
            x.at !== null && x.at > now && x.at - now <= HORIZON_MS,
        )
        .sort((a, b) => a.at - b.at);

  /*
   * Identity of the intended set, not of the array. The dashboard query hands
   * back a new array every poll, so comparing references would rewrite every
   * notification every eight seconds.
   */
  const key = `${soundId}|${wanted.map((x) => `${x.task.id}@${x.at}`).join(",")}`;
  if (key === lastScheduledKey) return;

  await ensureHandler();
  const N = await Notifications();
  if (!N) return;

  const pending = await N.getAllScheduledNotificationsAsync();
  for (const n of pending) {
    if (n.content.data?.kind === "scheduled-reminder") {
      await N.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  const channelId =
    soundId === "none" ? "lifeos-silent" : channelForSound(soundId);

  for (const { task, at } of wanted) {
    await N.scheduleNotificationAsync({
      content: {
        title: `${task.emoji ? `${task.emoji} ` : ""}${task.title}`,
        body: task.subtitle ?? task.purpose ?? "Upcoming",
        sound: soundId === "none" ? false : (SOUND_FILES[soundId] ?? "default"),
        data: { taskId: task.id, kind: "scheduled-reminder" },
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DATE,
        date: new Date(at),
        // Same story as above: this is where Android reads the channel from.
        ...(Platform.OS === "android" ? { channelId } : {}),
      },
    });
  }

  lastScheduledKey = key;
}

/**
 * Fire a sample notification on the channel a sound belongs to.
 *
 * The only honest preview on Android. The channel owns the sound, the OS plays
 * it, and nothing in JS can audition that — so the way to answer "what does
 * marimba sound like" is to send a real notification and listen. It also
 * doubles as the answer to "are notifications even working", which is otherwise
 * unanswerable until something happens to come due.
 */
export async function fireTestNotification(
  soundId: NotificationSoundId,
): Promise<boolean> {
  if (!isNative) return false;

  await ensureHandler();
  await ensureNotificationChannels(soundId);
  const N = await Notifications();
  if (!N) return false;

  const granted = await requestNotificationPermission();
  if (!granted) return false;

  await N.scheduleNotificationAsync({
    content: {
      title: "🔔 Life OS",
      body: "This is what a reminder sounds like.",
      sound: soundId === "none" ? false : (SOUND_FILES[soundId] ?? "default"),
      data: { kind: "test" },
    },
    trigger:
      Platform.OS === "android" ? { channelId: channelForSound(soundId) } : null,
  });
  return true;
}
