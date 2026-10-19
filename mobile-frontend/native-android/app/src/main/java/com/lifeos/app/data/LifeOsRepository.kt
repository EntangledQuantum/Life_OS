package com.lifeos.app.data

import com.lifeos.app.data.api.AnalyticsDto
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.LifeOsApi
import com.lifeos.app.data.api.ProtocolMismatchDto
import com.lifeos.app.data.api.SettingsDto
import com.lifeos.app.data.api.SourceBody
import com.lifeos.app.data.db.PendingWriteDao
import com.lifeos.app.data.db.PendingWriteEntity
import com.lifeos.app.data.db.ServerSettingsDao
import com.lifeos.app.data.db.ServerSettingsEntity
import com.lifeos.app.data.db.SnapshotDao
import com.lifeos.app.data.db.SnapshotEntity
import com.lifeos.app.domain.AnalyticsRange
import com.lifeos.app.domain.LifeDayGuard
import com.lifeos.app.domain.MAX_WRITE_ATTEMPTS
import com.lifeos.app.domain.Overlay
import com.lifeos.app.domain.PendingWrite
import com.lifeos.app.domain.StrandReason
import com.lifeos.app.domain.WriteKind
import com.lifeos.app.domain.WriteState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import retrofit2.Response

/** What every screen reads. Assembled from Room, never from a socket. */
data class TodayView(
    /** The cached snapshot with the optimistic overlay applied. */
    val data: DashboardTodayDto?,
    /**
     * The server's settings, from their own cached row.
     *
     * Defaults until the first `GET /api/v1/settings` lands, which is honest:
     * the app draws with the documented defaults rather than hiding a screen
     * because a second request has not arrived.
     */
    val settings: SettingsDto,
    val fetchedAt: Long?,
    val connection: ConnectionState,
    /** `refId`s with an unsent completion — the row's static pending dot. */
    val pendingTargets: Set<String>,
    val pendingCount: Int,
    /** Non-null exactly once, when writes have been stranded by the day guard. */
    val strandedNotice: StrandedNotice?,
)

/**
 * "2 changes from Tue 19 Oct couldn't be saved — the day had already rolled
 * over." Shown once, dismissible, never auto-retried and never re-dated.
 */
data class StrandedNotice(val count: Int, val lifeDayDate: String)

/**
 * Everything the UI reads, and the only path a write takes to the server.
 *
 * Room is the source of truth for rendering; the network is a background concern
 * that catches up. There is no "offline" gate on reads — Life OS lives on a LAN,
 * so a phone with no internet can reach it and a phone with perfect internet
 * cannot if the machine is asleep. Always attempt; type the failure.
 */
class LifeOsRepository(
    private val snapshots: SnapshotDao,
    private val settingsStore: ServerSettingsDao,
    private val writes: PendingWriteDao,
    private val prefs: ConnectionConfig,
    private val tokens: TokenSource,
    private val apiFactory: (String) -> LifeOsApi,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val json = ApiClient.json

    private val _connection = MutableStateFlow<ConnectionState>(ConnectionState.Probing)
    val connection: StateFlow<ConnectionState> = _connection.asStateFlow()

    private var consecutiveFailures = 0

    /** The drain and a manual refresh must not race each other's queue reads. */
    private val drainLock = Mutex()

    /* ------------------------------------------------------------- reading */

    val today: Flow<TodayView> = combine(
        snapshots.observe(),
        settingsStore.observe(),
        writes.observeAll(),
        _connection,
    ) { snapshot, settingsRow, queued, state ->
        val pending = queued.map(::toDomain).filter { it.state == WriteState.PENDING }
        val parsed = snapshot?.let { decode(it.payloadJson) }
        val strandedUnnoticed = queued
            .map(::toDomain)
            .filter { it.state == WriteState.STRANDED && !it.noticeShown }

        TodayView(
            data = parsed?.let { Overlay.apply(it, pending) },
            settings = settingsRow?.let { decodeSettings(it.payloadJson) } ?: SettingsDto(),
            fetchedAt = snapshot?.fetchedAt,
            connection = state,
            pendingTargets = Overlay.pendingTargets(pending),
            pendingCount = pending.size,
            strandedNotice = strandedUnnoticed
                .groupBy { it.lifeDayDate }
                .entries
                .firstOrNull()
                ?.let { StrandedNotice(it.value.size, it.key) },
        )
    }

    val pendingWrites: Flow<List<PendingWrite>> =
        writes.observeAll().map { list -> list.map(::toDomain) }

    suspend fun dismissStrandedNotice() = writes.markStrandedNoticeShown()

    suspend fun retryAllStranded() = writes.retryAllStranded()

    suspend fun discardStranded() = writes.discardStranded()

    /* ------------------------------------------------------------ refresh */

    /**
     * Fetch the dashboard and store it. Returns the new connection state.
     *
     * Called on resume, on the poll tick, on reconnect, and immediately after
     * any write is enqueued — never from a composition.
     */
    suspend fun refresh(): ConnectionState {
        val base = prefs.baseUrl()
        if (base.isNullOrBlank() || !tokens.hasToken()) {
            return ConnectionState.Unconfigured.also { _connection.value = it }
        }

        val api = apiFactory(base)
        val result = runCatching { api.today() }

        val response = result.getOrElse { throwable ->
            consecutiveFailures++
            val state = ConnectionState.afterFailure(
                failures = consecutiveFailures,
                fetchedAt = snapshots.get()?.fetchedAt,
                now = now(),
                detail = throwable.message,
            )
            _connection.value = state
            return state
        }

        return when {
            response.isSuccessful -> {
                val body = response.body()
                if (body == null) {
                    consecutiveFailures++
                    ConnectionState.afterFailure(
                        consecutiveFailures, snapshots.get()?.fetchedAt, now(), "empty body",
                    ).also { _connection.value = it }
                } else {
                    store(body, base)
                    // Best-effort, and deliberately after the snapshot is
                    // stored: a settings fetch that fails must not discard a
                    // dashboard that succeeded, and it must not move the
                    // connection state — the screen the user is looking at is
                    // already drawn and correct.
                    refreshSettings(api)
                    consecutiveFailures = 0
                    ConnectionState.Online.also { _connection.value = it }
                }
            }

            response.code() == 401 -> {
                // Clear the token and stop. Never retry a 401 in a loop — that is
                // how an app locks a user out of a server that is working fine.
                tokens.clear()
                ConnectionState.Unauthorized.also { _connection.value = it }
            }

            response.code() == 426 -> outdated(response).also { _connection.value = it }

            else -> {
                consecutiveFailures++
                ConnectionState.afterFailure(
                    consecutiveFailures,
                    snapshots.get()?.fetchedAt,
                    now(),
                    "HTTP ${response.code()}",
                ).also { _connection.value = it }
            }
        }
    }

    private fun outdated(response: Response<*>): ConnectionState {
        val mismatch = runCatching {
            response.errorBody()?.string()?.let { json.decodeFromString<ProtocolMismatchDto>(it) }
        }.getOrNull() ?: ProtocolMismatchDto(
            error = "This app is too old for your Life OS",
            clientProtocol = ApiClient.clientProtocol,
        )
        return ConnectionState.Outdated(mismatch)
    }

    private suspend fun store(body: DashboardTodayDto, baseUrl: String) {
        snapshots.put(
            SnapshotEntity(
                payloadJson = json.encodeToString(DashboardTodayDto.serializer(), body),
                fetchedAt = now(),
                lifeDayDate = body.lifeDay.lifeDay.ifBlank { body.date },
                baseUrl = baseUrl,
            ),
        )
    }

    private suspend fun refreshSettings(api: LifeOsApi) {
        val response = runCatching { api.settings() }.getOrNull() ?: return
        val body = response.body().takeIf { response.isSuccessful } ?: return
        settingsStore.put(
            ServerSettingsEntity(
                payloadJson = json.encodeToString(SettingsDto.serializer(), body),
                fetchedAt = now(),
            ),
        )
    }

    /**
     * Analytics for a range (§3.3) — the only screen-specific read.
     *
     * Not cached in Room and not polled: it is a question the user asked once by
     * tapping a range chip. `7d` never reaches here at all, because the
     * dashboard snapshot already carries it and therefore works offline.
     */
    suspend fun analytics(range: AnalyticsRange): Result<AnalyticsDto> {
        val base = prefs.baseUrl()
        if (base.isNullOrBlank() || !tokens.hasToken()) {
            return Result.failure(IllegalStateException("Not connected"))
        }
        val response = runCatching { apiFactory(base).analytics(range.wire) }
            .getOrElse { return Result.failure(it) }
        val body = response.body()
        return when {
            response.isSuccessful && body != null -> Result.success(body)
            else -> Result.failure(IllegalStateException("HTTP ${response.code()}"))
        }
    }

    /**
     * The server's current life-day, from the last snapshot.
     *
     * This is what the guard compares a write's stamp against. Null when there
     * has never been a successful fetch, which the guard treats as "cannot
     * decide" rather than as a mismatch.
     */
    suspend fun serverLifeDay(): String? = snapshots.get()?.lifeDayDate?.ifBlank { null }

    /** Saving a different address clears the cache: a different server is a different life. */
    suspend fun onServerChanged(newBaseUrl: String) {
        val existing = snapshots.get()
        if (existing != null && existing.baseUrl != ApiClient.normaliseBase(newBaseUrl) &&
            existing.baseUrl != newBaseUrl
        ) {
            snapshots.clear()
            settingsStore.clear()
        }
        prefs.setBaseUrl(newBaseUrl)
        consecutiveFailures = 0
        _connection.value = ConnectionState.Probing
    }

    /* -------------------------------------------------------------- writes */

    /**
     * Enqueue a write, stamped with the life-day that is current *now*.
     *
     * The stamp is taken at the moment of the tap, which is the entire basis of
     * the guard: taking it in the worker would stamp every write with the day it
     * was finally sent, which is exactly the bug.
     */
    suspend fun enqueue(
        kind: WriteKind,
        targetId: String,
        payload: JsonObject = JsonObject(emptyMap()),
    ): Long {
        val stamp = serverLifeDay() ?: snapshots.get()?.lifeDayDate ?: ""
        return writes.insert(
            PendingWriteEntity(
                kind = kind.name,
                targetId = targetId,
                payloadJson = json.encodeToString(JsonObject.serializer(), payload),
                lifeDayDate = stamp,
                enqueuedAt = now(),
            ),
        )
    }

    /** Tick a habit or a task. One entry point, so the row does not care which. */
    suspend fun complete(source: String, refId: String): Long = enqueue(
        kind = if (source == "habit") WriteKind.HABIT_COMPLETE else WriteKind.TASK_COMPLETE,
        targetId = refId,
    )

    suspend fun undoHabit(habitId: String): Long = enqueue(WriteKind.HABIT_UNDO, habitId)

    suspend fun markCelebrationSeen(goalId: String): Long =
        enqueue(WriteKind.CELEBRATION_SEEN, goalId)

    suspend fun patchSettings(key: String, value: Boolean): Long = enqueue(
        kind = WriteKind.SETTINGS_PATCH,
        targetId = key,
        payload = JsonObject(mapOf(key to JsonPrimitive(value))),
    )

    suspend fun patchSettings(key: String, value: String): Long = enqueue(
        kind = WriteKind.SETTINGS_PATCH,
        targetId = key,
        payload = JsonObject(mapOf(key to JsonPrimitive(value))),
    )

    suspend fun patchSettings(key: String, value: Int): Long = enqueue(
        kind = WriteKind.SETTINGS_PATCH,
        targetId = key,
        payload = JsonObject(mapOf(key to JsonPrimitive(value))),
    )

    /** Put a task away without doing it. Day-independent, so never stranded. */
    suspend fun dismissTask(taskId: String): Long = enqueue(WriteKind.TASK_DISMISS, taskId)

    /**
     * Set what you are doing now.
     *
     * `startedAt` is deliberately not sent: the server stamps it, and a phone
     * with a drifting clock would otherwise write a session that started in the
     * future. Not day-independent — a session belongs to the day it was in.
     */
    suspend fun startSession(activity: String): Long = enqueue(
        kind = WriteKind.SESSION_START,
        targetId = activity,
        payload = JsonObject(mapOf("activity" to JsonPrimitive(activity))),
    )

    suspend fun stopSession(): Long = enqueue(WriteKind.SESSION_STOP, "active")

    /**
     * `POST /api/v1/study` — the one write that is genuinely the user's and has
     * no row to hang off (§3.2).
     *
     * The quality flag is not cosmetic: `inspired`, `feynman` and `retrieval`
     * carry XP multipliers, so sending the wrong one quietly mis-pays the day.
     */
    suspend fun logStudy(title: String, minutes: Int, qualityFlag: String): Long = enqueue(
        kind = WriteKind.STUDY_LOG,
        targetId = title,
        payload = JsonObject(
            mapOf(
                "title" to JsonPrimitive(title),
                "durationMinutes" to JsonPrimitive(minutes),
                "qualityFlag" to JsonPrimitive(qualityFlag),
                // How the agent tells its own writes from the person's.
                "source" to JsonPrimitive("user"),
            ),
        ),
    )

    /**
     * Drain the queue, in order, honouring the life-day guard.
     *
     * Called by the `WorkManager` worker. Returns whether anything is still
     * waiting, so the worker can ask to be retried rather than guessing.
     */
    suspend fun drain(): DrainOutcome = drainLock.withLock {
        val base = prefs.baseUrl()
        if (base.isNullOrBlank() || !tokens.hasToken()) return DrainOutcome.NOT_CONFIGURED

        val queue = writes.pending()
        if (queue.isEmpty()) return DrainOutcome.EMPTY

        val api = apiFactory(base)
        val serverDay = serverLifeDay()
        var retryWanted = false

        for (entity in queue) {
            val write = toDomain(entity)
            if (entity.nextAttemptAt > now()) {
                // Still inside its own backoff window. Leave it; a hot-looping
                // write must not starve the rest of the queue.
                retryWanted = true
                continue
            }

            when (LifeDayGuard.verdict(write.kind, write.lifeDayDate, serverDay)) {
                LifeDayGuard.Verdict.Strand -> {
                    // The day rolled over under this write. A habit completion
                    // replayed after 04:00 lands on the wrong day and silently
                    // corrupts a streak, which is strictly worse than losing it.
                    writes.strand(
                        id = entity.id,
                        reason = StrandReason.DAY_ROLLED_OVER.name,
                        error = "Stamped ${write.lifeDayDate}, server is now $serverDay",
                        attempts = entity.attempts,
                    )
                    continue
                }

                LifeDayGuard.Verdict.Unknown -> {
                    // We have never had a snapshot, so we cannot compare. Wait
                    // rather than guess in either direction.
                    retryWanted = true
                    continue
                }

                LifeDayGuard.Verdict.Send -> Unit
            }

            when (send(api, write)) {
                SendResult.OK -> writes.delete(entity.id)

                SendResult.UNAUTHORIZED -> {
                    tokens.clear()
                    _connection.value = ConnectionState.Unauthorized
                    return DrainOutcome.UNAUTHORIZED
                }

                SendResult.REJECTED -> writes.strand(
                    id = entity.id,
                    reason = StrandReason.REJECTED.name,
                    error = "The server refused this write",
                    attempts = entity.attempts + 1,
                )

                SendResult.RETRY -> {
                    val attempts = entity.attempts + 1
                    if (attempts >= MAX_WRITE_ATTEMPTS) {
                        writes.strand(
                            id = entity.id,
                            reason = StrandReason.ATTEMPTS_EXHAUSTED.name,
                            error = "Failed $attempts times",
                            attempts = attempts,
                        )
                    } else {
                        writes.recordFailure(
                            id = entity.id,
                            attempts = attempts,
                            error = "Attempt $attempts failed",
                            nextAttemptAt = now() + LifeDayGuard.backoffMs(attempts),
                        )
                        retryWanted = true
                    }
                }
            }
        }

        return if (retryWanted) DrainOutcome.RETRY else DrainOutcome.DRAINED
    }

    private enum class SendResult { OK, RETRY, REJECTED, UNAUTHORIZED }

    private suspend fun send(api: LifeOsApi, write: PendingWrite): SendResult {
        val response = runCatching {
            when (write.kind) {
                WriteKind.HABIT_COMPLETE -> api.completeHabit(write.targetId, SourceBody())
                WriteKind.HABIT_UNDO -> api.undoHabit(write.targetId)
                WriteKind.TASK_COMPLETE -> api.completeTask(write.targetId, SourceBody())
                WriteKind.TASK_DISMISS -> api.dismissTask(write.targetId)
                WriteKind.TASK_NOTIFIED -> api.taskNotified(write.targetId)
                WriteKind.CELEBRATION_SEEN -> api.celebrationSeen(write.targetId)
                WriteKind.SETTINGS_PATCH -> api.patchSettings(decodeObject(write.payloadJson))
                WriteKind.SESSION_START -> api.startSession(decodeObject(write.payloadJson))
                WriteKind.SESSION_STOP -> api.stopSession()
                WriteKind.STUDY_LOG -> api.logStudy(decodeObject(write.payloadJson))
            }
        }.getOrElse { return SendResult.RETRY }

        return when {
            response.isSuccessful -> SendResult.OK

            // A habit that was already completed today. Success, silently: no
            // toast, no retry. The user's intent was "this is done", and it is.
            response.code() == 409 && write.kind == WriteKind.HABIT_COMPLETE -> SendResult.OK

            response.code() == 401 -> SendResult.UNAUTHORIZED

            // 404 on a target the server no longer has, or a malformed body:
            // retrying cannot fix either, so strand it with its error rather
            // than burning five attempts.
            response.code() in 400..499 -> SendResult.REJECTED

            else -> SendResult.RETRY
        }
    }

    private fun decodeObject(text: String): JsonObject =
        runCatching { json.decodeFromString(JsonObject.serializer(), text) }
            .getOrElse { JsonObject(emptyMap()) }

    private fun decode(payload: String): DashboardTodayDto? =
        runCatching { json.decodeFromString(DashboardTodayDto.serializer(), payload) }.getOrNull()

    private fun decodeSettings(payload: String): SettingsDto? =
        runCatching { json.decodeFromString(SettingsDto.serializer(), payload) }.getOrNull()

    private fun toDomain(e: PendingWriteEntity) = PendingWrite(
        id = e.id,
        kind = runCatching { WriteKind.valueOf(e.kind) }.getOrElse { WriteKind.TASK_COMPLETE },
        targetId = e.targetId,
        payloadJson = e.payloadJson,
        lifeDayDate = e.lifeDayDate,
        enqueuedAt = e.enqueuedAt,
        attempts = e.attempts,
        lastError = e.lastError,
        state = runCatching { WriteState.valueOf(e.state) }.getOrElse { WriteState.PENDING },
        strandReason = e.strandReason?.let { r -> runCatching { StrandReason.valueOf(r) }.getOrNull() },
        noticeShown = e.noticeShown,
    )
}

enum class DrainOutcome { EMPTY, DRAINED, RETRY, UNAUTHORIZED, NOT_CONFIGURED }
