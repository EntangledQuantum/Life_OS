package com.lifeos.app.data.sync

import com.lifeos.app.data.api.AchievementDto
import com.lifeos.app.data.api.ActiveSessionDto
import com.lifeos.app.data.api.AgendaDocDto
import com.lifeos.app.data.api.AgentPropertyDto
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.GoalDto
import com.lifeos.app.data.api.HabitWithTodayDto
import com.lifeos.app.data.api.InsightsDocDto
import com.lifeos.app.data.api.LifeDayDto
import com.lifeos.app.data.api.LoggedIntervalDto
import com.lifeos.app.data.api.ProgressDocDto
import com.lifeos.app.data.api.QuestDto
import com.lifeos.app.data.api.RibbonSegmentDto
import com.lifeos.app.data.api.SyncDocNames
import com.lifeos.app.data.api.SyncEnvelopeDto
import com.lifeos.app.data.api.TaskDto
import com.lifeos.app.data.api.UserProgressDto
import com.lifeos.app.data.db.AchievementEntity
import com.lifeos.app.data.db.GoalEntity
import com.lifeos.app.data.db.HabitEntity
import com.lifeos.app.data.db.PropertyEntity
import com.lifeos.app.data.db.QuestEntity
import com.lifeos.app.data.db.SyncDelta
import com.lifeos.app.data.db.SyncDocEntity
import com.lifeos.app.data.db.SyncStateEntity
import com.lifeos.app.data.db.TaskEntity
import com.lifeos.app.domain.SyncMath
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * The two halves of protocol 4's storage: a delta in, a day out.
 *
 * ### In — [toDelta]
 *
 * Turns an envelope into rows. Nothing is interpreted on the way: an entity's
 * whole JSON is kept, because the server sends whole rows and a client that
 * projected them onto the fields it happens to model today would quietly *lose*
 * anything it did not. The only fields lifted out are the ones something
 * queries or compares against a clock.
 *
 * ### Out — [compose]
 *
 * Rebuilds the one object every screen reads, [DashboardTodayDto], from the
 * rows, the documents and **the device's clock**.
 *
 * That shape is kept on purpose. `Predicates`, `DayModel`, `Overlay`,
 * `AgendaEpoch`, `Analytics`, the widget, the reminder coordinator and every
 * screen in the app are written against it, and UI_SPEC is the contract for
 * what they draw. Protocol 4 changes where the day comes from and what the
 * device works out for itself; it is not licence to redraw the app. So the
 * boundary moves and the composition stops at it: Room is still the only thing
 * the UI reads, and what it now reads is assembled from rows rather than
 * deserialised from a blob.
 *
 * **The four clock-dependent values are computed here**, in [SyncMath], and
 * never taken from a response:
 *
 * | value | how |
 * |---|---|
 * | `current` | `currentFrom`/`currentUntil` against the device clock |
 * | `dueReminders` | `dueFrom`/`dueUntil` and `notifiedAt` |
 * | `timeline` | `ribbon` + `lived`, cut at the device clock |
 * | `progress.improvementPct` | pace-adjusted by how far through the life-day it is |
 *
 * `pendingCelebrations` is the fifth and is not clock-dependent at all — it is
 * `goals.filter { celebrationPending }`, which the server used to send as its
 * own array.
 */
class SyncStore(private val json: kotlinx.serialization.json.Json = ApiClient.json) {

    /* ----------------------------------------------------------------- in */

    /**
     * An envelope, as rows.
     *
     * [etag] comes from the response headers rather than the body, and [nowMs]
     * is when it arrived — the status strip shows that, so "stale" stays a fact
     * about this device's clock rather than about the server's.
     */
    fun toDelta(
        envelope: SyncEnvelopeDto,
        etag: String?,
        clientId: String,
        nowMs: Long,
        baseUrl: String,
    ): SyncDelta = SyncDelta(
        reset = envelope.reset,
        habits = envelope.changed.habits.orEmpty().map {
            HabitEntity(id = it.id, json = encode(HabitWithTodayDto.serializer(), it))
        },
        tasks = envelope.changed.tasks.orEmpty().map(::taskRow),
        goals = envelope.changed.goals.orEmpty().map {
            GoalEntity(id = it.id, json = encode(GoalDto.serializer(), it))
        },
        properties = envelope.changed.properties.orEmpty().map {
            PropertyEntity(uid = it.uid, json = encode(AgentPropertyDto.serializer(), it))
        },
        quests = envelope.changed.quests.orEmpty().map {
            QuestEntity(id = it.id, json = encode(QuestDto.serializer(), it))
        },
        achievements = envelope.changed.achievements.orEmpty().map {
            AchievementEntity(id = it.id, json = encode(AchievementDto.serializer(), it))
        },
        deletedHabits = envelope.deleted.habits.orEmpty(),
        deletedTasks = envelope.deleted.tasks.orEmpty(),
        deletedGoals = envelope.deleted.goals.orEmpty(),
        deletedProperties = envelope.deleted.properties.orEmpty(),
        deletedQuests = envelope.deleted.quests.orEmpty(),
        deletedAchievements = envelope.deleted.achievements.orEmpty(),
        docs = docRows(envelope.docs),
        cursor = envelope.cursor.ifBlank { null },
        etag = etag,
        lifeDayDate = envelope.lifeDay.lifeDay,
        lifeDayStart = envelope.lifeDay.lifeDayStart,
        lifeDayEnd = envelope.lifeDay.lifeDayEnd,
        dayResetTime = envelope.lifeDay.dayResetTime,
        timezone = envelope.lifeDay.timezone,
        serverTime = envelope.serverTime.ifBlank { null },
        clientId = clientId,
        fetchedAt = nowMs,
        baseUrl = baseUrl,
    )

    private fun taskRow(task: TaskDto) = TaskEntity(
        id = task.id,
        status = task.status,
        slot = task.slot,
        kind = task.kind,
        showAt = task.showAt,
        currentFrom = task.currentFrom,
        currentUntil = task.currentUntil,
        dueFrom = task.dueFrom,
        dueUntil = task.dueUntil,
        notifiedAt = task.notifiedAt,
        json = encode(TaskDto.serializer(), task),
    )

    /**
     * Only the documents that actually arrived.
     *
     * A document absent from `docs` has **not changed** and its stored copy must
     * be left exactly as it is — writing nine rows on every delta would undo the
     * server's hashing work and make "completing a habit moves three documents"
     * into "completing a habit rewrites all nine".
     *
     * A document present as `null` is a different thing: for `activeSession` it
     * is a real value meaning the session was cleared. That becomes a row whose
     * json is null, so a reader can tell "cleared" from "never arrived".
     */
    private fun docRows(docs: JsonObject): List<SyncDocEntity> =
        docs.entries.map { (name, value) ->
            SyncDocEntity(
                name = name,
                json = if (value is JsonNull) null else value.toString(),
            )
        }

    private fun <T> encode(serializer: KSerializer<T>, value: T): String =
        json.encodeToString(serializer, value)

    /* ---------------------------------------------------------------- out */

    /** Everything Room holds, before the clock is applied. */
    data class Rows(
        val habits: List<HabitEntity> = emptyList(),
        val tasks: List<TaskEntity> = emptyList(),
        val goals: List<GoalEntity> = emptyList(),
        val properties: List<PropertyEntity> = emptyList(),
        val quests: List<QuestEntity> = emptyList(),
        val achievements: List<AchievementEntity> = emptyList(),
        val docs: List<SyncDocEntity> = emptyList(),
        val state: SyncStateEntity? = null,
    )

    /**
     * The rows, parsed once — everything about the day that does not depend on
     * what time it is.
     *
     * This is the expensive half, and separating it from [compose] is the reason
     * the clock can tick cheaply. Parsing is proportional to the whole
     * collection — 213 tasks is 242 KB of JSON on the measured database — and it
     * must happen only when Room actually changes. The clock, meanwhile, has to
     * move every few seconds or the now-marker freezes and a reminder fires
     * late. Doing both in one function would mean reparsing a quarter of a
     * megabyte every five seconds to move a marker; doing neither would mean
     * going back to a server that bakes the clock into a 2.26 MB payload, which
     * is the bug this release exists to remove.
     */
    data class Decoded(
        val state: SyncStateEntity,
        val tasks: List<TaskDto>,
        val habits: List<HabitWithTodayDto>,
        val goals: List<GoalDto>,
        val properties: List<AgentPropertyDto>,
        val quests: List<QuestDto>,
        val achievements: List<AchievementDto>,
        val agenda: AgendaDocDto,
        val ribbon: List<RibbonSegmentDto>,
        val lived: List<LoggedIntervalDto>,
        val progress: ProgressDocDto,
        val insights: InsightsDocDto,
        val activeSession: ActiveSessionDto?,
        val lifeDay: LifeDayDto,
        /** The raw `settings` document, or null if none has arrived yet. */
        val settingsJson: String?,
    )

    /**
     * Parse what Room holds.
     *
     * Returns null when there is no state row, meaning this installation has
     * never completed a sync. That is deliberately distinct from "a day with
     * nothing in it": the UI shows the first-run path for one and an empty day
     * for the other.
     */
    fun decode(rows: Rows): Decoded? {
        val state = rows.state ?: return null
        val docs = rows.docs.associateBy { it.name }
        return Decoded(
            state = state,
            tasks = rows.tasks.mapNotNull { decode(TaskDto.serializer(), it.json) },
            habits = rows.habits.mapNotNull { decode(HabitWithTodayDto.serializer(), it.json) },
            goals = rows.goals.mapNotNull { decode(GoalDto.serializer(), it.json) },
            properties = rows.properties.mapNotNull { decode(AgentPropertyDto.serializer(), it.json) },
            quests = rows.quests.mapNotNull { decode(QuestDto.serializer(), it.json) },
            achievements = rows.achievements.mapNotNull { decode(AchievementDto.serializer(), it.json) },
            agenda = doc(docs, SyncDocNames.AGENDA, AgendaDocDto.serializer()) ?: AgendaDocDto(),
            ribbon = docList(docs, SyncDocNames.RIBBON, RibbonSegmentDto.serializer()),
            lived = docList(docs, SyncDocNames.LIVED, LoggedIntervalDto.serializer()),
            progress = doc(docs, SyncDocNames.PROGRESS, ProgressDocDto.serializer()) ?: ProgressDocDto(),
            insights = doc(docs, SyncDocNames.INSIGHTS, InsightsDocDto.serializer()) ?: InsightsDocDto(),
            activeSession = doc(docs, SyncDocNames.ACTIVE_SESSION, ActiveSessionDto.serializer()),
            lifeDay = LifeDayDto(
                lifeDay = state.lifeDayDate,
                lifeDayStart = state.lifeDayStart,
                lifeDayEnd = state.lifeDayEnd,
                dayResetTime = state.dayResetTime,
                timezone = state.timezone,
            ),
            settingsJson = docs[SyncDocNames.SETTINGS]?.json,
        )
    }

    /**
     * The day, with the clock applied.
     *
     * Cheap on purpose: no parsing, no allocation beyond the four results. Safe
     * to call on a ticker, which is what makes the now-marker advance smoothly
     * between polls instead of jumping on each one.
     *
     * [nowMs] is the **device's** clock. Not the server's: §2 rule 1 exists
     * because the only clock that matters for display is the one next to the
     * screen.
     */
    fun compose(decoded: Decoded, nowMs: Long): DashboardTodayDto {
        val progress = decoded.progress

        /*
         * The four values the server stopped sending, and the fifth it stopped
         * deriving. Every one of them used to be baked into a payload, which is
         * why that payload could never be cached and had to be resent in full to
         * move a marker four pixels.
         */
        val current = SyncMath.currentAt(decoded.tasks, nowMs)
        val dueReminders = SyncMath.dueRemindersAt(decoded.tasks, nowMs)
        val timeline = SyncMath.composeTimeline(
            ribbon = decoded.ribbon,
            lived = decoded.lived,
            nowMs = nowMs,
        )
        val improvement = SyncMath.paceAdjustedImprovementPct(
            todayEfficiency = progress.efficiencyPct,
            yesterdayEfficiency = progress.yesterdayEfficiencyPct,
            dayFraction = SyncMath.dayFractionAt(decoded.lifeDay, nowMs),
        )

        return DashboardTodayDto(
            date = decoded.state.lifeDayDate,
            dayResetTime = decoded.state.dayResetTime,
            lifeDay = decoded.lifeDay,
            agenda = decoded.agenda.items,
            anytime = decoded.agenda.anytime,
            tasks = decoded.tasks,
            current = current,
            dueReminders = dueReminders,
            // Was its own array in the payload; it is a plain filter on goals,
            // and the protocol stopped sending what a client can derive.
            pendingCelebrations = decoded.goals.filter { it.celebrationPending },
            properties = decoded.properties,
            quests = decoded.quests,
            achievements = decoded.achievements,
            habits = decoded.habits,
            progress = UserProgressDto(
                totalXp = progress.totalXp,
                dailyXp = progress.dailyXp,
                dailyXpTarget = progress.dailyXpTarget,
                efficiencyPct = progress.efficiencyPct,
                improvementPct = improvement,
                yesterdayEfficiencyPct = progress.yesterdayEfficiencyPct,
                lastImprovementPulse = progress.lastImprovementPulse,
                growthStyle = progress.growthStyle,
            ),
            vsYesterday = decoded.insights.vsYesterday,
            pulse = decoded.insights.pulse,
            pulseExplanation = decoded.insights.pulseExplanation,
            goals = decoded.goals,
            consistency7 = decoded.insights.consistency7,
            xpSeries7 = decoded.insights.xpSeries7,
            activeSession = decoded.activeSession,
            timeline = timeline,
        )
    }

    private fun <T> doc(
        docs: Map<String, SyncDocEntity>,
        name: String,
        serializer: KSerializer<T>,
    ): T? {
        val text = docs[name]?.json ?: return null
        return decode(serializer, text)
    }

    private fun <T> docList(
        docs: Map<String, SyncDocEntity>,
        name: String,
        serializer: KSerializer<T>,
    ): List<T> {
        val text = docs[name]?.json ?: return emptyList()
        return decode(kotlinx.serialization.builtins.ListSerializer(serializer), text) ?: emptyList()
    }

    /**
     * Decode one row, and let one bad row be one bad row.
     *
     * `mapNotNull` over this is the whole error strategy for stored state: a
     * single habit whose JSON cannot be read drops that habit, rather than
     * throwing out of the flow and leaving the user looking at an empty day. The
     * old blob had the opposite property — one unparseable byte anywhere lost
     * everything, because it was all one document.
     */
    private fun <T> decode(serializer: KSerializer<T>, text: String): T? =
        runCatching { json.decodeFromString(serializer, text) }.getOrNull()
}
