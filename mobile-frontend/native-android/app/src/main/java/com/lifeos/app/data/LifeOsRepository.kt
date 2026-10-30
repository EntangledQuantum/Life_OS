package com.lifeos.app.data

import com.lifeos.app.data.api.AnalyticsDto
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.LifeOsApi
import com.lifeos.app.data.api.ProtocolMismatchDto
import com.lifeos.app.data.api.SettingsDto
import com.lifeos.app.data.api.SyncEnvelopeDto
import com.lifeos.app.data.api.SyncMutationDto
import com.lifeos.app.data.api.SyncMutations
import com.lifeos.app.data.api.SyncPushConflictDto
import com.lifeos.app.data.api.SyncPushRequestDto
import com.lifeos.app.data.db.AchievementDao
import com.lifeos.app.data.db.GoalDao
import com.lifeos.app.data.db.HabitDao
import com.lifeos.app.data.db.PendingWriteDao
import com.lifeos.app.data.db.PendingWriteEntity
import com.lifeos.app.data.db.PropertyDao
import com.lifeos.app.data.db.QuestDao
import com.lifeos.app.data.db.ServerSettingsDao
import com.lifeos.app.data.db.ServerSettingsEntity
import com.lifeos.app.data.db.SyncApplyDao
import com.lifeos.app.data.db.SyncDocDao
import com.lifeos.app.data.db.SyncStateDao
import com.lifeos.app.data.db.SyncStateEntity
import com.lifeos.app.data.db.TaskDao
import com.lifeos.app.data.sync.SyncStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flowOn
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
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import retrofit2.Response
import java.util.UUID

/** What every screen reads. Assembled from Room, never from a socket. */
data class TodayView(
    /**
     * The day, composed from Room's rows and this device's clock, with the
     * optimistic overlay applied.
     *
     * Still a [DashboardTodayDto] although the route of that name is gone. The
     * shape is what every screen, predicate and the widget are written against,
     * and UI_SPEC is the contract for what they draw; protocol 4 changed where
     * the day comes from, not what the app looks like.
     */
    val data: DashboardTodayDto?,
    /**
     * The server's settings.
     *
     * From the `settings` **document** under protocol 4, cached in its own row
     * so an upgrade does not briefly draw defaults over someone's preferences.
     * Defaults until one has ever arrived, which is honest: the app draws with
     * the documented defaults rather than hiding a screen.
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
 *
 * ### Protocol 4, in one paragraph
 *
 * The app holds a cursor. A poll sends it as `since` with the last `ETag` as
 * `If-None-Match`, and the server either answers `304` with nothing at all, or
 * sends the rows that moved, the ids to forget and the documents whose bytes
 * changed. That reply is applied to Room in one transaction and the cursor is
 * stored last. A write goes to `/sync/push` under a persisted mutation number
 * and its **reply carries the delta**, so a write is never followed by a
 * refetch. Artwork is a URL fetched once, ever. The contract is `docs/SYNC.md`.
 */
class LifeOsRepository(
    private val habitsDao: HabitDao,
    private val tasksDao: TaskDao,
    private val goalsDao: GoalDao,
    private val propertiesDao: PropertyDao,
    private val questsDao: QuestDao,
    private val achievementsDao: AchievementDao,
    private val docsDao: SyncDocDao,
    private val stateDao: SyncStateDao,
    private val applyDao: SyncApplyDao,
    private val settingsStore: ServerSettingsDao,
    private val writes: PendingWriteDao,
    private val prefs: ConnectionConfig,
    private val tokens: TokenSource,
    private val apiFactory: (String) -> LifeOsApi,
    private val store: SyncStore = SyncStore(),
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val json = ApiClient.json

    private val _connection = MutableStateFlow<ConnectionState>(ConnectionState.Probing)
    val connection: StateFlow<ConnectionState> = _connection.asStateFlow()

    private var consecutiveFailures = 0

    /** The drain and a manual refresh must not race each other's queue reads. */
    private val drainLock = Mutex()

    /**
     * One sync in flight at a time, and the extras are **dropped**, not queued.
     *
     * Far less load-bearing than it was — an unchanged poll is now 314 bytes or
     * zero, so polls cannot pile up the way 2.26 MB downloads did — but kept,
     * because a cold sync is still ~300 KB and a slow link plus an 8-second
     * timer could still overlap two of those. Dropped rather than queued,
     * because a poll tick asks for "the latest" and a request already in flight
     * answers that better than one started now.
     */
    private val refreshing = java.util.concurrent.atomic.AtomicBoolean(false)

    /* ------------------------------------------------------------- reading */

    /**
     * The rows, parsed. Recomputed only when Room actually changes.
     *
     * Eight sources, because the day is eight tables now instead of one blob.
     * Combined in two groups because `combine` is typed only to five, and
     * grouped rather than nested arbitrarily so each group is one `@Transaction`
     * worth of related state.
     */
    private val decoded: Flow<SyncStore.Decoded?> = combine(
        combine(
            habitsDao.observe(),
            tasksDao.observe(),
            goalsDao.observe(),
            propertiesDao.observe(),
            questsDao.observe(),
        ) { habits, tasks, goals, properties, quests ->
            SyncStore.Rows(
                habits = habits,
                tasks = tasks,
                goals = goals,
                properties = properties,
                quests = quests,
            )
        },
        combine(
            achievementsDao.observe(),
            docsDao.observe(),
            stateDao.observe(),
        ) { achievements, docs, state ->
            SyncStore.Rows(achievements = achievements, docs = docs, state = state)
        },
    ) { a, b ->
        store.decode(
            a.copy(achievements = b.achievements, docs = b.docs, state = b.state),
        )
    }
        /*
         * Off the main thread, deliberately.
         *
         * This parses every row the app holds — 242 KB of tasks on the measured
         * database. Collected into a `viewModelScope` state flow, that parse
         * would otherwise run on `Dispatchers.Main.immediate` and drop a frame
         * on the one list the user looks at every morning.
         */
        .flowOn(Dispatchers.Default)

    /**
     * The clock, as a flow.
     *
     * The now-marker, which task is current and which reminder is due are all
     * computed on this device now, so something has to make them move. It cannot
     * be the poll: an unchanged poll is a `304` that writes nothing to Room and
     * must cause **no recomposition at all**, which is the whole point of
     * sending `If-None-Match`. So the clock drives the clock, and the network
     * drives the data, and the two are independent — which is also why the
     * marker now advances smoothly instead of jumping once per poll.
     *
     * [CLOCK_TICK_MS] is five seconds: shorter than the old eight-second poll,
     * so no reminder fires later than it used to, and cheap because the parse is
     * upstream of it. A tick re-runs four pure functions over already-parsed
     * lists and nothing else.
     *
     * It stops when nothing is collecting — `today` is shared with
     * `WhileSubscribed`, so a backgrounded process ticks nothing.
     */
    private val clock: Flow<Long> = flow {
        while (true) {
            emit(now())
            delay(CLOCK_TICK_MS)
        }
    }

    val today: Flow<TodayView> = combine(
        decoded,
        settingsStore.observe(),
        writes.observeAll(),
        _connection,
        clock,
    ) { decodedRows, settingsRow, queued, state, nowMs ->
        val pending = queued.map(::toDomain).filter { it.state == WriteState.PENDING }
        val composed = decodedRows?.let { store.compose(it, nowMs) }
        val strandedUnnoticed = queued
            .map(::toDomain)
            .filter { it.state == WriteState.STRANDED && !it.noticeShown }

        TodayView(
            data = composed?.let { Overlay.apply(it, pending) },
            settings = settingsRow?.let { decodeSettings(it.payloadJson) } ?: SettingsDto(),
            fetchedAt = decodedRows?.state?.fetchedAt?.takeIf { it > 0 },
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
        .flowOn(Dispatchers.Default)

    val pendingWrites: Flow<List<PendingWrite>> =
        writes.observeAll().map { list -> list.map(::toDomain) }

    suspend fun dismissStrandedNotice() = writes.markStrandedNoticeShown()

    suspend fun retryAllStranded() = writes.retryAllStranded()

    suspend fun discardStranded() = writes.discardStranded()

    /* ------------------------------------------------------------ refresh */

    /**
     * Sync, and store what changed. Returns the new connection state.
     *
     * Called on resume, on the poll tick and on reconnect — and **not** after a
     * write any more, because `/sync/push` already answered with the delta that
     * write caused.
     */
    suspend fun refresh(): ConnectionState {
        val base = prefs.baseUrl()
        if (base.isNullOrBlank() || !tokens.hasToken()) {
            return ConnectionState.Unconfigured.also { _connection.value = it }
        }

        // Already syncing: let that one answer for both. See `refreshing`.
        if (!refreshing.compareAndSet(false, true)) return _connection.value
        try {
            return sync(base)
        } finally {
            refreshing.set(false)
        }
    }

    private suspend fun sync(base: String): ConnectionState {
        val api = apiFactory(base)
        val state = stateDao.get()
        // A cursor from a different server is meaningless. Sending it would at
        // best be answered with a reset and at worst be believed.
        val sameServer = state != null && isSameBase(state.baseUrl, base)
        val since = if (sameServer) state?.cursor else null
        val etag = if (sameServer) state?.etag else null

        val result = runCatching { api.sync(since = since, ifNoneMatch = etag) }

        val response = result.getOrElse { throwable ->
            return failed(throwable.message)
        }

        return when {
            /*
             * `304` — current, and the cheapest possible answer: no body, no
             * database write, no recomposition. Only `fetchedAt` moves, because
             * the status strip's "last updated" is a statement about when this
             * device last heard from the server, and it did just hear from it.
             */
            response.code() == 304 -> {
                if (state != null) stateDao.touch(now())
                consecutiveFailures = 0
                ConnectionState.Online.also { _connection.value = it }
            }

            response.isSuccessful -> {
                val body = response.body()
                if (body == null) {
                    failed("empty body")
                } else {
                    applyEnvelope(body, etagOf(response), base)
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

            else -> failed("HTTP ${response.code()}")
        }
    }

    private suspend fun failed(detail: String?): ConnectionState {
        consecutiveFailures++
        val state = ConnectionState.afterFailure(
            failures = consecutiveFailures,
            fetchedAt = stateDao.get()?.fetchedAt?.takeIf { it > 0 },
            now = now(),
            detail = detail,
        )
        _connection.value = state
        return state
    }

    /**
     * Apply a delta, then store the cursor — in that order, inside one
     * transaction.
     *
     * A `reset` is handled inside the transaction too, so a client that is told
     * to start again never renders the gap between "dropped everything" and
     * "applied the new state".
     */
    private suspend fun applyEnvelope(envelope: SyncEnvelopeDto, etag: String?, base: String) {
        val clientId = stateDao.get()?.clientId?.ifBlank { null } ?: newClientId()
        val delta = store.toDelta(
            envelope = envelope,
            etag = etag,
            clientId = clientId,
            nowMs = now(),
            baseUrl = base,
        )
        applyDao.apply(delta)

        /*
         * The `settings` document, into the row the UI already reads.
         *
         * Only when it actually arrived: a document is absent when it has not
         * changed, and writing defaults over the user's preferences because the
         * server had nothing new to say would be a bug with teeth.
         */
        val settingsJson = envelope.docs[com.lifeos.app.data.api.SyncDocNames.SETTINGS]
        if (settingsJson != null) {
            settingsStore.put(
                ServerSettingsEntity(payloadJson = settingsJson.toString(), fetchedAt = now()),
            )
        }
    }

    private fun etagOf(response: Response<*>): String? =
        response.headers()["ETag"]?.takeIf { it.isNotBlank() }

    private fun outdated(response: Response<*>): ConnectionState {
        val mismatch = runCatching {
            response.errorBody()?.string()?.let { json.decodeFromString<ProtocolMismatchDto>(it) }
        }.getOrNull() ?: ProtocolMismatchDto(
            error = "This app is too old for your Life OS",
            clientProtocol = ApiClient.clientProtocol,
        )
        return ConnectionState.Outdated(mismatch)
    }

    /**
     * This installation's id, generated once and kept.
     *
     * Stable per install, so the server can recognise this client's mutation
     * numbering. A reinstall is a new client and that is correct: it has no
     * queue and no cursor, so it is entitled to number from 1.
     */
    private suspend fun newClientId(): String {
        val existing = stateDao.get()
        if (existing != null && existing.clientId.isNotBlank()) return existing.clientId
        val id = UUID.randomUUID().toString()
        if (existing == null) {
            stateDao.put(SyncStateEntity(clientId = id))
        } else {
            stateDao.put(existing.copy(clientId = id))
        }
        return id
    }

    /**
     * Analytics for a range (§3.3) — the only screen-specific read left.
     *
     * Not cached in Room and not polled: it is a question the user asked once by
     * tapping a range chip. `7d` never reaches here at all, because the
     * `insights` document already carries it and therefore works offline.
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
     * The server's current life-day, from the sync state.
     *
     * What the guard compares a write's stamp against. Null when there has never
     * been a successful sync, which the guard treats as "cannot decide" rather
     * than as a mismatch.
     */
    suspend fun serverLifeDay(): String? = stateDao.get()?.lifeDayDate?.ifBlank { null }

    suspend fun pollInterval(base: Long): Long =
        PollIntervals.forAddress(prefs.baseUrl(), base)

    suspend fun emptyCacheTimeout(base: Long): Long =
        PollIntervals.emptyCacheTimeout(prefs.baseUrl(), base)

    /**
     * Saving a different address clears everything: a different server is a
     * different life.
     *
     * The cursor goes with it, and that matters more than it used to. A cursor
     * is only meaningful to the database that issued it — it carries that
     * database's epoch precisely so a cursor from somewhere else is refused —
     * and keeping one across a server change would mean asking a stranger what
     * changed since a number they have never seen.
     */
    suspend fun onServerChanged(newBaseUrl: String) {
        val existing = stateDao.get()
        if (existing != null && !isSameBase(existing.baseUrl, newBaseUrl)) {
            applyDao.clearAll()
            settingsStore.clear()
        }
        prefs.setBaseUrl(newBaseUrl)
        consecutiveFailures = 0
        _connection.value = ConnectionState.Probing
    }

    private fun isSameBase(stored: String, candidate: String): Boolean =
        stored == candidate || stored == ApiClient.normaliseBase(candidate)

    /* -------------------------------------------------------------- writes */

    /**
     * Enqueue a write, stamped with the life-day that is current *now*.
     *
     * The stamp is taken at the moment of the tap, which is the entire basis of
     * the guard: taking it in the worker would stamp every write with the day it
     * was finally sent, which is exactly the bug.
     *
     * No mutation number is assigned here. A number is assigned when the write
     * first reaches the wire, because the server refuses a batch with a hole in
     * it and a write the guard strands must not burn a number it will never use.
     */
    suspend fun enqueue(
        kind: WriteKind,
        targetId: String,
        payload: JsonObject = JsonObject(emptyMap()),
    ): Long {
        val stamp = serverLifeDay() ?: ""
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

    /**
     * `task.notified` — the de-dupe receipt (§8.4).
     *
     * Enqueued like every other write, and **posted even under do-not-disturb
     * and quiet hours**. That is a contract, not an optimisation: it is how the
     * server knows the item was surfaced, and skipping it while silenced means
     * every suppressed reminder fires the instant DND ends. An avalanche is
     * worse than the interruption that was being avoided.
     *
     * Day-independent, so the life-day guard never strands it — a receipt means
     * the same thing whatever day it is finally sent.
     */
    suspend fun markNotified(taskId: String): Long = enqueue(WriteKind.TASK_NOTIFIED, taskId)

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
     * `study.create` — the one write that is genuinely the user's and has no row
     * to hang off (§3.2).
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
     * Drain the queue through `/sync/push`, in order, honouring the life-day
     * guard.
     *
     * ### One request, not one per write
     *
     * The whole ready queue goes up in a single batch and the reply carries both
     * the per-mutation results and **the delta they caused**. So a tick is one
     * request and no refetch, where it used to be one request plus a 2.26 MB
     * re-read of a day the client had changed one row of.
     *
     * ### The numbering
     *
     * Ids are assigned here, in queue order, strictly one greater than the last.
     * The server refuses a batch with a hole — a hole means a mutation never
     * arrived, and half-applying the rest would record a number past it and make
     * the loss permanent and invisible. Three consequences:
     *
     *  - A write the guard strands never reaches this point, so it burns no
     *    number.
     *  - A number already assigned is **reused** on a retry, which is what makes
     *    a retry idempotent rather than a second habit completion.
     *  - The drain stops at the first write it cannot send, rather than skipping
     *    it. Order is not an implementation detail: a complete followed by an
     *    undo of the same habit must arrive in that order or the server ends up
     *    with the opposite of what the user did.
     *
     * Returns whether anything is still waiting, so the worker can ask to be
     * retried rather than guessing.
     */
    suspend fun drain(): DrainOutcome = drainLock.withLock {
        val base = prefs.baseUrl()
        if (base.isNullOrBlank() || !tokens.hasToken()) return DrainOutcome.NOT_CONFIGURED

        val queue = writes.pending()
        if (queue.isEmpty()) return DrainOutcome.EMPTY

        val api = apiFactory(base)
        val serverDay = serverLifeDay()
        var retryWanted = false

        // The batch, in queue order, stopping at the first write that cannot go.
        val batch = mutableListOf<Pair<PendingWriteEntity, SyncMutationDto>>()
        var nextId = (stateDao.get()?.lastMutationId ?: 0)

        for (entity in queue) {
            val write = toDomain(entity)

            if (entity.nextAttemptAt > now()) {
                // Still inside its own backoff window. Stop here rather than
                // reordering the queue around it.
                retryWanted = true
                break
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
                    // We have never synced, so we cannot compare. Wait rather
                    // than guess in either direction.
                    retryWanted = true
                    break
                }

                LifeDayGuard.Verdict.Send -> Unit
            }

            val mutationId = entity.mutationId ?: (nextId + 1).also { assigned ->
                // Recorded before the request goes out, so a process killed
                // mid-flight comes back knowing which number it used.
                writes.setMutationId(entity.id, assigned)
            }
            nextId = maxOf(nextId, mutationId)
            batch += entity to mutation(write, mutationId)
        }

        if (batch.isEmpty()) return if (retryWanted) DrainOutcome.RETRY else DrainOutcome.DRAINED

        val state = stateDao.get()
        val request = SyncPushRequestDto(
            clientId = state?.clientId?.ifBlank { null } ?: newClientId(),
            since = state?.cursor,
            mutations = batch.map { it.second },
        )

        val response = runCatching { api.push(request) }.getOrElse {
            batch.forEach { (entity, _) -> recordFailure(entity, it.message) }
            return DrainOutcome.RETRY
        }

        return when {
            response.isSuccessful -> {
                val body = response.body()
                    ?: return DrainOutcome.RETRY.also {
                        batch.forEach { (entity, _) -> recordFailure(entity, "empty body") }
                    }
                settle(body.results, batch)
                stateDao.setLastMutationId(maxOf(body.lastMutationId, nextId))
                /*
                 * The delta the writes caused, applied from the reply.
                 *
                 * This is the line that replaces the post-write refetch. The
                 * response is already the state after the write, so refetching
                 * here would be asking for something we were just handed.
                 */
                applyEnvelope(body.sync, etag = null, base = base)
                consecutiveFailures = 0
                _connection.value = ConnectionState.Online
                if (writes.pending().isNotEmpty()) DrainOutcome.RETRY else DrainOutcome.DRAINED
            }

            response.code() == 401 -> {
                tokens.clear()
                _connection.value = ConnectionState.Unauthorized
                DrainOutcome.UNAUTHORIZED
            }

            /*
             * `409` — this client's numbering and the server's disagree.
             *
             * A hole, or a database restored from under us. The server's own
             * `lastMutationId` is in the body, so the counter is reset to it and
             * every queued write forgets its assigned number; the next drain
             * renumbers from `lastMutationId + 1`. Retrying the same refused
             * batch instead would wedge the queue forever, which is precisely
             * what the numbering rules exist to prevent.
             */
            response.code() == 409 -> {
                val conflict = runCatching {
                    response.errorBody()?.string()
                        ?.let { json.decodeFromString<SyncPushConflictDto>(it) }
                }.getOrNull()
                if (conflict != null) stateDao.setLastMutationId(conflict.lastMutationId)
                writes.clearMutationIds()
                DrainOutcome.RETRY
            }

            response.code() == 426 -> {
                _connection.value = outdated(response)
                DrainOutcome.RETRY
            }

            // A 4xx that is not 401, 409 or 426 cannot be fixed by retrying.
            response.code() in 400..499 -> {
                batch.forEach { (entity, _) ->
                    writes.strand(
                        id = entity.id,
                        reason = StrandReason.REJECTED.name,
                        error = "The server refused this write (HTTP ${response.code()})",
                        attempts = entity.attempts + 1,
                    )
                }
                DrainOutcome.DRAINED
            }

            else -> {
                batch.forEach { (entity, _) -> recordFailure(entity, "HTTP ${response.code()}") }
                DrainOutcome.RETRY
            }
        }
    }

    /**
     * Resolve each write against what the server said about it.
     *
     * `duplicate` is dropped as a **success**, which is the rule that matters
     * most here: it covers a queue drained twice and a habit that was already
     * done today, and in both cases the tick is on screen and the thing did
     * happen. Showing the user a failure for it would be a lie.
     */
    private suspend fun settle(
        results: List<com.lifeos.app.data.api.SyncMutationResultDto>,
        batch: List<Pair<PendingWriteEntity, SyncMutationDto>>,
    ) {
        val byId = results.associateBy { it.id }
        for ((entity, mutation) in batch) {
            when (byId[mutation.id]?.status) {
                "applied", "duplicate" -> writes.delete(entity.id)

                "staleLifeDay" -> writes.strand(
                    id = entity.id,
                    reason = StrandReason.DAY_ROLLED_OVER.name,
                    error = byId[mutation.id]?.error
                        ?: "The life-day had already rolled over",
                    attempts = entity.attempts,
                )

                "rejected" -> writes.strand(
                    id = entity.id,
                    reason = StrandReason.REJECTED.name,
                    error = byId[mutation.id]?.error ?: "The server refused this write",
                    attempts = entity.attempts + 1,
                )

                // No result for a mutation we sent. Retry it under the same
                // number; the server will call it a duplicate if it did land.
                else -> recordFailure(entity, "No result returned")
            }
        }
    }

    private suspend fun recordFailure(entity: PendingWriteEntity, detail: String?) {
        val attempts = entity.attempts + 1
        if (attempts >= MAX_WRITE_ATTEMPTS) {
            writes.strand(
                id = entity.id,
                reason = StrandReason.ATTEMPTS_EXHAUSTED.name,
                error = "Failed $attempts times${detail?.let { ": $it" } ?: ""}",
                attempts = attempts,
            )
        } else {
            writes.recordFailure(
                id = entity.id,
                attempts = attempts,
                error = "Attempt $attempts failed${detail?.let { ": $it" } ?: ""}",
                nextAttemptAt = now() + LifeDayGuard.backoffMs(attempts),
            )
        }
    }

    /**
     * A queued write, as the mutation the protocol names.
     *
     * `source: "user"` on everything a human actually did — it is how the user's
     * agent tells their actions apart from the person's. `lifeDayDate` rides
     * along on every day-bound mutation, so the guard is enforced on the server
     * as well as here; the client's own check cannot catch a write that was
     * already in flight when the clock passed 04:00.
     */
    private fun mutation(write: PendingWrite, id: Long): SyncMutationDto {
        val payload = decodeObject(write.payloadJson)
        val name = when (write.kind) {
            WriteKind.HABIT_COMPLETE -> SyncMutations.HABIT_COMPLETE
            WriteKind.HABIT_UNDO -> SyncMutations.HABIT_UNDO
            WriteKind.TASK_COMPLETE -> SyncMutations.TASK_COMPLETE
            WriteKind.TASK_DISMISS -> SyncMutations.TASK_DISMISS
            WriteKind.TASK_NOTIFIED -> SyncMutations.TASK_NOTIFIED
            WriteKind.CELEBRATION_SEEN -> SyncMutations.GOAL_CELEBRATION_SEEN
            WriteKind.SETTINGS_PATCH -> SyncMutations.SETTINGS_PATCH
            WriteKind.SESSION_START -> SyncMutations.SESSION_SET
            WriteKind.SESSION_STOP -> SyncMutations.SESSION_CLEAR
            WriteKind.STUDY_LOG -> SyncMutations.STUDY_CREATE
        }
        val args: JsonObject = when (write.kind) {
            WriteKind.HABIT_COMPLETE -> JsonObject(
                mapOf(
                    "habitId" to JsonPrimitive(write.targetId),
                    "source" to JsonPrimitive("user"),
                ),
            )

            WriteKind.HABIT_UNDO -> JsonObject(
                mapOf("habitId" to JsonPrimitive(write.targetId)),
            )

            WriteKind.TASK_COMPLETE -> JsonObject(
                mapOf(
                    "taskId" to JsonPrimitive(write.targetId),
                    "source" to JsonPrimitive("user"),
                ),
            )

            WriteKind.TASK_DISMISS, WriteKind.TASK_NOTIFIED -> JsonObject(
                mapOf("taskId" to JsonPrimitive(write.targetId)),
            )

            WriteKind.CELEBRATION_SEEN -> JsonObject(
                mapOf("goalId" to JsonPrimitive(write.targetId)),
            )

            // The payload is already the shape these mutations want.
            WriteKind.SETTINGS_PATCH, WriteKind.STUDY_LOG, WriteKind.SESSION_START -> payload

            // `session.clear` takes no arguments: there is only one active
            // session, and clearing it needs no id.
            WriteKind.SESSION_STOP -> JsonObject(emptyMap())
        }
        return SyncMutationDto(
            id = id,
            name = name,
            args = args,
            lifeDayDate = write.lifeDayDate.takeIf { SyncMutations.isLifeDayBound(name) },
        )
    }

    private fun decodeObject(text: String): JsonObject =
        runCatching { json.decodeFromString(JsonObject.serializer(), text) }
            .getOrElse { JsonObject(emptyMap()) }

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

    companion object {
        /**
         * How often the clock-dependent values are recomputed.
         *
         * Five seconds, chosen against the old behaviour rather than for
         * smoothness: `dueReminders` used to arrive on an eight-second poll, so
         * anything at or below that fires no later than it used to. A tick costs
         * four pure functions over already-parsed lists.
         */
        const val CLOCK_TICK_MS = 5_000L
    }
}

enum class DrainOutcome { EMPTY, DRAINED, RETRY, UNAUTHORIZED, NOT_CONFIGURED }
