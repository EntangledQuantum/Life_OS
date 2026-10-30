import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { isWithinQuietHours } from "@life-os/shared";
import { pushMutation } from "@/lib/sync";
import { useDueReminders, useSettings } from "@/lib/use-sync";
import { armAudio, fireReminderAlert, stopTitleFlash } from "@/lib/notify";

/**
 * Fires agent reminders: chime, screen flash, flashing tab title, and an OS
 * notification when permitted.
 *
 * Headless — it renders nothing and watches the `dueReminders` worked out from
 * the task's own `dueFrom` / `dueUntil` against this machine's clock.
 *
 * Which half decides what has changed, and it is worth being precise about.
 * The server still owns the *policy* — the lead time, the shelf life, and
 * `notifiedAt`, the record that a reminder fired, which is what makes it fire
 * exactly once across every device. What moved here is only the clock
 * comparison, because the server cannot do that correctly from a distance: a
 * reminder used to arrive on the next poll and so could be up to eight seconds
 * late. It is now prompt, which is the one thing about this change a person
 * might actually notice.
 *
 * A task is marked notified as soon as it has chimed, so a refresh or a second
 * tab does not replay it. The task itself keeps flashing in the Quick log until
 * the user actually deals with it.
 */
export function ReminderRunner() {
  const navigate = useNavigate();
  /** Ids already fired in this tab — guards against a double render racing the POST. */
  const firedRef = useRef<Set<string>>(new Set());

  const due = useDueReminders();
  const settings = useSettings();

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

      /*
       * Fire and forget: the reply carries the delta that sets `notifiedAt`, so
       * the task drops out of `due` on its own. A failure here is survivable —
       * the worst case is the chime repeating on the next tick, which is what
       * the in-tab guard above is for.
       */
      void pushMutation("task.notified", { taskId: task.id }).catch(() => {
        /* offline; the reminder still landed and will be recorded next time */
      });
    }
  }, [due, settings, navigate]);

  return null;
}
