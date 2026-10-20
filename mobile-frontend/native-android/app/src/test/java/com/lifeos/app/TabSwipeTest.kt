package com.lifeos.app

import com.lifeos.app.domain.TabSwipe
import com.lifeos.app.ui.HomeTabsState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The swipe between Today · Day · You (UI_SPEC §5.4).
 *
 * The two decisions that make a gesture feel right or wrong — when it is ours,
 * and where it lands — are arithmetic, so they are tested here rather than
 * discovered by a thumb. The feel on top of them (200ms decelerate, no spring)
 * is a choice of animation spec and is not something a unit test can judge.
 */
class TabSwipeTest {

    private val slop = 24f
    private val fling = 400f * 2.55f // 400dp/s on the test device's density

    /* ------------------------------------------- is this gesture ours at all */

    @Test
    fun `a clearly horizontal drag is claimed`() {
        assertTrue(TabSwipe.claimsHorizontal(dx = 60f, dy = 4f, slop = slop))
        assertTrue(TabSwipe.claimsHorizontal(dx = -60f, dy = -4f, slop = slop))
    }

    @Test
    fun `a vertical scroll is never claimed`() {
        // The case the 2:1 rule exists for: a thumb going down the agenda,
        // drifting sideways as thumbs do.
        assertFalse(TabSwipe.claimsHorizontal(dx = 30f, dy = 120f, slop = slop))
        assertFalse(TabSwipe.claimsHorizontal(dx = -30f, dy = 120f, slop = slop))
    }

    @Test
    fun `a diagonal drag is left to the list until it is twice as horizontal`() {
        // 1:1 would take this one. §5.4 does not: losing a scroll to a page
        // turn is worse than losing a page turn to a scroll.
        assertFalse(TabSwipe.claimsHorizontal(dx = 55f, dy = 45f, slop = slop))
        assertFalse(TabSwipe.claimsHorizontal(dx = 60f, dy = 30f, slop = slop))
        assertTrue(TabSwipe.claimsHorizontal(dx = 61f, dy = 30f, slop = slop))
    }

    @Test
    fun `nothing inside the touch slop is a swipe`() {
        // Otherwise every tap on a card is a page turn waiting to happen.
        assertFalse(TabSwipe.claimsHorizontal(dx = 20f, dy = 0f, slop = slop))
        assertTrue(TabSwipe.claimsHorizontal(dx = 25f, dy = 0f, slop = slop))
    }

    /* ----------------------------------------------------- where it lands */

    private fun settle(
        from: Int,
        position: Float,
        velocity: Float = 0f,
        pages: Int = 3,
    ) = TabSwipe.settleTarget(from, position, velocity, fling, pages)

    @Test
    fun `a slow partial drag snaps back`() {
        assertEquals(0, settle(from = 0, position = 0.2f))
        assertEquals(1, settle(from = 1, position = 0.85f))
    }

    @Test
    fun `a slow drag past the commit fraction goes through`() {
        assertEquals(1, settle(from = 0, position = 0.4f))
        assertEquals(0, settle(from = 1, position = 0.6f))
    }

    @Test
    fun `a fast flick commits on a short drag`() {
        // Barely moved, but left and quickly: that is a flick, and it counts.
        assertEquals(1, settle(from = 0, position = 0.05f, velocity = -2_000f))
        assertEquals(0, settle(from = 1, position = 0.95f, velocity = 2_000f))
    }

    @Test
    fun `a slow drag at flicking speed minus one still needs the distance`() {
        assertEquals(0, settle(from = 0, position = 0.1f, velocity = -(fling - 1f)))
    }

    @Test
    fun `the target is measured from where the gesture started, not from the nearest page`() {
        /*
         * The reason `settleTarget` takes `startPage`. Drag 60% of the way from
         * Today to Day and the pager's own nearest page is already Day, with
         * its offset pointing *back* at Today. Reading that offset's sign would
         * snap the user back to Today after they had plainly arrived.
         */
        assertEquals(1, settle(from = 0, position = 0.6f))
        assertEquals(2, settle(from = 1, position = 1.6f))
    }

    @Test
    fun `one gesture moves one page, however hard it is thrown`() {
        assertEquals(1, settle(from = 0, position = 0.9f, velocity = -9_000f))
    }

    @Test
    fun `the ends do not wrap`() {
        assertEquals(0, settle(from = 0, position = -0.4f, velocity = 2_000f))
        assertEquals(2, settle(from = 2, position = 2.4f, velocity = -2_000f))
    }

    /* ------------------------------------------- what the bar reads from it */

    @Test
    fun `selectedness is one at home and zero at a neighbour`() {
        assertEquals(1f, TabSwipe.selectedness(0f, 0), 0.0001f)
        assertEquals(0f, TabSwipe.selectedness(0f, 1), 0.0001f)
        assertEquals(0f, TabSwipe.selectedness(0f, 2), 0.0001f)
    }

    @Test
    fun `selectedness splits evenly halfway through a swipe`() {
        // This is why the two indicators read as one travelling pill: at the
        // halfway point each is drawn at half opacity, on the same spot.
        assertEquals(0.5f, TabSwipe.selectedness(0.5f, 0), 0.0001f)
        assertEquals(0.5f, TabSwipe.selectedness(0.5f, 1), 0.0001f)
    }

    @Test
    fun `selectedness across the three items always sums to one`() {
        var p = 0f
        while (p <= 2f) {
            val sum = (0..2).sumOf { TabSwipe.selectedness(p, it).toDouble() }
            assertEquals("at position $p", 1.0, sum, 0.0001)
            p += 0.05f
        }
    }

    @Test
    fun `selectedness never goes negative two tabs away`() {
        assertEquals(0f, TabSwipe.selectedness(2f, 0), 0.0001f)
    }

    @Test
    fun `the indicator's travel is critically damped, by construction`() {
        /*
         * This is a guard against the change being "fixed" back, in either
         * direction, and it is worth a test because the history here is two
         * reversals deep.
         *
         * The Expo app travelled a pill across five tabs on an underdamped
         * spring (`mass .55, damping 30, stiffness 420`), it wobbled, and the
         * rewrite banned travel outright — "zero pixels", §5.4. The bar then
         * cross-faded two indicators in place, which the user described as the
         * highlight teleporting, and they were right. So it travels again, and
         * the thing that makes that safe is the damping ratio being exactly 1:
         * at critical damping the spring's solution has no oscillating term, so
         * it *cannot* overshoot and there is nothing to tune. Anything below 1
         * brings the wobble back.
         */
        assertEquals(1f, HomeTabsState.INDICATOR_DAMPING, 0f)
        // And quick: one slot in roughly 180ms at this stiffness.
        assertTrue(HomeTabsState.INDICATOR_STIFFNESS >= 900f)
    }
}
