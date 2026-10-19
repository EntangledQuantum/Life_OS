package com.lifeos.app

import com.lifeos.app.domain.LifeDays
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/**
 * The life-day is not the calendar day.
 *
 * Ported from `packages/shared/src/time.ts`, so these cases are the ones that
 * file's doc comments call out: 01:00 belongs to yesterday, the half-hour zones
 * must work, and the bounds are start-inclusive / end-exclusive.
 */
class LifeDayTest {

    private val london = "Europe/London"
    private val kolkata = "Asia/Kolkata"

    @Test
    fun `an hour after midnight belongs to the day you have been awake through`() {
        // 01:00 local on the 20th, reset at 04:00 → still the 19th.
        val instant = Instant.parse("2026-10-20T01:00:00Z")
        val day = LifeDays.of(instant, "04:00", "UTC")
        assertEquals("2026-10-19", day.date)
    }

    @Test
    fun `at the reset time exactly, the new day has started`() {
        val day = LifeDays.of(Instant.parse("2026-10-20T04:00:00Z"), "04:00", "UTC")
        assertEquals("2026-10-20", day.date)
    }

    @Test
    fun `a minute before the reset is still yesterday`() {
        val day = LifeDays.of(Instant.parse("2026-10-20T03:59:00Z"), "04:00", "UTC")
        assertEquals("2026-10-19", day.date)
    }

    @Test
    fun `the end is exclusive - a completion at exactly the end is tomorrow`() {
        val day = LifeDays.boundsOf("2026-10-19", "04:00", "UTC")
        assertEquals(Instant.parse("2026-10-19T04:00:00Z"), day.start)
        assertEquals(Instant.parse("2026-10-20T04:00:00Z"), day.end)

        val atEnd = LifeDays.of(day.end, "04:00", "UTC")
        assertEquals("2026-10-20", atEnd.date)
    }

    @Test
    fun `a half-hour zone is not rounded to the hour`() {
        // Asia/Kolkata is UTC+05:30. A 04:00 local reset is 22:30 UTC the day before.
        val day = LifeDays.boundsOf("2026-10-19", "04:00", kolkata)
        assertEquals(Instant.parse("2026-10-18T22:30:00Z"), day.start)
    }

    @Test
    fun `a DST boundary still yields exactly one day start`() {
        // Britain leaves summer time on 2026-10-25. The 04:00 reset exists on
        // both sides, and the bounds must stay 24 or 25 hours apart rather than
        // producing two starts or none.
        val before = LifeDays.boundsOf("2026-10-24", "04:00", london)
        val after = LifeDays.boundsOf("2026-10-25", "04:00", london)
        val hours = (after.start.epochSecond - before.start.epochSecond) / 3600
        assertEquals(25L, hours)
    }

    @Test
    fun `a malformed reset time falls back to 04 00 rather than throwing`() {
        assertEquals(4, LifeDays.parseResetTime("not a time").hour)
        assertEquals(4, LifeDays.parseResetTime(null).hour)
        assertEquals(4, LifeDays.parseResetTime("99:99").hour)
        assertEquals(30, LifeDays.parseResetTime("05:30").minute)
    }

    @Test
    fun `an invalid timezone falls back instead of taking down every date`() {
        val zone = LifeDays.resolveZone("Mars/Olympus_Mons")
        assertEquals(ZoneId.systemDefault(), zone)
    }

    @Test
    fun `addDays touches no timezone`() {
        assertEquals("2026-11-01", LifeDays.addDays("2026-10-31", 1))
        assertEquals("2026-02-28", LifeDays.addDays("2026-03-01", -1))
    }
}
