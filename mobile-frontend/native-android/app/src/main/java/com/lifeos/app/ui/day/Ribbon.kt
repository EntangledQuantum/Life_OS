package com.lifeos.app.ui.day

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.lifeos.app.data.api.TimelineBlockDto
import com.lifeos.app.domain.Ribbon
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.theme.serverColor
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Sizes
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette
import kotlinx.coroutines.delay
import java.time.Instant

/**
 * The day's shape, and **the one thing to look at on Day**: the now-marker.
 *
 * Drawn exactly as the server computed it — `left = startHour/24`,
 * `width = (endHour-startHour)/24`, overdrawn by a hair to kill the subpixel
 * seams between neighbours, never recomputed from the blocks.
 *
 * Either side of the marker the ribbon means two different things, and they are
 * drawn differently because of it:
 *
 *  - behind it, `actual: true` — what was actually done, **solid**;
 *  - ahead of it, `actual: false` — the plan, **tinted with a 1dp outline**.
 *
 * `status: "done"` goes to 55%. A plan drawn solid across hours that have
 * already passed says nothing about whether any of it happened.
 */
@Composable
fun DayRibbon(
    blocks: List<TimelineBlockDto>,
    timezone: String?,
    modifier: Modifier = Modifier,
) {
    val p = palette
    val segments = remember(blocks) { Ribbon.segments(blocks) }

    // The marker moves with the clock, not with the poll: a ribbon whose "now"
    // only updates every ten seconds is visibly wrong on a 56dp bar.
    var now by remember { mutableFloatStateOf(Ribbon.nowFraction(Instant.now(), timezone)) }
    LaunchedEffect(timezone) {
        while (true) {
            now = Ribbon.nowFraction(Instant.now(), timezone)
            delay(30_000)
        }
    }

    Column(modifier = modifier.fillMaxWidth()) {
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(Sizes.ribbon),
        ) {
            // ~0.2dp of overdraw per segment. Without it, neighbours that share
            // a boundary show a one-pixel black seam at most densities.
            val bleed = 0.2.dp.toPx()

            segments.forEach { segment ->
                val colour = serverColor(segment.colorHex) ?: p.accent
                val left = segment.left * size.width
                val width = segment.width * size.width + bleed
                // Multiplied through, never replaced. The server sends
                // "Unlogged" as rgba(255,255,255,0.05) and serverColor keeps
                // that 0.05 — but copy(alpha = x) *overwrites* it, which turned
                // a 5% white into a solid white block filling the ribbon.
                val alpha = if (segment.done) 0.55f else 1f

                if (segment.actual) {
                    drawRect(
                        color = colour.copy(alpha = colour.alpha * alpha),
                        topLeft = Offset(left, 0f),
                        size = Size(width, size.height),
                    )
                } else {
                    drawRect(
                        color = colour.copy(alpha = colour.alpha * 0.22f * alpha),
                        topLeft = Offset(left, 0f),
                        size = Size(width, size.height),
                    )
                    drawRect(
                        color = colour.copy(alpha = colour.alpha * 0.55f * alpha),
                        topLeft = Offset(left, 0f),
                        size = Size(segment.width * size.width, size.height),
                        style = Stroke(width = 1.dp.toPx()),
                    )
                }
            }

            // The now-marker: full height, 2dp, accent. Nothing else on Day is
            // accent-coloured, which is what makes it the one thing.
            val x = now * size.width
            drawRect(
                color = p.accent,
                topLeft = Offset(x - 1.dp.toPx(), 0f),
                size = Size(2.dp.toPx(), size.height),
            )
        }

        HourTicks(now = now)
    }
}

/** Sparse hour labels, in mono, with the marker's own label called out. */
@Composable
private fun HourTicks(now: Float) {
    val p = palette
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Ribbon.HOUR_TICKS.forEach { hour ->
            Mono(
                text = "%02d".format(if (hour == 24) 0 else hour),
                color = p.faint,
                style = LifeOsType.mono11,
            )
        }
    }
    Mono(
        text = "now %02d:%02d".format(
            (now * 24f).toInt(),
            ((now * 24f - (now * 24f).toInt()) * 60f).toInt(),
        ),
        color = p.accent,
        style = LifeOsType.mono11,
    )
}

/**
 * The ribbon's legend.
 *
 * The seven activity colours are the only semantic colour on a content surface
 * and they mean the same thing in every theme — but the ribbon is the one place
 * several of them sit side by side with no labels, so it is the one place that
 * earns a legend.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RibbonLegend(blocks: List<TimelineBlockDto>, modifier: Modifier = Modifier) {
    val p = palette
    val entries = remember(blocks) { Ribbon.legend(blocks) }
    if (entries.isEmpty()) return

    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        entries.forEach { entry ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(serverColor(entry.colorHex) ?: p.accent),
                )
                androidx.compose.material3.Text(
                    text = entry.category,
                    style = LifeOsType.label,
                    color = p.muted,
                )
            }
        }
    }
}
