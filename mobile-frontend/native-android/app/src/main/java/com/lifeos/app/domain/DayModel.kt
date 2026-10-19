package com.lifeos.app.domain

import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.TaskDto
import com.lifeos.app.data.api.TimelineBlockDto
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Day's shape, as pure data (UI_SPEC §3.2).
 *
 * Both halves of this file are here rather than in the screen for the same
 * reason: they are rules, and a rule written in a composable is a rule that
 * cannot be tested and gets written a second time the next time someone needs
 * it. The ribbon's geometry and the four day buckets are both decided once.
 */

/* ----------------------------------------------------------------- buckets */

/** Which heading a task sits under. The order of the enum is the screen order. */
enum class DayBucketKind {
    /** A date already past. Rolled-over leftovers; never dropped, drawn first. */
    EARLIER,
    TODAY,
    TOMORROW,

    /** Any later date, labelled by its weekday. */
    LATER,

    /** No `eventAt`, no `remindAt`, no `showAt`. Its own bucket, always last. */
    NO_TIME,
}

data class DayBucket(
    val kind: DayBucketKind,
    /** `Today`, `Tomorrow`, `Friday`, `Fri 7 Nov`, `No time`. */
    val label: String,
    /** The life-day this bucket covers, or null for [DayBucketKind.NO_TIME]. */
    val date: String?,
    val tasks: List<TaskDto>,
)

object DayBuckets {

    private val WEEKDAY = DateTimeFormatter.ofPattern("EEEE")
    private val DATED = DateTimeFormatter.ofPattern("EEE d MMM")

    /**
     * Bucket Day's scheduled tasks by the **life-day** of
     * `eventAt ?? remindAt ?? showAt`.
     *
     * The life-day, not the calendar day: a task at 01:30 belongs to the day you
     * have been awake through, so while it is still Tuesday-night-at-one it
     * reads "Today" rather than "Tomorrow". That is the same `dayResetTime` rule
     * the write queue's guard uses, so the two cannot disagree about which day
     * something is on.
     *
     * A task with none of the three instants is never dropped — it gets
     * [DayBucketKind.NO_TIME].
     *
     * Takes the already-partitioned list ([Predicates.dayPartition]) rather than
     * the whole payload, so this function cannot reintroduce a task that Needs
     * you has already claimed.
     */
    fun of(
        tasks: List<TaskDto>,
        todayLifeDay: String,
        dayResetTime: String?,
        timezone: String?,
    ): List<DayBucket> {
        val today = runCatching { LocalDate.parse(todayLifeDay) }.getOrNull()

        val grouped = LinkedHashMap<String?, MutableList<TaskDto>>()
        for (task in tasks) {
            val instant = Predicates.bucketInstant(task)
                ?.let { runCatching { Instant.parse(it) }.getOrNull() }
            val key = instant?.let { LifeDays.of(it, dayResetTime, timezone).date }
            grouped.getOrPut(key) { mutableListOf() } += task
        }

        // Timed buckets in date order; untimed last whatever order it arrived in.
        val dated = grouped.entries
            .filter { it.key != null }
            .sortedBy { it.key }
            .map { (date, rows) ->
                val day = runCatching { LocalDate.parse(date) }.getOrNull()
                val offset = if (today != null && day != null) {
                    day.toEpochDay() - today.toEpochDay()
                } else {
                    0L
                }
                DayBucket(
                    kind = when {
                        offset < 0L -> DayBucketKind.EARLIER
                        offset == 0L -> DayBucketKind.TODAY
                        offset == 1L -> DayBucketKind.TOMORROW
                        else -> DayBucketKind.LATER
                    },
                    label = label(day, offset, date!!),
                    date = date,
                    tasks = rows.sortedWith(byTime),
                )
            }

        val untimed = grouped[null]?.let {
            listOf(
                DayBucket(
                    kind = DayBucketKind.NO_TIME,
                    label = "No time",
                    date = null,
                    tasks = it.toList(),
                ),
            )
        } ?: emptyList()

        return dated + untimed
    }

    /** The whole list, bucketed, from a snapshot. One call site per screen. */
    fun of(data: DashboardTodayDto): List<DayBucket> = of(
        tasks = Predicates.dayPartition(data).scheduled,
        todayLifeDay = data.lifeDay.lifeDay.ifBlank { data.date },
        dayResetTime = data.lifeDay.dayResetTime,
        timezone = data.lifeDay.timezone,
    )

    private val byTime = Comparator<TaskDto> { a, b ->
        val at = Predicates.bucketInstant(a)
        val bt = Predicates.bucketInstant(b)
        when {
            at != null && bt != null -> at.compareTo(bt)
            at != null -> -1
            bt != null -> 1
            else -> a.title.compareTo(b.title)
        }
    }

    /**
     * `Today` · `Tomorrow` · a weekday inside the coming week · a dated weekday
     * beyond it.
     *
     * "Friday" stops meaning anything once there are two of them, so past a week
     * out the date is spelled.
     */
    private fun label(day: LocalDate?, offset: Long, raw: String): String = when {
        day == null -> raw
        offset == 0L -> "Today"
        offset == 1L -> "Tomorrow"
        offset in 2L..6L -> day.format(WEEKDAY)
        else -> day.format(DATED)
    }
}

/* ------------------------------------------------------------------ ribbon */

/**
 * One segment of the ribbon, as a fraction of the 24-hour day.
 *
 * `left` and `width` are 0–1 so the view multiplies by its own measured width —
 * never a computed pixel width, which is the rule the widget also lives by.
 */
data class RibbonSegment(
    val id: String,
    val label: String,
    val category: String,
    val colorHex: String,
    val left: Float,
    val width: Float,
    /** Behind the now-marker: what was lived. Solid. */
    val actual: Boolean,
    /** `status: "done"` draws at 55%. */
    val done: Boolean,
)

data class LegendEntry(val category: String, val colorHex: String)

/**
 * The ribbon, **rendered exactly as the server computed it** (§3.2).
 *
 * The server has already closed the gaps, resolved the overlaps and assigned
 * the colours, and split the day at the now-marker into lived (`actual: true`)
 * and planned (`actual: false`). Recomputing any of that from the blocks is how
 * the phone and the web client start disagreeing about what the day looked like,
 * so this function only converts hours to fractions.
 */
object Ribbon {

    /** Sparse ticks. Four labels across a phone is readable; twenty-four is not. */
    val HOUR_TICKS: List<Int> = listOf(0, 6, 12, 18, 24)

    fun segments(blocks: List<TimelineBlockDto>): List<RibbonSegment> =
        blocks.mapNotNull { block ->
            val start = block.startHour.coerceIn(0.0, 24.0)
            val end = block.endHour.coerceIn(0.0, 24.0)
            if (end <= start) return@mapNotNull null
            RibbonSegment(
                id = block.id,
                label = block.label,
                category = block.category,
                colorHex = block.color,
                left = (start / 24.0).toFloat(),
                width = ((end - start) / 24.0).toFloat(),
                actual = block.actual,
                done = block.status == "done",
            )
        }

    /** `(hour + min/60) / 24`. */
    fun nowFraction(time: LocalTime): Float =
        ((time.hour + time.minute / 60.0) / 24.0).toFloat().coerceIn(0f, 1f)

    fun nowFraction(instant: Instant, timezone: String?): Float =
        nowFraction(instant.atZone(LifeDays.resolveZone(timezone)).toLocalTime())

    /**
     * The legend: every category on the ribbon, once, in the order it first
     * appears across the day.
     *
     * The seven activity colours are a closed set and mean the same thing in
     * every theme, which is exactly why a legend is honest here — the ribbon is
     * the one surface where several of them sit side by side with no labels.
     */
    fun legend(blocks: List<TimelineBlockDto>): List<LegendEntry> {
        val seen = LinkedHashMap<String, String>()
        for (segment in segments(blocks)) {
            if (segment.category.isBlank()) continue
            seen.putIfAbsent(segment.category, segment.colorHex)
        }
        return seen.map { (category, colour) -> LegendEntry(category, colour) }
    }
}

/**
 * The shape of an empty day, from the planned sleep/wake times.
 *
 * §3.2's empty state: "the ribbon still draws (sleep/wake from settings give it
 * shape)". Without this an instance with nothing scheduled gets a flat bar,
 * which says less than nothing — the day has a shape before anything is on it.
 */
object PlannedDay {

    fun shape(plannedWake: String, plannedSleepStart: String): List<TimelineBlockDto> {
        val wake = parse(plannedWake) ?: return emptyList()
        val sleep = parse(plannedSleepStart) ?: return emptyList()
        if (sleep <= wake) return emptyList()
        return listOf(
            TimelineBlockDto(
                id = "planned-sleep-early",
                category = "Sleep",
                label = "Asleep",
                startHour = 0.0,
                endHour = wake,
                color = "#5C6BC0",
                status = "planned",
                actual = false,
            ),
            TimelineBlockDto(
                id = "planned-awake",
                category = "Life Admin",
                label = "Awake",
                startHour = wake,
                endHour = sleep,
                color = "#FBBF24",
                status = "planned",
                actual = false,
            ),
            TimelineBlockDto(
                id = "planned-sleep-late",
                category = "Sleep",
                label = "Asleep",
                startHour = sleep,
                endHour = 24.0,
                color = "#5C6BC0",
                status = "planned",
                actual = false,
            ),
        )
    }

    private fun parse(value: String): Double? {
        val time = runCatching { LocalTime.parse(value) }.getOrNull() ?: return null
        return time.hour + time.minute / 60.0
    }
}

/** The system zone, so a screen does not reach for [ZoneId] itself. */
internal fun zoneOf(timezone: String?): ZoneId = LifeDays.resolveZone(timezone)
