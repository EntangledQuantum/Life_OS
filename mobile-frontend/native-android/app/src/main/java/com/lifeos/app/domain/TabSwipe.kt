package com.lifeos.app.domain

import kotlin.math.abs

/**
 * The rules behind the swipe between Today · Day · You (UI_SPEC §5.4).
 *
 * Pure: no Compose, no Android. The three decisions that decide whether the
 * gesture feels right — **is this swipe ours**, **where does it land**, and
 * **how selected is each item right now** — are therefore unit-tested rather
 * than only felt, and each of them is written once.
 *
 * The first one is inherited. The Expo app only claimed a horizontal gesture
 * once it was twice as horizontal as vertical, because anything looser steals
 * from the agenda list the screen exists for. That rule earned its place and
 * it is kept here, as `claimsHorizontal`.
 */
object TabSwipe {

    /**
     * How much more horizontal than vertical a drag must be before the pages
     * take it. Two, inherited: a thumb travelling down a list is never this
     * sideways, and a thumb crossing the screen always is.
     */
    const val HORIZONTAL_RATIO = 2f

    /**
     * Past this speed the drag commits however short it was — this is the
     * flick. Below it, distance decides. In dp per second, so it means the same
     * thing on every screen.
     */
    const val FLING_DP_PER_SECOND = 400f

    /**
     * How far a *slow* drag must travel to commit, as a fraction of the page.
     * Below it the page snaps back. A third of the screen is a deliberate
     * movement; a tenth is a thumb resting on its way somewhere else.
     */
    const val COMMIT_FRACTION = 0.35f

    /**
     * Whether the pages should take this drag, or leave it to whatever is
     * scrolling vertically underneath.
     *
     * Both halves matter: past the touch slop (so a tap is never a swipe), and
     * twice as horizontal as vertical (so a scroll is never a swipe).
     */
    fun claimsHorizontal(dx: Float, dy: Float, slop: Float): Boolean =
        abs(dx) > slop && abs(dx) > HORIZONTAL_RATIO * abs(dy)

    /**
     * Which page the gesture settles on when the finger lifts.
     *
     * Measured from `startPage` — the page the gesture began on — rather than
     * from whichever page is nearest now, because those two disagree exactly
     * where it matters. Drag 60% of the way and the nearest page is already the
     * new one with the offset pointing *back* at the old one; reading the
     * offset's sign there would snap the user back after they had plainly
     * arrived.
     *
     * One page per gesture, by construction: a swipe moves to a neighbour, and
     * a long fast flick is still a neighbour rather than a trip across the app.
     *
     * @param position where the pager is now, in pages (`page + offset`).
     * @param velocity horizontal velocity in px/s, negative when moving left.
     * @param flingVelocity `FLING_DP_PER_SECOND` in px/s for this screen.
     */
    fun settleTarget(
        startPage: Int,
        position: Float,
        velocity: Float,
        flingVelocity: Float,
        pageCount: Int,
    ): Int {
        val travelled = position - startPage
        val step = when {
            // A flick wins over distance: the finger left moving, and which way
            // it was moving is the whole of the user's intent.
            velocity <= -flingVelocity -> 1
            velocity >= flingVelocity -> -1
            travelled >= COMMIT_FRACTION -> 1
            travelled <= -COMMIT_FRACTION -> -1
            else -> 0
        }
        return (startPage + step).coerceIn(0, pageCount - 1)
    }

    /**
     * How selected navigation item `index` is, given the pages' continuous
     * position — `1` when it fills the screen, `0` when a neighbour does, and
     * linear in between.
     *
     * The honest number: it is the finger's own position, rescaled. Everything
     * the bar draws is a function of this, so the icon, the label and the
     * indicator cannot drift out of step mid-gesture.
     */
    fun selectedness(position: Float, index: Int): Float =
        (1f - abs(position - index)).coerceIn(0f, 1f)

    /**
     * `selectedness`, eased — the number the bar actually *draws* with.
     *
     * Raw selectedness is linear, and a linear hand-over is the least legible
     * one there is: a third of the way through a swipe the two items differ by
     * a third, which on a 24dp glyph is nothing at all. Smoothstep spends that
     * contrast where a frozen frame needs it. At 40% of a swipe the outgoing
     * item is at 0.65 and the incoming at 0.35 — nearly half as much separation
     * again as the linear pair, which is the difference between a still that
     * reads "mostly Today, becoming Day" and one that reads "two grey icons".
     *
     * Symmetric, so `emphasis(p, i)` and `emphasis(p, i + 1)` still sum to one
     * across a swipe: the bar never gets brighter or dimmer in total, it only
     * moves its weight from one destination to the next.
     */
    fun emphasis(position: Float, index: Int): Float {
        val t = selectedness(position, index)
        return t * t * (3f - 2f * t)
    }

    /**
     * How far item `index` leans toward where the pages currently are, as a
     * fraction of one lean — `0` at rest, `±1` once the pages are a whole tab
     * away.
     *
     * This is what is left of the travelling pill, and the bound is the whole
     * point. Multiplied by a lean of a few dp rather than by the slot width, an
     * item's indicator shifts *toward* the movement without ever leaving the
     * icon it belongs to, so it can never be the thing that it was: a highlight
     * adrift in the gap between two destinations, meaning nothing until it
     * arrived (§5.4, revision 4).
     *
     * Direction survives the bound. During a left-to-right move every item's
     * lean increases together, so the whole bar leans the way you are going.
     */
    fun lean(position: Float, index: Int): Float =
        (position - index).coerceIn(-1f, 1f)
}
