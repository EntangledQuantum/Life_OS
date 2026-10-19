package com.lifeos.app.ui.growth

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.lifeos.app.domain.Growth
import com.lifeos.app.domain.GrowthGeometry
import com.lifeos.app.domain.PetalInput
import com.lifeos.app.ui.components.Mono
import com.lifeos.app.ui.theme.GrowthTokens
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.LocalReducedMotion
import com.lifeos.app.ui.theme.Motion
import com.lifeos.app.ui.theme.Palette
import com.lifeos.app.ui.theme.serverColor
import com.lifeos.app.ui.theme.Spacing
import com.lifeos.app.ui.theme.palette
import kotlin.math.roundToInt

/** The styles this build ships. `constellation` and `ascent` are postponed. */
enum class GrowthStyle {
    SPROUT, ORB, BLOOM;

    companion object {
        /**
         * Map whatever the server sends, including the pre-rename values, onto a
         * style this build can draw.
         *
         * A port of `normalizeGrowthStyle` in
         * `packages/shared/src/constants.ts`, narrowed: `constellation` and
         * `ascent` are not implemented in this milestone, and they fall back to
         * `bloom` rather than to a blank canvas — a day graphic that does not
         * draw is worse than one drawn in the default style.
         */
        fun from(value: String?): GrowthStyle = when (value) {
            "sprout", "plant", "both" -> SPROUT
            "orb", "water" -> ORB
            "bloom" -> BLOOM
            // Postponed, not cut. Until they ship, the product's default identity
            // is what the user sees.
            "constellation", "rings", "ascent", "arc" -> BLOOM
            else -> BLOOM
        }
    }
}

/**
 * The one thing to look at on Today.
 *
 * **The contract (§4.3, and §0.1): the ghosted 100% state is always drawn behind
 * the live state.** A 40% bar does not communicate the gap between where you are
 * and what a full day looks like. Every style draws its own ghost, and a
 * reviewer finding a style that does not should reject it.
 *
 * `efficiencyPct` above 100 shows the real figure; only the fill is clamped.
 *
 * Size comes from the container (`BoxWithConstraints`), never from the window —
 * in a two-column layout the meter lives in one column and the window width says
 * nothing useful about it.
 */
@Composable
fun GrowthMeter(
    efficiencyPct: Double,
    dailyXp: Int,
    dailyXpTarget: Int,
    style: GrowthStyle,
    habits: List<PetalInput>,
    consistencyHistory: List<Double>,
    modifier: Modifier = Modifier,
    maxSize: Dp = 240.dp,
    showReadout: Boolean = true,
) {
    val p = palette
    val reduced = LocalReducedMotion.current

    // §5.3: the meter's value animates over `long` from the previous value, and
    // it is one of only two things allowed to animate because data arrived.
    val target = (efficiencyPct / 100.0).coerceIn(0.0, 1.0).toFloat()
    val fill by animateFloatAsState(
        targetValue = target,
        animationSpec = tween(
            durationMillis = if (reduced) 0 else Motion.LONG,
            easing = Motion.emphasized,
        ),
        label = "meter-fill",
    )

    val complete = efficiencyPct >= 100.0

    /*
     * Two centred children, and both halves of that sentence are load-bearing.
     *
     * **Centred**, because `BoxWithConstraints` aligns at `TopStart` by default
     * and the figure is a fixed square inside a full-width card: on a 1080px
     * device the flower's centre sat at 27% across instead of 50%.
     *
     * **Two**, because the halo needs a bigger node than the figure. A draw
     * modifier clips to its own bounds, so a halo of radius `0.78 · side` drawn
     * into the figure's own `side`-sized node was cut off by a hard rectangle
     * at every edge. The halo gets `HALO_BOX · side` and is allowed to overflow
     * the meter's box vertically; the figure keeps the box's size, so every
     * style — and the sprout's deliberately right-aligned readout (§4.3) — is
     * laid out exactly as before, only in the middle of the card.
     */
    BoxWithConstraints(modifier = modifier, contentAlignment = Alignment.Center) {
        val side = Growth.figureSide(maxWidth.value, maxHeight.value, maxSize.value).dp

        Halo(
            complete = complete,
            palette = p,
            modifier = Modifier.requiredSize(Growth.haloBoxSide(side.value).dp),
        )

        Box(modifier = Modifier.size(side), contentAlignment = Alignment.Center) {
            when (style) {
                GrowthStyle.SPROUT -> Sprout(fill, complete, p)
                GrowthStyle.ORB -> Orb(fill, complete, p)
                GrowthStyle.BLOOM -> Bloom(
                    fill = fill,
                    complete = complete,
                    geometry = remember(efficiencyPct, habits, consistencyHistory) {
                        Growth.geometry(efficiencyPct, habits, consistencyHistory)
                    },
                    palette = p,
                )
            }

            if (showReadout) {
                /*
                 * Readout placement is per style, and the styles are not
                 * variations of each other. The orb's middle is empty, so the
                 * number *is* its contents: centred and large. The sprout has no
                 * empty middle — a centred number lands on the pot and the roots
                 * — so it goes to the right edge, where the viewBox is clear at
                 * every growth level. Bloom's core is the empty middle, but it is
                 * small, so the figure gets a compact centred readout.
                 */
                when (style) {
                    GrowthStyle.ORB -> OrbReadout(efficiencyPct, complete, side, p)
                    GrowthStyle.SPROUT -> SproutReadout(efficiencyPct, complete, side, p)
                    GrowthStyle.BLOOM -> BloomReadout(efficiencyPct, complete, side, p)
                }
            }
        }
    }

    if (showReadout) {
        // Below the figure, in mono: the two numbers and nothing else.
        Row(
            modifier = Modifier.padding(top = Spacing.xs),
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(Spacing.sm),
        ) {
            Mono("${efficiencyPct.roundToInt()}%", style = LifeOsType.mono14, color = p.text)
            Mono("$dailyXp/$dailyXpTarget XP", style = LifeOsType.mono12, color = p.muted)
        }
    }
}

/* ------------------------------------------------------------------- halo */

/**
 * The glow behind everything.
 *
 * It breathes, and goes loud only when the target is actually met. One of the
 * two infinite animations the app allows (the other is the orb's crests), and
 * only while the meter is on screen.
 *
 * **Its node is `HALO_BOX` times the figure, not the figure.** The radius below
 * is half of its own node, which is `GrowthTokens.HALO_RADIUS` of the figure by
 * construction — see `Growth.haloBoxSide`. Hand this a node the size of the
 * figure and the gradient is clipped into a rectangle.
 */
@Composable
private fun Halo(complete: Boolean, palette: Palette, modifier: Modifier) {
    val reduced = LocalReducedMotion.current
    val breath = if (reduced) {
        0.35f
    } else {
        val transition = rememberInfiniteTransition(label = "halo")
        val value by transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(2600, easing = Motion.easeInOutSine),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "halo-breath",
        )
        value
    }

    val base = if (complete) 0.85f else 0.34f
    val swing = if (complete) 0.30f else 0.12f
    val alpha = base + breath * swing

    Canvas(modifier = modifier) {
        val radius = size.minDimension / 2f
        drawCircle(
            brush = Brush.radialGradient(
                0.35f to palette.accent.copy(alpha = 0.34f * alpha),
                0.68f to palette.accent2.copy(alpha = 0.14f * alpha),
                1.0f to palette.accent2.copy(alpha = 0f),
                center = center,
                radius = radius,
            ),
            radius = radius,
            center = center,
        )
    }
}

/* ----------------------------------------------------------------- sprout */

@Composable
private fun Sprout(fill: Float, complete: Boolean, palette: Palette) {
    val stem = remember { GrowthShapes.stem() }
    val stemLength = remember(stem) { PathMeasure().apply { setPath(stem, false) }.length }

    Canvas(modifier = Modifier.fillMaxSize()) {
        val k = size.minDimension / GrowthTokens.SPROUT_VIEWBOX
        scale(k, k, pivot = Offset.Zero) {

            /* ---- the ghost: exactly what 100% looks like, always behind ---- */
            val ghostAlpha = if (complete) 0f else 0.14f
            if (ghostAlpha > 0f) {
                drawPath(stem, palette.text.copy(alpha = ghostAlpha), style = Stroke(width = 6f))
                GrowthShapes.LEAVES.forEach { anchor ->
                    drawPath(GrowthShapes.leaf(anchor, 1f), palette.text.copy(alpha = ghostAlpha))
                }
                drawCircle(palette.text.copy(alpha = ghostAlpha), radius = 15f, center = Offset(100f, 26f))
            }

            /* ---- the living plant ---- */
            // The stem is revealed along its own length rather than scaled, so
            // it grows from the soil up instead of stretching from the middle.
            val grown = Path()
            PathMeasure().apply { setPath(stem, false) }
                .getSegment(0f, stemLength * fill.coerceAtLeast(0.02f), grown, true)
            drawPath(grown, palette.accent, style = Stroke(width = 6f))

            GrowthShapes.LEAVES.forEachIndexed { index, anchor ->
                val s = Growth.leafUnfurl(index, fill)
                if (s > 0f) {
                    val colour = if (index % 2 == 0) palette.accent else palette.accent2
                    drawPath(GrowthShapes.leaf(anchor, s), colour.copy(alpha = s))
                }
            }

            // The arrival: the bud opens over the last tenth, so 100% does not
            // look like a brighter 99%.
            val bloom = Growth.bloomScale(fill)
            if (bloom > 0f) {
                drawCircle(
                    palette.accent2.copy(alpha = bloom),
                    radius = 15f * bloom,
                    center = Offset(100f, 26f),
                )
            }
            if (complete) {
                drawCircle(palette.text, radius = 5f, center = Offset(100f, 26f))
            }

            /* ---- pot, last, so the stem emerges from behind its rim ---- */
            drawPath(GrowthShapes.pot(), palette.text.copy(alpha = 0.07f))
            drawOval(
                color = palette.text.copy(alpha = 0.11f),
                topLeft = Offset(66f, 159f),
                size = Size(68f, 14f),
            )
            drawOval(
                color = palette.bg,
                topLeft = Offset(75f, 160.5f),
                size = Size(50f, 9f),
            )
        }
    }
}

/* -------------------------------------------------------------------- orb */

@Composable
private fun Orb(fill: Float, complete: Boolean, palette: Palette) {
    val reduced = LocalReducedMotion.current

    /*
     * Two load-bearing details, both easy to undo by accident:
     *
     *  1. The liquid is a full-height layer **translated on Y**, never a layer
     *     whose height animates. Height is a layout property and re-measures
     *     every frame; a translation does not, and the crests ride the surface
     *     for free because they move with it.
     *  2. Each crest scrolls by exactly **its own** period (`inner/2`, `inner/3`).
     *     Any other distance and the tiled sine visibly jumps once per loop. Do
     *     not give both waves the same drift.
     */
    val drift = if (reduced) {
        0f to 0f
    } else {
        val transition = rememberInfiniteTransition(label = "orb")
        val a by transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(3400, easing = LinearEasing), RepeatMode.Restart),
            label = "crest-a",
        )
        val b by transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(5200, easing = LinearEasing), RepeatMode.Restart),
            label = "crest-b",
        )
        a to b
    }

    Canvas(modifier = Modifier.fillMaxSize()) {
        val inner = size.minDimension * 0.9f
        val pad = (size.minDimension - inner) / 2f
        val radius = inner / 2f
        val centre = Offset(pad + radius, pad + radius)

        val periodA = inner / 2f
        val periodB = inner / 3f
        val waveWidth = inner + periodA
        val ampA = inner * 0.029f
        val ampB = inner * 0.021f

        // Ghost: the whole sphere is what 100% looks like.
        drawCircle(palette.accent.copy(alpha = 0.05f), radius = radius, center = centre)

        val sphere = Path().apply {
            addOval(
                androidx.compose.ui.geometry.Rect(
                    centre.x - radius, centre.y - radius, centre.x + radius, centre.y + radius,
                ),
            )
        }

        clipPath(sphere) {
            // The liquid: a full-height body slid down out of the clip.
            translate(top = (1f - fill.coerceAtLeast(0f)) * inner) {
                drawRect(
                    brush = Brush.linearGradient(
                        colors = listOf(palette.accent2, palette.accent),
                        start = Offset(pad + inner * 0.2f, pad),
                        end = Offset(pad + inner * 0.8f, pad + inner),
                    ),
                    topLeft = Offset(pad, pad),
                    size = Size(inner, inner),
                )

                // Back crest: darker, slower, drifting the other way.
                translate(left = pad + drift.second * periodB - periodB, top = pad - ampB) {
                    drawPath(
                        GrowthShapes.wave(waveWidth, periodB, ampB),
                        palette.accent.copy(alpha = 0.75f),
                    )
                }

                // Front crest: carries the specular line.
                translate(left = pad - drift.first * periodA, top = pad - ampA) {
                    val crest = GrowthShapes.wave(waveWidth, periodA, ampA)
                    drawPath(crest, palette.accent2)
                    drawPath(crest, Color.White.copy(alpha = 0.45f), style = Stroke(width = 1.5f))
                }
            }

            // Specular highlight on the glass, above the liquid.
            drawOval(
                color = Color.White.copy(alpha = 0.10f),
                topLeft = Offset(centre.x - inner * 0.19f, centre.y - inner * 0.34f),
                size = Size(inner * 0.26f, inner * 0.40f),
            )
        }

        // The rim last, so it reads as glass in front of the water. Full accent
        // at 100% is the orb's arrival state.
        drawCircle(
            color = if (complete) palette.accent else palette.accent.copy(alpha = 0.40f),
            radius = radius,
            center = centre,
            style = Stroke(width = 2f),
        )
    }
}

/* ------------------------------------------------------------------ bloom */

@Composable
private fun Bloom(
    fill: Float,
    complete: Boolean,
    geometry: GrowthGeometry,
    palette: Palette,
) {
    Canvas(modifier = Modifier.fillMaxSize()) {
        val k = size.minDimension / GrowthTokens.SIZE
        scale(k, k, pivot = Offset.Zero) {
            val centre = geometry.centre
            val origin = Offset(centre, centre)

            /* ---- ghost: every petal at full reach, the core at its largest ---- */
            if (!complete) {
                geometry.petals.forEach { petal ->
                    val full = petal.copy(reach = GrowthTokens.PETAL_OUTER)
                    drawPath(GrowthShapes.petal(full, centre), palette.text.copy(alpha = 0.10f))
                }
                drawCircle(
                    color = palette.text.copy(alpha = 0.08f),
                    radius = GrowthTokens.CORE_MAX,
                    center = origin,
                    style = Stroke(width = 1f),
                )
            }

            /* ---- rings: one per week already kept, innermost most recent ---- */
            geometry.rings.forEach { ring ->
                drawCircle(
                    color = palette.accent2.copy(alpha = 0.06f + ring.strength * 0.22f),
                    radius = ring.r,
                    center = origin,
                    style = Stroke(width = 0.8f + ring.strength * 1.6f),
                )
            }

            /* ---- petals: one per habit. A done petal is longer AND brighter,
                   so the state survives with the colour stripped out. ---- */
            geometry.petals.forEach { petal ->
                val colour = serverColor(petal.colorHex) ?: palette.accent
                drawPath(
                    path = GrowthShapes.petal(petal, centre),
                    color = if (petal.done) colour else colour.copy(alpha = 0.22f),
                )
                if (!petal.done) {
                    drawPath(
                        path = GrowthShapes.petal(petal, centre),
                        color = colour.copy(alpha = 0.35f),
                        style = Stroke(width = 1f),
                    )
                }
            }

            /* ---- core: today against target ---- */
            drawCircle(
                color = palette.surface2,
                radius = geometry.coreRadius,
                center = origin,
            )
            drawArc(
                brush = Brush.linearGradient(listOf(palette.accent2, palette.accent)),
                startAngle = -90f,
                sweepAngle = 360f * fill,
                useCenter = false,
                topLeft = Offset(centre - geometry.coreRadius, centre - geometry.coreRadius),
                size = Size(geometry.coreRadius * 2f, geometry.coreRadius * 2f),
                style = Stroke(width = 5f),
            )

            // The arrival: at 100% the two outermost rings settle into solid
            // accent, so a finished day is a different figure, not a brighter one.
            if (complete) {
                drawCircle(
                    color = palette.accent,
                    radius = GrowthTokens.PETAL_OUTER + GrowthTokens.RING_INNERMOST_OFFSET,
                    center = origin,
                    style = Stroke(width = 2f),
                )
                drawCircle(
                    color = palette.accent2.copy(alpha = 0.7f),
                    radius = GrowthTokens.PETAL_OUTER + GrowthTokens.RING_INNERMOST_OFFSET +
                        GrowthTokens.RING_GAP,
                    center = origin,
                    style = Stroke(width = 1.4f),
                )
            }
        }
    }
}

/*
 * `parseHex` used to live here, and five files imported it from the growth
 * meter — which is a strange place for the app's only colour parser and is
 * part of why nobody noticed it could not read `rgba(...)`. It is now
 * `ui/theme/serverColor`, which handles every form the server actually sends.
 */

/* --------------------------------------------------------------- readouts */

@Composable
private fun OrbReadout(pct: Double, complete: Boolean, side: Dp, palette: Palette) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Mono(
            text = "${pct.roundToInt()}%",
            style = LifeOsType.mono((side.value * 0.22f).roundToInt().coerceIn(18, 56), FontWeight.Bold),
            color = palette.text,
        )
        Text(
            text = if (complete) "TARGET MET" else "OF TODAY",
            style = LifeOsType.label,
            color = if (complete) palette.accent else palette.faint,
        )
    }
}

@Composable
private fun SproutReadout(pct: Double, complete: Boolean, side: Dp, palette: Palette) {
    /*
     * To the right edge, vertically centred. That column is empty by
     * construction and stays empty at every growth level: the stem runs down
     * x≈100/200 and the widest leaf tip reaches x≈130/200, so everything past
     * 0.68 of the width is clear. No "of today" caption — the number is a
     * marginal note beside a drawing, and a caption would make it a second
     * focal point. "Target met" stays, because that one is news.
     */
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.CenterEnd) {
        Column(horizontalAlignment = Alignment.End) {
            Mono(
                text = "${pct.roundToInt()}%",
                style = LifeOsType.mono((side.value * 0.12f).roundToInt().coerceIn(14, 34), FontWeight.Bold),
                color = palette.text,
            )
            if (complete) {
                Text("TARGET MET", style = LifeOsType.label, color = palette.accent)
            }
        }
    }
}

@Composable
private fun BloomReadout(pct: Double, complete: Boolean, side: Dp, palette: Palette) {
    // Bloom's core is its empty middle, but it is small (26–44 of 240), so the
    // readout is centred and compact rather than centred and large.
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Mono(
            text = "${pct.roundToInt()}%",
            style = LifeOsType.mono((side.value * 0.095f).roundToInt().coerceIn(12, 24), FontWeight.Bold),
            color = palette.text,
        )
        if (complete) {
            Text("MET", style = LifeOsType.label, color = palette.accent)
        }
    }
}
