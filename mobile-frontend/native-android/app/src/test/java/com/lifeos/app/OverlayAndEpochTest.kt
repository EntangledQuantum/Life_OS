package com.lifeos.app

import com.lifeos.app.data.api.AgendaItemDto
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.HabitWithTodayDto
import com.lifeos.app.data.api.TaskDto
import com.lifeos.app.data.api.UserProgressDto
import com.lifeos.app.domain.AgendaEpoch
import com.lifeos.app.domain.Overlay
import com.lifeos.app.domain.PendingWrite
import com.lifeos.app.domain.Predicates
import com.lifeos.app.domain.StrandReason
import com.lifeos.app.domain.WriteKind
import com.lifeos.app.domain.WriteState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The optimistic overlay, the ordering epoch, and the one-predicate rule.
 *
 * The epoch tests are the mechanical statement of "a row does not move when it
 * is ticked", which is the most important interaction rule on the main screen.
 */
class OverlayAndEpochTest {

    private fun item(
        id: String,
        at: String? = null,
        done: Boolean = false,
        title: String = id,
    ) = AgendaItemDto(
        id = "habit:$id",
        source = "habit",
        refId = id,
        title = title,
        at = at,
        done = done,
        state = if (done) "done" else if (at == null) "anytime" else "upcoming",
        habitId = id,
        xp = 10,
    )

    private fun write(
        kind: WriteKind,
        target: String,
        state: WriteState = WriteState.PENDING,
    ) = PendingWrite(
        id = 1,
        kind = kind,
        targetId = target,
        payloadJson = "{}",
        lifeDayDate = "2026-10-20",
        enqueuedAt = 0,
        attempts = 0,
        lastError = null,
        state = state,
        strandReason = null,
        noticeShown = false,
    )

    /* ---------------------------------------------------------------- overlay */

    @Test
    fun `a pending completion ticks the row and dims it in the same pass`() {
        val data = DashboardTodayDto(
            agenda = listOf(item("a", at = "2026-10-20T07:30:00Z")),
            habits = listOf(HabitWithTodayDto(id = "a")),
        )

        val result = Overlay.apply(data, listOf(write(WriteKind.HABIT_COMPLETE, "a")))

        val row = result.agenda.single()
        assertTrue(row.done)
        // Both, not just the flag: the card's treatment is driven by the state,
        // so setting only `done` would tick the row without dimming it.
        assertEquals("done", row.state)
        assertTrue(result.habits.single().completedToday)
    }

    @Test
    fun `aggregates are never hand-patched`() {
        val data = DashboardTodayDto(
            agenda = listOf(item("a")),
            habits = listOf(HabitWithTodayDto(id = "a")),
            progress = UserProgressDto(dailyXp = 100, efficiencyPct = 50.0),
            pulse = "Drifting",
        )

        val result = Overlay.apply(data, listOf(write(WriteKind.HABIT_COMPLETE, "a")))

        // One write can award XP, move efficiency, flip the pulse, schedule the
        // next occurrence and complete a goal. Rebuilding that here drifts, so
        // the overlay leaves every aggregate exactly as the server last said.
        assertEquals(100, result.progress.dailyXp)
        assertEquals(50.0, result.progress.efficiencyPct, 0.0001)
        assertEquals("Drifting", result.pulse)
    }

    @Test
    fun `an undo after a complete wins, because it came later`() {
        val data = DashboardTodayDto(
            agenda = listOf(item("a", done = true)),
            habits = listOf(HabitWithTodayDto(id = "a", completedToday = true)),
        )

        val result = Overlay.apply(
            data,
            listOf(
                write(WriteKind.HABIT_COMPLETE, "a"),
                write(WriteKind.HABIT_UNDO, "a"),
            ),
        )

        assertFalse(result.agenda.single().done)
        assertFalse(result.habits.single().completedToday)
    }

    @Test
    fun `the anytime subset is overlaid too, so a row cannot disagree with itself`() {
        val row = item("a")
        val data = DashboardTodayDto(agenda = listOf(row), anytime = listOf(row))

        val result = Overlay.apply(data, listOf(write(WriteKind.HABIT_COMPLETE, "a")))

        assertTrue(result.agenda.single().done)
        assertTrue(result.anytime.single().done)
    }

    @Test
    fun `pendingTargets covers only the writes a row can show`() {
        val targets = Overlay.pendingTargets(
            listOf(
                write(WriteKind.HABIT_COMPLETE, "a"),
                write(WriteKind.TASK_COMPLETE, "b"),
                write(WriteKind.SETTINGS_PATCH, "reducedMotion"),
            ),
        )
        assertEquals(setOf("a", "b"), targets)
    }

    @Test
    fun `an empty queue returns the same object rather than rebuilding it`() {
        val data = DashboardTodayDto(agenda = listOf(item("a")))
        assertTrue(Overlay.apply(data, emptyList()) === data)
    }

    /* ------------------------------------------------------------------ epoch */

    @Test
    fun `a ticked row keeps its index when the server re-sorts it to the bottom`() {
        val first = listOf(
            item("a", at = "2026-10-20T07:30:00Z"),
            item("b", at = "2026-10-20T09:00:00Z"),
            item("c", at = "2026-10-20T21:30:00Z"),
        )
        val epoch = AgendaEpoch.from("2026-10-20", first)
        assertEquals(listOf("habit:a", "habit:b", "habit:c"), epoch.apply(first).map { it.id })

        // The user ticks `a`. The server's compareAgenda puts done last.
        val reSorted = listOf(
            item("b", at = "2026-10-20T09:00:00Z"),
            item("c", at = "2026-10-20T21:30:00Z"),
            item("a", at = "2026-10-20T07:30:00Z", done = true),
        )

        assertEquals(
            "the ticked row must not move",
            listOf("habit:a", "habit:b", "habit:c"),
            epoch.apply(reSorted).map { it.id },
        )
        assertTrue(epoch.apply(reSorted).first().done)
    }

    @Test
    fun `a new item lands at its sorted position, not at the bottom`() {
        val first = listOf(
            item("a", at = "2026-10-20T07:30:00Z"),
            item("c", at = "2026-10-20T21:30:00Z"),
        )
        val epoch = AgendaEpoch.from("2026-10-20", first)
        epoch.apply(first)

        val withNew = first + item("b", at = "2026-10-20T09:00:00Z")
        assertEquals(
            listOf("habit:a", "habit:b", "habit:c"),
            epoch.apply(withNew).map { it.id },
        )
    }

    @Test
    fun `an item the server stops sending is dropped`() {
        val first = listOf(item("a"), item("b"))
        val epoch = AgendaEpoch.from("2026-10-20", first)
        epoch.apply(first)

        assertEquals(listOf("habit:a"), epoch.apply(listOf(item("a"))).map { it.id })
    }

    @Test
    fun `compareAgenda puts done last, then timed, then untimed by title`() {
        val done = item("z", at = "2026-10-20T07:00:00Z", done = true)
        val timed = item("t", at = "2026-10-20T09:00:00Z")
        val untimedA = item("ua", title = "Apple")
        val untimedB = item("ub", title = "Banana")

        assertTrue(Predicates.compareAgenda(timed, done) < 0)
        assertTrue(Predicates.compareAgenda(timed, untimedA) < 0)
        assertTrue(Predicates.compareAgenda(untimedA, untimedB) < 0)
    }

    /* ------------------------------------------------- the one-predicate rule */

    @Test
    fun `the Needs-you count and the Needs-you list cannot disagree`() {
        // This is the bug the web client has: a badge that counts every active
        // task against a page that filters pinned ones out.
        val data = DashboardTodayDto(
            tasks = listOf(
                TaskDto(id = "pinned-0", kind = "task", status = "active", slot = 0),
                TaskDto(id = "pinned-1", kind = "task", status = "active", slot = 1),
                TaskDto(id = "review", kind = "review", status = "active"),
                TaskDto(id = "untimed", kind = "task", status = "active"),
                TaskDto(
                    id = "timed",
                    kind = "task",
                    status = "active",
                    eventAt = "2026-10-20T09:00:00Z",
                ),
                TaskDto(id = "done", kind = "review", status = "done"),
            ),
        )

        val list = Predicates.needsYou(data)
        assertEquals(
            "the count must equal the list it counts",
            list.size,
            Predicates.needsYouCount(data),
        )
        assertEquals(setOf("review", "untimed"), list.map { it.id }.toSet())

        // And the pinned ones are exactly what Today draws as agent cards, so
        // nothing is both counted and drawn twice.
        assertEquals(listOf("pinned-0", "pinned-1"), Predicates.agentCards(data).map { it.id })
    }

    @Test
    fun `the day bucket falls back through eventAt, remindAt, showAt`() {
        assertEquals(
            "2026-10-20T09:00:00Z",
            Predicates.bucketInstant(TaskDto(eventAt = "2026-10-20T09:00:00Z", remindAt = "x")),
        )
        assertEquals("r", Predicates.bucketInstant(TaskDto(remindAt = "r", showAt = "s")))
        assertEquals("s", Predicates.bucketInstant(TaskDto(showAt = "s")))
        // Null means the "No time" bucket — never dropped.
        assertEquals(null, Predicates.bucketInstant(TaskDto()))
    }

    @Test
    fun `a stranded write is not in the overlay`() {
        // The optimistic overlay for a stranded write is dropped at the moment it
        // strands, so the row returns to undone and the UI stops lying.
        val stranded = write(WriteKind.HABIT_COMPLETE, "a", WriteState.STRANDED)
            .copy(strandReason = StrandReason.DAY_ROLLED_OVER)
        val pendingOnly = listOf(stranded).filter { it.state == WriteState.PENDING }

        val data = DashboardTodayDto(agenda = listOf(item("a")))
        assertFalse(Overlay.apply(data, pendingOnly).agenda.single().done)
    }
}
