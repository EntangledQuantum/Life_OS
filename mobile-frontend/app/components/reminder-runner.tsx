import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { isSilenced } from "@/lib/schedule";
import {
  ensureNotificationChannels,
  fireLocalReminder,
  onNotificationTapped,
  requestNotificationPermission,
  scheduleUpcomingReminders,
} from "@/lib/notifications";

/**
 * Fires due reminders once, and keeps the OS's schedule in step with the
 * server's. POSTs `/notified` even when silenced — the DND contract is that the
 * *interruption* is suppressed, not the record of it, or the whole backlog
 * arrives at once the moment quiet hours end.
 *
 * Renders nothing and lives in the tab layout rather than on a screen. It used
 * to be mounted by Today, which meant that if the app reopened on Timeline —
 * where a tapped notification lands you — nothing was ever scheduled with the
 * OS, and the only notifications that fired were the ones raised while you had
 * Today open. That is the "it only notifies me when I open the app" bug, from
 * the other end.
 */
export function ReminderRunner() {
  const qc = useQueryClient();
  const router = useRouter();
  const { authenticated } = useConnection();
  const firedRef = useRef<Set<string>>(new Set());

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
    enabled: authenticated,
    staleTime: 30_000,
  });

  /*
   * Its own dashboard query, on the same key the screens use — react-query
   * dedupes it, so this costs nothing extra while a screen is mounted and keeps
   * working when none is.
   */
  const { data: dashboard } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    enabled: authenticated,
    refetchInterval: 30_000,
  });

  const markNotified = useMutation({
    mutationFn: (id: string) => api.markTaskNotified(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  useEffect(() => {
    void requestNotificationPermission();
    void ensureNotificationChannels(settings?.notificationSound ?? "chime");
  }, [settings?.notificationSound]);

  /**
   * Tapping the notification opens Timeline with that task in front of you and
   * one button left to press. A notification you can only dismiss is just noise.
   */
  useEffect(() => {
    const sub = onNotificationTapped((taskId) => {
      router.navigate(
        taskId
          ? { pathname: "/(tabs)/timeline", params: { task: taskId } }
          : "/(tabs)/timeline",
      );
    });
    return () => sub?.();
  }, [router]);

  const due = dashboard?.dueReminders ?? [];
  const tasks = dashboard?.tasks;

  useEffect(() => {
    const silent = isSilenced(settings);
    for (const task of due) {
      if (firedRef.current.has(task.id)) continue;
      firedRef.current.add(task.id);

      void fireLocalReminder({
        task,
        soundId: settings?.notificationSound ?? "chime",
        silent,
      });

      // Always mark notified — even under DND (prevents an avalanche later).
      markNotified.mutate(task.id);
    }
    // `markNotified` is a stable mutation object; depending on it would refire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, settings]);

  useEffect(() => {
    if (!tasks) return;
    void scheduleUpcomingReminders(
      tasks,
      settings?.notificationSound ?? "chime",
      isSilenced(settings),
      settings?.reminderLeadMinutes,
    );
  }, [tasks, settings]);

  /*
   * Re-sync when the app comes back to the front.
   *
   * While backgrounded the poll is throttled or stopped, so what the OS holds
   * can be minutes stale — and the agent may have rescheduled the whole
   * evening in the meantime. Refetching on resume is what makes the pre-
   * registered set match the plan rather than the plan as of whenever the app
   * was last awake.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void qc.invalidateQueries({ queryKey: ["dashboard"] });
      }
    });
    return () => sub.remove();
  }, [qc]);

  return null;
}
