package com.lifeos.app.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.lifeos.app.LifeOsApp
import com.lifeos.app.data.sync.SyncWorker
import com.lifeos.app.domain.NotificationType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/*
 * The three broadcast receivers the notification layer needs.
 *
 * All three follow the same shape: `goAsync()`, do the work on the application
 * scope, `finish()` when done or when a timeout expires. A receiver's process
 * may be killed the moment `onReceive` returns, so a `launch` with no
 * `goAsync()` is a coroutine that is sometimes allowed to finish — which is the
 * worst kind of bug to own.
 */

/** Fired by [ReminderAlarms]: one reminder is due. */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val taskId = intent.getStringExtra(Notifier.EXTRA_TARGET) ?: return
        val title = intent.getStringExtra(EXTRA_TITLE)
        val body = intent.getStringExtra(EXTRA_BODY)
        val app = context.applicationContext as? LifeOsApp ?: return

        val pending = goAsync()
        app.container.appScope.launch(Dispatchers.Default) {
            try {
                withTimeoutOrNull(WORK_BUDGET_MS) {
                    app.container.reminders.fireReminder(taskId, title, body)
                }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val EXTRA_TITLE = "com.lifeos.app.notify.TITLE"
        const val EXTRA_BODY = "com.lifeos.app.notify.BODY"

        /** A broadcast receiver gets about ten seconds. Stay well inside it. */
        const val WORK_BUDGET_MS = 8_000L
    }
}

/**
 * Boot, a timezone change, and our own update.
 *
 * Alarms do not survive a reboot — the OS drops every one of them — so without
 * this the app would be silent from a restart until the user next opened it,
 * which on a phone that reboots overnight means silent for the whole morning.
 *
 * A timezone change matters for a different reason: every derived notification
 * time comes from an instant, but the quiet-hours window is wall-clock, so
 * flying two zones east moves which reminders are suppressed.
 *
 * `MY_PACKAGE_REPLACED` is here because an app update also clears alarms, and
 * this app is installed over itself constantly.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            -> Unit

            else -> return
        }

        val app = context.applicationContext as? LifeOsApp ?: return

        // The periodic sync is also cleared by a reboot in some OEM states;
        // re-asking is idempotent (`KEEP`).
        SyncWorker.schedulePeriodic(context)

        val pending = goAsync()
        app.container.appScope.launch(Dispatchers.Default) {
            try {
                withTimeoutOrNull(AlarmReceiver.WORK_BUDGET_MS) {
                    /*
                     * Re-seeded from the **cached** snapshot, not from a fetch.
                     * At boot the Wi-Fi is usually not up and the machine is
                     * probably asleep; the cache is what we have and it is
                     * enough to re-book today's alarms. The next poll corrects
                     * anything that moved.
                     */
                    app.container.reminders.reconcile(
                        app.container.repository.today.first(),
                    )
                }
            } finally {
                pending.finish()
            }
        }
    }
}

/**
 * **Done** and **Snooze 10m** on the notification itself (§8.4).
 *
 * Done enqueues the completion through the ordinary write queue, so it works
 * with no connection and with the app never having been opened — which is the
 * entire reason the queue exists.
 */
class ActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val targetId = intent.getStringExtra(Notifier.EXTRA_TARGET) ?: return
        val type = NotificationType.ofKey(intent.getStringExtra(Notifier.EXTRA_TYPE))
            ?: NotificationType.REMINDER
        val app = context.applicationContext as? LifeOsApp ?: return

        // Taken down first in both cases: the user has answered it.
        Notifier.cancel(context, type, targetId)

        val pending = goAsync()
        app.container.appScope.launch(Dispatchers.Default) {
            try {
                withTimeoutOrNull(AlarmReceiver.WORK_BUDGET_MS) {
                    when (action) {
                        ACTION_DONE -> {
                            app.container.repository.complete("task", targetId)
                            SyncWorker.request(context)
                        }

                        ACTION_SNOOZE -> {
                            val task = app.container.repository.today.first()
                                .data?.tasks?.firstOrNull { it.id == targetId }
                            /*
                             * The claim is released so the re-alarm is allowed
                             * to say it again. `/notified` is **not** re-posted:
                             * it was posted when this first fired, and the
                             * server's view of "this was surfaced" is correct.
                             */
                            app.container.firedNotifications.release("${type.key}:$targetId")
                            ReminderAlarms.snooze(
                                context = context,
                                taskId = targetId,
                                title = task?.title ?: "Life OS",
                                body = task?.subtitle,
                            )
                        }
                    }
                }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_DONE = "com.lifeos.app.notify.DONE"
        const val ACTION_SNOOZE = "com.lifeos.app.notify.SNOOZE"
    }
}
