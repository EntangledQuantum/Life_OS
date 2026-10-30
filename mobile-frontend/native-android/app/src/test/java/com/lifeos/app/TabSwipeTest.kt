package com.lifeos.app

import com.lifeos.app.domain.TabSwipe
import com.lifeos.app.ui.HomeTabsState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

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
        // The honest number: halfway between two tabs is half of each.
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

    /* ------------------------- what the destinations interpolate (§5.4 rev 4) */

    @Test
    fun `emphasis and selectedness agree wherever the bar comes to rest`() {
        // The handover between tracking a finger and animating after a tap is
        // invisible only because every resting position is a fixed point of
        // both numbers. If an ease were introduced that did not pin 0 and 1,
        // the bar would settle to a slightly different state than the one the
        // gesture left it in, and the join would show.
        for (i in 0..2) {
            assertEquals(1f, TabSwipe.emphasis(i.toFloat(), i), 0.0001f)
            assertEquals(0f, TabSwipe.emphasis(i.toFloat() + 1f, i), 0.0001f)
            assertEquals(0f, TabSwipe.emphasis(i.toFloat() - 1f, i), 0.0001f)
        }
    }

    @Test
    fun `emphasis separates the two tabs more than a linear hand-over would`() {
        /*
         * The legibility claim, as arithmetic. This is the test for the thing
         * the user actually complained about: a frame taken 40% through a
         * swipe has to read as "mostly Today, becoming Day" rather than as two
         * identical grey icons.
         *
         * Linear gives 0.60 / 0.40 — a 0.20 gap, which on a 24dp glyph and a
         * 12sp label is nothing. Smoothstep gives 0.648 / 0.352, which is
         * nearly half as much separation again.
         */
        val linear = TabSwipe.selectedness(0.4f, 0) - TabSwipe.selectedness(0.4f, 1)
        val eased = TabSwipe.emphasis(0.4f, 0) - TabSwipe.emphasis(0.4f, 1)
        assertEquals(0.2f, linear, 0.0001f)
        assertTrue("eased separation $eased should beat linear $linear", eased > linear * 1.4f)
    }

    @Test
    fun `emphasis across the three items always sums to one`() {
        // The bar moves its weight from one destination to the next; it never
        // gets brighter or dimmer in total. True of `selectedness` because it
        // is linear, and preserved here only because smoothstep is symmetric
        // about a half — which is the reason for choosing it over an ease that
        // merely looked right.
        var p = 0f
        while (p <= 2f) {
            val sum = (0..2).sumOf { TabSwipe.emphasis(p, it).toDouble() }
            assertEquals("at position $p", 1.0, sum, 0.0001)
            p += 0.05f
        }
    }

    @Test
    fun `emphasis never overshoots, at any position`() {
        /*
         * A guard with history behind it. Everything the bar draws — the
         * glyph's size, its lift, the capsule's width — is `lerp(rest, full,
         * emphasis)`, so an ease that returned 1.05 anywhere would make the
         * icon overshoot its size and spring back. That is the wobble the Expo
         * bar was rejected for, arriving by a different door.
         */
        var p = -1.5f
        while (p <= 3.5f) {
            for (i in 0..2) {
                val e = TabSwipe.emphasis(p, i)
                assertTrue("at $p item $i gave $e", e in 0f..1f)
            }
            p += 0.025f
        }
    }

    @Test
    fun `emphasis rises monotonically as the pages approach an item`() {
        // No dip, no bounce: a finger dragged steadily toward Day must make
        // Day steadily more selected and never briefly less.
        var p = 0f
        var previous = TabSwipe.emphasis(0f, 1)
        while (p <= 1f) {
            val now = TabSwipe.emphasis(p, 1)
            assertTrue("at $p: $now fell below $previous", now >= previous - 0.0001f)
            previous = now
            p += 0.01f
        }
    }

    /* ------------------------------- and what no longer crosses the gap */

    @Test
    fun `an item's indicator is bounded to its own icon, at every position`() {
        /*
         * The 2.0.2 fault, written down so it cannot come back.
         *
         * The old offset was `(indicator - index) * slotWidth` — the **whole**
         * distance between two slots. Halfway through a swipe that put a lit
         * 64dp capsule exactly half a slot from either icon: over the empty
         * space between them, attached to nothing, which is what the user saw
         * and called "an empty glow moving on the background glow".
         *
         * The offset is now `lean() * IndicatorLean`, and `lean` is bounded at
         * one. With a lean of 10dp the capsule's centre therefore moves at
         * most 10dp from its own icon. Even on the narrowest window this bar is
         * laid out in (320dp wide, so ~106dp per slot) half a slot is 53dp, so
         * the capsule stays inside its own half of its own slot with 43dp to
         * spare — by construction, not by tuning.
         */
        var p = -1.5f
        while (p <= 3.5f) {
            for (i in 0..2) {
                assertTrue("at $p item $i", abs(TabSwipe.lean(p, i)) <= 1f)
            }
            p += 0.025f
        }
    }

    @Test
    fun `nothing leans at rest`() {
        // At every resting position the bar is perfectly square: no item is
        // offset, so there is no residual tilt to notice.
        for (i in 0..2) {
            assertEquals(0f, TabSwipe.lean(i.toFloat(), i), 0.0001f)
        }
    }

    @Test
    fun `the whole bar leans the way the pages are going`() {
        /*
         * What is left of the travel, and why it still answers "which way did
         * I just go". Each item's lean is `position - index`, so moving the
         * pages from Today toward Day increases *every* item's lean together
         * and the three capsules all shift right. Bounded, but directional —
         * which is the clause of §5.4 that the 2.0.0 cross-fade failed.
         */
        for (i in 0..2) {
            val atRest = TabSwipe.lean(0f, i)
            val partway = TabSwipe.lean(0.4f, i)
            val arrived = TabSwipe.lean(1f, i)
            assertTrue("item $i did not lean forward", partway >= atRest)
            assertTrue("item $i did not keep leaning", arrived >= partway)
        }
        // And the one in the middle of the move leans toward it from both
        // sides: Today trails the pages, Day is still reaching back for them.
        assertTrue(TabSwipe.lean(0.4f, 0) > 0f)
        assertTrue(TabSwipe.lean(0.4f, 1) < 0f)
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
