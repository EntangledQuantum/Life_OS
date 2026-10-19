package com.lifeos.app

import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.LifeDayDto
import com.lifeos.app.data.api.TaskDto
import com.lifeos.app.data.api.TimelineBlockDto
import com.lifeos.app.domain.DayBucketKind
import com.lifeos.app.domain.DayBuckets
import com.lifeos.app.domain.PlannedDay
import com.lifeos.app.domain.Predicates
import com.lifeos.app.domain.Ribbon
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalTime

/**
 * Day's grouping rules and the ribbon's geometry.
 *
 * These are the two things on Day that can be wrong in a way a screenshot does
 * not show: a task in the wrong bucket looks exactly like a task in the right
 * one, and a count that disagrees with its list is the bug this repository has
 * already shipped once.
 */
class DayModelTest {

    private fun task(
        id: String,
        title: String = id,
        kind: String = "task",
        eventAt: String? = null,
        remindAt: String? = null,
        showAt: String? = null,
        slot: Int? = null,
        status: String = "active",
    ) = TaskDto(
        id = id,
        title = title,
        kind = kind,
        eventAt = eventAt,
        remindAt = remindAt,
        showAt = showAt,
        slot = slot,
        status = status,
    )

    /** 2026-10-20, reset 04:00, UTC throughout so the arithmetic is readable. */
    private val reset = "04:00"
    private val zone = "UTC"
    private val today = "2026-10-20"

    /* ---------------------------------------------------------- bucketing */

    @Test
    fun `a task today, tomorrow and later lands in its own bucket`() {
        val buckets = DayBuckets.of(
            tasks = listOf(
                task("a", eventAt = "2026-10-20T19:00:00Z"),
                task("b", eventAt = "2026-10-21T07:00:00Z"),
                task("c", eventAt = "2026-10-23T07:00:00Z"),
            ),
            todayLifeDay = today,
            dayResetTime = reset,
            timezone = zone,
        )

        assertEquals(
            listOf(DayBucketKind.TODAY, DayBucketKind.TOMORROW, DayBucketKind.LATER),
            buckets.map { it.kind },
        )
        assertEquals(listOf("Today", "Tomorrow", "Friday"), buckets.map { it.label })
    }

    @Test
    fun `01-30 belongs to the life-day you are still awake through, not to tomorrow`() {
        // 01:30 on the 21st is before the 04:00 reset, so its life-day is the
        // 20th — "Today" while you are still up, which is the whole point of
        // the life-day not being the calendar day.
        val buckets = DayBuckets.of(
            tasks = listOf(task("late", eventAt = "2026-10-21T01:30:00Z")),
            todayLifeDay = today,
            dayResetTime = reset,
            timezone = zone,
        )

        assertEquals(DayBucketKind.TODAY, buckets.single().kind)
    }

    @Test
    fun `a task with no instant gets the No time bucket and is never dropped`() {
        val buckets = DayBuckets.of(
            tasks = listOf(
                task("timed", eventAt = "2026-10-20T19:00:00Z"),
                task("loose"),
            ),
            todayLifeDay = today,
            dayResetTime = reset,
            timezone = zone,
        )

        val untimed = buckets.last()
        assertEquals(DayBucketKind.NO_TIME, untimed.kind)
        assertEquals("No time", untimed.label)
        assertNull(untimed.date)
        assertEquals(listOf("loose"), untimed.tasks.map { it.id })
        // Nothing vanished between the input and the buckets.
        assertEquals(2, buckets.sumOf { it.tasks.size })
    }

    @Test
    fun `No time is always last, whatever order it arrived in`() {
        val buckets = DayBuckets.of(
            tasks = listOf(task("loose"), task("timed", eventAt = "2026-10-20T19:00:00Z")),
            todayLifeDay = today,
            dayResetTime = reset,
            timezone = zone,
        )
        assertEquals(DayBucketKind.NO_TIME, buckets.last().kind)
    }

    @Test
    fun `the bucket instant falls back eventAt then remindAt then showAt`() {
        assertEquals("E", Predicates.bucketInstant(task("a", eventAt = "E", remindAt = "R", showAt = "S")))
        assertEquals("R", Predicates.bucketInstant(task("b", remindAt = "R", showAt = "S")))
        assertEquals("S", Predicates.bucketInstant(task("c", showAt = "S")))
        assertNull(Predicates.bucketInstant(task("d")))
    }

    @Test
    fun `a date already past is drawn first rather than dropped`() {
        val buckets = DayBuckets.of(
            tasks = listOf(
                task("yesterday", eventAt = "2026-10-19T09:00:00Z"),
                task("today", eventAt = "2026-10-20T09:00:00Z"),
            ),
            todayLifeDay = today,
            dayResetTime = reset,
            timezone = zone,
        )
        assertEquals(DayBucketKind.EARLIER, buckets.first().kind)
        assertEquals(2, buckets.sumOf { it.tasks.size })
    }

    @Test
    fun `rows inside a bucket are in time order`() {
        val buckets = DayBuckets.of(
            tasks = listOf(
                task("late", eventAt = "2026-10-20T21:30:00Z"),
                task("early", eventAt = "2026-10-20T07:30:00Z"),
            ),
            todayLifeDay = today,
            dayResetTime = reset,
            timezone = zone,
        )
        assertEquals(listOf("early", "late"), buckets.single().tasks.map { it.id })
    }

    @Test
    fun `beyond a week the weekday is spelled with its date`() {
        val buckets = DayBuckets.of(
            tasks = listOf(task("far", eventAt = "2026-11-07T09:00:00Z")),
            todayLifeDay = today,
            dayResetTime = reset,
            timezone = zone,
        )
        // "Saturday" alone stops meaning anything once there are two of them.
        assertTrue(buckets.single().label.contains("Nov"))
    }

    /* ------------------------------------------- the count/list agreement */

    @Test
    fun `Needs you and Scheduled are disjoint and together cover every visible task`() {
        val data = DashboardTodayDto(
            date = today,
            lifeDay = LifeDayDto(lifeDay = today, dayResetTime = reset, timezone = zone),
            tasks = listOf(
                task("review-timed", kind = "review", eventAt = "2026-10-20T19:00:00Z"),
                task("review-untimed", kind = "review"),
                task("plain-untimed"),
                task("plain-timed", eventAt = "2026-10-20T20:00:00Z"),
                task("pinned", slot = 0),
                task("done", status = "done", eventAt = "2026-10-20T08:00:00Z"),
            ),
        )

        val partition = Predicates.dayPartition(data)
        val needsIds = partition.needsYou.map { it.id }.toSet()
        val scheduledIds = partition.scheduled.map { it.id }.toSet()

        // Disjoint: nothing is in both lists.
        assertTrue((needsIds intersect scheduledIds).isEmpty())
        // Complete: together they are exactly what `scheduled` can show.
        assertEquals(
            Predicates.scheduled(data).map { it.id }.toSet(),
            needsIds + scheduledIds,
        )
        // The pinned card is Today's presentation, so Day shows it in neither.
        assertTrue("pinned" !in needsIds && "pinned" !in scheduledIds)
        // A done task is not visible on Day at all.
        assertTrue("done" !in needsIds && "done" !in scheduledIds)
    }

    @Test
    fun `Today's count is the length of the list Day renders`() {
        val data = DashboardTodayDto(
            date = today,
            lifeDay = LifeDayDto(lifeDay = today, dayResetTime = reset, timezone = zone),
            tasks = listOf(
                task("review", kind = "review", eventAt = "2026-10-20T19:00:00Z"),
                task("untimed"),
                task("timed", eventAt = "2026-10-20T20:00:00Z"),
            ),
        )

        // This is the whole rule: the link's figure and the block's rows are the
        // same function, so the link can never point at a page rendering nothing.
        assertEquals(
            Predicates.needsYouCount(data),
            Predicates.dayPartition(data).needsYou.size,
        )
    }

    @Test
    fun `the buckets Day draws never include a task Needs you has claimed`() {
        val data = DashboardTodayDto(
            date = today,
            lifeDay = LifeDayDto(lifeDay = today, dayResetTime = reset, timezone = zone),
            tasks = listOf(
                task("review", kind = "review", eventAt = "2026-10-20T19:00:00Z"),
                task("timed", eventAt = "2026-10-20T20:00:00Z"),
            ),
        )

        val drawn = DayBuckets.of(data).flatMap { it.tasks }.map { it.id }
        assertEquals(listOf("timed"), drawn)
    }

    /* ------------------------------------------------------------- ribbon */

    @Test
    fun `segments are fractions of the day, not pixels`() {
        val segments = Ribbon.segments(
            listOf(
                block("a", 0.0, 6.0),
                block("b", 6.0, 12.0),
                block("c", 12.0, 24.0),
            ),
        )
        assertEquals(3, segments.size)
        assertEquals(0f, segments[0].left, 1e-5f)
        assertEquals(0.25f, segments[0].width, 1e-5f)
        assertEquals(0.25f, segments[1].left, 1e-5f)
        assertEquals(0.5f, segments[2].left, 1e-5f)
        // Gap-free: each starts where the last ended.
        assertEquals(1f, segments.last().left + segments.last().width, 1e-5f)
    }

    @Test
    fun `a zero-width or inverted block is dropped rather than drawn backwards`() {
        val segments = Ribbon.segments(
            listOf(block("empty", 9.0, 9.0), block("inverted", 12.0, 10.0)),
        )
        assertTrue(segments.isEmpty())
    }

    @Test
    fun `hours outside the day are clamped into it`() {
        val segments = Ribbon.segments(listOf(block("over", -2.0, 30.0)))
        assertEquals(0f, segments.single().left, 1e-5f)
        assertEquals(1f, segments.single().width, 1e-5f)
    }

    @Test
    fun `the now marker is the fraction of the day elapsed`() {
        assertEquals(0f, Ribbon.nowFraction(LocalTime.of(0, 0)), 1e-5f)
        assertEquals(0.5f, Ribbon.nowFraction(LocalTime.of(12, 0)), 1e-5f)
        assertEquals(0.75f, Ribbon.nowFraction(LocalTime.of(18, 0)), 1e-5f)
        // 09:30 → (9 + 0.5) / 24
        assertEquals(0.39583f, Ribbon.nowFraction(LocalTime.of(9, 30)), 1e-4f)
    }

    @Test
    fun `the legend names each category once, in the order it first appears`() {
        val legend = Ribbon.legend(
            listOf(
                block("a", 0.0, 6.0, category = "Sleep", colour = "#5C6BC0"),
                block("b", 6.0, 9.0, category = "Deep Work", colour = "#6EA8FF"),
                block("c", 9.0, 12.0, category = "Sleep", colour = "#5C6BC0"),
            ),
        )
        assertEquals(listOf("Sleep", "Deep Work"), legend.map { it.category })
        assertEquals("#5C6BC0", legend.first().colorHex)
    }

    @Test
    fun `lived and planned keep their own treatment flags`() {
        val segments = Ribbon.segments(
            listOf(
                block("lived", 0.0, 9.0, actual = true, status = "done"),
                block("planned", 9.0, 24.0, actual = false),
            ),
        )
        assertTrue(segments[0].actual && segments[0].done)
        assertTrue(!segments[1].actual && !segments[1].done)
    }

    @Test
    fun `an empty day still has a shape from the planned sleep and wake`() {
        val shape = PlannedDay.shape(plannedWake = "07:00", plannedSleepStart = "23:00")
        assertEquals(3, shape.size)
        val segments = Ribbon.segments(shape)
        // Continuous and gap-free, midnight to midnight.
        assertEquals(0f, segments.first().left, 1e-5f)
        assertEquals(1f, segments.last().left + segments.last().width, 1e-5f)
        assertNotNull(segments.firstOrNull { it.category == "Sleep" })
    }

    @Test
    fun `a nonsense sleep window produces no shape rather than a backwards one`() {
        assertTrue(PlannedDay.shape("23:00", "07:00").isEmpty())
        assertTrue(PlannedDay.shape("not a time", "23:00").isEmpty())
    }

    private fun block(
        id: String,
        start: Double,
        end: Double,
        category: String = "Deep Work",
        colour: String = "#6EA8FF",
        status: String = "planned",
        actual: Boolean = false,
    ) = TimelineBlockDto(
        id = id,
        category = category,
        label = id,
        startHour = start,
        endHour = end,
        color = colour,
        status = status,
        actual = actual,
    )
}
