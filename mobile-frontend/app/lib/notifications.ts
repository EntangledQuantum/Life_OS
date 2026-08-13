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

/** Map Life OS sound ids onto Android channel behaviour. */
function channelForSound(soundId: NotificationSoundId): string {
  if (soundId === "none") return "lifeos-silent";
  if (soundId === "alert") return "lifeos-alert";
  return "lifeos-default";
}

export async function ensureNotificationChannels(
  soundId: NotificationSoundId = "chime",
): Promise<void> {
  if (Platform.OS !== "android") return;
  await ensureHandler();
  const N = await Notifications();
  if (!N) return;

  await N.setNotificationChannelAsync("lifeos-default", {
    name: "Life OS reminders",
    importance: N.AndroidImportance.HIGH,
    vibrationPattern: [0, 180, 100, 180],
    lightColor: "#7C9CFF",
    sound: "default",
  });

  await N.setNotificationChannelAsync("lifeos-alert", {
    name: "Life OS alerts",
    importance: N.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 120, 250, 120, 250],
    lightColor: "#FB923C",
    sound: "default",
  });

  await N.setNotificationChannelAsync("lifeos-silent", {
    name: "Life OS silent",
    importance: N.AndroidImportance.DEFAULT,
    sound: undefined,
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
    const sub = N.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { taskId?: string }
        | undefined;
      handler(data?.taskId ?? null);
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
      sound: soundId === "none" ? undefined : "default",
      data: { taskId: task.id, kind: "reminder" },
      ...(Platform.OS === "android" ? { channelId } : {}),
    },
    trigger: null,
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
        sound: soundId === "none" ? undefined : "default",
        data: { taskId: task.id, kind: "scheduled-reminder" },
        ...(Platform.OS === "android" ? { channelId } : {}),
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DATE,
        date: new Date(at),
      },
    });
  }

  lastScheduledKey = key;
}
