package com.lifeos.app

import com.lifeos.app.data.DrainOutcome
import com.lifeos.app.data.LifeOsRepository
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.LifeDayDto
import com.lifeos.app.data.db.SnapshotEntity
import com.lifeos.app.domain.WriteKind
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The write queue: ordering, the day guard in situ, retry and stranding.
 *
 * These go through the real [LifeOsRepository] against fakes, because the thing
 * worth testing is the interaction — "does the guard actually stop the send" is a
 * different question from "does the guard return Strand".
 */
class WriteQueueTest {

    private val serverDay = "2026-10-20"

    private fun snapshot(day: String = serverDay) = SnapshotEntity(
        payloadJson = ApiClient.json.encodeToString(
            DashboardTodayDto.serializer(),
            DashboardTodayDto(date = day, lifeDay = LifeDayDto(lifeDay = day)),
        ),
        fetchedAt = 1_000L,
        lifeDayDate = day,
        baseUrl = "http://127.0.0.1:8787/",
    )

    private fun repo(
        api: FakeApi,
        writes: FakePendingWriteDao,
        snapshots: FakeSnapshotDao,
        now: Long = 10_000L,
    ) = LifeOsRepository(
        snapshots = snapshots,
        writes = writes,
        prefs = FakeConfig(),
        tokens = FakeToken(),
        apiFactory = { api },
        now = { now },
    )

    @Test
    fun `writes are sent in enqueue order`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val snapshots = FakeSnapshotDao(snapshot())
        val repository = repo(api, writes, snapshots)

        // A complete then an undo of the same habit. Sent in the other order,
        // the server ends up with the opposite of what the user did.
        repository.complete("habit", "h1")
        repository.undoHabit("h1")
        repository.complete("task", "t1")

        val outcome = repository.drain()

        assertEquals(DrainOutcome.DRAINED, outcome)
        assertEquals(
            listOf("habit-complete:h1", "habit-undo:h1", "task-complete:t1"),
            api.calls,
        )
        assertTrue("the queue should be empty", writes.all.isEmpty())
    }

    @Test
    fun `a write stamped with yesterday is never sent`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        // The snapshot says yesterday when the tap happens…
        val snapshots = FakeSnapshotDao(snapshot("2026-10-19"))
        val repository = repo(api, writes, snapshots)

        repository.complete("habit", "h1")

        // …and the day rolls over before the drain runs.
        snapshots.put(snapshot("2026-10-20"))
        val outcome = repository.drain()

        assertEquals(DrainOutcome.DRAINED, outcome)
        assertTrue("nothing may reach the server", api.calls.none { it.startsWith("habit-") })

        val stranded = writes.all.single()
        assertEquals("STRANDED", stranded.state)
        assertEquals("DAY_ROLLED_OVER", stranded.strandReason)
        // It must say what it was, so the user can see exactly what was dropped.
        assertEquals("2026-10-19", stranded.lifeDayDate)
    }

    @Test
    fun `a day-independent write crosses the boundary and is sent`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val snapshots = FakeSnapshotDao(snapshot("2026-10-19"))
        val repository = repo(api, writes, snapshots)

        repository.markCelebrationSeen("g1")
        repository.enqueue(WriteKind.TASK_NOTIFIED, "t9")

        snapshots.put(snapshot("2026-10-20"))
        repository.drain()

        // The refetch is the worker's job, not the drain's, so only the two
        // writes appear here.
        assertEquals(listOf("celebration-seen:g1", "task-notified:t9"), api.calls)
        assertTrue(writes.all.isEmpty())
    }

    @Test
    fun `409 on a habit complete is success, not an error`() = runTest {
        val api = FakeApi(habitCompleteCode = 409)
        val writes = FakePendingWriteDao()
        val repository = repo(api, writes, FakeSnapshotDao(snapshot()))

        repository.complete("habit", "h1")
        repository.drain()

        // Resolved, not retried, not stranded, and nothing to toast.
        assertTrue("409 must clear the write", writes.all.isEmpty())
        assertEquals(1, api.calls.count { it == "habit-complete:h1" })
    }

    @Test
    fun `a transport failure is retried, with backoff, then stranded`() = runTest {
        val api = FakeApi(throwOnHabitComplete = true)
        val writes = FakePendingWriteDao()
        val snapshots = FakeSnapshotDao(snapshot())

        // `now` advances between drains so each write leaves its backoff window.
        var clock = 10_000L
        val repository = LifeOsRepository(
            snapshots = snapshots,
            writes = writes,
            prefs = FakeConfig(),
            tokens = FakeToken(),
            apiFactory = { api },
            now = { clock },
        )

        repository.complete("habit", "h1")

        var outcome = repository.drain()
        assertEquals(DrainOutcome.RETRY, outcome)
        assertEquals(1, writes.all.single().attempts)
        assertTrue(
            "a failed attempt must set a backoff window",
            writes.all.single().nextAttemptAt > clock,
        )

        // Draining again inside the window must not touch the network.
        val callsBefore = api.calls.size
        outcome = repository.drain()
        assertEquals(DrainOutcome.RETRY, outcome)
        assertEquals("the backoff window must be honoured", callsBefore, api.calls.size)

        // Burn the remaining attempts.
        repeat(4) {
            clock += 120_000L
            outcome = repository.drain()
        }

        val row = writes.all.single()
        assertEquals("STRANDED", row.state)
        assertEquals("ATTEMPTS_EXHAUSTED", row.strandReason)
        assertEquals(5, row.attempts)
    }

    @Test
    fun `a 4xx that is not 409 strands immediately rather than burning five attempts`() = runTest {
        val api = FakeApi(taskCompleteCode = 404)
        val writes = FakePendingWriteDao()
        val repository = repo(api, writes, FakeSnapshotDao(snapshot()))

        repository.complete("task", "gone")
        repository.drain()

        val row = writes.all.single()
        assertEquals("STRANDED", row.state)
        assertEquals("REJECTED", row.strandReason)
        assertEquals("retrying a 404 cannot help", 1, api.calls.count { it.startsWith("task-complete") })
    }

    @Test
    fun `with no snapshot at all the write waits rather than stranding`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        // No snapshot: the server's life-day is unknown.
        val repository = repo(api, writes, FakeSnapshotDao(null))

        repository.complete("habit", "h1")
        val outcome = repository.drain()

        assertEquals(DrainOutcome.RETRY, outcome)
        assertEquals("PENDING", writes.all.single().state)
        assertTrue("nothing may be sent on a guess", api.calls.none { it.startsWith("habit-") })
    }

    @Test
    fun `retry all puts stranded writes back in the queue`() = runTest {
        val api = FakeApi(taskCompleteCode = 404)
        val writes = FakePendingWriteDao()
        val repository = repo(api, writes, FakeSnapshotDao(snapshot()))

        repository.complete("task", "t1")
        repository.drain()
        assertEquals("STRANDED", writes.all.single().state)

        repository.retryAllStranded()
        val row = writes.all.single()
        assertEquals("PENDING", row.state)
        assertEquals(0, row.attempts)
        assertEquals(null, row.strandReason)
    }

    @Test
    fun `the stranded notice is shown once`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val snapshots = FakeSnapshotDao(snapshot("2026-10-19"))
        val repository = repo(api, writes, snapshots)

        repository.complete("habit", "h1")
        snapshots.put(snapshot("2026-10-20"))
        repository.drain()

        assertEquals(false, writes.all.single().noticeShown)
        repository.dismissStrandedNotice()
        assertEquals(true, writes.all.single().noticeShown)
    }

    @Test
    fun `an unconfigured app does not drain`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val repository = LifeOsRepository(
            snapshots = FakeSnapshotDao(snapshot()),
            writes = writes,
            prefs = FakeConfig(url = null),
            tokens = FakeToken(),
            apiFactory = { api },
            now = { 10_000L },
        )
        assertEquals(DrainOutcome.NOT_CONFIGURED, repository.drain())
        assertTrue(api.calls.isEmpty())
    }
}
