package com.lifeos.app.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * The protocol 4 wire types — `GET /api/v1/sync` and `POST /api/v1/sync/push`.
 *
 * Mirrors `packages/shared/src/sync.ts`. Copied rather than imported, like every
 * other shared type in this client, and `docs/SYNC.md` is the contract both
 * sides are written against.
 *
 * Two decoding decisions here are load-bearing and neither is obvious.
 *
 * **1. `docs` is a `JsonObject`, not nine nullable fields.** The contract says a
 * document is *absent* when it has not changed, and that `activeSession` may be
 * *present and null* to mean "the session was cleared". With nine nullable
 * fields those two cases decode identically, and the client would either keep a
 * session the user ended or throw away eight documents on every delta. Holding
 * the raw object means `containsKey` answers "did the server send this?" and the
 * value answers "what is it now?" — which is exactly the distinction the
 * protocol draws. It also means the two documents this client has no reader for
 * (`studySessions`, `gamification`) are stored faithfully instead of being
 * silently dropped by a type that does not mention them.
 *
 * **2. Every field has a default.** A server that grows a field must not break
 * an installed app, and a 426 is the only version error this client should ever
 * see — a missing key should never be the thing that decides whether the day
 * renders.
 */

/* ----------------------------------------------------------------- the read */

/** `{ items, anytime }` — today as one ordered list. */
@Serializable
data class AgendaDocDto(
    val items: List<AgendaItemDto> = emptyList(),
    val anytime: List<AgendaItemDto> = emptyList(),
)

/** A segment of the **planned** ribbon. Hours from the life-day's start. */
@Serializable
data class RibbonSegmentDto(
    val id: String = "",
    val category: String = "",
    val label: String = "",
    val startHour: Double = 0.0,
    val endHour: Double = 0.0,
    val color: String = "",
    val status: String = "planned",
)

/**
 * What actually happened today, as an interval rather than as a drawn bar.
 *
 * `endedAt == null` is the open one, and the client draws it up to its own
 * clock — which is why the now-marker advances smoothly between polls instead
 * of jumping on each one.
 */
@Serializable
data class LoggedIntervalDto(
    val id: String = "",
    val activity: String = "",
    val startedAt: String = "",
    val endedAt: String? = null,
    val blockId: String? = null,
)

/**
 * Today's numbers, minus the one that needs a clock.
 *
 * `improvementPct` is deliberately **not** here: it is a comparison against
 * where yesterday had got to *by this hour*, so a server-computed value would
 * be wrong by however long ago the last write happened. The client computes it
 * with `SyncMath.paceAdjustedImprovementPct`.
 */
@Serializable
data class ProgressDocDto(
    val totalXp: Int = 0,
    val dailyXp: Int = 0,
    val dailyXpTarget: Int = 0,
    val efficiencyPct: Double = 0.0,
    val yesterdayEfficiencyPct: Double = 0.0,
    val lastImprovementPulse: String = "Stable",
    val growthStyle: String = "bloom",
)

@Serializable
data class InsightsDocDto(
    val vsYesterday: VsYesterdayDto = VsYesterdayDto(),
    val pulse: String = "Stable",
    val pulseExplanation: String = "",
    val consistency7: List<ConsistencyPointDto> = emptyList(),
    val xpSeries7: List<SeriesPointDto> = emptyList(),
)

/**
 * Whole rows that changed, keyed by collection.
 *
 * A collection is absent when nothing in it moved, and a present entity is the
 * **whole current row** rather than a field-level patch — a partial row saves a
 * few hundred bytes and buys a merge bug in every client.
 */
@Serializable
data class SyncChangedDto(
    val habits: List<HabitWithTodayDto>? = null,
    val tasks: List<TaskDto>? = null,
    val goals: List<GoalDto>? = null,
    val properties: List<AgentPropertyDto>? = null,
    val quests: List<QuestDto>? = null,
    val achievements: List<AchievementDto>? = null,
)

/**
 * Ids to forget, per collection.
 *
 * A tombstone means "this is no longer yours to show" rather than strictly "a
 * row was deleted": a habit with `deletedAt` set is physically still there and
 * its history is never destroyed, but a client that kept it would show a habit
 * the user retired.
 */
@Serializable
data class SyncDeletedDto(
    val habits: List<String>? = null,
    val tasks: List<String>? = null,
    val goals: List<String>? = null,
    val properties: List<String>? = null,
    val quests: List<String>? = null,
    val achievements: List<String>? = null,
)

@Serializable
data class SyncEnvelopeDto(
    val protocol: Int = 4,
    /** Opaque. Store it, send it back, never parse or compare it. */
    val cursor: String = "",
    /** True → discard everything held **before** applying this. */
    val reset: Boolean = false,
    val lifeDay: LifeDayDto = LifeDayDto(),
    /**
     * The server's clock when it answered — the offset to correct by, and not an
     * invitation to use server time for display.
     */
    val serverTime: String = "",
    val changed: SyncChangedDto = SyncChangedDto(),
    val deleted: SyncDeletedDto = SyncDeletedDto(),
    /** Raw on purpose. See the note at the top of this file. */
    val docs: JsonObject = JsonObject(emptyMap()),
    /** True when `changed`, `deleted` and `docs` are all empty. */
    val upToDate: Boolean = false,
)

/* ---------------------------------------------------------------- the write */

/**
 * One thing the user did.
 *
 * [id] is strictly one greater than the last mutation this installation sent,
 * from a counter the client persists — not a random id and not a timestamp. It
 * is how the server recognises a retry, and it is what stops an offline queue
 * drained twice from completing a habit twice and paying for it twice.
 */
@Serializable
data class SyncMutationDto(
    val id: Long,
    val name: String,
    val args: JsonObject = JsonObject(emptyMap()),
    /**
     * The life-day that was current when the user pressed the thing. Required
     * on a day-bound mutation and ignored on the rest; a day-bound mutation with
     * none is `rejected`.
     */
    val lifeDayDate: String? = null,
)

@Serializable
data class SyncPushRequestDto(
    /** Stable per installation. A reinstall is a new client; that is correct. */
    val clientId: String,
    /** The cursor held now, so the reply can carry the delta and skip a poll. */
    val since: String? = null,
    val mutations: List<SyncMutationDto> = emptyList(),
)

/**
 * What became of one mutation.
 *
 * Four statuses and they are not interchangeable:
 *
 *  - `applied` — done, and its effects are in the same response's delta.
 *  - `duplicate` — already applied, or a no-op like a habit already done today.
 *    **Treated as success**: the tick is on screen and the thing did happen.
 *  - `staleLifeDay` — the day turned under it. Never retryable; stranded and
 *    surfaced once, because re-dating someone's history is worse than losing a
 *    write.
 *  - `rejected` — permanently wrong. Stranded with its error.
 */
@Serializable
data class SyncMutationResultDto(
    val id: Long = 0,
    val status: String = "",
    val error: String? = null,
    val result: JsonElement? = null,
)

@Serializable
data class SyncPushResponseDto(
    val protocol: Int = 4,
    /** The highest mutation id now applied for this client. */
    val lastMutationId: Long = 0,
    val results: List<SyncMutationResultDto> = emptyList(),
    /**
     * The delta from the request's `since` to now.
     *
     * This is the whole point of the endpoint: a write used to be followed by a
     * 2.26 MB refetch of a day the client had just changed one row of. **Take
     * the new state from here and never refetch after a write.**
     */
    val sync: SyncEnvelopeDto = SyncEnvelopeDto(),
)

/** `409` on push — a hole in the numbering. Resend from `lastMutationId + 1`. */
@Serializable
data class SyncPushConflictDto(
    val error: String = "",
    @SerialName("lastMutationId") val lastMutationId: Long = 0,
)

/** The mutation names, exactly as `SYNC_MUTATIONS` lists them. */
object SyncMutations {
    const val HABIT_COMPLETE = "habit.complete"
    const val HABIT_UNDO = "habit.undo"
    const val TASK_COMPLETE = "task.complete"
    const val TASK_DISMISS = "task.dismiss"
    const val TASK_NOTIFIED = "task.notified"
    const val TASK_INTERACT = "task.interact"
    const val GOAL_CELEBRATION_SEEN = "goal.celebrationSeen"
    const val SESSION_SET = "session.set"
    const val SESSION_CLEAR = "session.clear"
    const val STUDY_CREATE = "study.create"
    const val SETTINGS_PATCH = "settings.patch"

    /**
     * The mutations that land on a particular day, from
     * `LIFE_DAY_BOUND_MUTATIONS`.
     *
     * The exemptions are the writes that are statements about a *thing* rather
     * than about a day: a reminder was shown, a card was swept away, a
     * celebration was watched, a setting was changed.
     */
    val LIFE_DAY_BOUND = setOf(
        HABIT_COMPLETE,
        HABIT_UNDO,
        TASK_COMPLETE,
        TASK_INTERACT,
        SESSION_SET,
        SESSION_CLEAR,
        STUDY_CREATE,
    )

    fun isLifeDayBound(name: String): Boolean = name in LIFE_DAY_BOUND
}

/** The document names, as `SYNC_DOC_NAMES` lists them. */
object SyncDocNames {
    const val AGENDA = "agenda"
    const val RIBBON = "ribbon"
    const val LIVED = "lived"
    const val PROGRESS = "progress"
    const val INSIGHTS = "insights"
    const val STUDY_SESSIONS = "studySessions"
    const val SETTINGS = "settings"
    const val GAMIFICATION = "gamification"
    const val ACTIVE_SESSION = "activeSession"

    val ALL = listOf(
        AGENDA, RIBBON, LIVED, PROGRESS, INSIGHTS,
        STUDY_SESSIONS, SETTINGS, GAMIFICATION, ACTIVE_SESSION,
    )
}
