package com.lifeos.app.ui.celebration

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.lifeos.app.domain.Celebration
import com.lifeos.app.domain.CelebrationIntensity
import com.lifeos.app.ui.theme.serverColor
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.LocalReducedMotion
import com.lifeos.app.ui.theme.Motion
import com.lifeos.app.ui.theme.Radii
import com.lifeos.app.ui.theme.Sizes
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * The celebration (UI_SPEC §3.4) — the one moment this app is allowed to be loud.
 *
 * Global: it fires on Today, on Day, on You and on cold start, whenever
 * `pendingCelebrations` is non-empty. One at a time, queued.
 *
 * **It never auto-dismisses.** No timer, no dismiss-on-scrim-tap, no system-back
 * dismissal. The goal is not finished until the user has seen it, and
 * `celebration-seen` fires on the press of **Nice** and on nothing else — not on
 * render, not on a timer. If the user kills the app, the celebration is waiting
 * next time, and that is correct.
 *
 * `celebrationIntensity` and reduced motion compose and are independent:
 * `off` means no particles even with motion fully on, and reduced motion means
 * no particles and no scale — and in both cases the dialog still appears
 * full-screen and still requires a dismissal, because that is a contract rather
 * than an animation.
 */
@Composable
fun CelebrationOverlay(
    celebration: Celebration,
    intensity: CelebrationIntensity,
    onDismiss: (Celebration) -> Unit,
) {
    val p = palette
    val reduced = LocalReducedMotion.current
    val accent = serverColor(celebration.themeColor) ?: p.accent

    val particles = !reduced && intensity == CelebrationIntensity.FULL
    val bloom = !reduced && intensity != CelebrationIntensity.OFF

    Dialog(
        // Dismissed by the button, and only by the button.
        onDismissRequest = { /* deliberately nothing */ },
        properties = DialogProperties(
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
            usePlatformDefaultWidth = false,
        ),
    ) {
        // The arrival: scale 0.9 → 1.0 with a fade over `celebration`. Reduced
        // motion makes it a 100ms cross-fade with no scale.
        var arrived by remember(celebration.key) { mutableStateOf(false) }
        LaunchedEffect(celebration.key) { arrived = true }

        val progress by animateFloatAsState(
            targetValue = if (arrived) 1f else 0f,
            animationSpec = tween(
                durationMillis = if (reduced) Motion.REDUCED else Motion.CELEBRATION,
                easing = Motion.emphasized,
            ),
            label = "celebration-arrival",
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(p.bg),
            contentAlignment = Alignment.Center,
        ) {
            // A soft halo in the goal's own colour, behind everything.
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.radialGradient(
                            colors = listOf(accent.copy(alpha = 0.18f), p.bg),
                        ),
                    ),
            )

            if (particles) Particles(colour = accent)

            Column(
                modifier = Modifier
                    .widthIn(max = Sizes.contentMax)
                    .padding(Spacing.xxl)
                    .alpha(progress)
                    .scale(if (reduced) 1f else 0.9f + 0.1f * progress),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                if (bloom) {
                    Bloom(colour = accent, progress = progress)
                } else {
                    // `off` and reduced motion both get the static arrival state.
                    Box(
                        modifier = Modifier
                            .size(120.dp)
                            .background(
                                Brush.radialGradient(
                                    listOf(accent.copy(alpha = 0.30f), p.bg),
                                ),
                                RoundedCornerShape(60.dp),
                            ),
                    )
                }

                Text(
                    text = celebration.emoji.ifBlank { "✦" },
                    style = LifeOsType.mono(48),
                )

                celebration.tierLabel?.let {
                    Text(it.uppercase(), style = LifeOsType.label, color = accent)
                }

                Text(
                    text = celebration.title,
                    style = LifeOsType.pulse,
                    color = p.text,
                    textAlign = TextAlign.Center,
                )

                if (!celebration.whyItMatters.isNullOrBlank()) {
                    Text(
                        text = celebration.whyItMatters,
                        style = LifeOsType.body,
                        color = p.muted,
                        textAlign = TextAlign.Center,
                    )
                }

                // **One** button. Pressing it — and only this — posts
                // celebration-seen.
                Button(
                    onClick = { onDismiss(celebration) },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = accent,
                        contentColor = p.bg,
                    ),
                    modifier = Modifier.padding(top = Spacing.md),
                ) {
                    Text("Nice.", style = LifeOsType.cardTitle)
                }
            }
        }
    }
}

/** The bloom: a one-shot arrival, because 100% must not look like a brighter 99%. */
@Composable
private fun Bloom(colour: androidx.compose.ui.graphics.Color, progress: Float) {
    Canvas(modifier = Modifier.fillMaxWidth().height(120.dp)) {
        val centre = Offset(size.width / 2f, size.height / 2f)
        val radius = (size.minDimension / 2f) * progress
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(colour.copy(alpha = 0.42f), colour.copy(alpha = 0f)),
                center = centre,
                radius = radius.coerceAtLeast(1f),
            ),
            radius = radius.coerceAtLeast(1f),
            center = centre,
        )
        // Eight petals opening out of the middle.
        repeat(8) { index ->
            val angle = (index / 8f) * 2f * Math.PI.toFloat()
            val reach = radius * 0.8f
            drawCircle(
                color = colour.copy(alpha = 0.55f * progress),
                radius = 6f * progress,
                center = Offset(
                    centre.x + cos(angle) * reach,
                    centre.y + sin(angle) * reach,
                ),
            )
        }
    }
}

/**
 * Particles, for `celebrationIntensity: full` only.
 *
 * The one looping animation in the app besides the orb's crests and the
 * Needs-you pulse, and it exists for as long as the dialog does — which is
 * until the user presses the button, so it is bounded by a human rather than by
 * a timer.
 */
@Composable
private fun Particles(colour: androidx.compose.ui.graphics.Color) {
    val transition = rememberInfiniteTransition(label = "particles")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(Motion.CELEBRATION * 3, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "particle-phase",
    )

    // Fixed seed: the same celebration looks the same each time it is drawn, so
    // a recomposition does not teleport every particle.
    val seeds = remember {
        List(28) {
            val random = Random(it * 7919)
            Triple(random.nextFloat(), random.nextFloat(), 2f + random.nextFloat() * 4f)
        }
    }

    Canvas(modifier = Modifier.fillMaxSize()) {
        seeds.forEach { (x, offset, radius) ->
            val travel = (phase + offset) % 1f
            drawCircle(
                color = colour.copy(alpha = (1f - travel) * 0.55f),
                radius = radius,
                center = Offset(
                    x = x * size.width,
                    y = size.height * (1f - travel),
                ),
            )
        }
    }
}
