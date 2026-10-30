package com.lifeos.app

import com.lifeos.app.data.ConnectionState
import com.lifeos.app.data.LifeOsRepository
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.GoalDto
import com.lifeos.app.data.api.HabitWithTodayDto
import com.lifeos.app.data.api.LifeDayDto
import com.lifeos.app.data.api.SyncChangedDto
import com.lifeos.app.data.api.SyncDeletedDto
import com.lifeos.app.data.api.SyncEnvelopeDto
import com.lifeos.app.data.api.TaskDto
import com.lifeos.app.data.db.HabitEntity
import com.lifeos.app.data.db.SyncDocEntity
import com.lifeos.app.data.db.SyncStateEntity
import com.lifeos.app.data.sync.SyncStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Applying protocol 4: the delta, the tombstones, the reset, the `304` and the
 * cursor.
 *
 * These are the rules in `docs/SYNC.md` §5, §7 and §9, each one asserted
 * against the real [LifeOsRepository] and the real `SyncApplyDao.apply`
 * ordering. The rules are small and the consequences of breaking one are not:
 * applying a cursor without applying its delta loses a change permanently, and
 * writing nine documents on every poll undoes the server's hashing.
 */
class SyncProtocolTest {

    private val json = ApiClient.json

    private fun repo(api: FakeApi, db: FakeSyncDb, settings: FakeServerSettingsDao = FakeServerSettingsDao()) =
        LifeOsRepository(
            habitsDao = db.habits,
            tasksDao = db.tasks,
            goalsDao = db.goals,
            propertiesDao = db.properties,
            questsDao = db.quests,
            achievementsDao = db.achievements,
            docsDao = db.docs,
            stateDao = db.syncState,
            applyDao = db,
            settingsStore = settings,
            writes = FakePendingWriteDao(),
            prefs = FakeConfig(),
            tokens = FakeToken(),
            apiFactory = { api },
            now = { 50_000L },
        )

    private val lifeDay = LifeDayDto(
        lifeDay = "2026-10-30",
        lifeDayStart = "2026-10-29T22:30:00.000Z",
        lifeDayEnd = "2026-10-30T22:30:00.000Z",
        dayResetTime = "04:00",
        timezone = "Asia/Kolkata",
    )

    /* ------------------------------------------------------------ cold sync */

    @Test
    fun `a cold sync sends no cursor and stores the one it gets back`() = runTest {
        val api = FakeApi(
            envelope = SyncEnvelopeDto(
                cursor = "epoch.41",
                reset = true,
                lifeDay = lifeDay,
                changed = SyncChangedDto(
                    habits = listOf(HabitWithTodayDto(id = "h1", name = "Read")),
                    tasks = listOf(TaskDto(id = "t1", title = "Ship")),
                ),
            ),
            etag = "\"abc123\"",
        )
        val db = FakeSyncDb()
        val state = repo(api, db).refresh()

        assertEquals(ConnectionState.Online, state)
        // No cursor on the first run: `since` is omitted entirely.
        assertEquals(listOf<String?>(null), api.syncCursors)
        assertEquals(listOf<String?>(null), api.syncEtags)

        assertEquals("epoch.41", db.stateRow.value?.cursor)
        assertEquals("\"abc123\"", db.stateRow.value?.etag)
        assertEquals("2026-10-30", db.stateRow.value?.lifeDayDate)
        assertEquals(1, db.habitRows.value.size)
        assertEquals(1, db.taskRows.value.size)
        // And a client id was minted, because the push path needs a stable one.
        assertTrue(db.stateRow.value?.clientId?.isNotBlank() == true)
    }

    @Test
    fun `the next poll sends the cursor and the etag`() = runTest {
        val api = FakeApi(
            envelope = SyncEnvelopeDto(cursor = "epoch.41", reset = true, lifeDay = lifeDay),
            etag = "\"abc123\"",
        )
        val db = FakeSyncDb()
        val repository = repo(api, db)

        repository.refresh()
        repository.refresh()

        // 314 bytes becomes zero only if both of these go out.
        assertEquals(listOf(null, "epoch.41"), api.syncCursors)
        assertEquals(listOf(null, "\"abc123\""), api.syncEtags)
    }

    /* ---------------------------------------------------------------- deltas */

    @Test
    fun `a delta patches rows and tombstones delete them`() = runTest {
        val db = FakeSyncDb().also {
            it.stateRow.value = SyncStateEntity(
                cursor = "epoch.41",
                lifeDayDate = "2026-10-30",
                clientId = "c1",
                baseUrl = "http://127.0.0.1:8787/",
            )
            it.habitRows.value = listOf(
                HabitEntity("h1", json.encodeToString(HabitWithTodayDto.serializer(), HabitWithTodayDto(id = "h1", name = "Read"))),
                HabitEntity("h2", json.encodeToString(HabitWithTodayDto.serializer(), HabitWithTodayDto(id = "h2", name = "Walk"))),
            )
        }

        val api = FakeApi(
            envelope = SyncEnvelopeDto(
                cursor = "epoch.44",
                reset = false,
                lifeDay = lifeDay,
                // h1 changed its name; h2 was retired.
                changed = SyncChangedDto(
                    habits = listOf(HabitWithTodayDto(id = "h1", name = "Read more")),
                ),
                deleted = SyncDeletedDto(habits = listOf("h2")),
            ),
        )

        repo(api, db).refresh()

        assertEquals(listOf("h1"), db.habitRows.value.map { it.id })
        val h1 = json.decodeFromString(HabitWithTodayDto.serializer(), db.habitRows.value.single().json)
        assertEquals("Read more", h1.name)
        assertEquals("epoch.44", db.stateRow.value?.cursor)
    }

    @Test
    fun `applying the same delta twice leaves the same rows`() = runTest {
        // "Previously seen changes may reappear", and the daily XP pool is
        // redistributed across every habit whenever one is added — so every
        // habit legitimately moves at once and a replay must be a no-op.
        val db = FakeSyncDb()
        val api = FakeApi(
            envelope = SyncEnvelopeDto(
                cursor = "epoch.41",
                reset = true,
                lifeDay = lifeDay,
                changed = SyncChangedDto(habits = listOf(HabitWithTodayDto(id = "h1", name = "Read"))),
            ),
        )
        val repository = repo(api, db)

        repository.refresh()
        val afterFirst = db.habitRows.value
        repository.refresh()

        assertEquals(afterFirst, db.habitRows.value)
        assertEquals(1, db.habitRows.value.size)
    }

    @Test
    fun `a property is tombstoned by its uid, not by an id it does not have`() = runTest {
        // `properties` is the one collection whose id field is `uid`. Keying it
        // wrongly would mean a retired property never leaving the screen.
        val db = FakeSyncDb().also {
            it.stateRow.value = SyncStateEntity(cursor = "epoch.41", clientId = "c1", baseUrl = "http://127.0.0.1:8787/")
            it.propertyRows.value = listOf(
                com.lifeos.app.data.db.PropertyEntity("p-uid-1", "{}"),
            )
        }
        val api = FakeApi(
            envelope = SyncEnvelopeDto(
                cursor = "epoch.42",
                lifeDay = lifeDay,
                deleted = SyncDeletedDto(properties = listOf("p-uid-1")),
            ),
        )

        repo(api, db).refresh()
        assertTrue(db.propertyRows.value.isEmpty())
    }

    /* ----------------------------------------------------------------- reset */

    @Test
    fun `reset drops everything held before applying`() = runTest {
        val db = FakeSyncDb().also {
            it.stateRow.value = SyncStateEntity(cursor = "old.9", clientId = "c1", baseUrl = "http://127.0.0.1:8787/")
            it.habitRows.value = listOf(HabitEntity("stale", "{}"))
            it.taskRows.value = listOf(
                com.lifeos.app.data.db.TaskEntity(id = "stale-t", status = "active", json = "{}"),
            )
            it.docRows.value = listOf(SyncDocEntity("agenda", """{"items":[],"anytime":[]}"""))
        }

        val api = FakeApi(
            envelope = SyncEnvelopeDto(
                cursor = "fresh.1",
                reset = true,
                lifeDay = lifeDay,
                changed = SyncChangedDto(habits = listOf(HabitWithTodayDto(id = "h-new", name = "New"))),
            ),
        )

        repo(api, db).refresh()

        // Nothing from the old epoch may survive, including the documents.
        assertEquals(listOf("h-new"), db.habitRows.value.map { it.id })
        assertTrue(db.taskRows.value.isEmpty())
        assertEquals("fresh.1", db.stateRow.value?.cursor)
        // The client id survives a reset: it identifies the installation, not
        // the data, and renumbering mutations from 1 would collide server-side.
        assertEquals("c1", db.stateRow.value?.clientId)
    }

    /* ------------------------------------------------------------------- 304 */

    @Test
    fun `a 304 writes nothing but keeps the cursor and the etag`() = runTest {
        val before = SyncStateEntity(
            cursor = "epoch.41",
            etag = "\"abc123\"",
            lifeDayDate = "2026-10-30",
            clientId = "c1",
            lastMutationId = 7,
            fetchedAt = 1_000L,
            baseUrl = "http://127.0.0.1:8787/",
        )
        val db = FakeSyncDb().also {
            it.stateRow.value = before
            it.habitRows.value = listOf(HabitEntity("h1", "{}"))
        }
        val api = FakeApi(syncCode = 304)

        val state = repo(api, db).refresh()

        assertEquals(ConnectionState.Online, state)
        // The cursor, the etag and the counter are all untouched…
        assertEquals("epoch.41", db.stateRow.value?.cursor)
        assertEquals("\"abc123\"", db.stateRow.value?.etag)
        assertEquals(7L, db.stateRow.value?.lastMutationId)
        assertEquals(listOf(HabitEntity("h1", "{}")), db.habitRows.value)
        // …and only `fetchedAt` moves, because the strip's "last updated" is a
        // statement about when this device last heard from the server.
        assertEquals(50_000L, db.stateRow.value?.fetchedAt)
    }

    /* -------------------------------------------------------------- documents */

    @Test
    fun `an absent document is left alone and a present one is replaced whole`() = runTest {
        val db = FakeSyncDb().also {
            it.stateRow.value = SyncStateEntity(cursor = "epoch.41", clientId = "c1", baseUrl = "http://127.0.0.1:8787/")
            it.docRows.value = listOf(
                SyncDocEntity("agenda", """{"items":[],"anytime":[]}"""),
                SyncDocEntity("ribbon", """[{"id":"keep"}]"""),
            )
        }

        // Only `agenda` moved. `ribbon` is absent, which means unchanged.
        val api = FakeApi(
            envelope = SyncEnvelopeDto(
                cursor = "epoch.42",
                lifeDay = lifeDay,
                docs = buildJsonObject {
                    put("agenda", json.parseToJsonElement("""{"items":[{"id":"x"}],"anytime":[]}"""))
                },
            ),
        )

        repo(api, db).refresh()

        val docs = db.docRows.value.associateBy { it.name }
        assertTrue("agenda must be replaced", docs["agenda"]!!.json!!.contains("\"x\""))
        assertEquals("ribbon must be untouched", """[{"id":"keep"}]""", docs["ribbon"]!!.json)
    }

    @Test
    fun `activeSession present-but-null clears it, and absent does not`() = runTest {
        val db = FakeSyncDb().also {
            it.stateRow.value = SyncStateEntity(cursor = "epoch.41", clientId = "c1", baseUrl = "http://127.0.0.1:8787/")
            it.docRows.value = listOf(
                SyncDocEntity("activeSession", """{"activity":"Deep Work","startedAt":"2026-10-30T08:00:00.000Z"}"""),
            )
        }

        // Absent first: the session must survive a delta that does not mention it.
        val quiet = FakeApi(envelope = SyncEnvelopeDto(cursor = "epoch.42", lifeDay = lifeDay))
        repo(quiet, db).refresh()
        assertNotNull(
            "an absent document means unchanged, not cleared",
            db.docRows.value.single { it.name == "activeSession" }.json,
        )

        // Then an explicit null: that is a real value and means it was cleared.
        val cleared = FakeApi(
            envelope = SyncEnvelopeDto(
                cursor = "epoch.43",
                lifeDay = lifeDay,
                docs = buildJsonObject { put("activeSession", JsonNull) },
            ),
        )
        repo(cleared, db).refresh()
        assertNull(
            "present-but-null is a value: the session ended",
            db.docRows.value.single { it.name == "activeSession" }.json,
        )
    }

    @Test
    fun `the settings document lands in the settings row`() = runTest {
        // Settings used to be a second request on every poll. They are a
        // document now, so they arrive only when they actually changed.
        val db = FakeSyncDb()
        val settings = FakeServerSettingsDao()
        val api = FakeApi(
            envelope = SyncEnvelopeDto(
                cursor = "epoch.41",
                reset = true,
                lifeDay = lifeDay,
                docs = buildJsonObject {
                    put("settings", json.parseToJsonElement("""{"doNotDisturb":true}"""))
                },
            ),
        )

        repo(api, db, settings).refresh()

        // `first()`, not `collect`: the DAO exposes a hot StateFlow, so
        // collecting it never completes and the test would hang rather than fail.
        val seen = settings.observe().first()?.payloadJson
        assertTrue("the settings doc must be stored", seen?.contains("doNotDisturb") == true)
        // And no second request was made for them.
        assertEquals(listOf("sync"), api.calls)
    }

    /* -------------------------------------------------------------- statuses */

    @Test
    fun `a 426 blocks the app rather than looking like a dead server`() = runTest {
        val api = FakeApi(syncCode = 426)
        val state = repo(api, FakeSyncDb()).refresh()
        assertTrue("must be Outdated, not Unreachable", state is ConnectionState.Outdated)
    }

    @Test
    fun `a 401 clears the token and does not loop`() = runTest {
        val api = FakeApi(syncCode = 401)
        val db = FakeSyncDb()
        val state = repo(api, db).refresh()
        assertEquals(ConnectionState.Unauthorized, state)
        assertEquals("one attempt only", 1, api.calls.count { it == "sync" })
    }

    @Test
    fun `a cursor from a different server is never sent`() = runTest {
        // A cursor is only meaningful to the database that issued it. Sending
        // one to a different instance invites being told "nothing changed"
        // about a day this client has never seen.
        val db = FakeSyncDb().also {
            it.stateRow.value = SyncStateEntity(
                cursor = "other.99",
                etag = "\"other\"",
                clientId = "c1",
                baseUrl = "http://10.0.0.5:8787/",
            )
        }
        val api = FakeApi(envelope = SyncEnvelopeDto(cursor = "mine.1", reset = true, lifeDay = lifeDay))

        repo(api, db).refresh()

        assertEquals(listOf<String?>(null), api.syncCursors)
        assertEquals(listOf<String?>(null), api.syncEtags)
    }

    /* ------------------------------------------------------- the composed day */

    @Test
    fun `the composed day carries the four values the server stopped sending`() = runTest {
        val store = SyncStore()
        val nowMs = java.time.Instant.parse("2026-10-30T09:30:00.000Z").toEpochMilli()

        val rows = SyncStore.Rows(
            state = SyncStateEntity(
                cursor = "epoch.41",
                lifeDayDate = "2026-10-30",
                lifeDayStart = lifeDay.lifeDayStart,
                lifeDayEnd = lifeDay.lifeDayEnd,
                clientId = "c1",
                fetchedAt = 1_000L,
                baseUrl = "http://127.0.0.1:8787/",
            ),
            tasks = listOf(
                // Current: window open, no end.
                com.lifeos.app.data.db.TaskEntity(
                    id = "now",
                    status = "active",
                    currentFrom = "2026-10-30T08:00:00.000Z",
                    json = json.encodeToString(
                        TaskDto.serializer(),
                        TaskDto(id = "now", status = "active", currentFrom = "2026-10-30T08:00:00.000Z"),
                    ),
                ),
                // Due: a reminder that has not fired.
                com.lifeos.app.data.db.TaskEntity(
                    id = "due",
                    status = "active",
                    dueFrom = "2026-10-30T09:00:00.000Z",
                    json = json.encodeToString(
                        TaskDto.serializer(),
                        TaskDto(id = "due", status = "active", dueFrom = "2026-10-30T09:00:00.000Z"),
                    ),
                ),
            ),
            goals = listOf(
                com.lifeos.app.data.db.GoalEntity(
                    id = "g1",
                    json = json.encodeToString(
                        GoalDto.serializer(),
                        GoalDto(id = "g1", title = "Done", celebrationPending = true),
                    ),
                ),
            ),
            docs = listOf(
                SyncDocEntity("progress", """{"efficiencyPct":60.0,"yesterdayEfficiencyPct":100.0}"""),
                SyncDocEntity("lived", """[{"id":"l1","activity":"Deep Work","startedAt":"2026-10-30T08:00:00.000Z","endedAt":null}]"""),
                SyncDocEntity("ribbon", """[{"id":"r1","category":"Life","label":"Life","startHour":0,"endHour":24,"color":"#5B8CFF","status":"planned"}]"""),
            ),
        )

        val decoded = store.decode(rows)!!
        val day = store.compose(decoded, nowMs)

        assertEquals(listOf("now"), day.current.map { it.id })
        assertEquals(listOf("due"), day.dueReminders.map { it.id })
        // Derived, not sent: the old payload carried this as its own array.
        assertEquals(listOf("g1"), day.pendingCelebrations.map { it.id })
        // Pace-adjusted: at ~0.458 of the day, yesterday had reached ~45.8, so
        // 60 today is ahead rather than 40 points behind.
        assertEquals(14.2, day.progress.improvementPct, 0.05)
        // And the ribbon is cut at the clock, with the lived part behind it.
        assertTrue("the timeline must be composed", day.timeline.isNotEmpty())
        assertTrue("the lived part is behind the marker", day.timeline.any { it.actual })
        assertTrue("the plan is ahead of it", day.timeline.any { !it.actual })
    }

    @Test
    fun `no sync state at all composes to nothing, not to an empty day`() = runTest {
        // These are different: one is the first run and shows the connect path,
        // the other is a real day that happens to be empty.
        assertNull(SyncStore().decode(SyncStore.Rows()))
    }

    @Test
    fun `one unreadable row costs one row, not the whole day`() = runTest {
        // The old blob had the opposite property: one unparseable byte lost
        // everything, because the day was a single document.
        val store = SyncStore()
        val rows = SyncStore.Rows(
            state = SyncStateEntity(cursor = "e.1", lifeDayDate = "2026-10-30", clientId = "c1"),
            habits = listOf(
                HabitEntity("good", json.encodeToString(HabitWithTodayDto.serializer(), HabitWithTodayDto(id = "good", name = "Read"))),
                HabitEntity("bad", "{not json at all"),
            ),
        )

        val decoded = store.decode(rows)!!
        assertEquals(listOf("good"), decoded.habits.map { it.id })
    }
}
