import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isWithinQuietHours, type Task } from "@life-os/shared";
import { api } from "@/lib/api";
import { armAudio, fireReminderAlert, stopTitleFlash } from "@/lib/notify";

/**
 * Fires agent reminders: chime, screen flash, flashing tab title, and an OS
 * notification when permitted.
 *
 * Headless — it renders nothing and only watches the `dueReminders` the server
 * computed. The server decides *whether* a reminder is due (it owns the clock
 * and the once-only flag); the client only decides *how* it lands.
 *
 * A task is marked notified as soon as it has chimed, so a refresh or a second
 * tab does not replay it. The task itself keeps flashing in the Quick log until
 * the user actually deals with it.
 */
export function ReminderRunner({ due }: { due: Task[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  /** Ids already fired in this tab — guards against a double render racing the POST. */
  const firedRef = useRef<Set<string>>(new Set());

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: api.settings,
  });

  const markNotified = useMutation({
    mutationFn: (id: string) => api.markTaskNotified(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  /*
   * Audio needs a gesture before it will play; arm it once, up front.
   *
   * Notification permission is deliberately *not* requested here. Browsers
   * refuse a permission prompt with no user gesture behind it, silently — so
   * this call left permission on "default" forever and every OS notification
   * failed with nothing in the console. It lives on a button in Settings now.
   */
  useEffect(() => {
    armAudio();
    return () => stopTitleFlash();
  }, []);

  useEffect(() => {
    /**
     * Do-not-disturb, manual or scheduled. Suppresses the *interruption* only:
     * the reminder is still marked notified and still sits on the dashboard
     * pulsing, so nothing is lost — the user just is not yanked out of what
     * they were doing.
     *
     * It has to be marked notified even while silenced. The alternative is a
     * backlog that all fires at once the moment DND ends, which is worse than
     * the thing DND was protecting them from.
     */
    const quiet =
      settings?.quietHoursSilent !== false &&
      settings != null &&
      isWithinQuietHours(settings.quietHoursStart, settings.quietHoursEnd);
    const silent = Boolean(settings?.doNotDisturb) || quiet;

    for (const task of due) {
      if (firedRef.current.has(task.id)) continue;
      firedRef.current.add(task.id);

      const when = task.eventAt
        ? new Date(task.eventAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : null;

      fireReminderAlert({
        title: task.title,
        body: task.subtitle ?? task.purpose ?? (when ? `Starts at ${when}` : null),
        sound: task.sound,
        flash: task.flash,
        soundId: settings?.notificationSound ?? "chime",
        silent,
        tag: `lifeos-task-${task.id}`,
        // Clicking the notification is the fast path to finishing the thing:
        // it lands on Timeline with the task highlighted and a Done button.
        onClick: () => navigate(`/app/timeline?task=${task.id}`),
      });

      // A silenced reminder still leaves a trace you can find on your own terms.
      toast(`🔔 ${task.title}`, {
        description: when ? `Coming up at ${when}` : (task.subtitle ?? undefined),
        duration: silent ? 4000 : 8000,
      });

      markNotified.mutate(task.id);
    }
    // `markNotified` is a stable mutation object; re-running on it would refire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, settings]);

  return null;
}
