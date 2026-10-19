package com.lifeos.app.domain

import com.lifeos.app.ui.theme.GrowthTokens
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * The geometry behind the day graphic, so the web and the phone draw the same
 * picture.
 *
 * Ported from `packages/shared/src/growth.ts` and `journey.ts`. **Duplicated on
 * purpose** — this module must not import from the workspace — which means it is
 * a copy that can drift, so the numbers are unit-tested against the values in
 * those two files. Pure maths: no colours, no Compose, no Android.
 */

/** Where the day is, as a state rather than a number. */
enum class DayPhase { EARLY, UNDERWAY, NEARING, COMPLETE }

/**
 * How the figure should feel. Read by every growth style so that "nearly there"
 * and "there" look different in all of them — a finished day must not be a
 * slightly brighter unfinished one.
 */
data class JourneyFeel(
    val phase: DayPhase,
    /** 0–1, clamped. The raw fill everything scales from. */
    val fill: Float,
    /**
     * How strongly to light the figure, 0–1. Deliberately not linear with
     * `fill`: flat through the middle of the day, then it runs away with itself,
     * so the final push feels like one.
     */
    val glow: Float,
    /** Extra halo radius in viewBox units, on top of the figure. */
    val halo: Float,
    val nearing: Boolean,
    val complete: Boolean,
)

data class Petal(
    val id: String,
    val done: Boolean,
    val colorHex: String,
    /** Degrees clockwise from twelve o'clock. */
    val angle: Float,
    /** Tip distance from the centre, in viewBox units. */
    val reach: Float,
    /** Half-width at the widest point, in degrees. */
    val spread: Float,
)

data class Ring(
    val r: Float,
    /** How complete that week was, 0–1. Drawn as opacity and stroke weight. */
    val strength: Float,
)

data class GrowthGeometry(
    val size: Float,
    val centre: Float,
    val fill: Float,
    val complete: Boolean,
    val coreRadius: Float,
    val petals: List<Petal>,
    val rings: List<Ring>,
    val done: Int,
    val total: Int,
)

data class PetalInput(val id: String, val done: Boolean, val colorHex: String)

object Growth {

    fun dayPhase(efficiencyPct: Double): DayPhase = when {
        efficiencyPct >= 100 -> DayPhase.COMPLETE
        efficiencyPct >= 80 -> DayPhase.NEARING
        efficiencyPct >= 25 -> DayPhase.UNDERWAY
        else -> DayPhase.EARLY
    }

    fun journeyFeel(efficiencyPct: Double): JourneyFeel {
        val pct = if (efficiencyPct.isFinite()) efficiencyPct else 0.0
        val fill = (pct / 100.0).coerceIn(0.0, 1.0).toFloat()
        val phase = dayPhase(pct)
        // Quartic: flat for most of the day, then it runs away with itself.
        val glow = min(1f, fill * fill * fill * fill * 0.55f + fill * 0.35f)
        return JourneyFeel(
            phase = phase,
            fill = fill,
            glow = glow,
            halo = 6f + glow * 26f,
            nearing = phase == DayPhase.NEARING || phase == DayPhase.COMPLETE,
            complete = phase == DayPhase.COMPLETE,
        )
    }

    /**
     * The `bloom` figure: a petal per habit around a core, rings behind for the
     * weeks already kept.
     *
     * Three things at once — what is done today, which of *your* habits did it,
     * and how long it has been kept up. The old meters encoded one number
     * between them, which a bar would have carried.
     */
    fun geometry(
        efficiencyPct: Double,
        petals: List<PetalInput>,
        history: List<Double>,
    ): GrowthGeometry {
        val pct = if (efficiencyPct.isFinite()) efficiencyPct else 0.0
        val fill = (pct / 100.0).coerceIn(0.0, 1.0).toFloat()

        val total = petals.size
        val done = petals.count { it.done }

        // The core grows a little as the day fills, so the whole figure opens up
        // rather than only changing colour. Bounded, so an empty day still reads
        // as a shape and a full one does not swallow the petals.
        val coreRadius = GrowthTokens.CORE_MIN +
            (GrowthTokens.CORE_MAX - GrowthTokens.CORE_MIN) * fill

        // Even spacing regardless of count, so three habits look deliberate
        // rather than like a broken twelve.
        val step = if (total > 0) 360f / total else 0f
        val spread = if (total > 0) min(26f, max(9f, step * 0.34f)) else 0f

        val open = GrowthTokens.PETAL_INNER +
            (GrowthTokens.PETAL_OUTER - GrowthTokens.PETAL_INNER) * 0.5f

        return GrowthGeometry(
            size = GrowthTokens.SIZE,
            centre = GrowthTokens.SIZE / 2f,
            fill = fill,
            complete = pct >= 100,
            coreRadius = coreRadius,
            petals = petals.mapIndexed { i, p ->
                Petal(
                    id = p.id,
                    done = p.done,
                    colorHex = p.colorHex,
                    angle = i * step,
                    // A done petal reaches full length; an open one stops short,
                    // so the state survives with the colour stripped out. Half
                    // length rather than a stub: at 18% the open ones were specks.
                    reach = if (p.done) GrowthTokens.PETAL_OUTER else open,
                    spread = spread,
                )
            },
            rings = buildRings(history),
            done = done,
            total = total,
        )
    }

    /**
     * One ring per week behind today, innermost most recent.
     *
     * Weeks rather than days, because a ring per day would be a hundred
     * hairlines by spring — and a week is the unit people think in when they ask
     * whether something is sticking.
     */
    fun buildRings(history: List<Double>): List<Ring> {
        val clean = history.filter { it.isFinite() }
        if (clean.isEmpty()) return emptyList()

        val weeks = mutableListOf<Float>()
        var end = clean.size
        while (end > 0 && weeks.size < GrowthTokens.MAX_RINGS) {
            val slice = clean.subList(max(0, end - 7), end)
            if (slice.isEmpty()) break
            weeks += (slice.sum() / slice.size / 100.0).toFloat()
            end -= 7
        }

        val innermost = GrowthTokens.PETAL_OUTER + GrowthTokens.RING_INNERMOST_OFFSET
        return weeks.mapIndexed { i, strength ->
            Ring(
                r = innermost + i * GrowthTokens.RING_GAP,
                strength = strength.coerceIn(0f, 1f),
            )
        }
    }

    /**
     * How far a leaf has unfurled, 0–1.
     *
     * The sprout's six leaves appear at `LEAF_THRESHOLDS` and each unfurls over
     * the `LEAF_UNFURL_SPAN` of progress that follows its threshold, so the plant
     * grows out of the stem rather than fading in on top of it.
     */
    fun leafUnfurl(index: Int, fill: Float): Float {
        val thresholds = GrowthTokens.LEAF_THRESHOLDS
        if (index !in thresholds.indices) return 0f
        val raw = (fill - thresholds[index]) / GrowthTokens.LEAF_UNFURL_SPAN
        return raw.coerceIn(0f, 1f)
    }

    /**
     * The sprout's bloom at the tip: nothing until 0.90, full at 1.0.
     *
     * 100% must not look like a brighter 99%, so this is the sprout's arrival
     * state and it has a span of its own rather than tracking `fill`.
     */
    fun bloomScale(fill: Float): Float = ((fill - 0.9f) / 0.1f).coerceIn(0f, 1f)

    /** A point on a circle, degrees clockwise from twelve. */
    fun pointAt(centre: Float, degrees: Float, radius: Float): Pair<Float, Float> {
        val rad = ((degrees - 90f) * Math.PI / 180.0)
        return (centre + (cos(rad) * radius).toFloat()) to (centre + (sin(rad) * radius).toFloat())
    }
}
