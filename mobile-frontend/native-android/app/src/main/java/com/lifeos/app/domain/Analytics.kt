package com.lifeos.app.domain

import com.lifeos.app.data.api.AnalyticsDto
import com.lifeos.app.data.api.ConsistencyPointDto
import com.lifeos.app.data.api.SeriesPointDto
import kotlin.math.max

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
) {
    val isEmpty: Boolean get() = points.isEmpty()
}

object AnalyticsModel {

    /** Keeps an empty or all-zero series drawable. */
    private const val MIN_AXIS = 1.0

    /** `7d`, from the snapshot the whole app already has. */
    fun fromSnapshot(xpSeries7: List<SeriesPointDto>): ChartSeries = series(
        xpSeries7.map { ChartPoint(it.date, it.current, it.target) },
    )

    /** Any range, from the analytics payload. XP against its target. */
    fun xp(payload: AnalyticsDto): ChartSeries = series(
        payload.daily.map { ChartPoint(it.date, it.xp, it.xpTarget) },
    )

    /** The same window's consistency, which has no target of its own. */
    fun consistency(payload: AnalyticsDto): ChartSeries = series(
        payload.daily.map { ChartPoint(it.date, it.consistencyPct, 0.0) },
        floor = 100.0,
    )

    fun consistencyFromSnapshot(consistency7: List<ConsistencyPointDto>): ChartSeries = series(
        consistency7.map { ChartPoint(it.date, it.pct, 0.0) },
        floor = 100.0,
    )

    /**
     * The axis is the larger of the values and their targets.
     *
     * Where there is a target, the target rides the same axis as the actual —
     * a bar drawn past the top of its own chart is the alternative, and a 140%
     * day is a real thing (`efficiencyPct` can exceed 100).
     */
    private fun series(points: List<ChartPoint>, floor: Double = MIN_AXIS): ChartSeries {
        var top = floor
        for (point in points) {
            top = max(top, max(point.value, point.target))
        }
        return ChartSeries(points = points, axisMax = max(top, MIN_AXIS))
    }

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
