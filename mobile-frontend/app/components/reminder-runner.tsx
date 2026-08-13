import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardCard } from "@/lib/types";
import { api } from "@/lib/api";
import { isSilenced } from "@/lib/schedule";
import {
  ensureNotificationChannels,
  fireLocalReminder,
  onNotificationTapped,
  requestNotificationPermission,
  scheduleUpcomingReminders,
} from "@/lib/notifications";

/**
 * Fires due reminders once, POSTs /notified even when silenced (DND contract).
 */
export function ReminderRunner({
  due,
  scheduled,
}: {
  due: DashboardCard[];
  scheduled?: DashboardCard[];
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const firedRef = useRef<Set<string>>(new Set());

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
    staleTime: 30_000,
  });

  const markNotified = useMutation({
    mutationFn: (id: string) => api.markCardNotified(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  useEffect(() => {
    void requestNotificationPermission();
    void ensureNotificationChannels(settings?.notificationSound ?? "chime");
  }, [settings?.notificationSound]);

  /**
   * Tapping the notification opens Timeline with that card in front of you and
   * one button left to press. A notification you can only dismiss is just noise.
   */
  useEffect(() => {
    const sub = onNotificationTapped((cardId) => {
      router.navigate(
        cardId
          ? { pathname: "/(tabs)/timeline", params: { card: cardId } }
          : "/(tabs)/timeline",
      );
    });
    return () => sub?.();
  }, [router]);

  useEffect(() => {
    const silent = isSilenced(settings);
    for (const card of due) {
      if (firedRef.current.has(card.id)) continue;
      firedRef.current.add(card.id);

      void fireLocalReminder({
        card,
        soundId: settings?.notificationSound ?? "chime",
        silent,
      });

      // Always mark notified — even under DND (prevents avalanche later)
      markNotified.mutate(card.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, settings]);

  useEffect(() => {
    if (!scheduled) return;
    void scheduleUpcomingReminders(
      scheduled,
      settings?.notificationSound ?? "chime",
      isSilenced(settings),
    );
  }, [scheduled, settings]);

  return null;
}
