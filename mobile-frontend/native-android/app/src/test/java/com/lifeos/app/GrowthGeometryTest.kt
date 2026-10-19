package com.lifeos.app

import com.lifeos.app.domain.DayPhase
import com.lifeos.app.domain.Growth
import com.lifeos.app.domain.PetalInput
import com.lifeos.app.ui.theme.GrowthTokens
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The growth geometry.
 *
 * It is a **deliberate copy** of `packages/shared/src/{growth,journey}.ts`
 * (the isolation contract forbids importing it), and a copy can drift. These
 * tests are the thing that stops it: every number asserted here is a number read
 * out of those two files, so a change on either side fails here rather than
 * showing up as a phone and a desktop drawing visibly different objects.
 */
class GrowthGeometryTest {

    private val epsilon = 0.001f

    /* --------------------------------------------------------- the constants */

    @Test
    fun `leaf thresholds match the web client exactly`() {
        assertArrayEqualsF(
            floatArrayOf(0.16f, 0.32f, 0.46f, 0.62f, 0.78f, 0.90f),
            GrowthTokens.LEAF_THRESHOLDS,
        )
    }

    @Test
    fun `the shared constants match growth ts`() {
        assertEquals(240f, GrowthTokens.SIZE, epsilon)
        assertEquals(26f, GrowthTokens.CORE_MIN, epsilon)
        assertEquals(44f, GrowthTokens.CORE_MAX, epsilon)
        assertEquals(52f, GrowthTokens.PETAL_INNER, epsilon)
        assertEquals(104f, GrowthTokens.PETAL_OUTER, epsilon)
        assertEquals(8, GrowthTokens.MAX_RINGS)
    }

    /* ------------------------------------------------------------ journeyFeel */

    @Test
    fun `day phases change at 25, 80 and 100`() {
        assertEquals(DayPhase.EARLY, Growth.dayPhase(0.0))
        assertEquals(DayPhase.EARLY, Growth.dayPhase(24.9))
        assertEquals(DayPhase.UNDERWAY, Growth.dayPhase(25.0))
        assertEquals(DayPhase.UNDERWAY, Growth.dayPhase(79.9))
        assertEquals(DayPhase.NEARING, Growth.dayPhase(80.0))
        assertEquals(DayPhase.COMPLETE, Growth.dayPhase(100.0))
        assertEquals(DayPhase.COMPLETE, Growth.dayPhase(137.0))
    }

    @Test
    fun `glow is quartic, not linear - the last stretch must feel like one`() {
        val feel = Growth.journeyFeel(100.0)
        // fill^4 * 0.55 + fill * 0.35, clamped to 1.
        assertEquals(0.90f, feel.glow, epsilon)

        val half = Growth.journeyFeel(50.0)
        assertEquals(0.55f * 0.0625f + 0.35f * 0.5f, half.glow, epsilon)

        // The point of the curve: 60→80 must not look like 80→100.
        val lowStep = Growth.journeyFeel(80.0).glow - Growth.journeyFeel(60.0).glow
        val highStep = Growth.journeyFeel(100.0).glow - Growth.journeyFeel(80.0).glow
        assertTrue("the final stretch must lift harder", highStep > lowStep)
    }

    @Test
    fun `halo is 6 plus glow times 26`() {
        assertEquals(6f, Growth.journeyFeel(0.0).halo, epsilon)
        assertEquals(6f + 0.90f * 26f, Growth.journeyFeel(100.0).halo, epsilon)
    }

    @Test
    fun `a non-finite percentage is treated as zero rather than crashing the meter`() {
        assertEquals(0f, Growth.journeyFeel(Double.NaN).fill, epsilon)
        assertEquals(0f, Growth.geometry(Double.NaN, emptyList(), emptyList()).fill, epsilon)
    }

    /* --------------------------------------------------------------- geometry */

    @Test
    fun `fill is clamped but completeness reads the real figure`() {
        val over = Growth.geometry(137.0, emptyList(), emptyList())
        // efficiencyPct can exceed 100: clamp the fill, never the number.
        assertEquals(1f, over.fill, epsilon)
        assertTrue(over.complete)

        val under = Growth.geometry(-20.0, emptyList(), emptyList())
        assertEquals(0f, under.fill, epsilon)
        assertFalse(under.complete)
    }

    @Test
    fun `the core grows between CORE_MIN and CORE_MAX`() {
        assertEquals(26f, Growth.geometry(0.0, emptyList(), emptyList()).coreRadius, epsilon)
        assertEquals(44f, Growth.geometry(100.0, emptyList(), emptyList()).coreRadius, epsilon)
        assertEquals(35f, Growth.geometry(50.0, emptyList(), emptyList()).coreRadius, epsilon)
    }

    @Test
    fun `petals are spaced evenly whatever the count`() {
        val three = Growth.geometry(50.0, petals(3), emptyList())
        assertEquals(0f, three.petals[0].angle, epsilon)
        assertEquals(120f, three.petals[1].angle, epsilon)
        assertEquals(240f, three.petals[2].angle, epsilon)

        // A single habit sits at the top rather than at some arbitrary angle.
        val one = Growth.geometry(50.0, petals(1), emptyList())
        assertEquals(0f, one.petals.single().angle, epsilon)
    }

    @Test
    fun `spread is clamped to 9 and 26 degrees`() {
        // Many petals → the floor.
        assertEquals(9f, Growth.geometry(0.0, petals(40), emptyList()).petals[0].spread, epsilon)
        // Two petals → 360/2*0.34 = 61.2, clamped to the ceiling.
        assertEquals(26f, Growth.geometry(0.0, petals(2), emptyList()).petals[0].spread, epsilon)
        // Twelve petals → 30*0.34 = 10.2, inside the range.
        assertEquals(10.2f, Growth.geometry(0.0, petals(12), emptyList()).petals[0].spread, epsilon)
    }

    @Test
    fun `a done petal reaches further, so state survives losing the colour`() {
        val geometry = Growth.geometry(
            50.0,
            listOf(PetalInput("a", true, "#FFFFFF"), PetalInput("b", false, "#FFFFFF")),
            emptyList(),
        )
        val done = geometry.petals[0]
        val open = geometry.petals[1]

        assertEquals(104f, done.reach, epsilon)
        // Half the gap, not a stub: at 18% the open ones were specks and the
        // figure looked broken rather than partly done.
        assertEquals(52f + (104f - 52f) * 0.5f, open.reach, epsilon)
        assertTrue(done.reach > open.reach)
        assertEquals(1, geometry.done)
        assertEquals(2, geometry.total)
    }

    @Test
    fun `rings are one per week, newest innermost, capped at eight`() {
        // Fourteen days of perfect consistency → two rings.
        val two = Growth.buildRings(List(14) { 100.0 })
        assertEquals(2, two.size)
        assertEquals(104f + 8f, two[0].r, epsilon)
        assertEquals(104f + 8f + 9f, two[1].r, epsilon)
        assertEquals(1f, two[0].strength, epsilon)

        // A long-running instance is capped: past eight weeks it is a smudge.
        assertEquals(8, Growth.buildRings(List(365) { 60.0 }).size)

        assertTrue(Growth.buildRings(emptyList()).isEmpty())
    }

    @Test
    fun `a partial week averages only the days it has`() {
        // Three days at 60 → strength 0.6, not 0.6 * 3/7.
        val rings = Growth.buildRings(listOf(60.0, 60.0, 60.0))
        assertEquals(1, rings.size)
        assertEquals(0.6f, rings[0].strength, epsilon)
    }

    /* ----------------------------------------------------- sprout thresholds */

    @Test
    fun `each leaf unfurls across the 0_09 after its own threshold`() {
        // Below its threshold: nothing.
        assertEquals(0f, Growth.leafUnfurl(0, 0.15f), epsilon)
        // At it: just starting.
        assertEquals(0f, Growth.leafUnfurl(0, 0.16f), epsilon)
        // Halfway through the span.
        assertEquals(0.5f, Growth.leafUnfurl(0, 0.16f + 0.045f), epsilon)
        // Past it: fully open and staying open.
        assertEquals(1f, Growth.leafUnfurl(0, 0.30f), epsilon)
        assertEquals(1f, Growth.leafUnfurl(0, 1.0f), epsilon)

        // The last leaf is still closed at 0.89 and open by 1.0.
        assertEquals(0f, Growth.leafUnfurl(5, 0.89f), epsilon)
        assertEquals(1f, Growth.leafUnfurl(5, 1.0f), epsilon)
    }

    @Test
    fun `an out-of-range leaf index is zero rather than an exception`() {
        assertEquals(0f, Growth.leafUnfurl(-1, 1f), epsilon)
        assertEquals(0f, Growth.leafUnfurl(99, 1f), epsilon)
    }

    @Test
    fun `the bloom is the arrival - nothing until 0_90, full at 1_0`() {
        assertEquals(0f, Growth.bloomScale(0.89f), epsilon)
        assertEquals(0f, Growth.bloomScale(0.90f), epsilon)
        assertEquals(0.5f, Growth.bloomScale(0.95f), epsilon)
        assertEquals(1f, Growth.bloomScale(1.0f), epsilon)
        // 100% must not look like a brighter 99%.
        assertNotEquals(Growth.bloomScale(0.99f), Growth.bloomScale(1.0f))
    }

    /* ---------------------------------------------- the figure and its halo */

    /*
     * The milestone-4 bug, as arithmetic.
     *
     * The meter used to take the whole height for its figure and draw the halo
     * into that same square. The halo's radius is 0.78 of the figure, so 0.28
     * of it fell outside the node it was drawn into and a draw modifier clips
     * to its node: hence the hard rectangular edge the user saw just above
     * "Improving". These tests pin the relationship both ways round.
     */

    @Test
    fun `the halo does not fit in a node the size of the figure`() {
        // The premise of the bug. If this ever stops being true the extra box
        // below is dead weight and should go.
        assertTrue("halo radius must exceed half the figure", GrowthTokens.HALO_RADIUS > 0.5f)
    }

    @Test
    fun `the halo box is exactly big enough to contain the halo`() {
        val figure = 200f
        val box = Growth.haloBoxSide(figure)
        assertEquals(312f, box, epsilon)
        // Centre-to-edge of the box == the halo's radius. Not more (wasted
        // layout), not less (a clipped glow).
        assertEquals(figure * GrowthTokens.HALO_RADIUS, box / 2f, epsilon)
    }

    @Test
    fun `the figure takes the height it is given when the halo fits across`() {
        // The real device: 1080px at 408dpi is 423.5dp wide, less two 16dp
        // gutters, and the meter's box is 200dp high.
        assertEquals(200f, Growth.figureSide(391.5f, 200f, 240f), epsilon)
        // …and the halo it then asks for still fits across that width.
        assertTrue(Growth.haloBoxSide(200f) <= 391.5f)
    }

    @Test
    fun `a narrow box shrinks the figure rather than clipping the halo`() {
        val width = 250f
        val side = Growth.figureSide(width, 200f, 240f)
        assertEquals(width / GrowthTokens.HALO_BOX, side, epsilon)
        assertTrue("the figure shrank", side < 200f)
        assertEquals("and the halo now fits exactly", width, Growth.haloBoxSide(side), 0.01f)
    }

    @Test
    fun `the figure never exceeds its cap, and never goes negative`() {
        assertEquals(240f, Growth.figureSide(10_000f, 10_000f, 240f), epsilon)
        // An unbounded height is what a Column hands a child; the cap holds.
        assertEquals(240f, Growth.figureSide(10_000f, Float.POSITIVE_INFINITY, 240f), epsilon)
        assertEquals(0f, Growth.figureSide(0f, 0f, 240f), epsilon)
    }

    /* ------------------------------------------------------------- the paths */

    @Test
    fun `pointAt starts at twelve o'clock and goes clockwise`() {
        val (x0, y0) = Growth.pointAt(120f, 0f, 100f)
        assertEquals(120f, x0, 0.01f)
        assertEquals(20f, y0, 0.01f)

        val (x90, y90) = Growth.pointAt(120f, 90f, 100f)
        assertEquals(220f, x90, 0.01f)
        assertEquals(120f, y90, 0.01f)
    }

    private fun petals(n: Int) = (0 until n).map { PetalInput("p$it", false, "#FF5FA2") }

    private fun assertArrayEqualsF(expected: FloatArray, actual: FloatArray) {
        assertEquals("length", expected.size, actual.size)
        expected.indices.forEach { assertEquals("index $it", expected[it], actual[it], epsilon) }
    }
}
