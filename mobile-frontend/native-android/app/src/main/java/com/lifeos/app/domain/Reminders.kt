package com.lifeos.app.domain

import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.GoalDto
import com.lifeos.app.data.api.SettingsDto
import com.lifeos.app.data.api.TaskDto
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZonedDateTime

/**
 * Notifications, as arithmetic (UI_SPEC §8.1–§8.4).
 *
 * Everything here is pure: no `Context`, no `NotificationManager`, no clock of
 * its own. The Android layer in `notify/` decides *how* to post; this file
 * decides **what is due, when, and whether it has already been said** — which is
 * the part that was wrong four separate times in the old app and the part worth
 * a unit test.
 *
 * The one rule that governs the whole file: a notification time is **derived,
 * never read straight from `remindAt`**. The agent almost never sets `remindAt`
 * — it sets `eventAt` and expects the client to work backwards — so an app that
 * reads `remindAt` alone pre-schedules almost nothing and the only notification
 * the user ever gets is the one raised while the app happened to be open. That
 * was the bug. It is `remindAt ?? eventAt - reminderLeadMinutes`, in exactly one
 * function, and both the alarm seeding and the "is this current" window call it.
 */

/** The five types of §8.1. One user-visible row in Settings each. */
enum class NotificationType(
    /** The stable half of a channel id. Never change one of these in place. */
    val key: String,
    val label: String,
    val description: String,
    /** `HIGH` heads-up, or `DEFAULT`. [SYNC_PROBLEM] is `LOW`. */
    val importance: NotificationImportance,
    /** What the sound is before the user has chosen, per §8.1. */
    val defaultSound: SoundId,
    /** Whether the user may pick a sound at all. */
    val soundChoosable: Boolean,
) {
    REMINDER(
        key = "reminder",
        label = "Reminder",
        description = "Before something the agent scheduled.",
        importance = NotificationImportance.HIGH,
        // The one type whose default follows the server's `notificationSound`,
        // so the phone agrees with the dashboard out of the box.
        defaultSound = SoundId.CHIME,
        soundChoosable = true,
    ),
    DUE_NOW(
        key = "due",
        label = "Due now",
        description = "The moment something is on your plate.",
        importance = NotificationImportance.HIGH,
        defaultSound = SoundId.CHIME,
        soundChoosable = true,
    ),
    NEEDS_YOU(
        key = "needsyou",
        label = "Needs you",
        description = "A review the agent is waiting on.",
        importance = NotificationImportance.DEFAULT,
        // Silent by default: this is a queue, not an interruption.
        defaultSound = SoundId.NONE,
        soundChoosable = true,
    ),
    GOAL_READY(
        key = "goal",
        label = "Goal ready",
        description = "A goal you have not been shown yet.",
        importance = NotificationImportance.DEFAULT,
        defaultSound = SoundId.CHIME,
        soundChoosable = true,
    ),
    SYNC_PROBLEM(
        key = "sync",
        label = "Sync problem",
        description = "Writes that could not be saved.",
        importance = NotificationImportance.LOW,
        defaultSound = SoundId.NONE,
        // Silent always, and therefore no sound row at all (§8.1).
        soundChoosable = false,
    ),
    ;

    companion object {
        fun ofKey(key: String?): NotificationType? = entries.firstOrNull { it.key == key }

        /** The four with a sound row, in the order Settings lists them. */
        val choosable: List<NotificationType> get() = entries.filter { it.soundChoosable }
    }
}

/** Mapped to `NotificationManager` constants in the Android layer. */
enum class NotificationImportance { LOW, DEFAULT, HIGH }

/**
 * The sounds of §8.3. **The id is the contract, not the waveform.**
 *
 * Each non-silent one is a committed WAV in `res/raw`, rendered from the same
 * note table `apps/web/src/lib/notify.ts` synthesises in WebAudio, so "chime"
 * is the same two rising notes on the phone and in the browser.
 */
enum class SoundId(val wire: String, val label: String) {
    CHIME("chime", "Chime"),
    BELL("bell", "Bell"),
    MARIMBA("marimba", "Marimba"),
    PULSE("pulse", "Pulse"),
    ALERT("alert", "Alert"),

    /** Visual only. A channel with no sound, not a channel we skip posting to. */
    NONE("none", "Silent"),
    ;

    val silent: Boolean get() = this == NONE

    companion object {
        fun ofWire(wire: String?): SoundId =
            entries.firstOrNull { it.wire == wire } ?: CHIME

        /** The five audible ones plus silent, in picker order. */
        val pickable: List<SoundId> get() = entries.toList()
    }
}

/**
 * Channel identity (§8.2), and the reason it is shaped like this.
 *
 * An Android channel's sound is fixed when the channel is created and the OS
 * owns it from then on — deliberately, so an app cannot take a user's choice
 * back. Sharing one channel across several sounds is therefore not a shortcut,
 * it is a picker that silently does nothing, which is exactly what the old app
 * shipped.
 *
 * So the sound is **part of the id**. Two consequences worth stating:
 *
 *  - Adding a sixth sound later creates new ids and touches no existing
 *    channel, so a user's per-channel settings are never migrated.
 *  - Switching a type's sound away and back restores what the user had, because
 *    Android remembers a deleted channel's settings against its id.
 */
object Channels {

    /** One group per type family, so the OS's own screen groups them. */
    fun groupId(type: NotificationType): String = "lifeos-${type.key}"

    fun id(type: NotificationType, sound: SoundId): String =
        if (type == NotificationType.SYNC_PROBLEM) SYNC else "lifeos-${type.key}-${sound.wire}"

    /** A single silent `LOW` channel with no sound row (§8.2). */
    const val SYNC: String = "lifeos-sync"
}

/**
 * Which sound a type uses right now, in one function.
 *
 * Three sources, in order: what the user picked on this device, then the
 * server's `notificationSound` for the two types §8.1 says default from it,
 * then the type's own default. Resolved here rather than at each call site
 * because the channel id contains the sound — two places answering this
 * question differently means posting to a channel that was never created, and
 * Android drops a notification posted to an unknown channel in release while
 * logging about it in debug.
 */
object NotificationSounds {

    fun resolve(
        type: NotificationType,
        chosen: Map<String, String>,
        serverDefault: String,
    ): SoundId {
        if (!type.soundChoosable) return SoundId.NONE
        chosen[type.key]?.let { return SoundId.ofWire(it) }
        return when (type) {
            // "user-chosen, default from settings.notificationSound" (§8.1).
            NotificationType.REMINDER, NotificationType.DUE_NOW -> SoundId.ofWire(serverDefault)
            else -> type.defaultSound
        }
    }

    /**
     * Every channel that should exist for a given state of the preferences.
     *
     * §8.2: create **only the channels in use** — the defaults at first run,
     * plus one lazily when the user picks a new sound. This returns exactly
     * that set, so "create the channels in use" and "delete the ones that are
     * not" are one comparison rather than two lists maintained by hand.
     */
    fun inUse(chosen: Map<String, String>, serverDefault: String): Map<String, Pair<NotificationType, SoundId>> {
        val out = LinkedHashMap<String, Pair<NotificationType, SoundId>>()
        for (type in NotificationType.entries) {
            val sound = resolve(type, chosen, serverDefault)
            out[Channels.id(type, sound)] = type to sound
        }
        return out
    }
}

/** One alarm the OS should hold for us: a task, and when to say it. */
data class DerivedReminder(
    val taskId: String,
    val title: String,
    val body: String?,
    /** `remindAt ?? eventAt - lead`, as epoch millis. */
    val notifyAtMillis: Long,
    /**
     * `eventAt + durationMinutes`, or null when the task has no event.
     *
     * The item leaves the window here **whether or not it was completed** — a
     * thing that was scheduled for 09:00 and ran an hour is not "current" at
     * 14:00 because nobody ticked it.
     */
    val windowEndMillis: Long?,
)

/**
 * What the notification layer should do with this snapshot.
 *
 * Computed in one pass so the alarm set and the fire-now set cannot disagree —
 * the same mistake as a badge counting one predicate while a page filters by
 * another, which is the bug `Predicates` exists to prevent.
 */
data class ReminderPlan(
    /** Future alarms to hold, earliest first. */
    val alarms: List<DerivedReminder>,
    /** `dueReminders` that are genuinely due now. */
    val dueNow: List<TaskDto>,
    /** Reviews the agent is waiting on. */
    val needsYou: List<TaskDto>,
    /** Goals owed a celebration. */
    val goalsReady: List<GoalDto>,
)

object Reminders {

    /** The server's default, used until `GET /settings` has landed. */
    const val DEFAULT_LEAD_MINUTES: Int = 15

    /**
     * How far ahead alarms are seeded.
     *
     * The snapshot is today's, so anything beyond the end of tomorrow is not in
     * it anyway; this is a guard against a server sending a task years out and
     * the app booking an alarm the user has long since stopped caring about.
     */
    private const val HORIZON_MS: Long = 48L * 60 * 60 * 1000

    /**
     * When a task's notification should fire — the single derivation.
     *
     * Port of `notifyAt` in `packages/shared/src/schedule.ts` and of
     * `mobile-frontend/app/lib/schedule.ts`. Copied on purpose and must stay a
     * copy (see the isolation contract); pinned by `RemindersTest`.
     */
    fun notifyAtMillis(task: TaskDto, leadMinutes: Int = DEFAULT_LEAD_MINUTES): Long? {
        task.remindAt?.let { explicit ->
            return parseInstantMillis(explicit)
        }
        val event = task.eventAt?.let(::parseInstantMillis) ?: return null
        val lead = leadMinutes.coerceAtLeast(0)
        return event - lead * 60_000L
    }

    /**
     * When the task stops being current: `eventAt + durationMinutes`.
     *
     * Null for a task with no `eventAt`, which never leaves the window on time
     * because it never had one — it leaves when it is completed or dismissed.
     */
    fun windowEndMillis(task: TaskDto): Long? {
        val event = task.eventAt?.let(::parseInstantMillis) ?: return null
        return event + (task.durationMinutes ?: 0).coerceAtLeast(0) * 60_000L
    }

    /**
     * Everything the notification layer needs from one snapshot.
     *
     * `needsYou` and the agent cards come from [Predicates], not from a second
     * hand-written filter here — a notification about a review the Day screen
     * does not list would be the badge-over-an-empty-page bug with a sound.
     */
    fun plan(
        data: DashboardTodayDto,
        settings: SettingsDto,
        now: Long,
    ): ReminderPlan {
        val lead = settings.reminderLeadMinutes.coerceAtLeast(0)

        val alarms = data.tasks
            .asSequence()
            .filter { Predicates.isOpen(it) }
            .mapNotNull { task ->
                val at = notifyAtMillis(task, lead) ?: return@mapNotNull null
                // Already past, or further out than we are willing to hold.
                if (at <= now || at > now + HORIZON_MS) return@mapNotNull null
                DerivedReminder(
                    taskId = task.id,
                    title = task.title,
                    body = task.subtitle ?: task.purpose,
                    notifyAtMillis = at,
                    windowEndMillis = windowEndMillis(task),
                )
            }
            .sortedBy { it.notifyAtMillis }
            .toList()

        return ReminderPlan(
            alarms = alarms,
            dueNow = data.dueReminders.filter { Predicates.isOpen(it) },
            needsYou = Predicates.needsYou(data),
            goalsReady = data.pendingCelebrations,
        )
    }

    /**
     * The once-only rule (§8.4): fire for an id that is not in the fired set.
     *
     * The set is durable (a Room table), not a field, because "once" has to mean
     * once across a process death — a reminder that re-fires every cold start is
     * the version of this bug the user actually notices. The in-process guard on
     * top of it exists for a different failure: a recomposition racing the
     * `/notified` POST, which is the common one.
     */
    fun unfired(candidates: List<TaskDto>, fired: Set<String>): List<TaskDto> =
        candidates.filter { it.id !in fired }

    /**
     * Instants, parsed the three ways a server might send one.
     *
     * Null rather than an exception: a malformed `eventAt` must cost one
     * notification, never the screen.
     */
    fun parseInstantMillis(text: String?): Long? {
        if (text.isNullOrBlank()) return null
        return runCatching { Instant.parse(text).toEpochMilli() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(text).toInstant().toEpochMilli() }.getOrNull()
            ?: runCatching { ZonedDateTime.parse(text).toInstant().toEpochMilli() }.getOrNull()
    }
}

/**
 * Quiet hours and do-not-disturb (§8.4), in one place.
 *
 * This used to be written twice: once in `LifeOsRoot.silencedUntil` for the
 * status strip's silenced line, and it was about to be written again in the
 * notification layer. Two copies of a comparison that **wraps past midnight**
 * is the drift this codebase has a rule against, so both callers use this.
 *
 * Port of `isWithinQuietHours` / `isSilenced` in `mobile-frontend/app/lib/schedule.ts`.
 */
object QuietHours {

    /**
     * Minutes since midnight, or null if the string is not `HH:mm`.
     *
     * A malformed value means "no quiet hours", never "always quiet": the
     * failure mode of a typo must not be silence.
     */
    fun minutesOfDay(hhmm: String?): Int? {
        val match = Regex("^(\\d{1,2}):(\\d{2})$").find(hhmm?.trim().orEmpty()) ?: return null
        val hours = match.groupValues[1].toInt()
        val minutes = match.groupValues[2].toInt()
        if (hours > 23 || minutes > 59) return null
        return hours * 60 + minutes
    }

    /**
     * Whether `nowMinutes` is inside the window.
     *
     * **Start equal to end means no quiet hours, not always quiet.** The window
     * wraps: 22:00–07:00 is a real and normal setting, and a naive
     * `start <= now && now < end` is false for all of it.
     */
    fun isWithin(start: String?, end: String?, nowMinutes: Int): Boolean {
        val from = minutesOfDay(start) ?: return false
        val to = minutesOfDay(end) ?: return false
        if (from == to) return false
        return if (from < to) nowMinutes >= from && nowMinutes < to else nowMinutes >= from || nowMinutes < to
    }

    /** True when nothing may make a sound or a visual flash right now. */
    fun isSilenced(settings: SettingsDto, nowMinutes: Int): Boolean {
        if (settings.doNotDisturb) return true
        if (!settings.quietHoursSilent) return false
        return isWithin(settings.quietHoursStart, settings.quietHoursEnd, nowMinutes)
    }

    /**
     * What the status strip's silenced line says after "silenced until", or null
     * when nothing is silenced.
     */
    fun silencedUntil(settings: SettingsDto, nowMinutes: Int): String? {
        if (settings.doNotDisturb) return "you turn it back on"
        if (!settings.quietHoursSilent) return null
        return if (isWithin(settings.quietHoursStart, settings.quietHoursEnd, nowMinutes)) {
            settings.quietHoursEnd
        } else {
            null
        }
    }
}
