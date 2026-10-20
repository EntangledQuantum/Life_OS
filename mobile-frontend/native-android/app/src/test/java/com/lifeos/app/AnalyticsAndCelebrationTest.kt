package com.lifeos.app

import com.lifeos.app.data.api.AnalyticsDailyDto
import com.lifeos.app.data.api.AnalyticsDto
import com.lifeos.app.data.api.ConsistencyPointDto
import com.lifeos.app.data.api.GoalDto
import com.lifeos.app.data.api.GoalTierDto
import com.lifeos.app.data.api.SeriesPointDto
import com.lifeos.app.domain.AnalyticsModel
import com.lifeos.app.domain.AnalyticsRange
import com.lifeos.app.domain.CelebrationIntensity
import com.lifeos.app.domain.Celebrations
import com.lifeos.app.domain.GoalOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * You's two halves: the analytics ranges and the celebration queue.
 *
 * The queue's ordering is the part worth testing — a five-rung goal owes the
 * user five animations, in order, and "the goal is not finished until it has
 * been seen" is a contract rather than a nicety.
 */
class AnalyticsAndCelebrationTest {

    /* ---------------------------------------------------------- analytics */

    @Test
    fun `the wire values are the API's and 7d is the only one off the snapshot`() {
        assertEquals(listOf("7d", "30d", "90d", "all"), AnalyticsRange.entries.map { it.wire })
        assertTrue(AnalyticsRange.D7.fromSnapshot)
        assertTrue(AnalyticsRange.entries.filter { it.fromSnapshot }.size == 1)
    }

    @Test
    fun `an unknown range falls back to 7d rather than throwing`() {
        assertEquals(AnalyticsRange.D7, AnalyticsRange.ofWire(null))
        assertEquals(AnalyticsRange.D7, AnalyticsRange.ofWire("14d"))
        assertEquals(AnalyticsRange.ALL, AnalyticsRange.ofWire("all"))
    }

    @Test
    fun `an empty window is drawable and never divides by zero`() {
        val series = AnalyticsModel.fromSnapshot(emptyList())
        assertTrue(series.isEmpty)
        assertTrue(series.axisMax >= 1.0)
    }

    @Test
    fun `an all-zero window still has a positive axis`() {
        val series = AnalyticsModel.fromSnapshot(
            listOf(
                SeriesPointDto(date = "2026-10-19", current = 0.0, target = 0.0),
                SeriesPointDto(date = "2026-10-20", current = 0.0, target = 0.0),
            ),
        )
        assertEquals(2, series.points.size)
        assertTrue(series.axisMax >= 1.0)
    }

    @Test
    fun `a target within reach of the data rides the same axis as the actual`() {
        val series = AnalyticsModel.fromSnapshot(
            listOf(
                SeriesPointDto(date = "a", current = 120.0, target = 200.0),
                SeriesPointDto(date = "b", current = 150.0, target = 200.0),
            ),
        )
        // 200 is inside 2 x 150, so it stays in the domain and the dashed line
        // is drawn where it really is, with headroom above it.
        assertFalse(series.targetOffScale)
        assertEquals(200.0, series.target, 1e-9)
        assertEquals(200.0 * 1.15, series.axisMax, 1e-9)
    }

    @Test
    fun `a target far above the data does not flatten the week onto the floor`() {
        val series = AnalyticsModel.fromSnapshot(
            listOf(SeriesPointDto(date = "d", current = 25.0, target = 200.0)),
        )
        /*
         * The bug this rule exists for. Under the old `max(value, target)` axis
         * this returned 200.0, which drew a 25-XP morning as a flat line on the
         * floor under a dashed line on the ceiling, two thirds of the box empty.
         *
         * Now the data owns the domain: 25 is capped at twice itself, plus 15%
         * headroom, so the day occupies most of the height. The target is not
         * lost — it is reported as off-scale with its figure intact, and the
         * caller prints it.
         */
        assertEquals(25.0 * 2.0 * 1.15, series.axisMax, 1e-9)
        assertTrue(series.targetOffScale)
        assertEquals(200.0, series.target, 1e-9)
        // The day reads as more than half the box, which is the whole point.
        assertTrue(25.0 / series.axisMax > 0.4)
    }

    @Test
    fun `a day past its target does not clip the actual`() {
        val series = AnalyticsModel.xp(
            AnalyticsDto(
                daily = listOf(AnalyticsDailyDto(date = "d", xp = 260.0, xpTarget = 200.0)),
            ),
        )
        // efficiencyPct can exceed 100; the figure is never clamped, so neither
        // is the axis it is drawn against. A 130% day keeps its overshoot and
        // the target stays honestly inside the chart.
        assertTrue(series.axisMax > 260.0)
        assertFalse(series.targetOffScale)
        assertTrue(260.0 / series.axisMax > 0.8)
    }

    @Test
    fun `a series with no target at all has no off-scale claim to make`() {
        val series = AnalyticsModel.fromSnapshot(
            listOf(SeriesPointDto(date = "d", current = 40.0, target = 0.0)),
        )
        assertEquals(0.0, series.target, 1e-9)
        assertFalse(series.targetOffScale)
        assertEquals(40.0 * 1.15, series.axisMax, 1e-9)
    }

    @Test
    fun `consistency is drawn against a hundred even on a quiet week`() {
        val series = AnalyticsModel.consistencyFromSnapshot(
            listOf(ConsistencyPointDto(date = "d", pct = 12.0)),
        )
        // Otherwise a 12% week would draw as a full bar.
        assertEquals(100.0, series.axisMax, 1e-9)
    }

    @Test
    fun `improvement is signed and in percentage points, not a ratio`() {
        assertEquals("+4 pts", AnalyticsModel.points(3.7))
        assertEquals("-6 pts", AnalyticsModel.points(-6.0))
        assertEquals("0 pts", AnalyticsModel.points(0.0))
    }

    @Test
    fun `a missing delta reads as a dash rather than as zero`() {
        assertEquals("—", AnalyticsModel.signed(null))
        assertEquals("+3", AnalyticsModel.signed(3.0))
        assertEquals("-3", AnalyticsModel.signed(-3.0))
    }

    /* -------------------------------------------------------- celebration */

    private fun goal(
        id: String,
        pending: Boolean = false,
        metAt: String? = null,
        tiers: List<GoalTierDto> = emptyList(),
        pendingTier: GoalTierDto? = null,
        currentTier: GoalTierDto? = null,
        nextTier: GoalTierDto? = null,
        progressPct: Double = 0.0,
        status: String = "active",
    ) = GoalDto(
        id = id,
        title = "Goal $id",
        emoji = "✦",
        progressPct = progressPct,
        status = status,
        conditionMetAt = metAt,
        celebrationPending = pending,
        tiers = tiers,
        currentTier = currentTier,
        nextTier = nextTier,
        pendingTier = pendingTier,
    )

    private fun tier(
        id: String,
        rank: Int,
        label: String = "T$rank",
        metAt: String? = null,
        progressPct: Double = 0.0,
    ) = GoalTierDto(
        id = id,
        goalId = "g",
        rank = rank,
        label = label,
        metAt = metAt,
        progressPct = progressPct,
        celebrationPending = metAt != null,
    )

    @Test
    fun `a goal with no ladder celebrates itself`() {
        val queue = Celebrations.queue(listOf(goal("g1", pending = true)))
        assertEquals(1, queue.size)
        assertEquals("g1", queue.single().goalId)
        assertNull(queue.single().tierId)
        assertEquals("g1", queue.single().key)
    }

    @Test
    fun `a goal with a pending rung celebrates the rung, not the goal`() {
        val rung = tier("t2", rank = 2, label = "Silver", metAt = "2026-10-20T10:00:00Z")
        val queue = Celebrations.queue(listOf(goal("g1", pendingTier = rung)))
        val celebration = queue.single()
        assertEquals("t2", celebration.tierId)
        assertEquals("Silver", celebration.tierLabel)
        // The key is the rung: keying on the goal would collapse a five-rung
        // ladder into one animation.
        assertEquals("t2", celebration.key)
    }

    @Test
    fun `nothing pending is nothing queued`() {
        assertTrue(Celebrations.queue(listOf(goal("g1"), goal("g2"))).isEmpty())
        assertNull(Celebrations.next(emptyList()))
    }

    @Test
    fun `the oldest debt is first and the order is stable across polls`() {
        val goals = listOf(
            goal("newer", pending = true, metAt = "2026-10-20T12:00:00Z"),
            goal("older", pending = true, metAt = "2026-10-19T08:00:00Z"),
        )
        assertEquals(listOf("older", "newer"), Celebrations.queue(goals).map { it.goalId })
        // Re-ordering the input must not re-order the queue: the dialog cannot
        // be allowed to swap under the user's thumb between two renders.
        assertEquals(
            listOf("older", "newer"),
            Celebrations.queue(goals.reversed()).map { it.goalId },
        )
    }

    @Test
    fun `goals with no met time at all still have a deterministic order`() {
        val goals = listOf(goal("b", pending = true), goal("a", pending = true))
        assertEquals(listOf("a", "b"), Celebrations.queue(goals).map { it.goalId })
    }

    @Test
    fun `one at a time`() {
        val goals = listOf(
            goal("g1", pending = true, metAt = "2026-10-19T08:00:00Z"),
            goal("g2", pending = true, metAt = "2026-10-20T08:00:00Z"),
        )
        assertEquals("g1", Celebrations.next(goals)?.goalId)
    }

    @Test
    fun `a dismissed celebration does not come back before the refetch lands`() {
        val goals = listOf(
            goal("g1", pending = true, metAt = "2026-10-19T08:00:00Z"),
            goal("g2", pending = true, metAt = "2026-10-20T08:00:00Z"),
        )
        // The celebration-seen write is queued, so the next poll still reports
        // g1 pending. Without the dismissed set the dialog would reappear the
        // instant it closed.
        val next = Celebrations.next(goals, dismissed = setOf("g1"))
        assertEquals("g2", next?.goalId)
        assertNull(Celebrations.next(goals, dismissed = setOf("g1", "g2")))
    }

    @Test
    fun `intensity parses to the three documented states and defaults to full`() {
        assertEquals(CelebrationIntensity.FULL, CelebrationIntensity.of("full"))
        assertEquals(CelebrationIntensity.MINIMAL, CelebrationIntensity.of("minimal"))
        assertEquals(CelebrationIntensity.OFF, CelebrationIntensity.of("off"))
        assertEquals(CelebrationIntensity.FULL, CelebrationIntensity.of(null))
        assertEquals(CelebrationIntensity.FULL, CelebrationIntensity.of("loud"))
    }

    /* --------------------------------------------------------------- goals */

    @Test
    fun `the goal nearest done is first and an achieved one sinks`() {
        val goals = listOf(
            goal("far", progressPct = 10.0),
            goal("done", progressPct = 100.0, status = "achieved"),
            goal("near", progressPct = 80.0),
        )
        assertEquals(
            listOf("near", "far", "done"),
            GoalOrder.forYou(goals).map { it.id },
        )
    }

    @Test
    fun `rungs are bottom first, with reached and next marked`() {
        val t1 = tier("t1", rank = 1, metAt = "2026-10-01T00:00:00Z")
        val t2 = tier("t2", rank = 2, progressPct = 40.0)
        val t3 = tier("t3", rank = 3)
        val rungs = GoalOrder.rungs(
            goal("g", tiers = listOf(t3, t1, t2), currentTier = t1, nextTier = t2),
        )

        assertEquals(listOf(1, 2, 3), rungs.map { it.rank })
        assertTrue(rungs[0].reached)
        assertTrue(!rungs[1].reached && rungs[1].isNext)
        assertTrue(!rungs[2].reached && !rungs[2].isNext)
    }

    @Test
    fun `rungs with no rank keep the array order, which is the documented ladder`() {
        val a = GoalTierDto(id = "a", label = "Bronze")
        val b = GoalTierDto(id = "b", label = "Silver")
        val rungs = GoalOrder.rungs(goal("g", tiers = listOf(a, b)))
        assertEquals(listOf("Bronze", "Silver"), rungs.map { it.label })
        assertEquals(listOf(1, 2), rungs.map { it.rank })
    }

    @Test
    fun `a goal with no ladder has no rungs`() {
        assertTrue(GoalOrder.rungs(goal("g")).isEmpty())
    }

    @Test
    fun `ordering a list of goals never loses or duplicates one`() {
        val goals = listOf(goal("a"), goal("b"), goal("c", status = "achieved"))
        val ordered = GoalOrder.forYou(goals)
        assertEquals(goals.size, ordered.size)
        assertEquals(goals.map { it.id }.toSet(), ordered.map { it.id }.toSet())
        assertSame(goals.first { it.id == "a" }, ordered.first { it.id == "a" })
    }
}
