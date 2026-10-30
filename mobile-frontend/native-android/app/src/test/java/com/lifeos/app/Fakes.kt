package com.lifeos.app

import com.lifeos.app.data.ConnectionConfig
import com.lifeos.app.data.TokenSource
import com.lifeos.app.data.api.AnalyticsDailyDto
import com.lifeos.app.data.api.AnalyticsDto
import com.lifeos.app.data.api.AuthMeDto
import com.lifeos.app.data.api.HealthDto
import com.lifeos.app.data.api.LifeOsApi
import com.lifeos.app.data.api.PairClaimRequest
import com.lifeos.app.data.api.PairClaimResponse
import com.lifeos.app.data.api.ProtocolDto
import com.lifeos.app.data.api.SyncEnvelopeDto
import com.lifeos.app.data.api.SyncPushRequestDto
import com.lifeos.app.data.api.SyncPushResponseDto
import com.lifeos.app.data.db.AchievementDao
import com.lifeos.app.data.db.AchievementEntity
import com.lifeos.app.data.db.GoalDao
import com.lifeos.app.data.db.GoalEntity
import com.lifeos.app.data.db.HabitDao
import com.lifeos.app.data.db.HabitEntity
import com.lifeos.app.data.db.PendingWriteDao
import com.lifeos.app.data.db.PendingWriteEntity
import com.lifeos.app.data.db.PropertyDao
import com.lifeos.app.data.db.PropertyEntity
import com.lifeos.app.data.db.QuestDao
import com.lifeos.app.data.db.QuestEntity
import com.lifeos.app.data.db.ServerSettingsDao
import com.lifeos.app.data.db.ServerSettingsEntity
import com.lifeos.app.data.db.SyncApplyDao
import com.lifeos.app.data.db.SyncDocDao
import com.lifeos.app.data.db.SyncDocEntity
import com.lifeos.app.data.db.SyncStateDao
import com.lifeos.app.data.db.SyncStateEntity
import com.lifeos.app.data.db.TaskDao
import com.lifeos.app.data.db.TaskEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.Response

/*
 * In-memory stand-ins.
 *
 * The parts of this app worth testing — the life-day guard, the queue's ordering
 * and retry, the mutation numbering, the clock-dependent arithmetic — need no
 * server and no device, which is why they are tested against these rather than
 * against the user's live Life OS. Nothing here opens a socket.
 */

/**
 * The six collections, the nine documents and the one state row, in memory.
 *
 * One object rather than eight unrelated fakes, because the thing worth testing
 * is how a *delta* lands across all of them at once: a reset has to clear
 * everything, a tombstone has to remove from the right table, and the cursor
 * must not advance unless the rest of it did. It subclasses the real
 * [SyncApplyDao], so the ordering in `apply` that the tests assert is the
 * production code's own and not a copy of it.
 */
class FakeSyncDb : SyncApplyDao() {

    val habitRows = MutableStateFlow<List<HabitEntity>>(emptyList())
    val taskRows = MutableStateFlow<List<TaskEntity>>(emptyList())
    val goalRows = MutableStateFlow<List<GoalEntity>>(emptyList())
    val propertyRows = MutableStateFlow<List<PropertyEntity>>(emptyList())
    val questRows = MutableStateFlow<List<QuestEntity>>(emptyList())
    val achievementRows = MutableStateFlow<List<AchievementEntity>>(emptyList())
    val docRows = MutableStateFlow<List<SyncDocEntity>>(emptyList())
    val stateRow = MutableStateFlow<SyncStateEntity?>(null)

    /* ------------------------------------------------------------- upserts */

    override suspend fun upsertHabits(rows: List<HabitEntity>) {
        habitRows.value = merge(habitRows.value, rows) { it.id }
    }

    override suspend fun upsertTasks(rows: List<TaskEntity>) {
        taskRows.value = merge(taskRows.value, rows) { it.id }
    }

    override suspend fun upsertGoals(rows: List<GoalEntity>) {
        goalRows.value = merge(goalRows.value, rows) { it.id }
    }

    override suspend fun upsertProperties(rows: List<PropertyEntity>) {
        propertyRows.value = merge(propertyRows.value, rows) { it.uid }
    }

    override suspend fun upsertQuests(rows: List<QuestEntity>) {
        questRows.value = merge(questRows.value, rows) { it.id }
    }

    override suspend fun upsertAchievements(rows: List<AchievementEntity>) {
        achievementRows.value = merge(achievementRows.value, rows) { it.id }
    }

    override suspend fun upsertDocs(rows: List<SyncDocEntity>) {
        docRows.value = merge(docRows.value, rows) { it.name }
    }

    /**
     * `INSERT OR REPLACE`, by key, preserving the order rows first appeared.
     *
     * The order matters only so that assertions can be written against a stable
     * list; SQLite makes no such promise and nothing in the app depends on one.
     */
    private fun <T, K> merge(existing: List<T>, incoming: List<T>, key: (T) -> K): List<T> {
        val byKey = LinkedHashMap<K, T>()
        existing.forEach { byKey[key(it)] = it }
        incoming.forEach { byKey[key(it)] = it }
        return byKey.values.toList()
    }

    /* ------------------------------------------------------------- deletes */

    override suspend fun deleteHabits(ids: List<String>) {
        habitRows.value = habitRows.value.filterNot { it.id in ids }
    }

    override suspend fun deleteTasks(ids: List<String>) {
        taskRows.value = taskRows.value.filterNot { it.id in ids }
    }

    override suspend fun deleteGoals(ids: List<String>) {
        goalRows.value = goalRows.value.filterNot { it.id in ids }
    }

    override suspend fun deleteProperties(ids: List<String>) {
        propertyRows.value = propertyRows.value.filterNot { it.uid in ids }
    }

    override suspend fun deleteQuests(ids: List<String>) {
        questRows.value = questRows.value.filterNot { it.id in ids }
    }

    override suspend fun deleteAchievements(ids: List<String>) {
        achievementRows.value = achievementRows.value.filterNot { it.id in ids }
    }

    /* -------------------------------------------------------------- clears */

    override suspend fun clearHabits() {
        habitRows.value = emptyList()
    }

    override suspend fun clearTasks() {
        taskRows.value = emptyList()
    }

    override suspend fun clearGoals() {
        goalRows.value = emptyList()
    }

    override suspend fun clearProperties() {
        propertyRows.value = emptyList()
    }

    override suspend fun clearQuests() {
        questRows.value = emptyList()
    }

    override suspend fun clearAchievements() {
        achievementRows.value = emptyList()
    }

    override suspend fun clearDocs() {
        docRows.value = emptyList()
    }

    override suspend fun clearState() {
        stateRow.value = null
    }

    /* --------------------------------------------------------------- state */

    override suspend fun state(): SyncStateEntity? = stateRow.value

    override suspend fun put(state: SyncStateEntity) {
        stateRow.value = state
    }

    override suspend fun advance(
        cursor: String?,
        etag: String?,
        lifeDayDate: String,
        lifeDayStart: String?,
        lifeDayEnd: String?,
        dayResetTime: String,
        timezone: String?,
        serverTime: String?,
        fetchedAt: Long,
        baseUrl: String,
    ) {
        stateRow.value = stateRow.value?.copy(
            cursor = cursor,
            etag = etag,
            lifeDayDate = lifeDayDate,
            lifeDayStart = lifeDayStart,
            lifeDayEnd = lifeDayEnd,
            dayResetTime = dayResetTime,
            timezone = timezone,
            serverTime = serverTime,
            fetchedAt = fetchedAt,
            baseUrl = baseUrl,
        )
    }

    /* ----------------------------------------------- the DAOs, over the same state */

    val habits = object : HabitDao {
        override fun observe(): Flow<List<HabitEntity>> = habitRows
        override suspend fun upsert(rows: List<HabitEntity>) = upsertHabits(rows)
        override suspend fun deleteByIds(ids: List<String>) = deleteHabits(ids)
        override suspend fun clear() = clearHabits()
        override suspend fun count(): Int = habitRows.value.size
    }

    val tasks = object : TaskDao {
        override fun observe(): Flow<List<TaskEntity>> = taskRows
        override suspend fun upsert(rows: List<TaskEntity>) = upsertTasks(rows)
        override suspend fun deleteByIds(ids: List<String>) = deleteTasks(ids)
        override suspend fun clear() = clearTasks()
        override suspend fun count(): Int = taskRows.value.size
        override suspend fun remindable(): List<TaskEntity> = taskRows.value.filter {
            it.dueFrom != null &&
                it.notifiedAt.isNullOrEmpty() &&
                it.status != "done" &&
                it.status != "dismissed"
        }
    }

    val goals = object : GoalDao {
        override fun observe(): Flow<List<GoalEntity>> = goalRows
        override suspend fun upsert(rows: List<GoalEntity>) = upsertGoals(rows)
        override suspend fun deleteByIds(ids: List<String>) = deleteGoals(ids)
        override suspend fun clear() = clearGoals()
    }

    val properties = object : PropertyDao {
        override fun observe(): Flow<List<PropertyEntity>> = propertyRows
        override suspend fun upsert(rows: List<PropertyEntity>) = upsertProperties(rows)
        override suspend fun deleteByIds(ids: List<String>) = deleteProperties(ids)
        override suspend fun clear() = clearProperties()
    }

    val quests = object : QuestDao {
        override fun observe(): Flow<List<QuestEntity>> = questRows
        override suspend fun upsert(rows: List<QuestEntity>) = upsertQuests(rows)
        override suspend fun deleteByIds(ids: List<String>) = deleteQuests(ids)
        override suspend fun clear() = clearQuests()
    }

    val achievements = object : AchievementDao {
        override fun observe(): Flow<List<AchievementEntity>> = achievementRows
        override suspend fun upsert(rows: List<AchievementEntity>) = upsertAchievements(rows)
        override suspend fun deleteByIds(ids: List<String>) = deleteAchievements(ids)
        override suspend fun clear() = clearAchievements()
    }

    val docs = object : SyncDocDao {
        override fun observe(): Flow<List<SyncDocEntity>> = docRows
        override suspend fun upsert(rows: List<SyncDocEntity>) = upsertDocs(rows)
        override suspend fun clear() = clearDocs()
    }

    val syncState = object : SyncStateDao {
        override fun observe(): Flow<SyncStateEntity?> = stateRow
        override suspend fun get(): SyncStateEntity? = stateRow.value
        override suspend fun put(state: SyncStateEntity) {
            stateRow.value = state
        }

        override suspend fun clear() {
            stateRow.value = null
        }

        override suspend fun advance(
            cursor: String?,
            etag: String?,
            lifeDayDate: String,
            lifeDayStart: String?,
            lifeDayEnd: String?,
            dayResetTime: String,
            timezone: String?,
            serverTime: String?,
            fetchedAt: Long,
            baseUrl: String,
        ) = this@FakeSyncDb.advance(
            cursor, etag, lifeDayDate, lifeDayStart, lifeDayEnd,
            dayResetTime, timezone, serverTime, fetchedAt, baseUrl,
        )

        override suspend fun touch(fetchedAt: Long) {
            stateRow.value = stateRow.value?.copy(fetchedAt = fetchedAt)
        }

        override suspend fun setLastMutationId(id: Long) {
            stateRow.value = stateRow.value?.copy(lastMutationId = id)
        }
    }
}

class FakeServerSettingsDao(initial: ServerSettingsEntity? = null) : ServerSettingsDao {
    private val state = MutableStateFlow(initial)
    override fun observe(): Flow<ServerSettingsEntity?> = state
    override suspend fun put(settings: ServerSettingsEntity) {
        state.value = settings
    }

    override suspend fun clear() {
        state.value = null
    }
}

class FakePendingWriteDao : PendingWriteDao {
    private val rows = MutableStateFlow<List<PendingWriteEntity>>(emptyList())
    private var nextId = 1L

    val all: List<PendingWriteEntity> get() = rows.value

    override fun observeAll(): Flow<List<PendingWriteEntity>> = rows

    override suspend fun pending(): List<PendingWriteEntity> =
        rows.value.filter { it.state == "PENDING" }.sortedWith(
            compareBy({ it.enqueuedAt }, { it.id }),
        )

    override fun observePending(): Flow<List<PendingWriteEntity>> =
        rows.map { list -> list.filter { it.state == "PENDING" } }

    override fun observeUnnoticedStranded(): Flow<List<PendingWriteEntity>> =
        rows.map { list -> list.filter { it.state == "STRANDED" && !it.noticeShown } }

    override suspend fun insert(write: PendingWriteEntity): Long {
        val id = nextId++
        rows.value = rows.value + write.copy(id = id)
        return id
    }

    override suspend fun delete(id: Long) {
        rows.value = rows.value.filterNot { it.id == id }
    }

    override suspend fun recordFailure(id: Long, attempts: Int, error: String?, nextAttemptAt: Long) {
        rows.value = rows.value.map {
            if (it.id == id) {
                it.copy(attempts = attempts, lastError = error, nextAttemptAt = nextAttemptAt)
            } else {
                it
            }
        }
    }

    override suspend fun strand(id: Long, reason: String, error: String?, attempts: Int) {
        rows.value = rows.value.map {
            if (it.id == id) {
                it.copy(
                    state = "STRANDED",
                    strandReason = reason,
                    lastError = error,
                    attempts = attempts,
                )
            } else {
                it
            }
        }
    }

    override suspend fun markStrandedNoticeShown() {
        rows.value = rows.value.map {
            if (it.state == "STRANDED") it.copy(noticeShown = true) else it
        }
    }

    override suspend fun retryAllStranded() {
        rows.value = rows.value.map {
            if (it.state == "STRANDED") {
                it.copy(
                    state = "PENDING",
                    attempts = 0,
                    lastError = null,
                    strandReason = null,
                    nextAttemptAt = 0,
                )
            } else {
                it
            }
        }
    }

    override suspend fun clear() {
        rows.value = emptyList()
    }

    override suspend fun discardStranded() {
        rows.value = rows.value.filterNot { it.state == "STRANDED" }
    }

    override suspend fun setMutationId(id: Long, mutationId: Long) {
        rows.value = rows.value.map {
            if (it.id == id) it.copy(mutationId = mutationId) else it
        }
    }

    override suspend fun clearMutationIds() {
        rows.value = rows.value.map {
            if (it.state == "PENDING") it.copy(mutationId = null) else it
        }
    }
}

class FakeConfig(private var url: String? = "http://127.0.0.1:8787") : ConnectionConfig {
    override suspend fun baseUrl(): String? = url
    override suspend fun setBaseUrl(url: String) {
        this.url = url
    }
}

class FakeToken(private val value: String? = "test-token") : TokenSource {
    override fun token(): String? = value
}

/**
 * A scripted protocol 4 API.
 *
 * Each call appends to [calls] in order, which is how the queue's ordering is
 * asserted: a complete followed by an undo must arrive in that order, or the
 * server ends up with the opposite of what the user did. [pushes] keeps every
 * request body, so the mutation numbering and the life-day stamps can be
 * checked as the server would see them.
 */
class FakeApi(
    private val envelope: SyncEnvelopeDto = SyncEnvelopeDto(),
    var syncCode: Int = 200,
    /** Scripted `/sync/push` outcome. */
    var pushCode: Int = 200,
    var pushResponse: SyncPushResponseDto = SyncPushResponseDto(),
    var pushConflictLastMutationId: Long = 0,
    var throwOnPush: Boolean = false,
    var analyticsCode: Int = 200,
    var analyticsDaily: List<AnalyticsDailyDto> = emptyList(),
    /* ---- pairing (§7.3). The claim is unauthenticated, so none of this needs a token. ---- */
    var claimStatus: Int = 200,
    var claimResponse: PairClaimResponse = PairClaimResponse(),
    var throwOnClaim: Throwable? = null,
    /** How long `sync()` takes, so overlapping refreshes can be tested. */
    var syncDelayMs: Long = 0,
    /** The `ETag` the scripted sync answers with. */
    var etag: String? = null,
) : LifeOsApi {

    val calls = mutableListOf<String>()

    /** Every code submitted, and the URL it was submitted to. */
    val claims = mutableListOf<Pair<String, String>>()

    /** Every push body, in order. */
    val pushes = mutableListOf<SyncPushRequestDto>()

    /** Every `since` a sync was asked with, and every `If-None-Match`. */
    val syncCursors = mutableListOf<String?>()
    val syncEtags = mutableListOf<String?>()

    override suspend fun health(url: String): Response<HealthDto> {
        calls += "health"
        return Response.success(HealthDto(ok = true, lan = true))
    }

    override suspend fun protocol(url: String): Response<ProtocolDto> {
        calls += "protocol"
        return Response.success(ProtocolDto(protocol = 4, minProtocol = 4))
    }

    override suspend fun claimPairing(url: String, body: PairClaimRequest): Response<PairClaimResponse> {
        calls += "claim"
        claims += body.code to url
        throwOnClaim?.let { throw it }
        if (claimStatus != 200) {
            return Response.error(
                claimStatus,
                """{"error":"scripted $claimStatus"}""".toResponseBody("application/json".toMediaType()),
            )
        }
        return Response.success(claimResponse)
    }

    override suspend fun me(): Response<AuthMeDto> {
        calls += "me"
        return Response.success(AuthMeDto(ok = true))
    }

    override suspend fun sync(since: String?, ifNoneMatch: String?): Response<SyncEnvelopeDto> {
        calls += "sync"
        syncCursors += since
        syncEtags += ifNoneMatch
        if (syncDelayMs > 0) kotlinx.coroutines.delay(syncDelayMs)
        return when (syncCode) {
            200 -> {
                val headers = okhttp3.Headers.Builder()
                    .apply { etag?.let { add("ETag", it) } }
                    .build()
                Response.success(envelope, headers)
            }

            /*
             * `304` carries no body at all, which is the whole point of sending
             * `If-None-Match` — 314 bytes become zero.
             *
             * Built from a raw OkHttp response rather than with
             * `Response.error(code, body)`, because that overload rejects any
             * code below 400 and a 304 is not an error. This is exactly how
             * Retrofit itself delivers one: `parseResponse` treats anything
             * outside 200–299 as `Response.error(buffered, rawResponse)`, so a
             * real 304 arrives with `isSuccessful == false` and `code() == 304`
             * — which is why the repository has to test the code *before* it
             * tests `isSuccessful`, and why this fake has to reproduce the shape
             * faithfully rather than approximate it.
             */
            304 -> Response.error(
                "".toResponseBody(null),
                okhttp3.Response.Builder()
                    .code(304)
                    .message("Not Modified")
                    .protocol(okhttp3.Protocol.HTTP_1_1)
                    .request(okhttp3.Request.Builder().url("http://127.0.0.1:8787/api/v1/sync").build())
                    .build(),
            )

            else -> Response.error(
                syncCode,
                """{"error":"scripted $syncCode"}""".toResponseBody("application/json".toMediaType()),
            )
        }
    }

    override suspend fun push(body: SyncPushRequestDto): Response<SyncPushResponseDto> {
        calls += "push"
        pushes += body
        if (throwOnPush) throw java.io.IOException("socket closed")
        return when (pushCode) {
            200 -> Response.success(pushResponse)
            409 -> Response.error(
                409,
                """{"error":"hole","lastMutationId":$pushConflictLastMutationId}"""
                    .toResponseBody("application/json".toMediaType()),
            )

            else -> Response.error(
                pushCode,
                """{"error":"scripted $pushCode"}""".toResponseBody("application/json".toMediaType()),
            )
        }
    }

    override suspend fun analytics(range: String): Response<AnalyticsDto> {
        calls += "analytics:$range"
        return if (analyticsCode == 200) {
            Response.success(AnalyticsDto(range = range, daily = analyticsDaily))
        } else {
            Response.error(
                analyticsCode,
                """{"error":"scripted $analyticsCode"}"""
                    .toResponseBody("application/json".toMediaType()),
            )
        }
    }
}
