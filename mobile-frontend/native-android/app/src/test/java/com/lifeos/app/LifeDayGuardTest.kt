package com.lifeos.app

import com.lifeos.app.domain.LifeDayGuard
import com.lifeos.app.domain.MAX_WRITE_ATTEMPTS
import com.lifeos.app.domain.Predicates
import com.lifeos.app.domain.WriteKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The life-day stamp guard.
 *
 * The single most important piece of correctness in the app: a habit tick
 * replayed after the 04:00 reset lands on the wrong day and silently corrupts a
 * streak. Losing the write is the lesser harm, and these tests pin that choice
 * down so a later refactor cannot quietly reverse it.
 */
class LifeDayGuardTest {

    @Test
    fun `matching stamps send`() {
        assertEquals(
            LifeDayGuard.Verdict.Send,
            LifeDayGuard.verdict(WriteKind.HABIT_COMPLETE, "2026-10-20", "2026-10-20"),
        )
    }

    @Test
    fun `a habit completion stranded once the day has rolled over`() {
        assertEquals(
            LifeDayGuard.Verdict.Strand,
            LifeDayGuard.verdict(WriteKind.HABIT_COMPLETE, "2026-10-19", "2026-10-20"),
        )
        assertFalse(LifeDayGuard.maySend(WriteKind.HABIT_COMPLETE, "2026-10-19", "2026-10-20"))
    }

    @Test
    fun `a task completion is guarded exactly like a habit`() {
        assertEquals(
            LifeDayGuard.Verdict.Strand,
            LifeDayGuard.verdict(WriteKind.TASK_COMPLETE, "2026-10-19", "2026-10-20"),
        )
    }

    @Test
    fun `an undo is guarded too - undoing yesterday is as wrong as doing it`() {
        assertEquals(
            LifeDayGuard.Verdict.Strand,
            LifeDayGuard.verdict(WriteKind.HABIT_UNDO, "2026-10-19", "2026-10-20"),
        )
    }

    @Test
    fun `day-independent writes always send, even across a boundary`() {
        val exempt = listOf(
            WriteKind.SETTINGS_PATCH,
            WriteKind.CELEBRATION_SEEN,
            WriteKind.TASK_NOTIFIED,
            WriteKind.TASK_DISMISS,
        )
        for (kind in exempt) {
            assertTrue("$kind must be exempt", Predicates.isDayIndependent(kind))
            assertEquals(
                "$kind must send across a boundary",
                LifeDayGuard.Verdict.Send,
                LifeDayGuard.verdict(kind, "2026-10-19", "2026-10-20"),
            )
            // And with no server day known at all.
            assertEquals(
                LifeDayGuard.Verdict.Send,
                LifeDayGuard.verdict(kind, "2026-10-19", null),
            )
        }
    }

    @Test
    fun `completions are never exempt`() {
        val guarded = listOf(
            WriteKind.HABIT_COMPLETE,
            WriteKind.HABIT_UNDO,
            WriteKind.TASK_COMPLETE,
            WriteKind.SESSION_START,
            WriteKind.SESSION_STOP,
            WriteKind.STUDY_LOG,
        )
        for (kind in guarded) {
            assertFalse("$kind must be guarded", Predicates.isDayIndependent(kind))
        }
    }

    @Test
    fun `an unknown server day waits rather than guessing either way`() {
        assertEquals(
            LifeDayGuard.Verdict.Unknown,
            LifeDayGuard.verdict(WriteKind.HABIT_COMPLETE, "2026-10-20", null),
        )
        assertEquals(
            LifeDayGuard.Verdict.Unknown,
            LifeDayGuard.verdict(WriteKind.HABIT_COMPLETE, "2026-10-20", ""),
        )
    }

    @Test
    fun `backoff grows and is capped`() {
        assertEquals(1_000L, LifeDayGuard.backoffMs(0))
        assertEquals(2_000L, LifeDayGuard.backoffMs(1))
        assertEquals(4_000L, LifeDayGuard.backoffMs(2))
        assertEquals(64_000L, LifeDayGuard.backoffMs(6))
        // Capped: a wait long enough to be indistinguishable from stranded is
        // not an improvement.
        assertEquals(64_000L, LifeDayGuard.backoffMs(99))
    }

    @Test
    fun `the retry budget is five`() {
        assertEquals(5, MAX_WRITE_ATTEMPTS)
    }
}
