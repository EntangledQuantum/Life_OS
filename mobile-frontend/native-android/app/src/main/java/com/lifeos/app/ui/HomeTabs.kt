package com.lifeos.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
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
import androidx.compose.ui.graphics.lerp
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

    private var settleJob: Job? = null

    internal fun onGestureStart() {
        settleJob?.cancel()
        travelling = true
    }

    internal fun onGestureEnd(target: Int, spec: AnimationSpec<Float>) {
        settleJob = scope.launch {
            try {
                pager.animateScrollToPage(target, animationSpec = spec)
            } finally {
                travelling = false
            }
        }
    }

    /**
     * Go to a tab without a gesture: a navigation-bar tap, the Needs-you link,
     * a notification.
     *
     * The pages **jump** — `scrollToPage`, never `animateScrollToPage` — so the
     * indicator does not travel, which is §5.4's rule for a tap and still
     * stands. The change is carried by the fade instead, which is §5.3's
     * destination cross-fade.
     */
    fun jumpTo(tab: HomeTab, reduced: Boolean) {
        if (pager.currentPage == tab.ordinal && !travelling) return
        settleJob?.cancel()
        settleJob = scope.launch {
            travelling = false
            fade.snapTo(0f)
            pager.scrollToPage(tab.ordinal)
            fade.animateTo(
                targetValue = 1f,
                animationSpec = tween(
                    durationMillis = if (reduced) Motion.REDUCED else Motion.MEDIUM,
                    easing = Motion.emphasized,
                ),
            )
        }
    }
}

@Composable
fun rememberHomeTabsState(): HomeTabsState {
    val pager = rememberPagerState(pageCount = { HomeTab.all.size })
    val fade = remember { Animatable(1f) }
    val scope = rememberCoroutineScope()
    return remember(pager, scope) { HomeTabsState(pager, fade, scope) }
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
 * The bottom bar, with an indicator that tracks the gesture (§5.4).
 *
 * Two behaviours, one expression. Every item owns an indicator; its opacity is
 * that item's `selectedness` and its horizontal offset is how far the pages are
 * from it. At rest exactly one is visible and none is offset. Mid-drag two are
 * visible at partial opacity, each offset towards the other — and since both
 * land on the same point they read as **one** pill travelling under the finger.
 * On a tap the pages jump, so no offset is ever non-zero and the opacities
 * cross-fade in place over 200ms, which is the behaviour §5.4 was written for.
 *
 * It is built inside M3's `NavigationBar` so the height, window insets and
 * colours stay the platform's; only the interior is ours, because a standard
 * `NavigationBarItem` cannot be told where to put its indicator.
 */
@Composable
fun TrackingNavigationBar(
    state: HomeTabsState,
    reduced: Boolean,
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
                    val selected = state.pager.currentPage == index
                    // At rest the bar cross-fades; mid-gesture it tracks. The
                    // two agree at every resting position, so the handover
                    // between them is invisible.
                    val resting by animateFloatAsState(
                        targetValue = if (selected) 1f else 0f,
                        animationSpec = tween(if (reduced) Motion.REDUCED else Motion.SHORT),
                        label = "nav-${tab.name}",
                    )
                    val travelling = state.travelling

                    NavItemSlot(
                        tab = tab,
                        selected = selected,
                        selectedness = {
                            if (travelling) TabSwipe.selectedness(state.position, index) else resting
                        },
                        slide = { if (travelling) (state.position - index) * slotWidth else 0f },
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
            // Always visible (§5.4): nothing appears or disappears on
            // selection, the colour simply firms up.
            Text(
                text = tab.label,
                style = LifeOsType.label,
                color = lerp(p.muted, p.text, selectedness()),
                textAlign = TextAlign.Center,
                maxLines = 1,
            )
        }
    }
}
