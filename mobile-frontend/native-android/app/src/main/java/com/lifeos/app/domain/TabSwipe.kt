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
     * One number, read by the indicator, the icon and the label, so the three
     * cannot drift out of step mid-gesture.
     */
    fun selectedness(position: Float, index: Int): Float =
        (1f - abs(position - index)).coerceIn(0f, 1f)
}
