package com.lifeos.app.domain

/**
 * Which content tier a widget box gets (UI_SPEC §8.5).
 *
 * Pure, and in `domain` rather than in `widget/`, because it is the one decision
 * in the widget worth a unit test and because there is no Android in it. The
 * launcher hands out a different box per device, per cell count, and again after
 * every resize, so this is answered per render from the real dp box — never from
 * a device class and never once at install.
 */
enum class WidgetTier {
    /** 4×3 and up: everything, including the activity chips. */
    TALL,

    /** 4×2: meter, figures, pulse word, ribbon, two agenda rows. No chips. */
    FULL,

    /** Wide but short: the ribbon and the chips are dropped, not clipped. */
    WIDE_SHORT,

    /** 2×2: the ring, the percentage, and one agenda line. No tick. */
    COMPACT,
    ;

    /**
     * Whether a tick target fits.
     *
     * Open question #8, decided: a launcher cell is small and a mis-tap
     * completes a habit, so the tick is only drawn where 48dp of target fits.
     * On [COMPACT] the row opens the app instead of completing — which is the
     * right failure, because opening the app is recoverable and a wrongly
     * completed habit corrupts a streak.
     */
    val showsTick: Boolean get() = this != COMPACT

    val showsRibbon: Boolean get() = this == FULL || this == TALL

    /**
     * The chips need their own, higher threshold — measured, not guessed.
     *
     * §8.5 gives one threshold for the ribbon *and* the chips ("below ~150dp
     * tall, drop the ribbon and the chips"). On a real 4×2 box on the test
     * device — 366 × 203dp — the ribbon fits comfortably and the chips do not:
     * the meter, the ribbon and two agenda rows come to about 180dp before the
     * chips are reached. With one threshold the chips were being dropped by the
     * `Column` running out of room, which is the right *outcome* arrived at by
     * accident, and an accident is not a layout rule.
     *
     * So the two are separate thresholds and the chips get the taller one.
     * Stated as a spec divergence in the README.
     */
    val showsChips: Boolean get() = this == TALL

    /** How many agenda rows the box can hold without crowding the meter out. */
    val agendaRows: Int get() = if (this == FULL || this == TALL) 2 else 1
}

object WidgetTiers {

    /**
     * A 4-cell-wide widget is about this many dp on a phone.
     *
     * Below it there is no room for a figure beside the ring, so the layout
     * stacks and the tier is [WidgetTier.COMPACT] whatever the height.
     */
    const val WIDE_DP = 220f

    /**
     * The ribbon floor, from §8.5: "below ~150dp tall, drop the ribbon and the
     * chips rather than clipping them."
     */
    const val RIBBON_DP = 150f

    /**
     * The chips floor. **Measured on the device**, not taken from the spec.
     *
     * A 4×2 widget is about 203dp tall on the test phone, and everything above
     * the chips comes to roughly 180dp of that — so at 4×2 the chips have
     * nowhere to go, and only a 4×3 box genuinely has room. 230dp is the first
     * size at which they fit with margin rather than exactly.
     */
    const val CHIPS_DP = 230f

    fun of(widthDp: Float, heightDp: Float): WidgetTier = when {
        widthDp < WIDE_DP -> WidgetTier.COMPACT
        heightDp < RIBBON_DP -> WidgetTier.WIDE_SHORT
        heightDp < CHIPS_DP -> WidgetTier.FULL
        else -> WidgetTier.TALL
    }
}
