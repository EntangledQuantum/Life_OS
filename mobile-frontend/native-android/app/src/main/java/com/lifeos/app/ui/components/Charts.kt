package com.lifeos.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.lifeos.app.domain.ChartSeries
import com.lifeos.app.ui.theme.palette

/**
 * The XP area chart with its dashed target line (§3.3).
 *
 * One `Canvas`, no library, and **no animation**: it is content that arrives
 * with the data, not a thing that performs. Chrome is still, content moves —
 * and a chart that grows out of the floor every time a poll lands is the
 * shimmer rule in another costume.
 *
 * The target rides the same axis as the actual, which is the whole reason the
 * payload carries both: a number without its target is not a measurement.
 */
@Composable
fun AreaChart(
    series: ChartSeries,
    modifier: Modifier = Modifier,
    height: Dp = 120.dp,
    line: Color = palette.accent,
    fill: Color = palette.accent,
    target: Color = palette.muted,
) {
    val p = palette
    if (series.isEmpty) {
        // A real but empty window is not an error, so it gets a flat baseline
        // rather than an empty box that reads as a failed load.
        Box(modifier = modifier.fillMaxWidth().height(height)) {
            Canvas(modifier = Modifier.fillMaxWidth().height(height)) {
                drawLine(
                    color = p.border,
                    start = Offset(0f, size.height - 1f),
                    end = Offset(size.width, size.height - 1f),
                    strokeWidth = 1f,
                )
            }
        }
        return
    }

    Canvas(modifier = modifier.fillMaxWidth().height(height)) {
        val points = series.points
        val axis = series.axisMax.toFloat().coerceAtLeast(1f)
        val stepX = if (points.size > 1) size.width / (points.size - 1) else 0f

        fun x(index: Int) = if (points.size > 1) index * stepX else size.width / 2f
        fun y(value: Double) =
            size.height - (value.toFloat().coerceAtLeast(0f) / axis).coerceIn(0f, 1f) * size.height

        /* The area under the actual, then its outline on top. */
        val area = Path().apply {
            moveTo(x(0), size.height)
            points.forEachIndexed { index, point -> lineTo(x(index), y(point.value)) }
            lineTo(x(points.lastIndex), size.height)
            close()
        }
        drawPath(
            path = area,
            brush = Brush.verticalGradient(
                listOf(fill.copy(alpha = 0.32f), fill.copy(alpha = 0.02f)),
            ),
        )

        val outline = Path().apply {
            points.forEachIndexed { index, point ->
                if (index == 0) moveTo(x(index), y(point.value)) else lineTo(x(index), y(point.value))
            }
        }
        drawPath(path = outline, color = line, style = Stroke(width = 2f))

        /*
         * The target, dashed, only where there is one.
         *
         * Two renderings, because they are two different statements:
         *
         *  - **In the domain.** A solid-ish dash at the value, which is where
         *    the target really is.
         *  - **Off-scale** — the target is above the top of the box, because
         *    the domain is sized to the data (see `AnalyticsModel.series`).
         *    Then it is drawn as a *boundary* rather than as a value: pinned
         *    just inside the ceiling so it is not half-clipped, at a lower
         *    alpha and a longer dash so it does not read as "the target is
         *    exactly here". The caller prints the figure and says it is above
         *    the chart; that caption is the other half of this, not decoration.
         */
        val targets = points.filter { it.target > 0.0 }
        if (targets.isNotEmpty()) {
            val offScale = series.targetOffScale
            val dash = PathEffect.dashPathEffect(
                if (offScale) floatArrayOf(14f, 10f) else floatArrayOf(6f, 6f),
            )
            // Half the stroke plus a hair, so a clamped line sits fully inside
            // the box instead of being cut in half by the top edge.
            val ceiling = 2f
            val targetPath = Path().apply {
                points.forEachIndexed { index, point ->
                    val value = if (point.target > 0.0) point.target else targets.first().target
                    val yy = if (offScale) ceiling else y(value)
                    if (index == 0) moveTo(x(index), yy) else lineTo(x(index), yy)
                }
            }
            drawPath(
                path = targetPath,
                color = target.copy(alpha = if (offScale) 0.3f else 0.55f),
                style = Stroke(width = 1.5f, pathEffect = dash),
            )
        }
    }
}

/**
 * A thin determinate track — a goal's progress, a quest's count.
 *
 * `progressPct` is clamped for the fill only; a figure over 100 still prints.
 */
@Composable
fun ThinTrack(
    fraction: Float,
    modifier: Modifier = Modifier,
    height: Dp = 4.dp,
    colour: Color = palette.accent,
) {
    val p = palette
    Canvas(modifier = modifier.fillMaxWidth().height(height)) {
        val radius = size.height / 2f
        drawRoundRect(
            color = p.text.copy(alpha = 0.08f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(radius),
        )
        val width = size.width * fraction.coerceIn(0f, 1f)
        if (width > 0f) {
            drawRoundRect(
                color = colour,
                size = androidx.compose.ui.geometry.Size(width, size.height),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(radius),
            )
        }
    }
}
