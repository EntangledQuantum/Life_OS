package com.lifeos.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.lifeos.app.data.ConnectionState
import com.lifeos.app.domain.PendingWrite
import com.lifeos.app.domain.WriteState
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.components.PageBody
import com.lifeos.app.ui.components.SectionHeader
import com.lifeos.app.ui.components.humanDate
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Palette
import com.lifeos.app.ui.theme.Palettes
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Sizes
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.craftedSurface
import com.lifeos.app.ui.theme.palette
import com.lifeos.app.ui.theme.pressTone
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The settings index (§3.5): navigation only.
 *
 * **No switches here.** The index is six rows rather than thirty controls, which
 * is the difference between a screen you can scan and the one this replaces.
 */
@Composable
fun SettingsIndexScreen(
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.lg)) {
        PageBody(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            SettingsRow("Appearance", "Theme, day graphic, reduced motion") { onOpen("appearance") }
            SettingsRow("Notifications", "Per-type sounds, quiet hours, DND") { onOpen("notifications") }
            SettingsRow("The day", "Reset time, lead minutes, sleep/wake") { onOpen("day") }
            SettingsRow("Connection", "Server, token, health, pending writes") { onOpen("connection") }
            HorizontalDivider(color = palette.border, modifier = Modifier.padding(vertical = Spacing.sm))
            SettingsRow("Home screen widget", "What it shows, and how to place it") { onOpen("widget") }
            SettingsRow("About", "Version · protocol · open source") { onOpen("about") }
        }
    }
}

@Composable
private fun SettingsRow(title: String, subtitle: String, onClick: () -> Unit) {
    val p = palette
    /*
     * A tone, not a ripple. These six rows are the whole screen and they sit
     * directly on the page; a ripple spreading across a full-width row draws
     * more attention to the tap than to the thing being opened — which is about
     * to slide in from the right anyway (§5.3).
     */
    val interaction = remember { MutableInteractionSource() }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .pressTone(interaction, RoundedCornerShape(Radii.tile))
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(vertical = Spacing.md, horizontal = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = LifeOsType.body, color = p.text)
            Text(subtitle, style = LifeOsType.bodySmall, color = p.faint)
        }
        Text("›", style = LifeOsType.cardTitle, color = p.muted)
    }
}

/**
 * Appearance: the eight device-local palettes and reduced motion.
 *
 * There is no "Web app accent" and never will be: `settings.accentTheme` is a
 * server setting that drives the website, and this app neither reads nor writes
 * it. Same API, different product surface (§9).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AppearanceScreen(
    currentPaletteId: String,
    reducedMotionLocal: Boolean,
    onPickPalette: (String) -> Unit,
    onReducedMotionChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.lg)) {
        PageBody {
            SectionHeader("Theme")
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Palettes.all.forEach { candidate ->
                    PaletteSwatch(
                        candidate = candidate,
                        selected = candidate.id == currentPaletteId,
                        onClick = { onPickPalette(candidate.id) },
                    )
                }
            }
            Text(
                text = "Switching a theme changes colours only — never a layout, a size or an " +
                    "order. The same plant in all eight.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )

            HorizontalDivider(color = p.border)

            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Reduced motion", style = LifeOsType.body, color = p.text)
                    Text(
                        text = "OR'd with Android's own setting — either one on means reduced.",
                        style = LifeOsType.bodySmall,
                        color = p.faint,
                    )
                }
                Switch(checked = reducedMotionLocal, onCheckedChange = onReducedMotionChange)
            }

            Text(
                text = "The day graphic follows the server's growthStyle. This build draws " +
                    "sprout, orb and bloom.",
                style = LifeOsType.bodySmall,
                color = p.faint,
            )
        }
    }
}

@Composable
private fun PaletteSwatch(candidate: Palette, selected: Boolean, onClick: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(Radii.tile))
            .clickable(onClick = onClick)
            .padding(Spacing.xs),
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(Radii.tile))
                .background(candidate.surface)
                .border(
                    width = if (selected) 2.dp else 1.dp,
                    color = if (selected) candidate.accent else candidate.border,
                    shape = RoundedCornerShape(Radii.tile),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(20.dp)
                    .clip(RoundedCornerShape(50))
                    .background(candidate.accent),
            )
        }
        Text(candidate.label, style = LifeOsType.label, color = palette.muted)
    }
}

/**
 * Settings → Connection (§3.5).
 *
 * Address, token source, the live state, the pending-write count, and the one
 * entry point into `server` that the old app's dead button was meant to be.
 */
@Composable
fun ConnectionSettingsScreen(
    address: String?,
    state: ConnectionState,
    lifeDayDate: String?,
    pendingCount: Int,
    protocol: Int,
    onChangeServer: () -> Unit,
    onOpenPendingWrites: () -> Unit,
    onReconnect: () -> Unit,
    onDisconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.lg)) {
        PageBody {
            SectionHeader("Address")
            Mono(address ?: "not set", color = p.text, style = LifeOsType.mono14)
            TextButton(onClick = onChangeServer, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                Text("Change server ›", color = p.accent)
            }

            HorizontalDivider(color = p.border)

            SectionHeader("Token")
            Text("API token · Android Keystore", style = LifeOsType.body, color = p.text)

            HorizontalDivider(color = p.border)

            SectionHeader("State")
            Text(describe(state), style = LifeOsType.body, color = p.text)
            Mono("protocol $protocol", color = p.muted)
            lifeDayDate?.let { Mono("life-day $it", color = p.muted) }
            TextButton(onClick = onReconnect, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                Text("Reconnect", color = p.accent)
            }

            HorizontalDivider(color = p.border)

            val pendingInteraction = remember { MutableInteractionSource() }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .pressTone(pendingInteraction, RoundedCornerShape(Radii.tile))
                    .clickable(
                        interactionSource = pendingInteraction,
                        indication = null,
                        onClick = onOpenPendingWrites,
                    )
                    .padding(vertical = Spacing.md, horizontal = Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Pending writes", style = LifeOsType.body, color = p.text)
                Mono(" ($pendingCount)", color = if (pendingCount > 0) p.warning else p.faint)
                Box(Modifier.weight(1f))
                Text("›", style = LifeOsType.cardTitle, color = p.muted)
            }

            HorizontalDivider(color = p.border)

            // The only destructive control in the app, and the only place the
            // M3 `error` role is allowed to appear.
            TextButton(onClick = onDisconnect) {
                Text("Disconnect", color = androidx.compose.material3.MaterialTheme.colorScheme.error)
            }
        }
    }
}

private fun describe(state: ConnectionState): String = when (state) {
    ConnectionState.Online -> "Online"
    ConnectionState.Probing -> "Checking…"
    ConnectionState.Unconfigured -> "Not connected"
    ConnectionState.Unauthorized -> "The server did not accept this token"
    is ConnectionState.Stale -> "Stale — ${state.failures} failed attempt(s)"
    is ConnectionState.Unreachable -> "Can't reach Life OS — ${state.detail ?: "no answer"}"
    is ConnectionState.Outdated -> "This app is too old for this server"
}

/**
 * The pending-write list (§7.5, visibility place three).
 *
 * What, when, which life-day, attempts, last error — and **Retry all** and
 * **Discard**. A stranded write is inspectable rather than mysterious: the point
 * of dropping a write across a day boundary is that the user can see exactly
 * what was dropped.
 */
@Composable
fun PendingWritesScreen(
    writes: List<PendingWrite>,
    onRetryAll: () -> Unit,
    onDiscard: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    Column(modifier = modifier.fillMaxSize().padding(Spacing.lg)) {
        if (writes.isEmpty()) {
            Text("Nothing waiting.", style = LifeOsType.body, color = p.muted)
            return@Column
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            TextButton(onClick = onRetryAll) { Text("Retry all", color = p.accent) }
            TextButton(onClick = onDiscard) {
                Text("Discard stranded", color = androidx.compose.material3.MaterialTheme.colorScheme.error)
            }
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            items(writes, key = { it.id }) { write ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = Sizes.dayRow)
                        .craftedSurface(
                            shape = RoundedCornerShape(Radii.tile),
                            border = null,
                            pressShrink = false,
                        )
                        .padding(Spacing.md),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = write.kind.name.lowercase().replace('_', ' '),
                            style = LifeOsType.body,
                            color = p.text,
                            modifier = Modifier.weight(1f),
                        )
                        Mono(
                            text = if (write.state == WriteState.STRANDED) "stranded" else "waiting",
                            color = if (write.state == WriteState.STRANDED) p.warning else p.muted,
                        )
                    }
                    Mono(write.targetId, color = p.faint, style = LifeOsType.mono11)
                    Mono(
                        text = "life-day ${humanDate(write.lifeDayDate)} · " +
                            "${clock(write.enqueuedAt)} · ${write.attempts} attempt(s)",
                        color = p.faint,
                        style = LifeOsType.mono11,
                    )
                    write.strandReason?.let {
                        Mono(it.name.lowercase().replace('_', ' '), color = p.warning, style = LifeOsType.mono11)
                    }
                    write.lastError?.let {
                        Text(it, style = LifeOsType.bodySmall, color = p.muted, maxLines = 2)
                    }
                }
            }
        }
    }
}

private val HHMM = DateTimeFormatter.ofPattern("HH:mm")

private fun clock(epochMillis: Long): String = runCatching {
    Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault()).format(HHMM)
}.getOrDefault("")

/**
 * About, and a plain statement of the privacy promise.
 *
 * It is in the product README, so it belongs on a screen the user can read: this
 * app ships no telemetry, no analytics and no crash-reporting SDK, and nothing
 * leaves the device except calls to the user's own server.
 */
@Composable
fun AboutScreen(
    versionName: String,
    protocol: Int,
    applicationId: String,
    modifier: Modifier = Modifier,
) {
    val p = palette
    Column(modifier = modifier.fillMaxSize().padding(Spacing.lg)) {
        PageBody {
            SectionHeader("Life OS for Android")
            Mono("version $versionName", color = p.text, style = LifeOsType.mono14)
            Mono("protocol $protocol", color = p.muted)
            Mono(applicationId, color = p.faint, style = LifeOsType.mono11)
            HorizontalDivider(color = p.border)
            Text(
                text = "No telemetry, no analytics, no crash reporting. Nothing leaves this " +
                    "device except requests to your own Life OS server.",
                style = LifeOsType.bodySmall,
                color = p.muted,
            )
        }
    }
}
