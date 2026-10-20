package com.lifeos.app.notify

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.edit
import com.lifeos.app.domain.DerivedReminder
import com.lifeos.app.domain.NotificationType

/**
 * Alarms held by the OS, so a backgrounded or killed app still fires (§8.4).
 *
 * ## Why alarms rather than `WorkManager`
 *
 * A reminder is a statement about a *moment*. `WorkManager`'s minimum periodic
 * interval is fifteen minutes and its flex window is longer than that, so a
 * fifteen-minute lead delivered by periodic work is a coin toss between "on
 * time" and "after the thing started". The periodic sync in `SyncWorker` keeps
 * the cache and the widget current; the alarms say the actual reminders.
 *
 * ## Why not `setExactAndAllowWhileIdle` unconditionally
 *
 * This was the deliberate decision of the milestone, so it is written down.
 *
 *  - `SCHEDULE_EXACT_ALARM` is declared, and on Android 12 it is granted at
 *    install. From Android 13 it is a special permission the user grants in
 *    Settings, and it may be revoked at any time.
 *  - `USE_EXACT_ALARM` — which cannot be revoked — is **not** declared, and
 *    will not be. It is reserved by policy for alarm clocks and calendars, and
 *    a habit tracker claiming it is the kind of thing that gets an app flagged.
 *    The brief asked for nothing that would get the app killed or flagged.
 *
 * So: exact when the user has allowed it, and `setAndAllowWhileIdle` when they
 * have not. The inexact path still escapes Doze — that is what
 * `AndAllowWhileIdle` buys, and it is the part that matters — but the OS may
 * batch it, and in deep Doze that can mean several minutes late. The app says
 * so rather than implying otherwise: Settings → Notifications shows whether
 * exact alarms are permitted and links to the screen that grants it.
 *
 * Either way a `SecurityException` is caught. An alarm that cannot be set must
 * cost a notification, never the process.
 */
object ReminderAlarms {

    private const val ACTION_FIRE = "com.lifeos.app.notify.FIRE"
    private const val PREFS = "lifeos_alarms"
    private const val KEY_SCHEDULED = "scheduled"
    private const val SEPARATOR = "\u0001"

    /** Snooze is a purely local re-alarm; `/notified` has already been posted. */
    const val SNOOZE_MINUTES = 10

    /**
     * How many alarms are held at once.
     *
     * The snapshot is one day's worth, so this is generous. It is here because
     * an alarm per task on a pathological day is a way to annoy the OS's own
     * scheduler, and the ones that matter are the next few.
     */
    private const val MAX_ALARMS = 16

    /**
     * Replace the held alarms with exactly this set.
     *
     * Re-seeded on every poll, on boot and on a timezone change (§8.4), so it
     * has to be a reconciliation rather than an append: the previous ids are
     * remembered in a small `SharedPreferences` and cancelled first. Without
     * that, a task the agent moved or deleted keeps its old alarm and fires
     * about something that is no longer there.
     *
     * `SharedPreferences` rather than DataStore for this one thing because the
     * boot receiver reads it on the main thread with no coroutine scope of its
     * own, and it is a list of short strings.
     */
    fun reseed(context: Context, alarms: List<DerivedReminder>) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        val store = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        val previous = store.getString(KEY_SCHEDULED, null)
            ?.split(SEPARATOR)
            ?.filter { it.isNotBlank() }
            ?: emptyList()
        for (taskId in previous) {
            manager.cancel(firePendingIntent(context, taskId, null, null, mutable = false))
        }

        val kept = alarms.take(MAX_ALARMS)
        for (reminder in kept) {
            schedule(
                context = context,
                manager = manager,
                taskId = reminder.taskId,
                title = reminder.title,
                body = reminder.body,
                atMillis = reminder.notifyAtMillis,
            )
        }

        store.edit { putString(KEY_SCHEDULED, kept.joinToString(SEPARATOR) { it.taskId }) }
    }

    /**
     * One alarm, ten minutes out, after the user tapped Snooze.
     *
     * Local only, and open question #5's assumption made concrete: the server
     * owns reminder timing and has no snooze concept, so `notifiedAt` is already
     * set and the web client will not chime again. The divergence is that this
     * phone says it once more and no other client knows.
     */
    fun snooze(context: Context, taskId: String, title: String, body: String?) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        schedule(
            context = context,
            manager = manager,
            taskId = taskId,
            title = title,
            body = body,
            atMillis = System.currentTimeMillis() + SNOOZE_MINUTES * 60_000L,
        )
    }

    private fun schedule(
        context: Context,
        manager: AlarmManager,
        taskId: String,
        title: String,
        body: String?,
        atMillis: Long,
    ) {
        val pending = firePendingIntent(context, taskId, title, body, mutable = false)
        runCatching {
            if (canScheduleExact(manager)) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pending)
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pending)
            }
        }
    }

    /** False on 13+ until the user grants it, and revocable at any time. */
    fun canScheduleExact(manager: AlarmManager): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runCatching { manager.canScheduleExactAlarms() }.getOrDefault(false)
        } else {
            true
        }

    fun canScheduleExact(context: Context): Boolean {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return false
        return canScheduleExact(manager)
    }

    /**
     * The intent an alarm fires.
     *
     * The title rides along as an extra so the receiver can post immediately
     * even if the snapshot has since been cleared, but the receiver still
     * prefers the live task from Room — the extra is a fallback, not the truth.
     *
     * `FLAG_UPDATE_CURRENT` and a request code derived from the task id only:
     * extras are **not** part of `PendingIntent` equality, so the request code
     * is the only thing that keeps two tasks' alarms apart.
     */
    private fun firePendingIntent(
        context: Context,
        taskId: String,
        title: String?,
        body: String?,
        mutable: Boolean,
    ): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java)
            .setAction("$ACTION_FIRE.$taskId")
            .putExtra(Notifier.EXTRA_TYPE, NotificationType.REMINDER.key)
            .putExtra(Notifier.EXTRA_TARGET, taskId)
            .putExtra(AlarmReceiver.EXTRA_TITLE, title)
            .putExtra(AlarmReceiver.EXTRA_BODY, body)
        return PendingIntent.getBroadcast(
            context,
            taskId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or
                if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
