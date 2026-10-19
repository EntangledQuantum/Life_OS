package com.lifeos.app

import com.lifeos.app.data.ConnectionConfig
import com.lifeos.app.data.TokenSource
import com.lifeos.app.data.api.AuthMeDto
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.HealthDto
import com.lifeos.app.data.api.LifeOsApi
import com.lifeos.app.data.api.PairClaimRequest
import com.lifeos.app.data.api.PairClaimResponse
import com.lifeos.app.data.api.ProtocolDto
import com.lifeos.app.data.api.SourceBody
import com.lifeos.app.data.db.PendingWriteDao
import com.lifeos.app.data.db.PendingWriteEntity
import com.lifeos.app.data.db.SnapshotDao
import com.lifeos.app.data.db.SnapshotEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.Response

/*
 * In-memory stand-ins.
 *
 * The parts of this app worth testing — the life-day guard, the queue's ordering
 * and retry, the growth geometry — need no server and no device, which is why
 * they are tested against these rather than against the user's live Life OS.
 * Nothing here opens a socket.
 */

class FakeSnapshotDao(initial: SnapshotEntity? = null) : SnapshotDao {
    private val state = MutableStateFlow(initial)
    override fun observe(): Flow<SnapshotEntity?> = state
    override suspend fun get(): SnapshotEntity? = state.value
    override suspend fun put(snapshot: SnapshotEntity) {
        state.value = snapshot
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
 * A scripted API.
 *
 * Each call appends to [calls] in order, which is how the queue's ordering is
 * asserted: a complete followed by an undo must arrive in that order, or the
 * server ends up with the opposite of what the user did.
 */
class FakeApi(
    private val today: DashboardTodayDto = DashboardTodayDto(),
    /** Per-endpoint responses, keyed by the call name. */
    var habitCompleteCode: Int = 200,
    var taskCompleteCode: Int = 200,
    var throwOnHabitComplete: Boolean = false,
) : LifeOsApi {

    val calls = mutableListOf<String>()

    private fun ok(): Response<JsonObject> = Response.success(JsonObject(emptyMap()))

    private fun code(status: Int): Response<JsonObject> = Response.error(
        status,
        """{"error":"scripted $status"}""".toResponseBody("application/json".toMediaType()),
    )

    override suspend fun health(url: String): Response<HealthDto> {
        calls += "health"
        return Response.success(HealthDto(ok = true, lan = true))
    }

    override suspend fun protocol(url: String): Response<ProtocolDto> {
        calls += "protocol"
        return Response.success(ProtocolDto(protocol = 3, minProtocol = 3))
    }

    override suspend fun claimPairing(url: String, body: PairClaimRequest): Response<PairClaimResponse> {
        calls += "claim"
        return Response.success(PairClaimResponse())
    }

    override suspend fun me(): Response<AuthMeDto> {
        calls += "me"
        return Response.success(AuthMeDto(ok = true))
    }

    override suspend fun today(): Response<DashboardTodayDto> {
        calls += "today"
        return Response.success(today)
    }

    override suspend fun completeHabit(id: String, body: SourceBody): Response<JsonObject> {
        calls += "habit-complete:$id"
        if (throwOnHabitComplete) throw java.io.IOException("socket closed")
        return if (habitCompleteCode == 200) ok() else code(habitCompleteCode)
    }

    override suspend fun undoHabit(id: String): Response<JsonObject> {
        calls += "habit-undo:$id"
        return ok()
    }

    override suspend fun completeTask(id: String, body: SourceBody): Response<JsonObject> {
        calls += "task-complete:$id"
        return if (taskCompleteCode == 200) ok() else code(taskCompleteCode)
    }

    override suspend fun dismissTask(id: String): Response<JsonObject> {
        calls += "task-dismiss:$id"
        return ok()
    }

    override suspend fun taskNotified(id: String): Response<JsonObject> {
        calls += "task-notified:$id"
        return ok()
    }

    override suspend fun celebrationSeen(id: String): Response<JsonObject> {
        calls += "celebration-seen:$id"
        return ok()
    }

    override suspend fun patchSettings(body: JsonObject): Response<JsonObject> {
        calls += "settings-patch"
        return ok()
    }

    override suspend fun startSession(body: JsonObject): Response<JsonObject> {
        calls += "session-start"
        return ok()
    }

    override suspend fun stopSession(): Response<JsonObject> {
        calls += "session-stop"
        return ok()
    }

    override suspend fun logStudy(body: JsonObject): Response<JsonObject> {
        calls += "study-log"
        return ok()
    }
}
