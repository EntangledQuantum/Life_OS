package com.lifeos.app.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * Everything that is NOT a colour.
 *
 * These objects take no palette and are not provided through any composition
 * local keyed to a theme, which is what makes UI_SPEC §6.2 structural: switching
 * a palette recomposes colours only — no layout pass changes, no measurement
 * changes, no re-sort, no scroll jump.
 */

/** §6.6: `4 · 8 · 12 · 16 · 20 · 24 · 32`. Nothing between, nothing beyond. */
object Spacing {
    val xs: Dp = 4.dp
    val sm: Dp = 8.dp
    val md: Dp = 12.dp
    val lg: Dp = 16.dp
    val xl: Dp = 20.dp
    val xxl: Dp = 24.dp
    val xxxl: Dp = 32.dp
}

/** §6.6: `12` tile, `20` card, `28` sheet and FAB. */
object Radii {
    val tile: Dp = 12.dp
    val card: Dp = 20.dp
    val sheet: Dp = 28.dp
}

/** Fixed geometry that several screens must agree on. */
object Sizes {
    /** Line length cap, centred — the old `PageBody`. */
    val contentMax: Dp = 560.dp
    val topBar: Dp = 56.dp
    val activityLine: Dp = 40.dp
    val statusStrip: Dp = 32.dp
    val agendaCard: Dp = 88.dp
    val agendaCardWithStrip: Dp = 104.dp
    val iconTile: Dp = 48.dp

    /** The mark beside an agent card's title — its SVG, its icon, or its emoji. */
    val agentMark: Dp = 28.dp

    /** A goal card's icon tile. Larger on the lead goal, which is the one thing. */
    val goalIcon: Dp = 40.dp
    val goalIconLead: Dp = 56.dp

    /** A rarity rung's own picture, in place of the filled dot. */
    val rungIcon: Dp = 18.dp

    /** The celebration's medallion — the tier's picture, full and immediate. */
    val celebrationIcon: Dp = 120.dp

    /** A task's artwork in a detail sheet. 3:2 at the sheet's width, near enough. */
    val sheetArtwork: Dp = 180.dp
    val tick: Dp = 44.dp
    val tickTouch: Dp = 48.dp
    val meter: Dp = 200.dp
    val ribbon: Dp = 56.dp
    val dayRow: Dp = 56.dp
    val weekMark: Dp = 8.dp
}

/**
 * §5.2. Material 3 standard durations; do not invent new ones.
 *
 * Nothing in the app animates longer than `long` except `celebration`.
 */
object Motion {
    const val INSTANT = 100
    const val SHORT = 200
    const val MEDIUM = 350
    const val LONG = 500
    const val CELEBRATION = 900

    /** Reduced motion collapses every duration above to a 100ms cross-fade. */
    const val REDUCED = 100

    val linear: Easing = LinearEasing

    /** M3 standard decelerate. */
    val easeOutCubic: Easing = CubicBezierEasing(0.21f, 0.6f, 0.35f, 1f)

    /** M3 emphasized. */
    val emphasized: Easing = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)

    val easeInOutSine: Easing = CubicBezierEasing(0.37f, 0f, 0.63f, 1f)

    /** The tick's scale punch, and nothing else. */
    const val SNAP_DAMPING = 0.9f
    const val SNAP_STIFFNESS = 1400f
    const val DEFAULT_DAMPING = Spring.DampingRatioNoBouncy

    /** §5.5: one pulse, 1800ms per cycle, border alpha 25% → 60%. */
    const val PULSE_PERIOD = 1800
    const val PULSE_MIN_ALPHA = 0.25f
    const val PULSE_MAX_ALPHA = 0.60f

    /** §3 state rules: the refresh line waits this long before it shows. */
    const val REFRESH_INDICATOR_DELAY_MS = 600L

    /** An empty cache becomes an error panel after this. */
    const val EMPTY_CACHE_ERROR_MS = 6_000L
}

/**
 * The seven buckets of the day.
 *
 * **Not part of a palette, by design (§6.2).** The seven must mean the same
 * colour in every theme, on the ribbon, on the widget and on the web, or the
 * ribbon needs a legend. Values copied from the Expo app's `lib/theme.ts` so
 * the three surfaces agree.
 */
object ActivityColors {
    const val DEEP_WORK = "Deep Work"
    const val STUDY = "Study"
    const val SLEEP = "Sleep"
    const val EXERCISE = "Exercise"
    const val BREAK = "Break"
    const val LIFE_ADMIN = "Life Admin"
    const val EXPLORATION = "Exploration"

    /** The closed set. Agents map their content onto these; nothing invents one. */
    val ALL: List<String> = listOf(DEEP_WORK, STUDY, SLEEP, EXERCISE, BREAK, LIFE_ADMIN, EXPLORATION)

    /**
     * The activity chips the user may set by hand.
     *
     * Sleep and Break are excluded: the schedule and the agent set those. One
     * definition, used by the picker and by the widget — see the "one predicate"
     * rule in the README.
     */
    val MANUAL: List<String> = ALL - setOf(SLEEP, BREAK)

    private val byTag: Map<String, Color> = mapOf(
        DEEP_WORK to Color(0xFF6EA8FF),
        STUDY to Color(0xFFB57BFF),
        EXERCISE to Color(0xFFFF7A9C),
        BREAK to Color(0xFF4ADE80),
        LIFE_ADMIN to Color(0xFFFBBF24),
        SLEEP to Color(0xFF5C6BC0),
        EXPLORATION to Color(0xFF22D3EE),
    )

    fun of(tag: String?, fallback: Color): Color =
        if (tag == null) fallback else byTag[tag] ?: fallback
}

/**
 * Growth-meter geometry, ported from `packages/shared/src/{growth,journey}.ts`.
 *
 * Duplicated on purpose (isolation contract) and therefore a copy that must stay
 * one. Unit-tested against the values in those files.
 */
object GrowthTokens {
    /** The square both clients draw into. `GROWTH_SIZE` in growth.ts. */
    const val SIZE = 240f

    /** Sprout viewBox. The sprout is drawn in 200 units, not 240. */
    const val SPROUT_VIEWBOX = 200f

    /**
     * Leaf thresholds, then bloom at 1.0. These match the web client exactly;
     * a drifted copy makes the phone and the desktop different objects.
     */
    val LEAF_THRESHOLDS = floatArrayOf(0.16f, 0.32f, 0.46f, 0.62f, 0.78f, 0.90f)

    /** Each leaf unfurls across the 0.09 of progress after its threshold. */
    const val LEAF_UNFURL_SPAN = 0.09f

    /**
     * The halo's radius, as a fraction of the figure's side.
     *
     * Deliberately larger than `0.5`: the glow is supposed to reach well past
     * the figure. Which is exactly why it **cannot** be drawn into a node the
     * size of the figure — see `HALO_BOX`.
     */
    const val HALO_RADIUS = 0.78f

    /**
     * The halo's drawing node, as a multiple of the figure's side.
     *
     * `2 × HALO_RADIUS`: the smallest square whose centre-to-edge distance is
     * the halo's own radius. A draw modifier clips to its node's bounds, so a
     * halo of radius `0.78 · side` drawn into a `side`-sized node loses
     * everything past `0.5 · side` — which is the hard rectangular edge that
     * was visible around the glow until milestone 4. Give it this much room and
     * the gradient reaches zero alpha inside its own node.
     */
    const val HALO_BOX = 2f * HALO_RADIUS

    const val CORE_MIN = 26f
    const val CORE_MAX = 44f
    const val PETAL_INNER = 52f
    const val PETAL_OUTER = 104f
    const val MAX_RINGS = 8
    const val RING_GAP = 9f
    const val RING_INNERMOST_OFFSET = 8f
}
