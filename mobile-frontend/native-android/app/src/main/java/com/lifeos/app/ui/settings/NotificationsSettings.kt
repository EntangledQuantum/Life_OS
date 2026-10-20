package com.lifeos.app.ui.settings

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.lifeos.app.data.AppContainer
import com.lifeos.app.data.AppPrefs
import com.lifeos.app.data.api.SettingsDto
import com.lifeos.app.domain.Channels
import com.lifeos.app.domain.NotificationSounds
import com.lifeos.app.domain.NotificationType
import com.lifeos.app.domain.SoundId
import com.lifeos.app.notify.LifeOsChannels
import com.lifeos.app.notify.ReminderAlarms
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.components.PageBody
import com.lifeos.app.ui.components.SectionHeader
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette
import kotlinx.coroutines.launch

/**
 * The route: collects what the page needs and owns the side effects.
 *
 * Opening this screen is itself one of the two in-context moments §8.2 names
 * for asking `POST_NOTIFICATIONS` — the user is here to configure reminders, so
 * the request has a visible reason. It is asked once, and a denial is a
 * supported state rather than a dead end.
 */
@Composable
fun NotificationsRoute(
    container: AppContainer,
    settings: SettingsDto,
    onPatchBool: (String, Boolean) -> Unit,
    onPatchString: (String, String) -> Unit,
) {
    val context = LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val prefsFlow = remember { container.preferences.prefs }
    val prefs by prefsFlow.collectAsStateWithLifecycle(initialValue = AppPrefs())

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = { scope.launch { container.preferences.setNotificationPermissionAsked(true) } },
    )

    NotificationsSettingsScreen(
        settings = settings,
        chosenSounds = prefs.notificationSounds,
        permitted = LifeOsChannels.permitted(context),
        exactAlarmsAllowed = ReminderAlarms.canScheduleExact(context),
        onPickSound = { type, sound ->
            scope.launch {
                /*
                 * Order matters. The preference is written first and the
                 * channels are reconciled from it second, because the channel
                 * set is a *function of* the preference (`NotificationSounds.inUse`)
                 * rather than a thing maintained in parallel. `sync` creates the
                 * new channel and deletes the one that is no longer in use,
                 * which is §8.2's "create the new, post to it from then on,
                 * delete the old".
                 */
                container.preferences.setNotificationSound(type.key, sound.wire)
                val updated = prefs.notificationSounds + (type.key to sound.wire)
                LifeOsChannels.sync(context, updated, settings.notificationSound)
            }
        },
        onOpenChannelSettings = { type ->
            val sound = NotificationSounds.resolve(
                type = type,
                chosen = prefs.notificationSounds,
                serverDefault = settings.notificationSound,
            )
            // Make sure it exists before sending the user to its settings
            // screen: the OS shows nothing for a channel id it has never seen.
            LifeOsChannels.sync(context, prefs.notificationSounds, settings.notificationSound)
            open(context, LifeOsChannels.channelSettingsIntent(context, Channels.id(type, sound)))
        },
        onOpenAppNotificationSettings = {
            open(context, LifeOsChannels.appSettingsIntent(context))
        },
        onRequestPermission = {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        },
        onOpenExactAlarmSettings = {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                open(context, Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM))
            }
        },
        onPatchBool = onPatchBool,
        onPatchString = onPatchString,
    )
}

private fun open(context: Context, intent: Intent) {
    runCatching { context.startActivity(intent) }
}

/**
 * Settings → **Notifications** (§3.5, §8.1–§8.3), built.
 *
 * The page the previous milestone deliberately shipped as a placeholder, on the
 * grounds that a sound picker in front of no channels is the old app's dead
 * control over again. The delivery layer is here now, so the picker is real —
 * and it is honest about the one thing it cannot do:
 *
 * **Once a channel exists, the OS owns its sound.** Picking a sound here creates
 * a *new* channel and starts posting to that one; it does not edit the old one,
 * because Android does not allow that and should not. So every row also offers
 * **Android settings ›** for that exact channel, which is the truthful place to
 * change it. Our picker is a convenience that creates channels; the system is
 * the authority.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NotificationsSettingsScreen(
    settings: SettingsDto,
    chosenSounds: Map<String, String>,
    permitted: Boolean,
    exactAlarmsAllowed: Boolean,
    onPickSound: (NotificationType, SoundId) -> Unit,
    onOpenChannelSettings: (NotificationType) -> Unit,
    onOpenAppNotificationSettings: () -> Unit,
    onRequestPermission: () -> Unit,
    onOpenExactAlarmSettings: () -> Unit,
    onPatchBool: (String, Boolean) -> Unit,
    onPatchString: (String, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
    ) {
        PageBody {
            /* ---- blocked, if it is ---- */
            if (!permitted) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(Radii.tile))
                        .background(p.surface)
                        .padding(Spacing.md),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Text("Android is blocking notifications", style = LifeOsType.body, color = p.warning)
                    Text(
                        text = "Everything below still applies the moment it is allowed. " +
                            "Until then the in-app pulse and the status strip carry it all — " +
                            "nothing is lost, it is just quiet.",
                        style = LifeOsType.bodySmall,
                        color = p.faint,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        TextButton(onClick = onRequestPermission) {
                            Text("Allow", color = p.accent)
                        }
                        TextButton(onClick = onOpenAppNotificationSettings) {
                            Text("Android settings ›", color = p.muted)
                        }
                    }
                }
            }

            /* ---- one row per type, with its sound ---- */
            SectionHeader("Sounds")
            Text(
                text = "A sound belongs to an Android channel, and a channel's sound is fixed " +
                    "when it is created — the system owns it from then on. Picking one here " +
                    "makes a new channel and posts to that; Android settings is where it is " +
                    "really changed.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )

            NotificationType.choosable.forEach { type ->
                val current = NotificationSounds.resolve(
                    type = type,
                    chosen = chosenSounds,
                    serverDefault = settings.notificationSound,
                )
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    Text(type.label, style = LifeOsType.body, color = p.text)
                    Text(type.description, style = LifeOsType.bodySmall, color = p.faint)
                    FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                    ) {
                        SoundId.pickable.forEach { sound ->
                            SoundChip(
                                label = sound.label,
                                selected = sound == current,
                                onClick = { onPickSound(type, sound) },
                            )
                        }
                    }
                    TextButton(
                        onClick = { onOpenChannelSettings(type) },
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp()),
                    ) {
                        Text("Android settings for this channel ›", color = p.accent, style = LifeOsType.bodySmall)
                    }
                }
                HorizontalDivider(color = p.border)
            }

            Text(
                text = "Sync problems have no sound row: they are always silent and always " +
                    "low — a write that could not be saved is a thing to read later, not an " +
                    "interruption.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )

            HorizontalDivider(color = p.border)

            /* ---- quiet hours and DND, which are the server's ---- */
            SectionHeader("Quiet hours")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Silent during quiet hours", style = LifeOsType.body, color = p.text)
                    Text(
                        text = "The window wraps past midnight, so ${settings.quietHoursStart}" +
                            "–${settings.quietHoursEnd} means overnight.",
                        style = LifeOsType.bodySmall,
                        color = p.faint,
                    )
                }
                Switch(
                    checked = settings.quietHoursSilent,
                    onCheckedChange = { onPatchBool("quietHoursSilent", it) },
                )
            }
            TimeChipsRow(
                current = settings.quietHoursStart,
                options = listOf("21:00", "22:00", "22:30", "23:00", "00:00", "03:30"),
                onPick = { onPatchString("quietHoursStart", it) },
            )
            Text("…until", style = LifeOsType.bodySmall, color = p.faint)
            TimeChipsRow(
                current = settings.quietHoursEnd,
                options = listOf("06:00", "06:30", "07:00", "08:00", "10:30"),
                onPick = { onPatchString("quietHoursEnd", it) },
            )

            HorizontalDivider(color = p.border)

            SectionHeader("Do not disturb")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Silence everything", style = LifeOsType.body, color = p.text)
                    Text(
                        text = "Nothing is posted and nothing flashes — but the server is still " +
                            "told each reminder was surfaced, so they do not all arrive at once " +
                            "when you turn this back off.",
                        style = LifeOsType.bodySmall,
                        color = p.faint,
                    )
                }
                Switch(
                    checked = settings.doNotDisturb,
                    onCheckedChange = { onPatchBool("doNotDisturb", it) },
                )
            }
            Text(
                text = "Both of these are your Life OS settings, not this phone's: the website " +
                    "honours them too. Sounds are per-device, because a channel is.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )

            HorizontalDivider(color = p.border)

            /* ---- timing, told honestly ---- */
            SectionHeader("Timing")
            Mono(
                text = if (exactAlarmsAllowed) "exact alarms: allowed" else "exact alarms: not allowed",
                color = if (exactAlarmsAllowed) p.positive else p.warning,
                style = LifeOsType.mono13,
            )
            Text(
                text = if (exactAlarmsAllowed) {
                    "Reminders fire at the minute they are due, even in Doze."
                } else {
                    "Android may batch reminders, so one can arrive a few minutes late. " +
                        "Allowing exact alarms fixes that."
                },
                style = LifeOsType.bodySmall,
                color = p.faint,
            )
            if (!exactAlarmsAllowed && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                TextButton(
                    onClick = onOpenExactAlarmSettings,
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp()),
                ) {
                    Text("Allow exact alarms ›", color = p.accent)
                }
            }
            Text(
                text = "A reminder is due at its remind time, or ${settings.reminderLeadMinutes} " +
                    "minutes before the thing itself — whichever the agent set. Change the lead " +
                    "under The day.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )
        }
    }
}

@Composable
private fun SoundChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val p = palette
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(Radii.tile))
            .background(if (selected) p.accent.copy(alpha = 0.18f) else p.surface2)
            .clickable(onClick = onClick)
            .padding(horizontal = Spacing.md, vertical = Spacing.sm),
    ) {
        Mono(
            text = label,
            color = if (selected) p.accent else p.muted,
            style = LifeOsType.mono13,
        )
    }
}

/**
 * The same chip row as **The day**, for the same reason: these are half-hour
 * decisions about the shape of a day, and a wheel picker returning 22:47 would
 * store a precision nobody meant. A value the server holds that is not on our
 * list is still shown, and shown as selected.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TimeChipsRow(current: String, options: List<String>, onPick: (String) -> Unit) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        val all = if (current in options) options else listOf(current) + options
        all.forEach { option ->
            SoundChip(label = option, selected = option == current, onClick = { onPick(option) })
        }
    }
}

/** Local helper so the import list does not need `androidx.compose.ui.unit.dp`. */
private fun Int.dp() = androidx.compose.ui.unit.Dp(this.toFloat())
