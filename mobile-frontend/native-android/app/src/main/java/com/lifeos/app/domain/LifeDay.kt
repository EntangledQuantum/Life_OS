package com.lifeos.app.domain

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The life-day is not the calendar day.
 *
 * It starts at `dayResetTime` (04:00 by default), not midnight, so finishing
 * something at 01:00 counts for the day you have been awake through rather than
 * the one that started an hour ago. This is the single rule everything else in
 * the sync layer hangs off, and `LocalDate.now()` is never the answer to
 * "today".
 *
 * Ported from `packages/shared/src/time.ts`. The TypeScript version converges on
 * the zone offset by hand because the platform gives it no way to build an
 * instant from wall-clock-in-a-zone; `java.time` does, so this reads shorter
 * while computing the same bounds, including for half-hour zones and across DST.
 */
data class LifeDay(
    /** The life-day this instant belongs to, `YYYY-MM-DD`. */
    val date: String,
    /** When that day began. */
    val start: Instant,
    /** When it ends — exclusive, so a completion at exactly this is tomorrow. */
    val end: Instant,
    val dayResetTime: String,
    val timezone: String,
)

object LifeDays {
    const val DEFAULT_RESET_TIME = "04:00"

    private val DATE = DateTimeFormatter.ISO_LOCAL_DATE

    /** `HH:mm`, falling back to 04:00 rather than throwing on a malformed value. */
    fun parseResetTime(value: String?): LocalTime {
        val parts = value?.split(":") ?: return LocalTime.of(4, 0)
        val h = parts.getOrNull(0)?.toIntOrNull() ?: return LocalTime.of(4, 0)
        val m = parts.getOrNull(1)?.toIntOrNull() ?: 0
        return if (h in 0..23 && m in 0..59) LocalTime.of(h, m) else LocalTime.of(4, 0)
    }

    /**
     * A zone name the platform recognises, else the system zone.
     *
     * A stored zone that is no longer valid must not be able to take down every
     * date in the app.
     */
    fun resolveZone(configured: String?): ZoneId =
        runCatching { ZoneId.of(configured) }.getOrElse { ZoneId.systemDefault() }

    /** Which life-day an instant falls in. */
    fun of(instant: Instant, dayResetTime: String?, timezone: String?): LifeDay {
        val zone = resolveZone(timezone)
        val reset = parseResetTime(dayResetTime)
        val local = instant.atZone(zone)
        // Before the reset the calendar has rolled over but the life-day has not.
        val beforeReset = local.toLocalTime() < reset
        val key = if (beforeReset) local.toLocalDate().minusDays(1) else local.toLocalDate()
        return bounds(key, reset, zone, dayResetTime)
    }

    /** The bounds of a named life-day, without needing an instant inside it. */
    fun boundsOf(date: String, dayResetTime: String?, timezone: String?): LifeDay {
        val zone = resolveZone(timezone)
        val reset = parseResetTime(dayResetTime)
        return bounds(LocalDate.parse(date, DATE), reset, zone, dayResetTime)
    }

    private fun bounds(
        key: LocalDate,
        reset: LocalTime,
        zone: ZoneId,
        rawReset: String?,
    ): LifeDay = LifeDay(
        date = key.format(DATE),
        start = startOf(key, reset, zone),
        end = startOf(key.plusDays(1), reset, zone),
        dayResetTime = rawReset ?: DEFAULT_RESET_TIME,
        timezone = zone.id,
    )

    /**
     * The instant a life-day begins.
     *
     * `atZone` resolves a wall-clock time that a DST jump skipped forward to the
     * next valid instant and picks the earlier of a repeated one, which is the
     * behaviour we want: a reset time that does not exist on one day in the year
     * should still produce exactly one boundary.
     */
    private fun startOf(date: LocalDate, reset: LocalTime, zone: ZoneId): Instant =
        date.atTime(reset).atZone(zone).toInstant()

    /** `YYYY-MM-DD` shifted by whole days, touching no timezone. */
    fun addDays(date: String, days: Long): String =
        LocalDate.parse(date, DATE).plusDays(days).format(DATE)
}
