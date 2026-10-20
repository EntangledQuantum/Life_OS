package com.lifeos.app.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.LocalReducedMotion
import com.lifeos.app.ui.theme.Motion
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Sizes
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.craftedSurface
import com.lifeos.app.ui.theme.palette

/**
 * Every number, time, duration, percentage and id (§6.6).
 *
 * A single composable rather than a convention, so "is this figure mono?" is
 * answered by which function was called rather than by reading a text style.
 */
@Composable
fun Mono(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LifeOsType.mono12,
    color: Color = palette.muted,
    maxLines: Int = 1,
) {
    Text(
        text = text,
        modifier = modifier,
        style = style,
        color = color,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * Line length capped and centred — the old `PageBody` (§6.6).
 *
 * 560dp, so a tablet does not stretch a sentence across 1200 pixels.
 */
@Composable
fun PageBody(
    modifier: Modifier = Modifier,
    verticalArrangement: Arrangement.Vertical = Arrangement.spacedBy(Spacing.lg),
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Box(modifier = modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Column(
            modifier = Modifier
                .widthIn(max = Sizes.contentMax)
                .fillMaxWidth(),
            verticalArrangement = verticalArrangement,
            content = content,
        )
    }
}

/**
 * The pulse (§5.5): a 2dp border breathing between 25% and 60% alpha, 1800ms,
 * `EaseInOutSine`. No scale, no shadow, no colour change.
 *
 * Under reduced motion it becomes a **static** 60%-alpha border: the information
 * ("this needs you") survives, the movement does not.
 *
 * One implementation, used by every place that pulses, and there is never more
 * than one pulsing region on a screen.
 */
@Composable
fun Modifier.pulseBorder(color: Color, shape: androidx.compose.ui.graphics.Shape): Modifier {
    val reduced = LocalReducedMotion.current
    if (reduced) {
        return border(2.dp, color.copy(alpha = Motion.PULSE_MAX_ALPHA), shape)
    }
    val transition = rememberInfiniteTransition(label = "pulse")
    val alpha by transition.animateFloat(
        initialValue = Motion.PULSE_MIN_ALPHA,
        targetValue = Motion.PULSE_MAX_ALPHA,
        animationSpec = infiniteRepeatable(
            animation = tween(Motion.PULSE_PERIOD, easing = Motion.easeInOutSine),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulse-alpha",
    )
    return border(2.dp, color.copy(alpha = alpha), shape)
}

/**
 * The error panel (§3 state rules).
 *
 * Inline, in the content area — never a dialog, never a snackbar for a load
 * failure. It states what it was waiting for, the real server message, the
 * address it tried, and offers **Try again** and **Change server**, both of
 * which actually work. A screen with no data always offers a way out.
 */
@Composable
fun ErrorPanel(
    waitingFor: String,
    serverMessage: String?,
    address: String?,
    onRetry: () -> Unit,
    onChangeServer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    Column(
        modifier = modifier
            .fillMaxWidth()
            .craftedSurface(shape = RoundedCornerShape(Radii.card), pressShrink = false)
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Text(waitingFor, style = LifeOsType.cardTitle, color = p.text)
        if (!serverMessage.isNullOrBlank()) {
            Text(serverMessage, style = LifeOsType.bodySmall, color = p.muted, maxLines = 4)
        }
        if (!address.isNullOrBlank()) {
            Mono(address, color = p.faint, style = LifeOsType.mono12)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            TextButton(onClick = onRetry) { Text("Try again", color = p.accent) }
            // This button did nothing in the old app. It is the single most
            // visible bug being fixed, so it goes to a real destination that
            // works with no token and no connection.
            TextButton(onClick = onChangeServer) { Text("Change server", color = p.muted) }
        }
    }
}

/**
 * Skeleton placeholders matching the final layout — never a centred spinner, and
 * **no shimmer** (§5.4). Static placeholders at 6% alpha.
 *
 * The 6% is the fill; the 1dp border at 9% is new. A flat block of flat grey
 * reads as a rendering failure, where a block with an edge reads as a card that
 * has not arrived — which is what it is, and what the content replacing it will
 * look like. Still completely still: a border is not an animation.
 */
@Composable
fun SkeletonBlock(height: Int, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(Radii.card)
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height.dp)
            .clip(shape)
            .background(palette.text.copy(alpha = 0.06f))
            .border(1.dp, palette.text.copy(alpha = 0.09f), shape),
    )
}

@Composable
fun SectionHeader(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier,
        style = LifeOsType.label,
        color = palette.faint,
    )
}

/** The 6dp hollow dot that marks a row with an unsent write (§7.5). Static. */
@Composable
fun PendingDot(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(6.dp)
            .clip(RoundedCornerShape(50))
            .border(1.dp, palette.text.copy(alpha = 0.4f), RoundedCornerShape(50)),
    )
}
