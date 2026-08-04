import { Platform } from "react-native";
import type { DashboardCard, NotificationSoundId } from "./types";

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
  card: DashboardCard;
  soundId: NotificationSoundId;
  silent: boolean;
}): Promise<void> {
  const { card, soundId, silent } = opts;
  if (silent || !isNative) return;

  await ensureHandler();
  const N = await Notifications();
  if (!N) return;

  const when = card.eventAt
    ? new Date(card.eventAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const channelId =
    soundId === "none" ? "lifeos-silent" : channelForSound(soundId);

  await N.scheduleNotificationAsync({
    content: {
      title: `${card.emoji ? `${card.emoji} ` : ""}${card.title}`,
      body:
        card.subtitle ??
        card.purpose ??
        (when ? `Starts at ${when}` : "Reminder from Life OS"),
      sound: soundId === "none" ? undefined : "default",
      data: { cardId: card.id, kind: "reminder" },
      ...(Platform.OS === "android" ? { channelId } : {}),
    },
    trigger: null,
  });
}

/**
 * Schedule future local notifications from card.remindAt so a backgrounded
 * app still fires. Caller still POSTs /notified when the app next talks to the server.
 */
export async function scheduleUpcomingReminders(
  cards: DashboardCard[],
  soundId: NotificationSoundId,
  silent: boolean,
): Promise<void> {
  if (silent || !isNative) return;

  await ensureHandler();
  const N = await Notifications();
  if (!N) return;

  const pending = await N.getAllScheduledNotificationsAsync();
  for (const n of pending) {
    if (n.content.data?.kind === "scheduled-reminder") {
      await N.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  const now = Date.now();
  for (const card of cards) {
    if (!card.remindAt || card.notifiedAt || card.status !== "active") continue;
    const at = new Date(card.remindAt).getTime();
    if (Number.isNaN(at) || at <= now) continue;
    if (at - now > 48 * 60 * 60 * 1000) continue;

    const channelId =
      soundId === "none" ? "lifeos-silent" : channelForSound(soundId);

    await N.scheduleNotificationAsync({
      content: {
        title: `${card.emoji ? `${card.emoji} ` : ""}${card.title}`,
        body: card.subtitle ?? card.purpose ?? "Upcoming",
        sound: soundId === "none" ? undefined : "default",
        data: {
          cardId: card.id,
          kind: "scheduled-reminder",
        },
        ...(Platform.OS === "android" ? { channelId } : {}),
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DATE,
        date: new Date(at),
      },
    });
  }
}
