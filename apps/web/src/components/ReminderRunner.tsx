import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DashboardCard } from "@life-os/shared";
import { api } from "@/lib/api";
import {
  armAudio,
  fireReminderAlert,
  requestNotificationPermission,
  stopTitleFlash,
} from "@/lib/notify";

/**
 * Fires agent reminders: chime, screen flash, flashing tab title, and an OS
 * notification when permitted.
 *
 * Headless — it renders nothing and only watches the `dueReminders` the server
 * computed. The server decides *whether* a reminder is due (it owns the clock
 * and the once-only flag); the client only decides *how* it lands.
 *
 * A card is marked notified as soon as it has chimed, so a refresh or a second
 * tab does not replay it. The card itself keeps flashing in the Upcoming rail
 * until the user actually deals with it.
 */
export function ReminderRunner({ due }: { due: DashboardCard[] }) {
  const qc = useQueryClient();
  /** Ids already fired in this tab — guards against a double render racing the POST. */
  const firedRef = useRef<Set<string>>(new Set());

  const markNotified = useMutation({
    mutationFn: (id: string) => api.markCardNotified(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  // Audio needs a gesture before it will play; arm it once, up front.
  useEffect(() => {
    armAudio();
    void requestNotificationPermission();
    return () => stopTitleFlash();
  }, []);

  useEffect(() => {
    for (const card of due) {
      if (firedRef.current.has(card.id)) continue;
      firedRef.current.add(card.id);

      const when = card.eventAt
        ? new Date(card.eventAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : null;

      fireReminderAlert({
        title: card.title,
        body: card.subtitle ?? card.purpose ?? (when ? `Starts at ${when}` : null),
        sound: card.sound,
        flash: card.flash,
      });

      toast(`🔔 ${card.title}`, {
        description: when ? `Coming up at ${when}` : (card.subtitle ?? undefined),
        duration: 8000,
      });

      markNotified.mutate(card.id);
    }
    // `markNotified` is a stable mutation object; re-running on it would refire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due]);

  return null;
}
