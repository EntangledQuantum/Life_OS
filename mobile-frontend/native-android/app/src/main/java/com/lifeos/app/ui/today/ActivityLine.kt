package com.lifeos.app.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.lifeos.app.data.api.ActiveSessionDto
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.theme.ActivityColors
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Sizes
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette
import kotlinx.coroutines.delay
import java.time.Instant

/**
 * `activeSession` is the only running thing in the app (§4.4).
 *
 * Nothing the agent scheduled ever "starts": a task has a target time and a done
 * flag, and there is no Start button on one anywhere. The only running thing is
 * this manually-set activity session, which is also the only thing that paints
 * the ribbon behind the now-marker.
 *
 * Deliberately quieter than an agenda card, and its control is smaller than a
 * row's tick. It is the one thing on Today that is not a thing to do.
 */
@Composable
fun ActivityLine(
    session: ActiveSessionDto?,
    onStart: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette

    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = Sizes.activityLine)
            .clip(RoundedCornerShape(Sizes.activityLine / 2))
            .background(p.surface),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(modifier = Modifier.size(Spacing.md))

        if (session == null) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(RoundedCornerShape(50))
                    .background(p.faint),
            )
            Text("Not tracking", style = LifeOsType.bodySmall, color = p.muted)
            Box(Modifier.weight(1f))
            TextButton(onClick = onStart) {
                Text("Start", style = LifeOsType.label, color = p.accent)
            }
        } else {
            val colour = ActivityColors.of(session.activity, p.accent)
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(RoundedCornerShape(50))
                    .background(colour),
            )
            Text(session.activity, style = LifeOsType.bodySmall, color = p.text)
            Mono("·", color = p.faint)
            Elapsed(startedAt = session.startedAt)
            Box(Modifier.weight(1f))
            TextButton(onClick = onStop) {
                Text("Stop", style = LifeOsType.label, color = p.muted)
            }
        }
    }
}

/**
 * `HH:MM:SS` ticked **locally** from `startedAt`, never polled.
 *
 * Polling a counter means it jumps by eight seconds at a time and disagrees with
 * the clock; a local tick is also the reason every figure in this app is
 * JetBrains Mono with tabular figures — otherwise the digits jitter the layout
 * once a second.
 */
@Composable
private fun Elapsed(startedAt: String) {
    val started = remember(startedAt) {
        runCatching { Instant.parse(startedAt) }.getOrNull()
    }
    var nowMillis by remember { mutableLongStateOf(System.currentTimeMillis()) }

    LaunchedEffect(startedAt) {
        while (true) {
            nowMillis = System.currentTimeMillis()
            delay(1_000)
        }
    }

    val text = if (started == null) {
        "--:--:--"
    } else {
        val seconds = ((nowMillis - started.toEpochMilli()) / 1000).coerceAtLeast(0)
        "%02d:%02d:%02d".format(seconds / 3600, (seconds % 3600) / 60, seconds % 60)
    }

    Mono(text, color = palette.text, style = LifeOsType.mono12)
}

/**
 * The activity picker's seven chips — a **closed set**; nothing invents a tag.
 *
 * Note it offers all seven here, while the widget's chips exclude Sleep and
 * Break. Both read [ActivityColors.MANUAL] / [ActivityColors.ALL] rather than
 * listing strings, so the two cannot drift.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ActivityPickerChips(
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ActivityColors.ALL.forEach { tag ->
            val colour = ActivityColors.of(tag, p.accent)
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(Sizes.activityLine / 2))
                    .background(colour.copy(alpha = 0.16f))
                    .clickable(onClick = { onPick(tag) })
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(RoundedCornerShape(50))
                        .background(colour),
                )
                Text(tag, style = LifeOsType.label, color = p.text)
            }
        }
    }
}
