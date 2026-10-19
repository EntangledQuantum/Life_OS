package com.lifeos.app.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface SnapshotDao {
    /** The UI's only read. One row, so one nullable emission. */
    @Query("SELECT * FROM snapshot WHERE id = ${SnapshotEntity.SINGLETON_ID}")
    fun observe(): Flow<SnapshotEntity?>

    @Query("SELECT * FROM snapshot WHERE id = ${SnapshotEntity.SINGLETON_ID}")
    suspend fun get(): SnapshotEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(snapshot: SnapshotEntity)

    /** Saving a different server address clears the cache — a different life. */
    @Query("DELETE FROM snapshot")
    suspend fun clear()
}

@Dao
interface ServerSettingsDao {
    @Query("SELECT * FROM server_settings WHERE id = ${ServerSettingsEntity.SINGLETON_ID}")
    fun observe(): Flow<ServerSettingsEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(settings: ServerSettingsEntity)

    @Query("DELETE FROM server_settings")
    suspend fun clear()
}

@Dao
interface FiredNotificationDao {

    /**
     * Claim the right to fire, atomically.
     *
     * Returns the new row id, or **-1** when the key was already there — which
     * is `INSERT OR IGNORE` doing the de-duplication inside SQLite. A
     * read-the-set-then-decide version of this loses the race between the alarm
     * receiver and the in-app poll, and the user hears the same reminder twice.
     * The caller fires only on a non-negative result.
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun claim(row: FiredNotificationEntity): Long

    @Query("SELECT `key` FROM fired_notifications")
    suspend fun keys(): List<String>

    @Query("SELECT `key` FROM fired_notifications")
    fun observeKeys(): Flow<List<String>>

    /** Snooze and "it really did not fire" both need the claim released. */
    @Query("DELETE FROM fired_notifications WHERE `key` = :key")
    suspend fun release(key: String)

    /**
     * Keep the table small.
     *
     * A week is well past any horizon alarms are seeded over, so a pruned key
     * can never be re-fired by a task that is still live.
     */
    @Query("DELETE FROM fired_notifications WHERE fired_at < :before")
    suspend fun prune(before: Long)
}

@Dao
interface PendingWriteDao {
    @Query("SELECT * FROM pending_writes ORDER BY enqueued_at ASC, id ASC")
    fun observeAll(): Flow<List<PendingWriteEntity>>

    /**
     * The drain's queue, in enqueue order.
     *
     * Order matters and is not an implementation detail: a complete followed by
     * an undo of the same habit must arrive in that order, or the server ends up
     * with the opposite of what the user did.
     */
    @Query("SELECT * FROM pending_writes WHERE state = 'PENDING' ORDER BY enqueued_at ASC, id ASC")
    suspend fun pending(): List<PendingWriteEntity>

    @Query("SELECT * FROM pending_writes WHERE state = 'PENDING'")
    fun observePending(): Flow<List<PendingWriteEntity>>

    /** Stranded writes whose one-time notice has not been shown yet. */
    @Query("SELECT * FROM pending_writes WHERE state = 'STRANDED' AND notice_shown = 0 ORDER BY enqueued_at ASC")
    fun observeUnnoticedStranded(): Flow<List<PendingWriteEntity>>

    @Insert
    suspend fun insert(write: PendingWriteEntity): Long

    @Query("DELETE FROM pending_writes WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("UPDATE pending_writes SET attempts = :attempts, last_error = :error, next_attempt_at = :nextAttemptAt WHERE id = :id")
    suspend fun recordFailure(id: Long, attempts: Int, error: String?, nextAttemptAt: Long)

    @Query(
        "UPDATE pending_writes SET state = 'STRANDED', strand_reason = :reason, " +
            "last_error = :error, attempts = :attempts WHERE id = :id",
    )
    suspend fun strand(id: Long, reason: String, error: String?, attempts: Int)

    @Query("UPDATE pending_writes SET notice_shown = 1 WHERE state = 'STRANDED'")
    suspend fun markStrandedNoticeShown()

    /** Retry all: back to pending with the attempt count reset. */
    @Query("UPDATE pending_writes SET state = 'PENDING', attempts = 0, last_error = NULL, strand_reason = NULL, next_attempt_at = 0 WHERE state = 'STRANDED'")
    suspend fun retryAllStranded()

    @Query("DELETE FROM pending_writes")
    suspend fun clear()

    @Query("DELETE FROM pending_writes WHERE state = 'STRANDED'")
    suspend fun discardStranded()
}
