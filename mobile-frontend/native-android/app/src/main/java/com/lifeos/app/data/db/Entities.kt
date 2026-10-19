package com.lifeos.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * The snapshot table (UI_SPEC §7.1).
 *
 * One row, id 1. It holds the latest `GET /api/v1/dashboard/today` response plus
 * `fetchedAt`, so a cold start renders real content in the first frame rather
 * than a spinner.
 *
 * **Deviation from §7.1, stated plainly:** the spec says "as parsed entities".
 * The payload is stored as its JSON text and deserialised on read instead. The
 * reason is that the dashboard is a single atomic read — twenty normalised
 * tables would have to be written in one transaction and re-joined on every
 * emission to reconstruct exactly what arrived, and the only query anything
 * actually makes is "give me the whole snapshot". The properties that mattered
 * are kept: Room is still the only thing the UI reads, the read is still a Flow,
 * and the cache still survives the process. `lifeDayDate` is denormalised into a
 * column because the write queue's guard needs it without parsing the payload.
 */
@Entity(tableName = "snapshot")
data class SnapshotEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    /** The raw `dashboard/today` body. */
    @ColumnInfo(name = "payload_json") val payloadJson: String,
    /** When this snapshot arrived. The status strip shows it, so "stale" is a fact. */
    @ColumnInfo(name = "fetched_at") val fetchedAt: Long,
    /** `lifeDay.date` as the server reported it. The guard compares against this. */
    @ColumnInfo(name = "life_day_date") val lifeDayDate: String,
    /** Which server this came from. A different server is a different life. */
    @ColumnInfo(name = "base_url") val baseUrl: String,
) {
    companion object {
        const val SINGLETON_ID = 1
    }
}

/**
 * The server's settings, cached in one row beside the snapshot.
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
)
