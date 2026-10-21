package com.lifeos.app.ui

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.ui.unit.IntOffset
import com.lifeos.app.ui.theme.Motion

/**
 * How a secondary screen arrives and leaves (UI_SPEC §5.3).
 *
 * **Shared axis X.** Going into Settings, into a settings subpage, into `server`
 * or into the scanner moves the world left; coming back moves it right. 2.0.0
 * shipped `navigation-compose`'s default, which is a plain cross-fade in both
 * directions, and a cross-fade has no direction: forward and back looked
 * identical, so the back gesture did not feel like going back and the whole app
 * read as cheaper than it is. That is the "it just fades in and out" the user
 * reported.
 *
 * Three decisions worth stating:
 *
 *  - **The offset is a fraction of the width, not a dp constant.** 12% is about
 *    47dp on a phone and about 100dp on a tablet, which is the same *gesture* at
 *    both sizes rather than the same number of pixels.
 *  - **The outgoing screen fades faster than the incoming one arrives.** Equal
 *    fades cross at 50% each and the two screens ghost through one another; at
 *    `short` out and `medium` in, the old screen is gone before the new one is
 *    solid.
 *  - **Nothing here is a spring.** A fixed duration and M3's emphasized easing,
 *    like everything else in this app. Springs are what made the old navigation
 *    pill wobble.
 *
 * `navigation-compose` drives the two `pop` transitions in reverse under a
 * predictive-back gesture, so the back swipe scrubs this animation with the
 * user's finger and nothing extra is needed to make that work.
 *
 * Reduced motion collapses all four to a 100ms cross-fade (§5.6): the direction
 * is information, but not information worth translating a screen for when the
 * user has asked for no translation anywhere.
 */
private const val SHIFT = 0.12f

private val slide = tween<IntOffset>(Motion.MEDIUM, easing = Motion.emphasized)
private val fadeIntoView = tween<Float>(Motion.MEDIUM, easing = Motion.emphasized)
private val fadeOutOfView = tween<Float>(Motion.SHORT, easing = Motion.easeOutCubic)

private fun shift(width: Int): Int = (width * SHIFT).toInt()

/** Forward: the new screen comes in from the right. */
fun screenEnter(reduced: Boolean): EnterTransition =
    if (reduced) {
        fadeIn(tween(Motion.REDUCED))
    } else {
        fadeIn(fadeIntoView) + slideInHorizontally(slide) { shift(it) }
    }

/** Forward: the screen behind it leaves to the left. */
fun screenExit(reduced: Boolean): ExitTransition =
    if (reduced) {
        fadeOut(tween(Motion.REDUCED))
    } else {
        fadeOut(fadeOutOfView) + slideOutHorizontally(slide) { -shift(it) }
    }

/** Back: the screen underneath returns from the left. */
fun screenPopEnter(reduced: Boolean): EnterTransition =
    if (reduced) {
        fadeIn(tween(Motion.REDUCED))
    } else {
        fadeIn(fadeIntoView) + slideInHorizontally(slide) { -shift(it) }
    }

/** Back: the screen being left goes out to the right, the way it came in. */
fun screenPopExit(reduced: Boolean): ExitTransition =
    if (reduced) {
        fadeOut(tween(Motion.REDUCED))
    } else {
        fadeOut(fadeOutOfView) + slideOutHorizontally(slide) { shift(it) }
    }
