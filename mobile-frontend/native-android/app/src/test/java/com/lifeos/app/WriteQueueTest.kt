package com.lifeos.app

import com.lifeos.app.data.DrainOutcome
import com.lifeos.app.data.LifeOsRepository
import com.lifeos.app.data.api.SyncEnvelopeDto
import com.lifeos.app.data.api.SyncMutationResultDto
import com.lifeos.app.data.api.SyncMutations
import com.lifeos.app.data.api.SyncPushResponseDto
import com.lifeos.app.data.db.SyncStateEntity
import com.lifeos.app.domain.WriteKind
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The write queue under protocol 4: ordering, the day guard in situ, the
 * mutation numbering, retry and stranding.
 *
 * These go through the real [LifeOsRepository] against fakes, because the thing
 * worth testing is the interaction — "does the guard actually stop the send" is
 * a different question from "does the guard return Strand".
 *
 * Every write now leaves as a **named mutation in one `/sync/push` batch**
 * rather than as its own REST call, so the assertions are about what the batch
 * contained and in what order, which is what the server sees.
 */
class WriteQueueTest {

    private val serverDay = "2026-10-20"

    private fun state(day: String = serverDay, lastMutationId: Long = 0) = SyncStateEntity(
        cursor = "epoch.41",
        etag = "\"abc\"",
        lifeDayDate = day,
        clientId = "client-1",
        lastMutationId = lastMutationId,
        fetchedAt = 1_000L,
        baseUrl = "http://127.0.0.1:8787/",
    )

    /** A push that applies everything it was given. */
    private fun allApplied(ids: List<Long>) = SyncPushResponseDto(
        lastMutationId = ids.maxOrNull() ?: 0,
        results = ids.map { SyncMutationResultDto(id = it, status = "applied") },
        sync = SyncEnvelopeDto(cursor = "epoch.42"),
    )

    private fun repo(
        api: FakeApi,
        writes: FakePendingWriteDao,
        db: FakeSyncDb,
        now: Long = 10_000L,
    ) = LifeOsRepository(
        habitsDao = db.habits,
        tasksDao = db.tasks,
        goalsDao = db.goals,
        propertiesDao = db.properties,
        questsDao = db.quests,
        achievementsDao = db.achievements,
        docsDao = db.docs,
        stateDao = db.syncState,
        applyDao = db,
        settingsStore = FakeServerSettingsDao(),
        writes = writes,
        prefs = FakeConfig(),
        tokens = FakeToken(),
        apiFactory = { api },
        now = { now },
    )

    private fun dbWith(day: String = serverDay, lastMutationId: Long = 0) =
        FakeSyncDb().also { it.stateRow.value = state(day, lastMutationId) }

    @Test
    fun `writes are sent in enqueue order, in one batch`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val db = dbWith()
        val repository = repo(api, writes, db)
        api.pushResponse = allApplied(listOf(1, 2, 3))

        // A complete then an undo of the same habit. Sent in the other order,
        // the server ends up with the opposite of what the user did.
        repository.complete("habit", "h1")
        repository.undoHabit("h1")
        repository.complete("task", "t1")

        val outcome = repository.drain()

        assertEquals(DrainOutcome.DRAINED, outcome)
        // One request for three writes, which is the point of the endpoint.
        assertEquals(1, api.pushes.size)
        assertEquals(
            listOf(
                SyncMutations.HABIT_COMPLETE,
                SyncMutations.HABIT_UNDO,
                SyncMutations.TASK_COMPLETE,
            ),
            api.pushes.single().mutations.map { it.name },
        )
        // Numbered from 1, strictly sequential: a hole is refused outright.
        assertEquals(listOf(1L, 2L, 3L), api.pushes.single().mutations.map { it.id })
        assertTrue("the queue should be empty", writes.all.isEmpty())
    }

    @Test
    fun `the batch carries the cursor so the reply can carry the delta`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val db = dbWith()
        val repository = repo(api, writes, db)
        api.pushResponse = allApplied(listOf(1))

        repository.complete("habit", "h1")
        repository.drain()

        assertEquals("epoch.41", api.pushes.single().since)
        assertEquals("client-1", api.pushes.single().clientId)
        // And the delta in the reply is applied, so no refetch is needed.
        assertEquals("epoch.42", db.stateRow.value?.cursor)
    }

    @Test
    fun `a day-bound mutation carries its life-day and a day-independent one does not`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val repository = repo(api, writes, dbWith())
        api.pushResponse = allApplied(listOf(1, 2))

        repository.complete("habit", "h1")
        repository.dismissTask("t1")
        repository.drain()

        val sent = api.pushes.single().mutations
        assertEquals(serverDay, sent.first { it.name == SyncMutations.HABIT_COMPLETE }.lifeDayDate)
        // `task.dismiss` means the same thing whatever day it is finally sent,
        // so stamping it would invite the server to refuse it for no reason.
        assertNull(sent.first { it.name == SyncMutations.TASK_DISMISS }.lifeDayDate)
    }

    @Test
    fun `a write stamped with yesterday is never sent`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        // The state says yesterday when the tap happens…
        val db = dbWith("2026-10-19")
        val repository = repo(api, writes, db)

        repository.complete("habit", "h1")

        // …and the day rolls over before the drain runs.
        db.stateRow.value = state("2026-10-20")
        val outcome = repository.drain()

        assertEquals(DrainOutcome.DRAINED, outcome)
        assertTrue("nothing may reach the server", api.pushes.isEmpty())

        val stranded = writes.all.single()
        assertEquals("STRANDED", stranded.state)
        assertEquals("DAY_ROLLED_OVER", stranded.strandReason)
        // It must say what it was, so the user can see exactly what was dropped.
        assertEquals("2026-10-19", stranded.lifeDayDate)
        // And it must not have burned a mutation number: a number assigned to a
        // write that never goes out is a hole that refuses every later write.
        assertNull(stranded.mutationId)
    }

    @Test
    fun `a write the guard strands does not consume a number owed to the next one`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val db = dbWith("2026-10-19")
        val repository = repo(api, writes, db)

        // One stale write, then the day turns, then a fresh write.
        repository.complete("habit", "stale")
        db.stateRow.value = state("2026-10-20")
        repository.complete("habit", "fresh")
        api.pushResponse = allApplied(listOf(1))

        repository.drain()

        // The fresh write is mutation 1, not 2. If the stranded one had taken
        // the number, the server would see a hole and refuse the batch forever.
        assertEquals(listOf(1L), api.pushes.single().mutations.map { it.id })
        assertEquals(1, api.pushes.single().mutations.size)
    }

    @Test
    fun `a day-independent write crosses the boundary and is sent`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val db = dbWith("2026-10-19")
        val repository = repo(api, writes, db)
        api.pushResponse = allApplied(listOf(1, 2))

        repository.markCelebrationSeen("g1")
        repository.enqueue(WriteKind.TASK_NOTIFIED, "t9")

        db.stateRow.value = state("2026-10-20")
        repository.drain()

        assertEquals(
            listOf(SyncMutations.GOAL_CELEBRATION_SEEN, SyncMutations.TASK_NOTIFIED),
            api.pushes.single().mutations.map { it.name },
        )
        assertTrue(writes.all.isEmpty())
    }

    @Test
    fun `duplicate is success, not an error`() = runTest {
        // The habit was already completed today. The optimistic tick is on
        // screen and the thing did happen, so showing a failure would be a lie.
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val repository = repo(api, writes, dbWith())
        api.pushResponse = SyncPushResponseDto(
            lastMutationId = 1,
            results = listOf(SyncMutationResultDto(id = 1, status = "duplicate")),
            sync = SyncEnvelopeDto(cursor = "epoch.42"),
        )

        repository.complete("habit", "h1")
        repository.drain()

        assertTrue("duplicate must clear the write", writes.all.isEmpty())
        assertEquals(1, api.pushes.size)
    }

    @Test
    fun `staleLifeDay from the server strands and is never retried`() = runTest {
        // The write was already in flight when the clock passed 04:00, which is
        // precisely the case the client's own guard cannot catch.
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val repository = repo(api, writes, dbWith())
        api.pushResponse = SyncPushResponseDto(
            lastMutationId = 1,
            results = listOf(
                SyncMutationResultDto(
                    id = 1,
                    status = "staleLifeDay",
                    error = "This was done on 2026-10-19 and the life-day is now 2026-10-20.",
                ),
            ),
            sync = SyncEnvelopeDto(cursor = "epoch.42"),
        )

        repository.complete("habit", "h1")
        repository.drain()

        val row = writes.all.single()
        assertEquals("STRANDED", row.state)
        assertEquals("DAY_ROLLED_OVER", row.strandReason)
        assertTrue(
            "the server's sentence is what the user should see",
            row.lastError?.contains("2026-10-19") == true,
        )
    }

    @Test
    fun `a rejected mutation strands with its error`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val repository = repo(api, writes, dbWith())
        api.pushResponse = SyncPushResponseDto(
            lastMutationId = 1,
            results = listOf(
                SyncMutationResultDto(id = 1, status = "rejected", error = "No such task"),
            ),
            sync = SyncEnvelopeDto(cursor = "epoch.42"),
        )

        repository.complete("task", "gone")
        repository.drain()

        val row = writes.all.single()
        assertEquals("STRANDED", row.state)
        assertEquals("REJECTED", row.strandReason)
        assertEquals("retrying cannot help", 1, api.pushes.size)
        assertTrue(row.lastError?.contains("No such task") == true)
    }

    @Test
    fun `a retry reuses the same mutation number`() = runTest {
        // This is what makes a retry idempotent rather than a second habit
        // completion: the server recognises the number and answers duplicate.
        val api = FakeApi(throwOnPush = true)
        val writes = FakePendingWriteDao()
        var clock = 10_000L
        val db = dbWith()
        val repository = LifeOsRepository(
            habitsDao = db.habits,
            tasksDao = db.tasks,
            goalsDao = db.goals,
            propertiesDao = db.properties,
            questsDao = db.quests,
            achievementsDao = db.achievements,
            docsDao = db.docs,
            stateDao = db.syncState,
            applyDao = db,
            settingsStore = FakeServerSettingsDao(),
            writes = writes,
            prefs = FakeConfig(),
            tokens = FakeToken(),
            apiFactory = { api },
            now = { clock },
        )

        repository.complete("habit", "h1")
        repository.drain()
        val firstNumber = writes.all.single().mutationId
        assertNotNull("a sent write must record its number", firstNumber)

        clock += 120_000L
        api.throwOnPush = false
        api.pushResponse = allApplied(listOf(firstNumber!!))
        repository.drain()

        assertEquals(
            "the second attempt must reuse the number",
            listOf(firstNumber, firstNumber),
            api.pushes.map { it.mutations.single().id },
        )
    }

    @Test
    fun `a transport failure is retried, with backoff, then stranded`() = runTest {
        val api = FakeApi(throwOnPush = true)
        val writes = FakePendingWriteDao()
        val db = dbWith()

        // `now` advances between drains so each write leaves its backoff window.
        var clock = 10_000L
        val repository = LifeOsRepository(
            habitsDao = db.habits,
            tasksDao = db.tasks,
            goalsDao = db.goals,
            propertiesDao = db.properties,
            questsDao = db.quests,
            achievementsDao = db.achievements,
            docsDao = db.docs,
            stateDao = db.syncState,
            applyDao = db,
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
        val callsBefore = api.pushes.size
        outcome = repository.drain()
        assertEquals(DrainOutcome.RETRY, outcome)
        assertEquals("the backoff window must be honoured", callsBefore, api.pushes.size)

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
    fun `a 409 renumbers from the server's counter instead of wedging`() = runTest {
        // A hole, or a database restored from under us. Retrying the same
        // refused batch would block every write from now on, which is exactly
        // what the numbering rules exist to prevent.
        val api = FakeApi(pushCode = 409, pushConflictLastMutationId = 17)
        val writes = FakePendingWriteDao()
        val db = dbWith(lastMutationId = 3)
        val repository = repo(api, writes, db)

        repository.complete("habit", "h1")
        val outcome = repository.drain()

        assertEquals(DrainOutcome.RETRY, outcome)
        assertEquals("the server's counter wins", 17L, db.stateRow.value?.lastMutationId)
        assertNull("the assigned number is forgotten", writes.all.single().mutationId)
        assertEquals("PENDING", writes.all.single().state)

        // The next drain numbers from the server's counter + 1.
        api.pushCode = 200
        api.pushResponse = allApplied(listOf(18))
        repository.drain()
        assertEquals(18L, api.pushes.last().mutations.single().id)
    }

    @Test
    fun `a 4xx that is not 401, 409 or 426 strands the batch`() = runTest {
        val api = FakeApi(pushCode = 400)
        val writes = FakePendingWriteDao()
        val repository = repo(api, writes, dbWith())

        repository.complete("task", "t1")
        repository.drain()

        val row = writes.all.single()
        assertEquals("STRANDED", row.state)
        assertEquals("REJECTED", row.strandReason)
        assertEquals("retrying a 400 cannot help", 1, api.pushes.size)
    }

    @Test
    fun `with no sync state at all the write waits rather than stranding`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        // No state row: the server's life-day is unknown.
        val repository = repo(api, writes, FakeSyncDb())

        repository.complete("habit", "h1")
        val outcome = repository.drain()

        assertEquals(DrainOutcome.RETRY, outcome)
        assertEquals("PENDING", writes.all.single().state)
        assertTrue("nothing may be sent on a guess", api.pushes.isEmpty())
    }

    @Test
    fun `retry all puts stranded writes back in the queue`() = runTest {
        val api = FakeApi(pushCode = 400)
        val writes = FakePendingWriteDao()
        val repository = repo(api, writes, dbWith())

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
        val db = dbWith("2026-10-19")
        val repository = repo(api, writes, db)

        repository.complete("habit", "h1")
        db.stateRow.value = state("2026-10-20")
        repository.drain()

        assertEquals(false, writes.all.single().noticeShown)
        repository.dismissStrandedNotice()
        assertEquals(true, writes.all.single().noticeShown)
    }

    @Test
    fun `an unconfigured app does not drain`() = runTest {
        val api = FakeApi()
        val writes = FakePendingWriteDao()
        val db = dbWith()
        val repository = LifeOsRepository(
            habitsDao = db.habits,
            tasksDao = db.tasks,
            goalsDao = db.goals,
            propertiesDao = db.properties,
            questsDao = db.quests,
            achievementsDao = db.achievements,
            docsDao = db.docs,
            stateDao = db.syncState,
            applyDao = db,
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

    /* ------------------------------------------------- changing server */

    @Test
    fun `changing server clears the day and the cursor`() = runTest {
        // A different server is a different life. Keeping the cursor would mean
        // asking a stranger what changed since a number they have never issued
        // — and being told "nothing", forever.
        val db = dbWith()
        db.habitRows.value = listOf(com.lifeos.app.data.db.HabitEntity("h1", "{}"))
        val repository = repo(FakeApi(), FakePendingWriteDao(), db)

        repository.onServerChanged("http://192.168.1.9:8787")

        assertNull(db.stateRow.value)
        assertTrue(db.habitRows.value.isEmpty())
    }

    /* ------------------------------------------------------ the poll, paced */

    @Test
    fun `a sync that arrives while one is in flight is dropped`() = runTest {
        val api = FakeApi(syncDelayMs = 30_000)
        val repository = repo(api, FakePendingWriteDao(), dbWith())

        val first = launch { repository.refresh() }
        runCurrent()

        // Three more poll ticks land mid-flight. None may start a second sync.
        repeat(3) { repository.refresh() }
        assertEquals(1, api.calls.count { it == "sync" })

        advanceUntilIdle()
        first.join()
        assertEquals(1, api.calls.count { it == "sync" })
    }

    @Test
    fun `a sync after the previous one finished does fetch`() = runTest {
        // The other half: coalescing must not turn into a latch that stops the
        // app ever syncing again.
        val api = FakeApi(syncDelayMs = 1_000)
        val repository = repo(api, FakePendingWriteDao(), dbWith())

        repository.refresh()
        repository.refresh()
        assertEquals(2, api.calls.count { it == "sync" })
    }
}
