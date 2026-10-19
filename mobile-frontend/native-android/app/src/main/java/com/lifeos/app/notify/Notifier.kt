package com.lifeos.app.notify

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.lifeos.app.MainActivity
import com.lifeos.app.R
import com.lifeos.app.domain.Channels
import com.lifeos.app.domain.NotificationType
import com.lifeos.app.domain.SoundId

/**
 * Posting a notification (UI_SPEC §8.1–§8.4).
 *
 * The thing the old app got wrong was structural and cannot be written here:
 * `channelId` was passed on the notification's *content*, where no such field
 * exists, so it was silently dropped and every notification landed on the
 * default channel — which is why the sound picker appeared to do nothing even
 * after the channels were split. In Kotlin the channel is the first argument of
 * `NotificationCompat.Builder(context, channelId)`; there is nowhere else to put
 * it and no way to omit it. The type system makes the old bug unrepresentable.
 */
object Notifier {

    /** Extras a tap carries into [MainActivity]. Read on cold start and live. */
    const val EXTRA_TYPE = "com.lifeos.app.notify.TYPE"
    const val EXTRA_TARGET = "com.lifeos.app.notify.TARGET"

    /**
     * What the user sees, and what they can do about it without opening the app.
     *
     * `sound` is passed in rather than resolved here: it decides the channel,
     * and the channel must be one [LifeOsChannels.sync] has created. One
     * resolution, in `NotificationSounds`.
     */
    fun post(
        context: Context,
        type: NotificationType,
        targetId: String,
        title: String,
        body: String?,
        sound: SoundId,
        /** Done / Snooze, for Reminder and Due-now only (§8.4). */
        withTaskActions: Boolean = false,
    ) {
        /*
         * Checked rather than assumed, twice, because the two checks are not
         * the same question.
         *
         * `POST_NOTIFICATIONS` is the runtime grant on API 33+. It is checked
         * explicitly — not merely wrapped in a `runCatching` — because a denied
         * post must not throw and must not be an error: §8.2 says the in-app
         * pulse and the status strip still carry everything, so a refused post
         * is the normal outcome of a supported configuration.
         *
         * `areNotificationsEnabled` is broader and catches the case the
         * permission cannot: a user who has switched this app's notifications
         * off in system settings, on any API level.
         */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        if (!LifeOsChannels.permitted(context)) return

        val channelId = Channels.id(type, sound)
        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setAutoCancel(true)
            .setCategory(
                if (type == NotificationType.SYNC_PROBLEM) {
                    NotificationCompat.CATEGORY_ERROR
                } else {
                    NotificationCompat.CATEGORY_REMINDER
                },
            )
            .setContentIntent(tapIntent(context, type, targetId))

        if (!body.isNullOrBlank()) {
            builder.setContentText(body)
            builder.setStyle(NotificationCompat.BigTextStyle().bigText(body))
        }

        if (withTaskActions) {
            builder.addAction(
                0,
                "Done",
                actionIntent(context, ActionReceiver.ACTION_DONE, type, targetId),
            )
            builder.addAction(
                0,
                "Snooze 10m",
                actionIntent(context, ActionReceiver.ACTION_SNOOZE, type, targetId),
            )
        }

        runCatching {
            NotificationManagerCompat.from(context).notify(
                notificationId(type, targetId),
                builder.build(),
            )
        }
    }

    fun cancel(context: Context, type: NotificationType, targetId: String) {
        runCatching {
            NotificationManagerCompat.from(context).cancel(notificationId(type, targetId))
        }
    }

    /**
     * One stable id per (type, target).
     *
     * Stable so a re-post replaces rather than stacks, and per-type so a
     * Reminder and a Due-now for the same task are two rows — they are two
     * different statements and dismissing one must not dismiss the other.
     */
    fun notificationId(type: NotificationType, targetId: String): Int =
        "${type.key}:$targetId".hashCode()

    /**
     * The tap (§8.4).
     *
     * It goes to [MainActivity] with the type and target as extras rather than
     * to a deep-link URI, because the destination is a *sheet* and the sheets
     * are view-model state rather than `NavHost` routes (a stated divergence).
     * The activity hands both to the view model, which opens the right overlay
     * on whichever destination the app resumes on.
     *
     * `FLAG_ACTIVITY_SINGLE_TOP` with `onNewIntent` handles the warm case;
     * the cold case is handled by reading `intent` in `onCreate`, and **both
     * paths are required** — a listener alone misses the cold start, which is
     * the common case, because the notification is why the app is opening.
     */
    private fun tapIntent(
        context: Context,
        type: NotificationType,
        targetId: String,
    ): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .setAction("${ACTION_OPEN}.${type.key}.$targetId")
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(EXTRA_TYPE, type.key)
            .putExtra(EXTRA_TARGET, targetId)
        return PendingIntent.getActivity(
            context,
            notificationId(type, targetId),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun actionIntent(
        context: Context,
        action: String,
        type: NotificationType,
        targetId: String,
    ): PendingIntent {
        val intent = Intent(context, ActionReceiver::class.java)
            .setAction(action)
            .putExtra(EXTRA_TYPE, type.key)
            .putExtra(EXTRA_TARGET, targetId)
        return PendingIntent.getBroadcast(
            context,
            "$action:${type.key}:$targetId".hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * A distinct action per (type, target) so `PendingIntent` equality does not
     * collapse two taps into one. Intent extras are **not** part of that
     * equality, which is a classic way to end up opening the wrong task.
     */
    private const val ACTION_OPEN = "com.lifeos.app.notify.OPEN"
}
