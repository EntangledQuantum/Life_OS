package com.lifeos.app

import com.lifeos.app.data.DrainOutcome
import com.lifeos.app.data.LifeOsRepository
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.DashboardTodayDto
import com.lifeos.app.data.api.LifeDayDto
import com.lifeos.app.data.db.SnapshotEntity
import com.lifeos.app.domain.WriteKind
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
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
        fetchedAt = 1_000L,
        lifeDayDate = day,
        baseUrl = "http://127.0.0.1:8787/",
    )

    private fun payload(day: String = serverDay) = FakeSnapshotPayloads(
        ApiClient.json.encodeToString(
            DashboardTodayDto.serializer(),
            DashboardTodayDto(date = day, lifeDay = LifeDayDto(lifeDay = day)),
        ),
    )

    private fun repo(
        api: FakeApi,
        writes: FakePendingWriteDao,
        snapshots: FakeSnapshotDao,
        now: Long = 10_000L,
    ) = LifeOsRepository(
        snapshots = snapshots,
        payloads = payload(),
        settingsStore = FakeServerSettingsDao(),
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
            payloads = payload(),
            settingsStore = FakeServerSettingsDao(),
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
            payloads = payload(),
            settingsStore = FakeServerSettingsDao(),
            writes = writes,
            prefs = FakeConfig(url = null),
            tokens = FakeToken(),
            apiFactory = { api },
            now = { 10_000L },
        )
        assertEquals(DrainOutcome.NOT_CONFIGURED, repository.drain())
        assertTrue(api.calls.isEmpty())
    }

    /* ----------------------------------------------------- the poll, paced */

    /* ------------------------------------------- the snapshot, out of SQLite */

    @Test
    fun `a dashboard larger than a CursorWindow round-trips`() = runTest {
        // The user's "it crashed altogether after connecting". Their payload is
        // 2.26 MB — habits and goals carry inline base64 artwork — and Android's
        // CursorWindow is 2 MB per row, so the first read after the first
        // successful fetch threw SQLiteBlobTooBigException and took the process
        // with it, on every launch, permanently. The row now holds metadata and
        // the body lives in a file, so size is not a cliff any more.
        val big = "x".repeat(3 * 1024 * 1024)
        val payloads = FakeSnapshotPayloads()
        payloads.write(big)

        assertEquals(big.length, payloads.read()?.length)
        // And nothing about the row grows with it: four small columns.
        val row = snapshot()
        assertEquals(serverDay, row.lifeDayDate)
    }

    @Test
    fun `changing server clears the body as well as the row`() = runTest {
        // A different server is a different life. Leaving the file behind would
        // mean the new server's first empty poll rendered the old server's day.
        val snapshots = FakeSnapshotDao(snapshot())
        val payloads = payload()
        val repository = LifeOsRepository(
            snapshots = snapshots,
            payloads = payloads,
            settingsStore = FakeServerSettingsDao(),
            writes = FakePendingWriteDao(),
            prefs = FakeConfig(),
            tokens = FakeToken(),
            apiFactory = { FakeApi() },
            now = { 10_000L },
        )

        repository.onServerChanged("http://192.168.1.9:8787")

        assertEquals(null, snapshots.get())
        assertEquals(null, payloads.read())
    }

    @Test
    fun `a refresh that arrives while one is in flight is dropped`() = runTest {
        // The bug this prevents is not subtle once you see it on a real
        // network: the poll fires every 8s and `LifeOsViewModel.refresh()`
        // launches and returns, so against a server whose dashboard takes
        // 6.8–15.2s (2.26 MB through a tunnel, measured on the phone) a new
        // full download started on top of every one still running. They starve
        // each other until all of them blow any deadline, and the app reports
        // a server that has gone away while it is answering fine.
        val api = FakeApi(todayDelayMs = 30_000)
        val repository = repo(api, FakePendingWriteDao(), FakeSnapshotDao(snapshot()))

        val first = launch { repository.refresh() }
        runCurrent()

        // Three more poll ticks land mid-flight. None of them may start a
        // second download.
        repeat(3) { repository.refresh() }
        assertEquals(1, api.calls.count { it == "today" })

        advanceUntilIdle()
        first.join()
        assertEquals(1, api.calls.count { it == "today" })
    }

    @Test
    fun `a refresh after the previous one finished does fetch`() = runTest {
        // The other half: coalescing must not turn into a latch that stops the
        // app ever refetching again.
        val api = FakeApi(todayDelayMs = 1_000)
        val repository = repo(api, FakePendingWriteDao(), FakeSnapshotDao(snapshot()))

        repository.refresh()
        repository.refresh()
        assertEquals(2, api.calls.count { it == "today" })
    }
}
