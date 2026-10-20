package com.lifeos.app.domain

import com.lifeos.app.data.api.AnalyticsDto
import com.lifeos.app.data.api.ConsistencyPointDto
import com.lifeos.app.data.api.SeriesPointDto
import kotlin.math.max
import kotlin.math.min

/**
 * You's lower half, as pure data (UI_SPEC §3.3).
 *
 * Analytics is the *past tense of Today*, not a dashboard: the same four
 * quantities at a different zoom. All this file does is pick a series and work
 * out the axis, because every series arrives from the server ready to draw and
 * the client is not supposed to do arithmetic on it beyond picking colours.
 */

/** `7d · 30d · 90d · all`. The wire values are the API's, not ours to invent. */
enum class AnalyticsRange(val wire: String, val label: String) {
    D7("7d", "7d"),
    D30("30d", "30d"),
    D90("90d", "90d"),
    ALL("all", "All"),
    ;

    /**
     * Whether this range can be drawn from the dashboard snapshot alone.
     *
     * `7d` rides along on every poll as `xpSeries7`, so it renders offline and
     * costs no request. Everything else is one `GET /api/v1/analytics`, made
     * when the user asks and never polled.
     */
    val fromSnapshot: Boolean get() = this == D7

    companion object {
        fun ofWire(wire: String?): AnalyticsRange =
            entries.firstOrNull { it.wire == wire } ?: D7
    }
}

/** One day of the chart: what happened, and the line it is measured against. */
data class ChartPoint(
    val date: String,
    val value: Double,
    val target: Double,
)

/**
 * A chart, ready to draw.
 *
 * `axisMax` is never zero: a fresh instance with no XP at all would otherwise
 * divide by it, and a flat empty chart is a legitimate thing to draw.
 */
data class ChartSeries(
    val points: List<ChartPoint>,
    val axisMax: Double,
    /**
     * The target this series is measured against, or 0 when it has none.
     *
     * Carried explicitly so the caller can print the figure even on the days
     * the line is clamped to the ceiling.
     */
    val target: Double = 0.0,
    /**
     * The target is above [axisMax] — the dashed line is drawn at the ceiling
     * and the figure is above the chart.
     *
     * The caller must say so in words; a dashed line at the top edge that
     * silently means "or higher" is the dishonest version of this.
     */
    val targetOffScale: Boolean = false,
) {
    val isEmpty: Boolean get() = points.isEmpty()
}

object AnalyticsModel {

    /** Keeps an empty or all-zero series drawable. */
    private const val MIN_AXIS = 1.0

    /**
     * Breathing room above the tallest thing in the domain.
     *
     * Nothing — a peak or the target line — sits flush against the top edge,
     * where it reads as clipped rather than as reached.
     */
    private const val HEADROOM = 1.15

    /**
     * How far above the data a target may still drag the domain.
     *
     * Past this the target is off-scale. 2.0 is the point at which the data
     * still occupies half the box: a chart whose content is squeezed into the
     * bottom third has stopped being a chart.
     */
    private const val MAX_TARGET_STRETCH = 2.0

    /** `7d`, from the snapshot the whole app already has. */
    fun fromSnapshot(xpSeries7: List<SeriesPointDto>): ChartSeries = series(
        xpSeries7.map { ChartPoint(it.date, it.current, it.target) },
    )

    /** Any range, from the analytics payload. XP against its target. */
    fun xp(payload: AnalyticsDto): ChartSeries = series(
        payload.daily.map { ChartPoint(it.date, it.xp, it.xpTarget) },
    )

    /** The same window's consistency, which has no target of its own. */
    fun consistency(payload: AnalyticsDto): ChartSeries = percentSeries(
        payload.daily.map { ChartPoint(it.date, it.consistencyPct, 0.0) },
    )

    fun consistencyFromSnapshot(consistency7: List<ConsistencyPointDto>): ChartSeries =
        percentSeries(consistency7.map { ChartPoint(it.date, it.pct, 0.0) })

    /**
     * The y-domain, and the rule it follows.
     *
     * **The rule:** the data owns the domain and the target is a guest.
     *
     *   `axisMax = max(dataMax, min(target, dataMax * 2)) * 1.15`
     *
     * This replaces `axisMax = max(dataMax, target)`, which was wrong on a real
     * phone in a way no test caught: against a 200-XP daily target, a 25-XP
     * morning put the dashed target line flush along the ceiling and every real
     * value flat along the floor, leaving about two thirds of the box empty. The
     * chart was drawing the target faithfully and saying nothing about the week.
     *
     * So the domain is sized to the data, with 15% of headroom so a peak is not
     * read as clipped. The target raises the domain only as far as twice the
     * data — the point at which the data still fills half the box. A target
     * further above than that is **off-scale**: the domain stays with the data,
     * the dashed line is pinned to the ceiling, and [ChartSeries.targetOffScale]
     * is set so the caller prints the figure and says in words that it is above
     * the chart. The target is never silently dropped and never silently
     * rescaled.
     *
     * When the day *exceeds* its target the target is inside `2 * dataMax` by
     * construction, so it stays in the domain and the overshoot is drawn: a 130%
     * day is a real thing and is still not clipped, which is what the old rule
     * got right and this one keeps.
     */
    private fun series(points: List<ChartPoint>): ChartSeries {
        if (points.isEmpty()) return ChartSeries(points, MIN_AXIS)

        var dataMax = 0.0
        var target = 0.0
        for (point in points) {
            dataMax = max(dataMax, point.value)
            // One target per series in practice; the largest is the honest one
            // to draw if the server ever moves it mid-window.
            target = max(target, point.target)
        }

        val reachable = min(target, dataMax * MAX_TARGET_STRETCH)
        val top = max(max(dataMax, reachable) * HEADROOM, MIN_AXIS)
        return ChartSeries(
            points = points,
            axisMax = top,
            target = target,
            targetOffScale = target > top,
        )
    }

    /**
     * A percentage series: the domain is fixed at 0–100 whatever happened.
     *
     * Consistency is a share of a possible total, so it is comparable across
     * weeks only if the axis does not move. A quiet week must look like a quiet
     * week rather than being rescaled into looking like a full one — which is
     * what [series]' data-owns-the-domain rule would do to it, and why these are
     * two functions rather than one with a flag.
     */
    private fun percentSeries(points: List<ChartPoint>): ChartSeries =
        ChartSeries(points = points, axisMax = 100.0)

    /**
     * A signed figure in percentage **points**, not a ratio.
     *
     * `improvementPct` is a difference between two percentages, so "+4%" would
     * be wrong twice over; this renders "+4 pts".
     */
    fun points(value: Double): String {
        val rounded = Math.round(value)
        return if (rounded > 0) "+$rounded pts" else "$rounded pts"
    }

    /** A signed delta for the vs-yesterday figures. Never coloured red. */
    fun signed(value: Double?): String {
        if (value == null) return "—"
        val rounded = Math.round(value)
        return if (rounded > 0) "+$rounded" else "$rounded"
    }
}
