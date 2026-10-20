package com.lifeos.app.ui.theme

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.unit.dp

/**
 * How a surface is **made**: its tone, its press, and its arrival.
 *
 * This file exists because of a mistake worth recording. The user's complaint
 * about the old app was *information overload* — too much on screen at once —
 * and 2.0.0 read that as a mandate to reduce visual richness too. Those are
 * different axes. The density reduction was right and it stays: no screen here
 * gains a number, a row or a control from anything below. What was wrong was
 * flattening the craft, so that a card became an outline around some text and
 * every surface sat at exactly the same tone as the page.
 *
 * So: tone separation, considered press states, and a measured arrival from
 * loading to loaded — at the same information density, and still obeying §6.
 * Always dark. A palette swaps colours only; every number in here is a non-
 * themed constant, so a theme cannot reach the geometry.
 *
 * **No shadows.** §6.3 is unchanged: M3 dark elevation is tonal, and the only
 * shadow in the app is the FAB's. A floating card on near-black reads as mud.
 * Depth here is colour and a lit top edge, which is what dark Material actually
 * does.
 */

/** Toward white, in straight RGB — a tone step, not a tint. */
fun Color.lifted(amount: Float): Color = Color(
    red = (red + amount).coerceAtMost(1f),
    green = (green + amount).coerceAtMost(1f),
    blue = (blue + amount).coerceAtMost(1f),
    alpha = alpha,
)

private object SurfaceTone {
    /**
     * How much lighter the top of a card is than its foot.
     *
     * Small on purpose. Enough that the eye reads a lit edge and therefore an
     * object; not enough to be a gradient anybody notices as one. Measured
     * against `bloom`'s `#1A1220`, this is about two values out of 255.
     */
    const val LIFT = 0.022f

    /** Where the gradient has finished. The rest of the card is flat. */
    const val LIFT_STOP = 0.62f

    /** Added to the lift while pressed: the surface comes up to meet the finger. */
    const val PRESS_LIFT = 0.030f

    /** How far a pressed card shrinks. 1.2% — felt, not watched. */
    const val PRESS_SHRINK = 0.012f
}

/**
 * A card: tonal gradient, a 1dp border, and an optional press state.
 *
 * Pass the card's `interactionSource` — the same one its `clickable` is given —
 * and the surface answers the finger in the same frame it lands, which is the
 * §5.2 `instant` token and the reason it is 100ms and linear.
 *
 * `pressShrink` is for things that read as objects you push (a card, a tile).
 * A list row gets [pressTone] instead: shrinking a 56dp row makes the list
 * jitter rather than making the row feel pressed.
 */
@Composable
fun Modifier.craftedSurface(
    shape: Shape,
    base: Color = palette.surface,
    border: Color? = palette.border,
    interactionSource: InteractionSource? = null,
    pressShrink: Boolean = true,
): Modifier {
    val reduced = LocalReducedMotion.current
    val pressed = interactionSource?.collectIsPressedAsState()?.value ?: false
    val press by animateFloatAsState(
        targetValue = if (pressed) 1f else 0f,
        animationSpec = tween(Motion.INSTANT, easing = Motion.linear),
        label = "press",
    )

    val top = base.lifted(SurfaceTone.LIFT + SurfaceTone.PRESS_LIFT * press)
    val foot = base.lifted(SurfaceTone.PRESS_LIFT * press)

    // Reduced motion kills the scale, not the tone: the tone carries the
    // information ("this is pressed"), the movement does not (§5.6).
    val scale = if (pressShrink && !reduced) 1f - SurfaceTone.PRESS_SHRINK * press else 1f

    return this
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
        }
        .clip(shape)
        .background(
            Brush.verticalGradient(
                0f to top,
                SurfaceTone.LIFT_STOP to foot,
                1f to foot,
            ),
        )
        .then(if (border != null) Modifier.border(1.dp, border, shape) else Modifier)
}

/**
 * A row's press state: a tone, and nothing else.
 *
 * For the rows that sit directly on the page — settings, Day's list, a link —
 * where there is no card to lift. The row briefly becomes a surface, which is
 * the quietest way to say "this is a target" without drawing a container around
 * every line on the screen.
 */
@Composable
fun Modifier.pressTone(
    interactionSource: InteractionSource,
    shape: Shape,
    tone: Color = palette.surface2,
): Modifier {
    val pressed = interactionSource.collectIsPressedAsState().value
    val press by animateFloatAsState(
        targetValue = if (pressed) 1f else 0f,
        animationSpec = tween(Motion.INSTANT, easing = Motion.linear),
        label = "row-press",
    )
    return this
        .clip(shape)
        .background(lerp(Color.Transparent, tone, press))
}

/**
 * The fade from loading to loaded.
 *
 * `0` while there is nothing, `1` once there is, over `short`. A cold start with
 * a cache is already `1` on its first frame, so nothing fades in on the path
 * that matters — the animation only exists for the one case it describes, which
 * is a skeleton being replaced by the first payload ever to arrive. That used
 * to be a hard cut, and a hard cut after six seconds of placeholders reads as
 * the screen having been swapped out from under you.
 */
@Composable
fun arrivalAlpha(ready: Boolean): Float {
    val reduced = LocalReducedMotion.current
    val alpha by animateFloatAsState(
        targetValue = if (ready) 1f else 0f,
        animationSpec = tween(
            durationMillis = if (reduced) Motion.REDUCED else Motion.SHORT,
            easing = Motion.easeOutCubic,
        ),
        label = "arrival",
    )
    return alpha
}
