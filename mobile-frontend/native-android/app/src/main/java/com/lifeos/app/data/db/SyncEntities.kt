package com.lifeos.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Protocol 4's storage: **one row per thing**, not one row per day.
 *
 * ### What this replaces, and why it is the most important file in the migration
 *
 * Until 2.0.2 the entire `dashboard/today` payload lived in a single column.
 * On the user's real data that payload is 2,263,618 bytes — 97.4% of it inline
 * base64 artwork — and Android's `CursorWindow` caps **one row** at 2 MB. Not
 * one query, not one table: one row. So the first read after the first
 * *successful* fetch threw `SQLiteBlobTooBigException` and took the process
 * down, and because the row was still there it did so again on every launch,
 * permanently. The app was bricked by succeeding.
 *
 * 2.0.2 moved the body to a file beside the database, which stopped the
 * crashing but kept the shape: one opaque blob, rewritten whole on every poll,
 * reparsed whole on every read. Protocol 4 sends rows and tombstones, so the
 * client can finally store rows.
 *
 * ### The rule this file exists to enforce
 *
 * **Nothing here may be an unbounded single-column blob.** Every table below is
 * keyed by the entity's own id, and the largest value any single row can hold is
 * one habit, one task or one goal. On the measured production database the whole
 * `tasks` collection is 242,661 bytes across 213 rows — about 1.1 KB each, three
 * orders of magnitude below the limit — and artwork is a URL now, so a picture
 * cannot push a row over it however many an agent attaches.
 *
 * ### Why a `json` column rather than forty typed ones
 *
 * The columns that are broken out are the ones something *queries or compares*:
 * a task's `status` and its four window instants, because [SyncMath] reads them
 * on every tick to decide what is current and what should chime. The rest of
 * the row stays as its own JSON, per entity, and that is a deliberate trade
 * stated plainly rather than hidden:
 *
 *  - It keeps the delta's contract exactly. The server sends **whole rows**, so
 *    an upsert is one statement and can never half-apply a row; a forty-column
 *    projection would need a migration every time the server grows a field,
 *    and a field this client does not model yet would be silently dropped on
 *    the way through — the client would then *lose* data the server sent it.
 *  - It is bounded by construction, which is the property that was violated
 *    before. One entity per row, and a tombstone deletes exactly one row.
 *  - The nested shapes are real: a goal carries its `tiers`, each with its own
 *    art and its own `celebrationPending`. Flattening those into columns means
 *    either Room type converters over the same JSON or four more tables and a
 *    re-join on every emission, for data nothing filters on.
 *
 * Primary keys are the server's ids, so applying the same delta twice is the
 * same `INSERT OR REPLACE` twice — which is what the protocol asks for, since
 * "previously seen changes may reappear" and the daily XP pool legitimately
 * moves every habit at once whenever one is added.
 */

/** A habit, as `HabitWithToday`. */
@Entity(tableName = "habits")
data class HabitEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "json") val json: String,
)

/**
 * A task, as `SyncedTask`.
 *
 * The broken-out columns are the ones the clock is compared against. They are
 * stored as the server's ISO text rather than as parsed millis on purpose: the
 * text is what arrived, parsing is cheap, and a column of epoch millis would
 * have to pick a meaning for the unparseable case at write time instead of
 * letting [SyncMath] apply the same NaN rule the TypeScript applies.
 *
 * `status` is indexed because every screen filters on it — "active" is the
 * common case and the collection carries every task ever, `done`, `missed` and
 * `dismissed` included, deliberately, so Timeline and history work with no
 * network.
 */
@Entity(
    tableName = "tasks",
    indices = [Index(value = ["status"]), Index(value = ["slot"])],
)
data class TaskEntity(
    @PrimaryKey val id: String,
    val status: String,
    /** 0 or 1 pins a task as an agent card; null is an ordinary task. */
    val slot: Int? = null,
    val kind: String = "task",
    @ColumnInfo(name = "show_at") val showAt: String? = null,
    @ColumnInfo(name = "current_from") val currentFrom: String? = null,
    @ColumnInfo(name = "current_until") val currentUntil: String? = null,
    @ColumnInfo(name = "due_from") val dueFrom: String? = null,
    @ColumnInfo(name = "due_until") val dueUntil: String? = null,
    @ColumnInfo(name = "notified_at") val notifiedAt: String? = null,
    @ColumnInfo(name = "json") val json: String,
)

/** A goal, with its `tiers` and the three derived tier pointers. */
@Entity(tableName = "goals")
data class GoalEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "json") val json: String,
)

/**
 * An `AgentProperty`.
 *
 * Keyed by `uid`, which is this collection's id field and not `key` — the one
 * collection in the protocol whose id is not called `id`.
 */
@Entity(tableName = "properties")
data class PropertyEntity(
    @PrimaryKey val uid: String,
    @ColumnInfo(name = "json") val json: String,
)

@Entity(tableName = "quests")
data class QuestEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "json") val json: String,
)

@Entity(tableName = "achievements")
data class AchievementEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "json") val json: String,
)

/**
 * The nine derived documents, each replaced whole.
 *
 * Keyed by name rather than given nine columns, because the protocol's unit of
 * change is the document: each is recomputed when the counter moves, hashed,
 * and sent **only if its bytes changed**. A row per document means applying a
 * delta touches exactly the documents that moved — completing a habit writes
 * `agenda`, `progress` and `insights` and leaves the other six alone, which is
 * both the cheapest thing to do and the easiest to reason about.
 *
 * Stored as text even for the two this client has no reader for
 * (`studySessions`, `gamification`), so a delta is applied faithfully rather
 * than being partly discarded by a type that does not mention them.
 *
 * `activeSession` is the awkward one and the reason [json] is nullable:
 * present-but-null is a **real value** meaning the session was cleared, and it
 * has to be distinguishable from the document being absent because it did not
 * change. Absent → no row written. Present-and-null → a row whose [json] is
 * null.
 */
@Entity(tableName = "sync_docs")
data class SyncDocEntity(
    @PrimaryKey val name: String,
    @ColumnInfo(name = "json") val json: String?,
)

/**
 * One row holding where this installation is in the protocol.
 *
 * ### The cursor
 *
 * Opaque. Stored, sent back as `since`, and never parsed, compared or ordered.
 * It is written **after** a response has been applied, never before: a crash
 * between the two costs one redundant delta, which is idempotent, whereas the
 * other order costs a change that is silently never applied.
 *
 * ### The mutation counter
 *
 * [lastMutationId] is the highest id this installation has *assigned*. The
 * server requires ids to be strictly sequential with **no holes** — a gap means
 * a mutation never arrived, so the whole batch is refused with `409` — which is
 * why an id is assigned when a write is first sent rather than when it is
 * enqueued. A write stranded by the client's own life-day guard never reaches
 * the wire and so never burns a number; if a hole appears anyway, the `409`
 * carries the server's own `lastMutationId` and the queue is renumbered from it.
 *
 * ### `clientId`
 *
 * Stable per installation, generated once. A reinstall is a new client and that
 * is correct: it has no queue and no cursor, so it is entitled to its own
 * numbering from 1.
 */
@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    /** Null until the first successful sync. Null means "cold sync me". */
    val cursor: String? = null,
    /** The last response's `ETag`, sent as `If-None-Match`. 314 bytes → 0. */
    val etag: String? = null,
    @ColumnInfo(name = "life_day_date") val lifeDayDate: String = "",
    @ColumnInfo(name = "life_day_start") val lifeDayStart: String? = null,
    @ColumnInfo(name = "life_day_end") val lifeDayEnd: String? = null,
    @ColumnInfo(name = "day_reset_time") val dayResetTime: String = "04:00",
    val timezone: String? = null,
    /**
     * The server's clock at the last answer, and the device's at the same
     * moment. The difference is the offset to correct by — a phone minutes out
     * would otherwise get the now-marker and the due reminders wrong.
     */
    @ColumnInfo(name = "server_time") val serverTime: String? = null,
    @ColumnInfo(name = "client_id") val clientId: String = "",
    @ColumnInfo(name = "last_mutation_id") val lastMutationId: Long = 0,
    @ColumnInfo(name = "fetched_at") val fetchedAt: Long = 0,
    /** Which server this state came from. A different server is a different life. */
    @ColumnInfo(name = "base_url") val baseUrl: String = "",
) {
    companion object {
        const val SINGLETON_ID = 1
    }
}
