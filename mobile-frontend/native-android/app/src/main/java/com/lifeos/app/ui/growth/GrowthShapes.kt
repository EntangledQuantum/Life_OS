package com.lifeos.app.ui.growth

import androidx.compose.ui.graphics.Path
import com.lifeos.app.domain.Growth
import com.lifeos.app.domain.Petal
import com.lifeos.app.ui.theme.GrowthTokens
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * The paths, as pure functions of geometry.
 *
 * Separated from the drawing so they can be unit-tested — a petal that curves
 * differently on the phone than on the desktop makes the two graphics different
 * objects, and the only way to know they agree is to assert on the numbers.
 *
 * Everything here is in viewBox units: 200 for the sprout, 240 for bloom and the
 * orb. The caller scales.
 */
object GrowthShapes {

    /* ------------------------------------------------------------- sprout */

    /** The stem, as the web and Expo clients draw it. */
    fun stem(): Path = Path().apply {
        moveTo(100f, 168f)
        cubicTo(100f, 140f, 88f, 116f, 100f, 92f)
        cubicTo(112f, 68f, 100f, 46f, 100f, 26f)
    }

    /** Leaf anchors, in order. Index matches [GrowthTokens.LEAF_THRESHOLDS]. */
    data class LeafAnchor(val x: Float, val y: Float, val side: Int, val size: Float)

    val LEAVES = listOf(
        LeafAnchor(97f, 140f, -1, 1.00f),
        LeafAnchor(95f, 118f, 1, 1.15f),
        LeafAnchor(97f, 100f, -1, 1.20f),
        LeafAnchor(106f, 76f, 1, 1.10f),
        LeafAnchor(103f, 58f, -1, 0.95f),
        LeafAnchor(100f, 44f, 1, 0.85f),
    )

    /**
     * One leaf at unfurl `s`.
     *
     * `s` 0 is nothing and 1 is the full leaf, so a leaf grows *out of* the stem
     * rather than fading in on top of it. Geometry interpolated, not opacity.
     */
    fun leaf(anchor: LeafAnchor, s: Float): Path {
        val w = 20f * anchor.size * s
        val h = 9f * anchor.size * s
        val x = anchor.x
        val y = anchor.y
        val side = anchor.side
        val tip = x + side * w
        return Path().apply {
            moveTo(x, y)
            cubicTo(
                x + side * w * 0.4f, y - h,
                tip - side * w * 0.15f, y - h * 0.6f,
                tip, y - h * 0.2f,
            )
            cubicTo(
                tip - side * w * 0.2f, y + h * 0.5f,
                x + side * w * 0.4f, y + h * 0.5f,
                x, y,
            )
            close()
        }
    }

    fun pot(): Path = Path().apply {
        moveTo(66f, 166f)
        lineTo(73f, 196f)
        quadraticBezierTo(100f, 204f, 127f, 196f)
        lineTo(134f, 166f)
        close()
    }

    /* --------------------------------------------------------------- bloom */

    /**
     * A petal as two quadratic curves meeting at the tip.
     *
     * A port of `petalPath` in `packages/shared/src/growth.ts`.
     */
    fun petal(petal: Petal, centre: Float): Path {
        val base = GrowthTokens.PETAL_INNER * 0.62f
        val (sx, sy) = Growth.pointAt(centre, petal.angle - petal.spread * 0.3f, base)
        val (ex, ey) = Growth.pointAt(centre, petal.angle + petal.spread * 0.3f, base)
        val (tx, ty) = Growth.pointAt(centre, petal.angle, petal.reach)
        val mid = (base + petal.reach) / 2f
        val (lx, ly) = Growth.pointAt(centre, petal.angle - petal.spread, mid)
        val (rx, ry) = Growth.pointAt(centre, petal.angle + petal.spread, mid)

        return Path().apply {
            moveTo(sx, sy)
            quadraticBezierTo(lx, ly, tx, ty)
            quadraticBezierTo(rx, ry, ex, ey)
            close()
        }
    }

    /* ----------------------------------------------------------------- orb */

    /**
     * A tiled sine, filled down to the bottom of its box.
     *
     * The mean line sits at `amp` so the box can be offset by exactly `-amp` and
     * meet the water with no seam. Each crest must then scroll by exactly its
     * own period or the tiling visibly jumps once per loop — that is the whole
     * reason `periodA` and `periodB` differ.
     */
    fun wave(width: Float, period: Float, amp: Float): Path {
        val half = period / 2f
        val mid = amp
        val path = Path().apply { moveTo(0f, mid) }
        var x = 0f
        var up = true
        while (x < width) {
            val cy = if (up) mid - amp * 2f else mid + amp * 2f
            path.quadraticBezierTo(x + half / 2f, cy, x + half, mid)
            x += half
            up = !up
        }
        path.lineTo(x, amp * 2f + 2f)
        path.lineTo(0f, amp * 2f + 2f)
        path.close()
        return path
    }

    /** Degrees → a point, for callers that want radians-free maths. */
    fun circlePoint(centre: Float, degrees: Float, radius: Float): Pair<Float, Float> {
        val rad = (degrees - 90f) * PI.toFloat() / 180f
        return (centre + cos(rad) * radius) to (centre + sin(rad) * radius)
    }
}
