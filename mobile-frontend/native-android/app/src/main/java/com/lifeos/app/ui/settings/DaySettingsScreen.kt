package com.lifeos.app.ui.settings

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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import com.lifeos.app.data.api.SettingsDto
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.components.PageBody
import com.lifeos.app.ui.components.SectionHeader
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette

/**
 * Settings → **The day** (§3.5).
 *
 * `dayResetTime`, `plannedWake`, `plannedSleepStart/End`, and the timezone as a
 * read-only display. All of them `PATCH /api/v1/settings`, through the same
 * queue as everything else — so a change moves instantly offline and syncs
 * later, exactly like a tick.
 *
 * The values are offered as chips rather than as a time picker. Every one of
 * these is a half-hour-granularity decision about the shape of a day ("I get up
 * at seven"), the server stores them as `HH:mm` strings, and a wheel picker
 * returning 07:13 would store a precision nobody meant. The chips are the
 * closed set of sensible answers; anything else belongs on the dashboard, where
 * the server's own settings page is.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DaySettingsScreen(
    settings: SettingsDto,
    onPatchString: (String, String) -> Unit,
    onPatchInt: (String, Int) -> Unit,
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
            SectionHeader("Day reset")
            Text(
                text = "When the day rolls over. Anything you finish before this counts for " +
                    "the day you have been awake through, not the one that just started.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )
            TimeChips(
                current = settings.dayResetTime,
                options = listOf("00:00", "02:00", "03:00", "04:00", "05:00", "06:00"),
                onPick = { onPatchString("dayResetTime", it) },
            )

            HorizontalDivider(color = p.border)

            SectionHeader("Planned wake")
            Text(
                text = "Gives the ribbon its shape on a day with nothing scheduled.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )
            TimeChips(
                current = settings.plannedWake,
                options = listOf("05:00", "06:00", "06:30", "07:00", "07:30", "08:00", "09:00"),
                onPick = { onPatchString("plannedWake", it) },
            )

            HorizontalDivider(color = p.border)

            SectionHeader("Planned sleep")
            TimeChips(
                current = settings.plannedSleepStart,
                options = listOf("21:00", "22:00", "22:30", "23:00", "23:30", "00:00", "01:00"),
                onPick = { onPatchString("plannedSleepStart", it) },
            )
            Text("…until", style = LifeOsType.bodySmall, color = p.faint)
            TimeChips(
                current = settings.plannedSleepEnd,
                options = listOf("05:00", "06:00", "06:30", "07:00", "07:30", "08:00"),
                onPick = { onPatchString("plannedSleepEnd", it) },
            )

            HorizontalDivider(color = p.border)

            SectionHeader("Reminder lead")
            Text(
                text = "How long before a scheduled thing you hear about it — and the width " +
                    "of the window that puts it on Today. One number for both, because " +
                    "\"you should know about this now\" and \"this is on your plate now\" are " +
                    "the same statement.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                listOf(5, 10, 15, 30, 60).forEach { minutes ->
                    Chip(
                        label = "${minutes}m",
                        selected = settings.reminderLeadMinutes == minutes,
                        onClick = { onPatchInt("reminderLeadMinutes", minutes) },
                    )
                }
            }

            HorizontalDivider(color = p.border)

            SectionHeader("Timezone")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Mono(
                    text = settings.timezone ?: "—",
                    color = p.text,
                    style = LifeOsType.mono14,
                    modifier = Modifier.weight(1f),
                )
            }
            Text(
                text = "Read-only. The server resolves it, and an agent elsewhere needs it to " +
                    "schedule in your day rather than its own.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )

            Text(
                text = "Every change here queues like a tick: it moves now and syncs when the " +
                    "server is reachable.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TimeChips(current: String, options: List<String>, onPick: (String) -> Unit) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        // A value the server holds that is not one of ours is still shown, and
        // shown as selected — the app must not make a legitimate server setting
        // look wrong because it is not on our list.
        val all = if (current in options) options else listOf(current) + options
        all.forEach { option ->
            Chip(label = option, selected = option == current, onClick = { onPick(option) })
        }
    }
}

@Composable
private fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
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
 * Settings → **Home screen widget** (§3.5).
 *
 * The widget itself is a later milestone, and this page says exactly that rather
 * than offering a control that does nothing — which is the bug this whole
 * rewrite started from.
 */
@Composable
fun WidgetSettingsScreen(modifier: Modifier = Modifier) {
    val p = palette
    Column(modifier = modifier.fillMaxSize().padding(Spacing.lg)) {
        PageBody {
            SectionHeader("Home screen widget")
            Text(
                text = "Not in this build. When it ships it will show the growth meter, the " +
                    "ribbon with the now-marker and the next one or two things, reading the " +
                    "same cached snapshot this app does and updating on the same poll — it " +
                    "will never fetch on its own.",
                style = LifeOsType.body,
                color = p.muted,
            )
            Text(
                text = "Ticking something on the widget will go through the same write queue, " +
                    "so it will work with the app closed and the server asleep.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )
        }
    }
}

/**
 * Settings → **Notifications** (§3.5), deliberately not built here.
 *
 * Notifications own the channel strategy (§8.2) — a channel's sound is fixed at
 * creation and the OS owns it from then on — so the page and the delivery
 * mechanism have to ship together. A sound picker in front of no channels is
 * precisely the bug the rewrite exists to fix: the old app's picker did nothing
 * because `channelId` was being smuggled through content.
 */
@Composable
fun NotificationsSettingsScreen(modifier: Modifier = Modifier) {
    val p = palette
    Column(modifier = modifier.fillMaxSize().padding(Spacing.lg)) {
        PageBody {
            SectionHeader("Notifications")
            Text(
                text = "Not in this build. Sounds, quiet hours and do-not-disturb arrive with " +
                    "the delivery layer they configure — a sound picker in front of no " +
                    "channels is the old app's dead control over again.",
                style = LifeOsType.body,
                color = p.muted,
            )
            Text(
                text = "Until then, quiet hours and do-not-disturb set on your dashboard are " +
                    "still honoured: the status strip shows a silenced line, and an item that " +
                    "needs you still pulses.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )
        }
    }
}
