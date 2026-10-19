package com.lifeos.app.notify

import android.app.NotificationChannel
import android.app.NotificationChannelGroup
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import androidx.core.net.toUri
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.lifeos.app.R
import com.lifeos.app.domain.Channels
import com.lifeos.app.domain.NotificationImportance
import com.lifeos.app.domain.NotificationSounds
import com.lifeos.app.domain.NotificationType
import com.lifeos.app.domain.SoundId

/**
 * Android notification channels (UI_SPEC §8.2).
 *
 * The one thing to understand before changing anything here: **a channel's
 * sound is fixed when the channel is created and the OS owns it from then on.**
 * That is deliberate on Android's part — an app must not be able to take a
 * user's choice back — and it means a sound change is not an edit, it is a new
 * channel. The old app shared channels across sounds, so its sound picker
 * silently did nothing for the entire life of the app.
 *
 * Hence: the sound is part of the channel id (`domain/Channels`), changing a
 * sound creates the new channel and deletes the old one, and the system's own
 * per-channel screen is offered as the authority — our picker is a convenience
 * that creates channels, not the owner of the setting.
 */
object LifeOsChannels {

    /**
     * Bring the channel set in line with the preferences.
     *
     * Idempotent, and cheap enough to call on every launch: `createNotificationChannel`
     * on an existing id is a no-op for everything the user may have changed
     * (importance, sound, vibration), so re-running this cannot reset their
     * settings. What it does do is create anything missing and delete any
     * `lifeos-` channel that is no longer in use — which is the "delete the old
     * one" half of §8.2, and the reason switching a sound away and back restores
     * what the user had: Android remembers a deleted channel's settings against
     * its id.
     */
    fun sync(context: Context, chosen: Map<String, String>, serverDefault: String) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return

        for (type in NotificationType.entries) {
            manager.createNotificationChannelGroup(
                NotificationChannelGroup(Channels.groupId(type), type.label),
            )
        }

        val wanted = NotificationSounds.inUse(chosen, serverDefault)
        for ((id, pair) in wanted) {
            val (type, sound) = pair
            manager.createNotificationChannel(channel(context, id, type, sound))
        }

        /*
         * Delete ours that are no longer wanted. Scoped to the `lifeos-` prefix
         * so a channel this app did not create is never touched, and skipping
         * anything still in `wanted` so this cannot delete what it just made.
         */
        for (existing in manager.notificationChannels) {
            val id = existing.id
            if (id.startsWith("lifeos-") && id !in wanted) {
                manager.deleteNotificationChannel(id)
            }
        }
    }

    private fun channel(
        context: Context,
        id: String,
        type: NotificationType,
        sound: SoundId,
    ): NotificationChannel {
        val channel = NotificationChannel(id, label(type, sound), importance(type))
        channel.description = type.description
        channel.group = Channels.groupId(type)

        if (sound.silent) {
            // A silent channel, not a channel we decline to post to: the visual
            // notification is the point and must never depend on audio (§8.4).
            channel.setSound(null, null)
            channel.enableVibration(type.importance == NotificationImportance.HIGH)
        } else {
            channel.setSound(
                uri(context, sound),
                AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .build(),
            )
        }

        if (type == NotificationType.SYNC_PROBLEM) {
            // Silent, low, and out of the way: a sync problem is a thing to read
            // later, not an interruption (§8.1).
            channel.setShowBadge(false)
            channel.enableVibration(false)
        }
        return channel
    }

    /**
     * The name the user reads in Android's own settings.
     *
     * The sound is in the name because the ids are per-sound: without it a user
     * who has changed sounds twice sees three identically-named "Reminder"
     * channels and cannot tell which one is live.
     */
    private fun label(type: NotificationType, sound: SoundId): String =
        if (sound.silent) "${type.label} (silent)" else "${type.label} (${sound.label})"

    private fun importance(type: NotificationType): Int = when (type.importance) {
        NotificationImportance.HIGH -> NotificationManager.IMPORTANCE_HIGH
        NotificationImportance.DEFAULT -> NotificationManager.IMPORTANCE_DEFAULT
        NotificationImportance.LOW -> NotificationManager.IMPORTANCE_LOW
    }

    /**
     * A `res/raw` resource URI for a bundled WAV.
     *
     * `android.resource://` rather than a file path or an asset: the OS plays
     * this while none of our code is running, so it has to be a URI the system
     * can resolve on its own.
     */
    fun uri(context: Context, sound: SoundId): android.net.Uri? {
        val resId = when (sound) {
            SoundId.CHIME -> R.raw.chime
            SoundId.BELL -> R.raw.bell
            SoundId.MARIMBA -> R.raw.marimba
            SoundId.PULSE -> R.raw.pulse
            SoundId.ALERT -> R.raw.alert
            SoundId.NONE -> return null
        }
        return "android.resource://${context.packageName}/$resId".toUri()
    }

    /** Whether the user has granted `POST_NOTIFICATIONS` (always true below 33). */
    fun permitted(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled()

    /**
     * `ACTION_CHANNEL_NOTIFICATION_SETTINGS` for one type's live channel (§8.2).
     *
     * Offered beside every sound row, because once the OS owns the sound, the
     * OS's own screen is the truthful place to change it. A picker that pretends
     * otherwise is the dead control again.
     */
    fun channelSettingsIntent(context: Context, channelId: String): Intent =
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID, channelId)

    /** The app's own notification screen — where a denied permission is fixed. */
    fun appSettingsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
}
