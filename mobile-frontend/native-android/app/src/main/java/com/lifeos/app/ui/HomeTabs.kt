package com.lifeos.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.lifeos.app.domain.TabSwipe
import com.lifeos.app.ui.theme.LifeOsType
import com.lifeos.app.ui.theme.Motion
import com.lifeos.app.ui.theme.palette
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * The three top-level destinations, as pages of one screen.
 *
 * They stopped being three `NavHost` destinations in milestone 4. A swipe has
 * to show two of them at once, under the finger, and a navigation graph can
 * only ever be at one destination — so Today is the destination and Day and You
 * are pages inside it. Everything that used to `navigate(Routes.DAY)` now picks
 * a tab, which is also why there is no longer a `popUpTo(TODAY) { saveState }`
 * dance to stop Today → Day → Today stacking three entries.
 */
enum class HomeTab(val label: String) {
    TODAY("Today"),
    DAY("Day"),
    YOU("You"),
    ;

    companion object {
        val all: List<HomeTab> = entries.toList()
    }
}

/**
 * Where the three pages are, and how they are moving.
 *
 * One number the whole shell reads — `position`, the pages' place in tab units,
 * continuous while a finger is on them — and two flags saying how it is
 * changing: `travelling` for a gesture, `fadeAlpha` for a tap.
 */
@Stable
class HomeTabsState(
    val pager: PagerState,
    private val fade: Animatable<Float, *>,
    private val travel: Animatable<Float, *>,
    private val scope: CoroutineScope,
) {
    /** Continuous, 0–2. The indicator, the icons and the labels all read this. */
    val position: Float get() = pager.currentPage + pager.currentPageOffsetFraction

    /** The page the content is nearest. Flips at the halfway point of a drag. */
    val current: HomeTab get() = HomeTab.all[pager.currentPage]

    /**
     * The page a gesture has finished on.
     *
     * The poll interval keys off this and not off `current`, so one swipe
     * cannot start and stop three polls on its way across.
     */
    val settled: HomeTab get() = HomeTab.all[pager.settledPage]

    /**
     * True while the user's own finger — or the settle that finishes their
     * gesture — is moving the pages. The navigation bar reads it to choose
     * between travelling with them and cross-fading in place (§5.4).
     */
    var travelling: Boolean by mutableStateOf(false)
        private set

    /** §5.3's destination cross-fade. Driven by taps only; 1 during a swipe. */
    val fadeAlpha: Float get() = fade.value

    /**
     * Where the navigation bar's indicator is, in tab units. **One number.**
     *
     * During a gesture it is the pages' own position, so the indicator is the
     * user's finger. Otherwise it is a critically-damped animation toward the
     * selected tab, so a tap makes the indicator *travel* rather than vanish
     * here and appear there.
     *
     * The two agree at every resting position, which is what makes the handover
     * between them invisible. §5.4 used to forbid the second half outright
     * ("zero pixels of travel"); the rewritten section explains why that was
     * wrong and what the real rule is.
     */
    val indicator: Float get() = if (travelling) position else travel.value

    private var settleJob: Job? = null

    /**
     * Which gesture or tap currently owns the indicator.
     *
     * `Job.cancel()` is **not** immediate — the coroutine resumes at its next
     * suspension point and only then unwinds. So a settle that releases the
     * indicator in a `finally` can release it *after* the next swipe has already
     * claimed it, which stops the indicator tracking a finger that is still on
     * the screen. One counter makes the handover explicit: only the owner may
     * hand the indicator back.
     */
    private var owner = 0

    internal fun onGestureStart() {
        owner++
        settleJob?.cancel()
        travelling = true
    }

    internal fun onGestureEnd(target: Int, spec: AnimationSpec<Float>) {
        val mine = ++owner
        settleJob = scope.launch {
            pager.animateScrollToPage(target, animationSpec = spec)
            /*
             * Sync, then release — and neither on the cancelled path, which is
             * the point of not using `finally` here. Syncing hands the
             * indicator back to the animation at exactly where the gesture left
             * it, so the next tap travels from the truth rather than from
             * wherever the last tap ended.
             */
            travel.snapTo(pager.currentPage.toFloat())
            if (owner == mine) travelling = false
        }
    }

    /**
     * Go to a tab without a gesture: a navigation-bar tap, the Needs-you link,
     * a notification.
     *
     * Two things happen, and they are deliberately different from each other.
     *
     * **The pages jump** — `scrollToPage`, never `animateScrollToPage` — and the
     * content cross-fades (§5.3). Sliding three screens past the eye on a tap is
     * the long horizontal travel the whole navigation was redesigned to remove,
     * and it is content, so a cross-fade is the right language for it.
     *
     * **The indicator travels.** It is 32dp of chrome moving between two
     * adjacent slots, and it is the one thing on screen that says *which way you
     * just went*. Critically damped and fast: `dampingRatio = 1` means it cannot
     * overshoot by construction, so it physically cannot do the wobble the old
     * Expo pill was rejected for. Under reduced motion it snaps and the
     * cross-fade carries the change alone.
     */
    fun jumpTo(tab: HomeTab, reduced: Boolean) {
        if (pager.currentPage == tab.ordinal && !travelling) return
        owner++
        settleJob?.cancel()
        settleJob = scope.launch {
            // Where the indicator is *now*, before the pages jump out from
            // under it. Taken here so the travel always starts from the truth,
            // whatever a cancelled settle did or did not get round to syncing.
            val from = pager.currentPage.toFloat()
            travelling = false
            fade.snapTo(0f)
            travel.snapTo(from)
            pager.scrollToPage(tab.ordinal)
            /*
             * `scope.launch`, not `launch`: deliberately **not** a child of
             * this job. A second tap cancels this one, and the indicator must
             * keep travelling to the newest target rather than stopping
             * halfway. `Animatable` already guarantees one animation at a time
             * and the latest caller wins, which is exactly the behaviour
             * wanted here.
             */
            scope.launch {
                if (reduced) {
                    travel.snapTo(tab.ordinal.toFloat())
                } else {
                    travel.animateTo(
                        targetValue = tab.ordinal.toFloat(),
                        animationSpec = spring(
                            dampingRatio = INDICATOR_DAMPING,
                            stiffness = INDICATOR_STIFFNESS,
                            visibilityThreshold = 0.001f,
                        ),
                    )
                }
            }
            fade.animateTo(
                targetValue = 1f,
                animationSpec = tween(
                    durationMillis = if (reduced) Motion.REDUCED else Motion.MEDIUM,
                    easing = Motion.emphasized,
                ),
            )
        }
    }

    companion object {
        /**
         * Exactly critical. Not 0.9, not "close enough": at 1.0 the solution to
         * the spring has no oscillating term at all, so there is no overshoot to
         * tune away later. The old pill was `damping 30, stiffness 420` on
         * `mass .55` — underdamped, which is why it needed tuning and still
         * wobbled.
         */
        const val INDICATOR_DAMPING = 1f

        /**
         * Quick. A critically damped spring at this stiffness crosses one slot
         * in roughly 180ms, which is inside §5.2's `short`/`medium` band and
         * reads as the indicator keeping up with the tap rather than following
         * it.
         */
        const val INDICATOR_STIFFNESS = 1_200f
    }
}

@Composable
fun rememberHomeTabsState(): HomeTabsState {
    val pager = rememberPagerState(pageCount = { HomeTab.all.size })
    val fade = remember { Animatable(1f) }
    val travel = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    return remember(pager, scope) { HomeTabsState(pager, fade, travel, scope) }
}

/**
 * The pages, and the gesture that moves them.
 *
 * `userScrollEnabled = false`: the drag is ours, not the pager's. The pager
 * claims a horizontal drag the moment it crosses the touch slop on the X axis,
 * which is a 1:1 rule, and §5.4 wants 2:1 — twice as horizontal as vertical.
 * The screen under this gesture is a scrolling agenda, and losing a scroll to a
 * page turn is much worse than losing a page turn to a scroll. The pager is
 * still what measures the pages, holds the position and keeps each page's own
 * scroll state.
 */
@Composable
fun HomeTabPager(
    state: HomeTabsState,
    reduced: Boolean,
    modifier: Modifier = Modifier,
    page: @Composable (HomeTab) -> Unit,
) {
    HorizontalPager(
        state = state.pager,
        userScrollEnabled = false,
        beyondViewportPageCount = 0,
        modifier = modifier
            .tabSwipe(state, reduced)
            .graphicsLayer {
                // §5.3's destination change: cross-fade with a 4% scale-in.
                // Taps drive it; during a swipe `fadeAlpha` is 1 and this does
                // nothing, because there the movement *is* the transition.
                val f = state.fadeAlpha
                alpha = f
                scaleX = 0.96f + 0.04f * f
                scaleY = 0.96f + 0.04f * f
            },
    ) { index ->
        page(HomeTab.all[index])
    }
}

/**
 * The swipe.
 *
 * Nothing is consumed until `claimsHorizontal` is satisfied, so until the
 * gesture is unambiguously ours the list underneath scrolls exactly as it did
 * before this existed — and if the list claims it first, we stand down.
 */
private fun Modifier.tabSwipe(state: HomeTabsState, reduced: Boolean): Modifier =
    pointerInput(state, reduced) {
        val slop = viewConfiguration.touchSlop
        val fling = TabSwipe.FLING_DP_PER_SECOND * density
        val tracker = VelocityTracker()

        awaitEachGesture {
            val first = awaitFirstDown(requireUnconsumed = false)
            tracker.resetTracking()
            tracker.addPosition(first.uptimeMillis, first.position)

            val startPage = state.pager.currentPage
            var dx = 0f
            var dy = 0f
            var claimed = false

            while (true) {
                val event = awaitPointerEvent()
                val change = event.changes.firstOrNull { it.id == first.id } ?: break
                if (!change.pressed) break
                tracker.addPosition(change.uptimeMillis, change.position)

                if (!claimed) {
                    // Something below took it — a vertical scroll. Leave it be.
                    if (change.isConsumed) break
                    dx += change.positionChange().x
                    dy += change.positionChange().y
                    when {
                        TabSwipe.claimsHorizontal(dx, dy, slop) -> {
                            claimed = true
                            state.onGestureStart()
                        }
                        abs(dy) > slop -> break
                    }
                }

                if (claimed) {
                    val moved = change.positionChange().x
                    change.consume()
                    state.pager.dispatchRawDelta(-moved)
                }
            }

            if (claimed) {
                state.onGestureEnd(
                    target = TabSwipe.settleTarget(
                        startPage = startPage,
                        position = state.position,
                        velocity = tracker.calculateVelocity().x,
                        flingVelocity = fling,
                        pageCount = HomeTab.all.size,
                    ),
                    // Deterministic and short: 200ms decelerate, not a spring.
                    // Springs are what made the old bar wobble. With reduced
                    // motion the pages simply arrive (§5.6).
                    spec = if (reduced) snap() else tween(Motion.SHORT, easing = Motion.easeOutCubic),
                )
            }
        }
    }

/* ------------------------------------------------------- the navigation bar */

private val IndicatorWidth: Dp = 64.dp
private val IndicatorHeight: Dp = 32.dp

/**
 * The bottom bar, with an indicator that travels (§5.4).
 *
 * **One expression, both behaviours.** Every item owns an indicator; its opacity
 * is that item's `selectedness` at the shared [HomeTabsState.indicator] position
 * and its horizontal offset is how far that position is from the item. At rest
 * exactly one is visible and none is offset. In motion — whether a finger is
 * dragging the pages or a tap set the spring going — two are visible at partial
 * opacity, each offset toward the other, and because both land on the same point
 * they read as **one** pill travelling.
 *
 * That the two cases are the same arithmetic is the point. 2.0.0 had a `when`
 * here: track during a gesture, otherwise cross-fade two indicators in place.
 * The cross-fade is what the user described as "spotlight from one place to
 * another" — the highlight did not move, it was extinguished in one slot and lit
 * in the next, which the eye reads as teleporting rather than as going
 * somewhere.
 *
 * It is built inside M3's `NavigationBar` so the height, window insets and
 * colours stay the platform's; only the interior is ours, because a standard
 * `NavigationBarItem` cannot be told where to put its indicator.
 */
@Composable
fun TrackingNavigationBar(
    state: HomeTabsState,
    icon: @Composable (tab: HomeTab, filled: Boolean) -> Unit,
    onSelect: (HomeTab) -> Unit,
) {
    val p = palette
    var slotWidth by remember { mutableFloatStateOf(0f) }

    NavigationBar(containerColor = p.surface, contentColor = p.text) {
        /*
         * No `fillMaxHeight` anywhere in here. `Scaffold` measures its bottom
         * bar against the whole window, so a child that fills the height makes
         * the bar as tall as the screen and leaves the content none — which is
         * exactly what it did the first time this was run on a phone. The bar's
         * height is `NavigationBar`'s own, and everything inside wraps.
         */
        Box(
            modifier = Modifier
                .weight(1f)
                .onSizeChanged { slotWidth = it.width.toFloat() / HomeTab.all.size },
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                HomeTab.all.forEachIndexed { index, tab ->
                    NavItemSlot(
                        tab = tab,
                        selected = state.pager.currentPage == index,
                        // One source for both, read on the draw pass (below), so
                        // the indicator, the icon swap and the label firm up
                        // together and cannot drift out of step mid-travel.
                        selectedness = { TabSwipe.selectedness(state.indicator, index) },
                        slide = { (state.indicator - index) * slotWidth },
                        icon = icon,
                        onSelect = { onSelect(tab) },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

/**
 * One item.
 *
 * `selectedness` and `slide` are lambdas on purpose: read inside a
 * `graphicsLayer` block they move the pill on the draw pass, so a finger
 * dragging across the screen never recomposes or re-measures the bar.
 */
@Composable
private fun NavItemSlot(
    tab: HomeTab,
    selected: Boolean,
    selectedness: () -> Float,
    slide: () -> Float,
    icon: @Composable (tab: HomeTab, filled: Boolean) -> Unit,
    onSelect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = palette
    Box(
        modifier = modifier.selectable(
            selected = selected,
            onClick = onSelect,
            role = Role.Tab,
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
        ),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(contentAlignment = Alignment.Center) {
                Box(
                    modifier = Modifier
                        .size(IndicatorWidth, IndicatorHeight)
                        .graphicsLayer {
                            alpha = selectedness()
                            translationX = slide()
                        }
                        .clip(RoundedCornerShape(IndicatorHeight / 2))
                        .background(p.accent2.copy(alpha = 0.16f)),
                )
                Box(
                    modifier = Modifier.height(IndicatorHeight),
                    contentAlignment = Alignment.Center,
                ) {
                    // Outlined underneath, filled on top at this item's own
                    // selectedness: the swap interpolates with the gesture
                    // instead of waiting for it to end.
                    Box(modifier = Modifier.graphicsLayer { alpha = 1f - selectedness() }) {
                        icon(tab, false)
                    }
                    Box(modifier = Modifier.graphicsLayer { alpha = selectedness() }) {
                        icon(tab, true)
                    }
                }
            }
            /*
             * Always visible (§5.4): nothing appears or disappears on
             * selection, the colour simply firms up.
             *
             * Two stacked copies rather than one `lerp`ed colour, for the same
             * reason as the icons above: a colour computed in the composition
             * recomposes this `Text` on every frame of the travel, and a bar
             * that recomposes while a finger is dragging it is a bar that can
             * drop a frame. Two alphas in a `graphicsLayer` are a draw.
             */
            Box {
                Text(
                    text = tab.label,
                    style = LifeOsType.label,
                    color = p.muted,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier.graphicsLayer { alpha = 1f - selectedness() },
                )
                Text(
                    text = tab.label,
                    style = LifeOsType.label,
                    color = p.text,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier.graphicsLayer { alpha = selectedness() },
                )
            }
        }
    }
}
