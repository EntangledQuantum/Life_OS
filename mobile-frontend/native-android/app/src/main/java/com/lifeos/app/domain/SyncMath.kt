package com.lifeos.app.domain

import com.lifeos.app.data.api.LifeDayDto
import com.lifeos.app.data.api.LoggedIntervalDto
import com.lifeos.app.data.api.RibbonSegmentDto
import com.lifeos.app.data.api.TaskDto
import com.lifeos.app.data.api.TimelineBlockDto
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.Locale

/**
 * The five values protocol 4 stopped sending, computed here instead.
 *
 * A port of the clock-dependent helpers in `packages/shared/src/sync.ts`
 * (`isCurrentAt`, `isReminderDueAt`, `dayFractionAt`, `composeTimeline`,
 * `activityColor`) and `xp.ts` (`paceAdjustedImprovementPct`). **Copied, not
 * imported** — this folder is a standalone Gradle build — so it is a copy that
 * something has to keep honest, which is what `SyncMathTest` is for: it runs the
 * same cases the TypeScript's own tests run, plus the edges the TypeScript gets
 * from JavaScript's semantics rather than from its source.
 *
 * ### Why any of this is on the device
 *
 * `GET /api/v1/dashboard/today` baked a clock reading into every response:
 * which task was `current`, which reminders were `due`, where the now-marker
 * cut the timeline, and `improvementPct`. A payload that embeds "now" is stale
 * the instant it is written, which is why that route had to resend 2.26 MB to
 * move a marker four pixels and why no `ETag` could ever have matched. The
 * server now sends *instants*; the comparison happens against the only clock
 * that matters, which is the one next to the screen (SYNC.md §2, rule 1).
 *
 * It is also simply better: the marker advances smoothly between polls instead
 * of jumping on each one, and a reminder fires when it is due rather than up to
 * eight seconds late.
 *
 * ### Fidelity to the TypeScript, deliberately
 *
 * The TS gets several behaviours from JavaScript rather than from anything
 * written down, and a Kotlin port that "improves" on them makes the phone and
 * the dashboard disagree. All three are reproduced on purpose:
 *
 *  - **`Date.parse` returns `NaN` on a string it cannot read, and every
 *    comparison against `NaN` is false.** So an unparseable `currentUntil` does
 *    *not* close the window, and an unparseable `currentFrom` does not open it.
 *    [instantMs] returns null and each comparison is guarded, which is the same
 *    outcome rather than a thrown exception.
 *  - **`if (task.showAt)` and `if (task.notifiedAt)` are truthiness tests**, so
 *    an empty string behaves as absent. `isNullOrEmpty` here, not `!= null`.
 *  - **`getHours()` reads the device's zone, and seconds are discarded.** The
 *    ribbon's axis is the wall clock, so [clockHour] is `hour + minute / 60` in
 *    [zone] and nothing finer.
 *
 * `Math.round` is JavaScript's, which is `floor(x + 0.5)` — half goes *up*,
 * toward positive infinity. `java.lang.Math.round(Double)` is the same
 * function; `kotlin.math.round` is **not** (it rounds half away from zero, so
 * `-2.5` would go to `-3` where JS gives `-2`). The `java.lang` one is used
 * below for exactly that reason.
 */
object SyncMath {

    /**
     * The zone the wall clock is read in. The device's, always.
     *
     * A parameter rather than a call to `ZoneId.systemDefault()` inside each
     * function, so a test can pin a zone and so the ribbon cannot quietly start
     * reading UTC on a phone that is not in it.
     */
    val deviceZone: ZoneId get() = ZoneId.systemDefault()

    /* ------------------------------------------------------------- parsing */

    /**
     * `Date.parse`, as far as this protocol needs it — epoch millis, or null.
     *
     * Null is this port's `NaN`: every caller guards the comparison rather than
     * treating a bad instant as zero, because epoch zero is 1970 and would make
     * every window look long since open.
     *
     * Three forms are accepted, in the order JavaScript accepts them. The server
     * only ever writes the first (`toISOString()`, always `Z`), but a cached row
     * written by an older build, or a hand-edited database, should not take a
     * screen down:
     *
     *  1. an instant with `Z` or a numeric offset — absolute, zone-independent;
     *  2. a date-time with no offset — which ES2015+ reads as **local** time, so
     *     it is read in [zone] here and not in UTC;
     *  3. anything else — null.
     */
    fun instantMs(text: String?, zone: ZoneId = deviceZone): Long? {
        val raw = text?.trim()
        if (raw.isNullOrEmpty()) return null
        runCatching { return Instant.parse(raw).toEpochMilli() }
        runCatching { return OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        runCatching {
            return LocalDateTime.parse(raw).atZone(zone).toInstant().toEpochMilli()
        }
        return null
    }

    /**
     * Clock hour 0–24 — the axis the ribbon is drawn against.
     *
     * `d.getHours() + d.getMinutes() / 60` in the TS. Seconds are deliberately
     * discarded: a segment boundary that moved every second would redraw the
     * ribbon on every frame for no visible gain, and the TS does not do it.
     */
    fun clockHour(epochMs: Long, zone: ZoneId = deviceZone): Double {
        val t = Instant.ofEpochMilli(epochMs).atZone(zone)
        return t.hour + t.minute / 60.0
    }

    /* -------------------------------------------------------------- `current` */

    /**
     * Is this task current — on the front page — at [nowMs]?
     *
     * The whole of what the old `current` array was. Reads no network, allocates
     * nothing, and is safe to call on every tick.
     */
    fun isCurrentAt(task: TaskDto, nowMs: Long, zone: ZoneId = deviceZone): Boolean {
        if (task.status != "active") return false
        val from = task.currentFrom ?: return false
        // `currentFrom === null` is the only null check the TS makes before
        // parsing; an unparseable value falls through to the NaN rule below.
        val fromMs = instantMs(from, zone)
        if (fromMs != null && fromMs > nowMs) return false

        val untilMs = task.currentUntil?.let { instantMs(it, zone) }
        if (task.currentUntil != null && untilMs != null && untilMs < nowMs) return false

        // Truthiness: an empty `showAt` is absent, not "epoch".
        if (!task.showAt.isNullOrEmpty()) {
            val showMs = instantMs(task.showAt, zone)
            if (showMs != null && showMs > nowMs) return false
        }
        return true
    }

    /** Every task that is current at [nowMs], in the order it was given. */
    fun currentAt(tasks: List<TaskDto>, nowMs: Long, zone: ZoneId = deviceZone): List<TaskDto> =
        tasks.filter { isCurrentAt(it, nowMs, zone) }

    /* --------------------------------------------------------- `dueReminders` */

    /**
     * Should this task's notification fire at [nowMs], and has it not already?
     *
     * `notifiedAt` is still the *server's* record that it fired — the client
     * posts `task.notified` and the flag comes back in the next delta — so a
     * reminder still fires exactly once across every device. That contract did
     * not change with protocol 4; only the clock comparison moved.
     */
    fun isReminderDueAt(task: TaskDto, nowMs: Long, zone: ZoneId = deviceZone): Boolean {
        // Truthiness again: `notifiedAt: ""` means not yet notified.
        if (!task.notifiedAt.isNullOrEmpty()) return false
        if (task.status == "done" || task.status == "dismissed") return false
        val from = task.dueFrom ?: return false
        val fromMs = instantMs(from, zone)
        if (fromMs != null && fromMs > nowMs) return false

        val untilMs = task.dueUntil?.let { instantMs(it, zone) }
        if (task.dueUntil != null && untilMs != null && untilMs < nowMs) return false
        return true
    }

    fun dueRemindersAt(tasks: List<TaskDto>, nowMs: Long, zone: ZoneId = deviceZone): List<TaskDto> =
        tasks.filter { isReminderDueAt(it, nowMs, zone) }

    /* ------------------------------------------------------------ day fraction */

    /**
     * Where [nowMs] falls in the life-day, 0–1. The pace the day is judged at.
     *
     * Returns 1 when the edges are missing or inverted — `!(end > start)` in the
     * TS, which is also true when either parse gave `NaN`. One, not zero: a day
     * whose shape is unknown is treated as finished, so the improvement figure
     * falls back to the honest full-day delta instead of reporting a flat 0 that
     * looks like real news.
     */
    fun dayFractionAt(day: LifeDayDto, nowMs: Long, zone: ZoneId = deviceZone): Double {
        val start = instantMs(day.lifeDayStart, zone) ?: return 1.0
        val end = instantMs(day.lifeDayEnd, zone) ?: return 1.0
        if (end <= start) return 1.0
        val f = (nowMs - start).toDouble() / (end - start).toDouble()
        return f.coerceIn(0.0, 1.0)
    }

    /* ------------------------------------------------------ improvement */

    /**
     * Today against where yesterday had got to *by this hour*.
     *
     * The raw delta compared a day in progress with a day that finished, so at
     * breakfast it reported roughly -100% every morning — an artefact of the
     * clock dressed up as a verdict, and a breach of the one rule the whole app
     * is built on: never tell someone they are failing at something they have
     * not had the chance to do yet.
     *
     * The first tenth of the day reports flat rather than scaled, because a
     * fraction that small makes the comparison noise.
     */
    fun paceAdjustedImprovementPct(
        todayEfficiency: Double,
        yesterdayEfficiency: Double,
        dayFraction: Double,
    ): Double {
        val f = dayFraction.coerceIn(0.0, 1.0)
        if (f < 0.1) return 0.0
        val yesterdaySoFar = yesterdayEfficiency * f
        return round1(todayEfficiency - yesterdaySoFar)
    }

    /** The raw difference in efficiency, in points. `improvementPct` in xp.ts. */
    fun improvementPct(todayEfficiency: Double, yesterdayEfficiency: Double): Double =
        round1(todayEfficiency - yesterdayEfficiency)

    /**
     * One decimal place, rounded the way JavaScript rounds.
     *
     * `Math.round(x * 10) / 10`. `java.lang.Math.round` is `floor(x + 0.5)`,
     * which is JS's rule — half upward, toward positive infinity. Using
     * `kotlin.math.round` here would round half *away from zero* and disagree
     * with the dashboard on every negative half-point.
     */
    private fun round1(value: Double): Double {
        if (value.isNaN() || value.isInfinite()) return value
        return Math.round(value * 10).toDouble() / 10.0
    }

    /* ---------------------------------------------------------- the ribbon */

    /**
     * The colour of each day bucket on the ribbon.
     *
     * Part of the contract rather than this client's own palette: the planned
     * half arrives already coloured by the server and the lived half is coloured
     * here, so two tables would make the same hour change colour as it crossed
     * the now-marker. `ACTIVITY_COLORS` in sync.ts, verbatim.
     */
    val ACTIVITY_COLORS: Map<String, String> = mapOf(
        "Sleep" to "#6366F1",
        "Life" to "#5B8CFF",
        "Life Admin" to "#5B8CFF",
        "Deep Work" to "#A78BFA",
        "Study" to "#C084FC",
        "Health" to "#34D399",
        "Break" to "#94A3B8",
        "Startup" to "#FBBF24",
        "Exercise" to "#34D399",
        "Exploration" to "#F472B6",
    )

    const val DEFAULT_ACTIVITY_COLOR = "#5B8CFF"

    fun activityColor(activity: String): String =
        ACTIVITY_COLORS[activity] ?: DEFAULT_ACTIVITY_COLOR

    /** The unlogged segment's fill. `rgba(255,255,255,0.05)` in the TS. */
    const val UNLOGGED_COLOR = "rgba(255,255,255,0.05)"

    private const val EPS = 1e-6

    /**
     * The ribbon, cut at [nowMs]: what was lived behind the marker, the plan
     * ahead of it.
     *
     * This used to be computed on the server and shipped pre-cut, which is the
     * single reason a poll had to resend the day to move a marker. It needs one
     * thing the server does not have — the clock by the screen — so it lives
     * here and both clients run the same forty lines.
     *
     * **An hour with no record stays an explicit `unlogged` segment** rather
     * than being papered over with the plan. An hour you did not log is
     * information, not a Deep Work block you get to take credit for.
     */
    fun composeTimeline(
        ribbon: List<RibbonSegmentDto>,
        lived: List<LoggedIntervalDto>,
        nowMs: Long,
        colorOf: (String) -> String = ::activityColor,
        zone: ZoneId = deviceZone,
    ): List<TimelineBlockDto> {
        val nowHour = clockHour(nowMs, zone)
        val out = mutableListOf<TimelineBlockDto>()
        var cursor = 0.0

        // Lexicographic on the ISO string, as the TS does with `localeCompare`.
        // These are ASCII instants, so ordering by text is ordering by time.
        val ordered = lived.sortedBy { it.startedAt }
        for (entry in ordered) {
            val startMs = instantMs(entry.startedAt, zone) ?: continue
            val from = clockHour(startMs, zone).coerceIn(0.0, 24.0)
            // An open interval (`endedAt: null`) is drawn up to the marker, so
            // it grows smoothly between polls instead of on each one.
            val endHour = entry.endedAt
                ?.let { instantMs(it, zone) }
                ?.let { clockHour(it, zone) }
                ?: nowHour
            val to = maxOf(from, minOf(nowHour, endHour))
            if (to <= from + EPS) continue
            if (from > cursor + EPS) out += unlogged(cursor, from)
            out += TimelineBlockDto(
                id = "did-${entry.id}",
                category = entry.activity,
                label = entry.activity,
                startHour = from,
                endHour = to,
                color = colorOf(entry.activity),
                status = "done",
                actual = true,
            )
            cursor = to
        }
        if (nowHour > cursor + EPS) out += unlogged(cursor, nowHour)

        for (seg in ribbon) {
            val startHour = maxOf(seg.startHour, nowHour)
            if (seg.endHour <= startHour + EPS) continue
            out += TimelineBlockDto(
                id = seg.id,
                category = seg.category,
                label = seg.label,
                startHour = startHour,
                endHour = seg.endHour,
                color = seg.color,
                status = seg.status,
                actual = false,
            )
        }
        return out
    }

    private fun unlogged(from: Double, to: Double) = TimelineBlockDto(
        // `unlogged-${from.toFixed(3)}`. Locale.ROOT so a device set to a comma
        // decimal separator produces the same id as the dashboard does.
        id = "unlogged-" + String.format(Locale.ROOT, "%.3f", from),
        category = "Unlogged",
        label = "Not recorded",
        startHour = from,
        endHour = to,
        color = UNLOGGED_COLOR,
        status = "unlogged",
        actual = true,
    )
}
