package com.lifeos.app

import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.GoalDto
import com.lifeos.app.data.api.SettingsDto
import com.lifeos.app.data.api.TaskDto
import com.lifeos.app.domain.Channels
import com.lifeos.app.domain.NotificationSounds
import com.lifeos.app.domain.NotificationType
import com.lifeos.app.domain.Predicates
import com.lifeos.app.domain.QuietHours
import com.lifeos.app.domain.Reminders
import com.lifeos.app.domain.SoundId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * The notification derivation rules (UI_SPEC §8.1–§8.4).
 *
 * Every one of these is a bug the old app shipped first. The arithmetic is pure
 * and testable precisely so the Android layer above it can be thin enough to
 * verify by looking at a phone.
 */
class RemindersTest {

    private val base = Instant.parse("2026-10-20T09:00:00Z").toEpochMilli()

    private fun task(
        id: String = "t1",
        eventAt: String? = null,
        remindAt: String? = null,
        durationMinutes: Int? = null,
        status: String = "active",
        kind: String = "task",
        slot: Int? = null,
    ) = TaskDto(
        id = id,
        title = "Read 20 pages",
        eventAt = eventAt,
        remindAt = remindAt,
        durationMinutes = durationMinutes,
        status = status,
        kind = kind,
        slot = slot,
    )

    /* ------------------------------------------------ the derived time */

    @Test
    fun `an explicit remindAt is used as it is`() {
        val at = Reminders.notifyAtMillis(
            task(remindAt = "2026-10-20T08:45:00Z", eventAt = "2026-10-20T12:00:00Z"),
            leadMinutes = 15,
        )
        // remindAt wins outright: the lead is not applied on top of it.
        assertEquals(Instant.parse("2026-10-20T08:45:00Z").toEpochMilli(), at)
    }

    @Test
    fun `without remindAt the time is the event minus the lead`() {
        val at = Reminders.notifyAtMillis(task(eventAt = "2026-10-20T09:30:00Z"), leadMinutes = 15)
        /*
         * The bug this rule exists for. The agent almost never sets `remindAt`
         * — it sets `eventAt` and expects to be told beforehand — so an app that
         * reads `remindAt` alone pre-schedules almost nothing, and the only
         * notification the user ever gets is the one raised while the app
         * happens to be open.
         */
        assertEquals(Instant.parse("2026-10-20T09:15:00Z").toEpochMilli(), at)
    }

    @Test
    fun `a task with neither time has no notification time`() {
        assertNull(Reminders.notifyAtMillis(task()))
    }

    @Test
    fun `a negative lead is clamped rather than scheduling after the event`() {
        val at = Reminders.notifyAtMillis(task(eventAt = "2026-10-20T09:30:00Z"), leadMinutes = -30)
        assertEquals(Instant.parse("2026-10-20T09:30:00Z").toEpochMilli(), at)
    }

    @Test
    fun `the default lead matches the server's`() {
        assertEquals(15, Reminders.DEFAULT_LEAD_MINUTES)
    }

    @Test
    fun `a malformed instant costs one notification and not the screen`() {
        assertNull(Reminders.notifyAtMillis(task(eventAt = "tomorrow-ish")))
        assertNull(Reminders.parseInstantMillis(""))
        assertNull(Reminders.parseInstantMillis(null))
        // Offsets and zoned forms both parse: the server may send either.
        assertNotNull(Reminders.parseInstantMillis("2026-10-20T09:00:00+05:30"))
    }

    /* ------------------------------------------------------ the window */

    @Test
    fun `an item leaves the window at the event plus its duration`() {
        val end = Reminders.windowEndMillis(
            task(eventAt = "2026-10-20T09:00:00Z", durationMinutes = 45),
        )
        assertEquals(Instant.parse("2026-10-20T09:45:00Z").toEpochMilli(), end)
    }

    @Test
    fun `completing it does not change when it leaves the window`() {
        /*
         * §8.1: "an item leaves it at `eventAt + durationMinutes` whether or not
         * it was completed." A thing scheduled for 09:00 that ran an hour is not
         * still current at 14:00 because nobody ticked it.
         */
        val open = task(eventAt = "2026-10-20T09:00:00Z", durationMinutes = 30, status = "active")
        val done = open.copy(status = "done")
        assertEquals(Reminders.windowEndMillis(open), Reminders.windowEndMillis(done))
    }

    @Test
    fun `a task with no event never leaves the window on the clock`() {
        assertNull(Reminders.windowEndMillis(task(remindAt = "2026-10-20T09:00:00Z")))
    }

    /* -------------------------------------------------------- the plan */

    @Test
    fun `the plan seeds future alarms in order and drops the past`() {
        val data = DashboardTodayDto(
            tasks = listOf(
                task(id = "late", eventAt = "2026-10-20T18:00:00Z"),
                task(id = "soon", eventAt = "2026-10-20T09:30:00Z"),
                task(id = "gone", eventAt = "2026-10-20T07:00:00Z"),
            ),
        )
        val plan = Reminders.plan(data, SettingsDto(), base)

        assertEquals(listOf("soon", "late"), plan.alarms.map { it.taskId })
        assertTrue(plan.alarms.all { it.notifyAtMillis > base })
    }

    @Test
    fun `an alarm beyond the horizon is not held`() {
        val data = DashboardTodayDto(
            tasks = listOf(task(id = "someday", eventAt = "2027-01-01T09:00:00Z")),
        )
        assertTrue(Reminders.plan(data, SettingsDto(), base).alarms.isEmpty())
    }

    @Test
    fun `a closed task is not reminded about`() {
        val data = DashboardTodayDto(
            tasks = listOf(
                task(id = "done", eventAt = "2026-10-20T12:00:00Z", status = "done"),
            ),
        )
        assertTrue(Reminders.plan(data, SettingsDto(), base).alarms.isEmpty())
    }

    @Test
    fun `the plan's needs-you is the same list Day renders`() {
        val data = DashboardTodayDto(
            tasks = listOf(
                task(id = "review", kind = "review"),
                task(id = "card", kind = "review", slot = 0),
                task(id = "timed", eventAt = "2026-10-20T12:00:00Z"),
            ),
        )
        val plan = Reminders.plan(data, SettingsDto(), base)
        /*
         * Not a second filter. A notification about a review the Day screen does
         * not list is the badge-over-an-empty-page bug with a sound on it, which
         * is the whole reason `Predicates` exists.
         */
        assertEquals(Predicates.needsYou(data).map { it.id }, plan.needsYou.map { it.id })
        assertEquals(listOf("review"), plan.needsYou.map { it.id })
    }

    @Test
    fun `goals owed a celebration are carried through`() {
        val data = DashboardTodayDto(
            pendingCelebrations = listOf(GoalDto(id = "g1", title = "Read 12 books")),
        )
        assertEquals(listOf("g1"), Reminders.plan(data, SettingsDto(), base).goalsReady.map { it.id })
    }

    @Test
    fun `the lead comes from settings, not from the constant`() {
        val data = DashboardTodayDto(tasks = listOf(task(eventAt = "2026-10-20T12:00:00Z")))

        val short = Reminders.plan(data, SettingsDto(reminderLeadMinutes = 15), base)
        assertEquals(
            Instant.parse("2026-10-20T11:45:00Z").toEpochMilli(),
            short.alarms.single().notifyAtMillis,
        )

        val long = Reminders.plan(data, SettingsDto(reminderLeadMinutes = 60), base)
        assertEquals(
            Instant.parse("2026-10-20T11:00:00Z").toEpochMilli(),
            long.alarms.single().notifyAtMillis,
        )
    }

    @Test
    fun `a reminder due exactly now is not held as an alarm`() {
        /*
         * An alarm is a thing the OS holds for *later*. One whose time has
         * already arrived belongs to the due-now path, which fires it on this
         * poll — booking an alarm for a moment that has passed either fires
         * immediately and duplicates it, or never fires at all.
         */
        val data = DashboardTodayDto(tasks = listOf(task(eventAt = "2026-10-20T09:15:00Z")))
        val plan = Reminders.plan(data, SettingsDto(reminderLeadMinutes = 15), base)
        assertTrue(plan.alarms.isEmpty())
    }

    /* -------------------------------------------------- the once rule */

    @Test
    fun `nothing already fired is fired again`() {
        val candidates = listOf(task(id = "a"), task(id = "b"), task(id = "c"))
        assertEquals(
            listOf("a", "c"),
            Reminders.unfired(candidates, setOf("b")).map { it.id },
        )
        assertTrue(Reminders.unfired(candidates, setOf("a", "b", "c")).isEmpty())
    }

    /* ----------------------------------------------------- quiet hours */

    @Test
    fun `quiet hours wrap past midnight`() {
        // 22:00–07:00 is the normal setting and the one a naive comparison fails.
        assertTrue(QuietHours.isWithin("22:00", "07:00", minutes(23, 30)))
        assertTrue(QuietHours.isWithin("22:00", "07:00", minutes(2, 0)))
        assertTrue(QuietHours.isWithin("22:00", "07:00", minutes(22, 0)))
        assertFalse(QuietHours.isWithin("22:00", "07:00", minutes(7, 0)))
        assertFalse(QuietHours.isWithin("22:00", "07:00", minutes(12, 0)))
    }

    @Test
    fun `a same-day window is start-inclusive and end-exclusive`() {
        assertTrue(QuietHours.isWithin("09:00", "17:00", minutes(9, 0)))
        assertTrue(QuietHours.isWithin("09:00", "17:00", minutes(16, 59)))
        assertFalse(QuietHours.isWithin("09:00", "17:00", minutes(17, 0)))
    }

    @Test
    fun `start equal to end means no quiet hours, not always quiet`() {
        assertFalse(QuietHours.isWithin("03:30", "03:30", minutes(3, 30)))
        assertFalse(QuietHours.isWithin("03:30", "03:30", minutes(14, 0)))
    }

    @Test
    fun `a malformed time means no quiet hours rather than permanent silence`() {
        // The failure mode of a typo must not be an app that never speaks.
        assertFalse(QuietHours.isWithin("not-a-time", "07:00", minutes(3, 0)))
        assertFalse(QuietHours.isWithin("25:00", "07:00", minutes(3, 0)))
        assertFalse(QuietHours.isWithin("22:70", "07:00", minutes(3, 0)))
        assertNull(QuietHours.minutesOfDay("7:5"))
        assertEquals(7 * 60 + 5, QuietHours.minutesOfDay("7:05"))
    }

    @Test
    fun `do not disturb silences regardless of the window`() {
        val settings = SettingsDto(doNotDisturb = true, quietHoursSilent = false)
        assertTrue(QuietHours.isSilenced(settings, minutes(12, 0)))
        assertEquals("you turn it back on", QuietHours.silencedUntil(settings, minutes(12, 0)))
    }

    @Test
    fun `quiet hours only silence when the switch is on`() {
        val off = SettingsDto(quietHoursSilent = false, quietHoursStart = "22:00", quietHoursEnd = "07:00")
        assertFalse(QuietHours.isSilenced(off, minutes(23, 0)))

        val on = off.copy(quietHoursSilent = true)
        assertTrue(QuietHours.isSilenced(on, minutes(23, 0)))
        assertEquals("07:00", QuietHours.silencedUntil(on, minutes(23, 0)))
        assertNull(QuietHours.silencedUntil(on, minutes(12, 0)))
    }

    private fun minutes(hour: Int, minute: Int) = hour * 60 + minute

    /* --------------------------------------------- channels and sounds */

    @Test
    fun `a channel id carries its sound, because a channel's sound is immutable`() {
        /*
         * The reason the old picker did nothing. If two sounds share an id, the
         * second choice posts to a channel created with the first sound, and the
         * OS — correctly — keeps playing the first.
         */
        val a = Channels.id(NotificationType.REMINDER, SoundId.CHIME)
        val b = Channels.id(NotificationType.REMINDER, SoundId.BELL)
        assertFalse(a == b)
        assertEquals("lifeos-reminder-chime", a)
        assertEquals("lifeos-reminder-bell", b)
    }

    @Test
    fun `the sync channel is one silent channel with no sound in its id`() {
        // Silent always, so there is nothing for a sound to vary.
        assertEquals("lifeos-sync", Channels.id(NotificationType.SYNC_PROBLEM, SoundId.ALERT))
        assertEquals("lifeos-sync", Channels.id(NotificationType.SYNC_PROBLEM, SoundId.NONE))
        assertFalse(NotificationType.SYNC_PROBLEM.soundChoosable)
    }

    @Test
    fun `the id and group names are stable`() {
        /*
         * Pinned deliberately. A channel id is a user's settings: renaming one
         * in place silently discards whatever they had configured for it, and
         * §8.2 asks for names that let a sound be added later without migrating
         * anything. Change these only with a migration story.
         */
        assertEquals(
            listOf("reminder", "due", "needsyou", "goal", "sync"),
            NotificationType.entries.map { it.key },
        )
        assertEquals("lifeos-reminder", Channels.groupId(NotificationType.REMINDER))
        assertEquals(
            listOf("chime", "bell", "marimba", "pulse", "alert", "none"),
            SoundId.entries.map { it.wire },
        )
    }

    @Test
    fun `a sound resolves from the user, then the server, then the type`() {
        // The user's choice on this device wins.
        assertEquals(
            SoundId.MARIMBA,
            NotificationSounds.resolve(
                NotificationType.REMINDER,
                mapOf("reminder" to "marimba"),
                serverDefault = "bell",
            ),
        )
        // Then the server's `notificationSound`, for the two types §8.1 says so.
        assertEquals(
            SoundId.BELL,
            NotificationSounds.resolve(NotificationType.REMINDER, emptyMap(), "bell"),
        )
        assertEquals(
            SoundId.BELL,
            NotificationSounds.resolve(NotificationType.DUE_NOW, emptyMap(), "bell"),
        )
        // Needs-you defaults to silent whatever the server's sound is: it is a
        // queue, not an interruption.
        assertEquals(
            SoundId.NONE,
            NotificationSounds.resolve(NotificationType.NEEDS_YOU, emptyMap(), "bell"),
        )
        assertEquals(
            SoundId.CHIME,
            NotificationSounds.resolve(NotificationType.GOAL_READY, emptyMap(), "bell"),
        )
    }

    @Test
    fun `an unknown stored sound falls back rather than crashing`() {
        assertEquals(
            SoundId.CHIME,
            NotificationSounds.resolve(
                NotificationType.REMINDER,
                mapOf("reminder" to "theremin"),
                serverDefault = "chime",
            ),
        )
    }

    @Test
    fun `only the channels in use exist, and a new choice adds exactly one`() {
        val before = NotificationSounds.inUse(emptyMap(), "chime")
        // Five types, five channels — not thirty.
        assertEquals(NotificationType.entries.size, before.size)

        val after = NotificationSounds.inUse(mapOf("reminder" to "bell"), "chime")
        assertEquals(before.size, after.size)
        assertTrue("lifeos-reminder-bell" in after)
        assertFalse("lifeos-reminder-bell" in before)
        /*
         * And the other four are untouched, which is the property §8.2 wants:
         * adding a sound never migrates a user's existing channel settings.
         */
        assertEquals(
            before.keys - "lifeos-reminder-chime",
            after.keys - "lifeos-reminder-bell",
        )
    }

    @Test
    fun `the silent choice is a channel, not an absence of one`() {
        val channels = NotificationSounds.inUse(mapOf("reminder" to "none"), "chime")
        // "none = visual only" means a silent channel we still post to, never a
        // notification we decline to show.
        assertTrue("lifeos-reminder-none" in channels)
        assertTrue(SoundId.NONE.silent)
    }
}
