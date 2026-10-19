package com.lifeos.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.lifeos.app.data.ConnectionState
import com.lifeos.app.data.StrandedNotice
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.LocalReducedMotion
import com.lifeos.app.ui.theme.Motion
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Sizes
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * **One** surface for every non-Online state (§7.4).
 *
 * 32dp, `surface2`, a 2dp amber top edge, directly under the top app bar on
 * every screen. It participates in layout and pushes content down — it never
 * covers content.
 *
 * It animates **once per state change**, not once per failed poll. A strip that
 * re-animates every 8 seconds is worse than no strip, which is why the animation
 * is keyed on the state's identity and not on the poll.
 */
@Composable
fun StatusStrip(
    state: ConnectionState,
    fetchedAt: Long?,
    strandedNotice: StrandedNotice?,
    silencedUntil: String?,
    onRetry: () -> Unit,
    onChangeServer: () -> Unit,
    onDismissStranded: () -> Unit,
    onSeeStranded: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val reduced = LocalReducedMotion.current
    val duration = if (reduced) Motion.REDUCED else Motion.SHORT

    Column(modifier = modifier.fillMaxWidth()) {
        AnimatedVisibility(
            visible = state.showsStrip,
            enter = fadeIn(tween(duration)) + expandVertically(tween(duration)),
            exit = fadeOut(tween(duration)) + shrinkVertically(tween(duration)),
        ) {
            ConnectionLine(
                state = state,
                fetchedAt = fetchedAt,
                onRetry = onRetry,
                onChangeServer = onChangeServer,
            )
        }

        /*
         * The stranded-write notice sits in the strip's position and is
         * dismissible. It surfaces exactly once — never silently, never
         * auto-retried, never re-dated.
         */
        AnimatedVisibility(
            visible = strandedNotice != null,
            enter = fadeIn(tween(duration)) + expandVertically(tween(duration)),
            exit = fadeOut(tween(duration)) + shrinkVertically(tween(duration)),
        ) {
            strandedNotice?.let {
                StrandedLine(
                    notice = it,
                    onSeeThem = onSeeStranded,
                    onDismiss = onDismissStranded,
                )
            }
        }

        /*
         * DND / quiet hours: the same treatment, quieter, no amber edge.
         * Silence must be visible or a missed reminder reads as a broken app.
         */
        AnimatedVisibility(
            visible = silencedUntil != null,
            enter = fadeIn(tween(duration)),
            exit = fadeOut(tween(duration)),
        ) {
            silencedUntil?.let { SilencedLine(it) }
        }
    }
}

@Composable
private fun ConnectionLine(
    state: ConnectionState,
    fetchedAt: Long?,
    onRetry: () -> Unit,
    onChangeServer: () -> Unit,
) {
    val p = palette
    Column(modifier = Modifier.fillMaxWidth()) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(p.warning),
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Sizes.statusStrip)
                .background(p.surface2)
                .padding(horizontal = Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Text("◆", style = LifeOsType.label, color = p.warning)
            Text(
                text = headline(state),
                style = LifeOsType.bodySmall,
                color = p.text,
                modifier = Modifier.weight(1f, fill = false),
            )
            // The timestamp is the cache's `fetchedAt`, in mono, so "stale" is a
            // fact rather than a vibe.
            fetchedAt?.let { Mono("· ${clock(it)}", color = p.muted) }

            Box(modifier = Modifier.weight(1f))

            if (state is ConnectionState.Unreachable) {
                TextButton(onClick = onRetry) { Text("Retry", style = LifeOsType.label, color = p.accent) }
            }
            StripMenu(onChangeServer = onChangeServer, onReconnect = onRetry)
        }
    }
}

/**
 * `⋮` holds **Change server** and **Reconnect**, so `server` is reachable from
 * every screen in two taps even with no connection at all.
 */
@Composable
private fun StripMenu(onChangeServer: () -> Unit, onReconnect: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.size(32.dp)) {
            Icon(Icons.Filled.MoreVert, contentDescription = "Connection options", tint = palette.muted)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text("Change server") },
                onClick = { open = false; onChangeServer() },
            )
            DropdownMenuItem(
                text = { Text("Reconnect") },
                onClick = { open = false; onReconnect() },
            )
        }
    }
}

@Composable
private fun StrandedLine(
    notice: StrandedNotice,
    onSeeThem: () -> Unit,
    onDismiss: () -> Unit,
) {
    val p = palette
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(p.surface2)
            .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "${notice.count} ${if (notice.count == 1) "change" else "changes"} from " +
                "${humanDate(notice.lifeDayDate)} couldn't be saved — the day had already " +
                "rolled over.",
            style = LifeOsType.bodySmall,
            color = p.text,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onSeeThem) { Text("See them", style = LifeOsType.label, color = p.accent) }
        TextButton(onClick = onDismiss) { Text("Dismiss", style = LifeOsType.label, color = p.muted) }
    }
}

@Composable
private fun SilencedLine(until: String) {
    val p = palette
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(p.surface2)
            .padding(horizontal = Spacing.md, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Text("◇", style = LifeOsType.label, color = p.muted)
        Text("Silenced until $until", style = LifeOsType.bodySmall, color = p.muted)
    }
}

/** The pending-write count beside the gear (§7.5): `2↑`. Cross-fades, never spins. */
@Composable
fun PendingCountBadge(count: Int, state: ConnectionState, modifier: Modifier = Modifier) {
    // At Online with a draining queue it is not shown at all — a queue that
    // clears in 300ms is not news.
    val visible = count > 0 && state !is ConnectionState.Online
    androidx.compose.animation.Crossfade(
        targetState = if (visible) count else 0,
        animationSpec = tween(if (LocalReducedMotion.current) Motion.REDUCED else Motion.SHORT),
        label = "pending-count",
        modifier = modifier,
    ) { value ->
        if (value > 0) {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(Radii.tile))
                    .background(palette.surface2)
                    .padding(horizontal = Spacing.xs, vertical = 2.dp),
            ) {
                Mono("$value↑", color = palette.warning)
            }
        } else {
            Box(Modifier)
        }
    }
}

private fun headline(state: ConnectionState): String = when (state) {
    is ConnectionState.Stale -> "Last updated"
    is ConnectionState.Unreachable -> "Can't reach Life OS · showing"
    else -> ""
}

private val HHMM = DateTimeFormatter.ofPattern("HH:mm")

private fun clock(epochMillis: Long): String =
    runCatching {
        Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault()).format(HHMM)
    }.getOrDefault("")

/** `2026-10-19` → `Mon 19 Oct`. */
fun humanDate(isoDate: String): String = runCatching {
    java.time.LocalDate.parse(isoDate)
        .format(DateTimeFormatter.ofPattern("EEE d MMM"))
}.getOrDefault(isoDate)
