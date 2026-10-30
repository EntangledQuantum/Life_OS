package com.lifeos.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/*
 * The `snapshot` table is gone as of version 5.
 *
 * It held the whole day as one opaque payload — first in a column, which
 * exceeded Android's 2 MB per-row `CursorWindow` limit and bricked the app, then
 * in a file beside the database, which did not crash but was still rewritten
 * whole on every poll. Protocol 4 sends rows and tombstones, so the day is
 * stored as rows: see [SyncEntities]. Nothing in this database is an unbounded
 * single-column blob any more, and nothing may become one again.
 */

/**
 * The server's settings, cached in one row.
 *
 * Still its own table under protocol 4, now fed by the `settings` **document**
 * rather than by a second `GET /api/v1/settings` — one fewer request per poll,
 * and the document only arrives when its bytes actually changed. The table is
 * kept rather than folded into `sync_docs` so that the settings an upgrading
 * install already has survive until the first protocol 4 response lands; a
 * screen that drew defaults for a few seconds after an upgrade would look like
 * the user's preferences had been lost.
 *
 * Its own table rather than a column on `snapshot` because the two arrive from
 * two different requests and either can fail on its own: a settings fetch that
 * fails must not discard a dashboard that succeeded, and an app that has never
 * reached `/settings` still has to draw Today.
 */
@Entity(tableName = "server_settings")
data class ServerSettingsEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    @ColumnInfo(name = "payload_json") val payloadJson: String,
    @ColumnInfo(name = "fetched_at") val fetchedAt: Long,
) {
    companion object {
        const val SINGLETON_ID = 1
    }
}

/**
 * `fired_notifications` — the once-only rule, made durable (§8.4).
 *
 * "Fire once and only once per item" has to survive a process death, or the
 * version of the bug the user actually notices is the one where every reminder
 * says itself again on the next cold start. An in-memory set cannot do that, so
 * the set is a table.
 *
 * The primary key is `<type>:<taskId>` rather than the task id alone, because a
 * Reminder fifteen minutes before a thing and a Due-now at the moment of it are
 * two different statements about the same task and the user is entitled to both.
 *
 * Being the primary key is the whole mechanism: the claim is an
 * `INSERT OR IGNORE`, so SQLite decides who fires and two callers racing cannot
 * both win. Nothing reads the set and then writes it.
 */
@Entity(tableName = "fired_notifications")
data class FiredNotificationEntity(
    /** `<NotificationType.key>:<task or goal id>`. */
    @PrimaryKey val key: String,
    @ColumnInfo(name = "fired_at") val firedAt: Long,
    /** Kept for the pruner and for answering "what did it say yesterday". */
    @ColumnInfo(name = "life_day_date") val lifeDayDate: String,
)

/**
 * `pending_writes` (§7.5).
 *
 * `lifeDayDate` is stamped when the user taps, not when the worker runs. That
 * one column is the whole life-day guard.
 */
@Entity(tableName = "pending_writes")
data class PendingWriteEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val kind: String,
    @ColumnInfo(name = "target_id") val targetId: String,
    @ColumnInfo(name = "payload_json") val payloadJson: String,
    @ColumnInfo(name = "life_day_date") val lifeDayDate: String,
    @ColumnInfo(name = "enqueued_at") val enqueuedAt: Long,
    val attempts: Int = 0,
    @ColumnInfo(name = "last_error") val lastError: String? = null,
    /** `PENDING` | `STRANDED`. */
    val state: String = "PENDING",
    @ColumnInfo(name = "strand_reason") val strandReason: String? = null,
    /** The stranded notice surfaces exactly once. This is how. */
    @ColumnInfo(name = "notice_shown") val noticeShown: Boolean = false,
    /** Earliest instant the drain may try this write again. */
    @ColumnInfo(name = "next_attempt_at") val nextAttemptAt: Long = 0,
    /**
     * The mutation number this write was sent under, or null if it has not been
     * sent yet.
     *
     * Protocol 4 identifies a write by a counter the client persists and
     * increments by exactly one, and the server refuses a batch with a **hole**
     * in it — `409`, resend from `lastMutationId + 1`. Two consequences, and
     * both are the reason this column exists rather than a plain counter:
     *
     *  - **The number is assigned when the write is first sent, not when it is
     *    enqueued.** A write the life-day guard strands never reaches the wire,
     *    and a number burned on it would be a hole that refuses every later
     *    write for good.
     *  - **The number is reused on every retry.** That is what makes a retry
     *    idempotent: the server answers `duplicate` and the user's habit is
     *    completed once, not once per attempt on a flaky link.
     */
    @ColumnInfo(name = "mutation_id") val mutationId: Long? = null,
)
