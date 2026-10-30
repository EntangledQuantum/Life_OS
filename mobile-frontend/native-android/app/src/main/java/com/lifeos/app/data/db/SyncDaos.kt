package com.lifeos.app.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

/**
 * Reading and applying protocol 4's rows.
 *
 * Every collection gets the same three operations — observe, upsert, delete by
 * id — because the protocol gives every collection the same three events:
 * something changed, something was tombstoned, start again. The uniformity is
 * the point: there is no collection with a special path that could be the one
 * that forgets to handle a tombstone.
 *
 * **Upserts are `REPLACE`**, which is what idempotency means here. The same
 * delta applied twice must leave the same rows, and it will: the server sends
 * whole rows keyed by their own ids, so a replay overwrites a row with itself.
 */

@Dao
interface HabitDao {
    @Query("SELECT * FROM habits")
    fun observe(): Flow<List<HabitEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(rows: List<HabitEntity>)

    @Query("DELETE FROM habits WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("DELETE FROM habits")
    suspend fun clear()

    @Query("SELECT COUNT(*) FROM habits")
    suspend fun count(): Int
}

@Dao
interface TaskDao {
    @Query("SELECT * FROM tasks")
    fun observe(): Flow<List<TaskEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(rows: List<TaskEntity>)

    @Query("DELETE FROM tasks WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("DELETE FROM tasks")
    suspend fun clear()

    @Query("SELECT COUNT(*) FROM tasks")
    suspend fun count(): Int

    /**
     * The candidates for a reminder, narrowed in SQL rather than in Kotlin.
     *
     * `dueFrom IS NOT NULL AND notifiedAt IS NULL` is the part of
     * `isReminderDueAt` that needs no clock, so the alarm scheduler can ask for
     * the handful of tasks that could ever chime instead of loading all 213 and
     * filtering. The clock comparison still happens in [SyncMath]; this only
     * avoids reading rows that can be excluded without one.
     */
    @Query(
        "SELECT * FROM tasks WHERE due_from IS NOT NULL AND (notified_at IS NULL OR notified_at = '') " +
            "AND status NOT IN ('done', 'dismissed')",
    )
    suspend fun remindable(): List<TaskEntity>
}

@Dao
interface GoalDao {
    @Query("SELECT * FROM goals")
    fun observe(): Flow<List<GoalEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(rows: List<GoalEntity>)

    @Query("DELETE FROM goals WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("DELETE FROM goals")
    suspend fun clear()
}

@Dao
interface PropertyDao {
    @Query("SELECT * FROM properties")
    fun observe(): Flow<List<PropertyEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(rows: List<PropertyEntity>)

    @Query("DELETE FROM properties WHERE uid IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("DELETE FROM properties")
    suspend fun clear()
}

@Dao
interface QuestDao {
    @Query("SELECT * FROM quests")
    fun observe(): Flow<List<QuestEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(rows: List<QuestEntity>)

    @Query("DELETE FROM quests WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("DELETE FROM quests")
    suspend fun clear()
}

@Dao
interface AchievementDao {
    @Query("SELECT * FROM achievements")
    fun observe(): Flow<List<AchievementEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(rows: List<AchievementEntity>)

    @Query("DELETE FROM achievements WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("DELETE FROM achievements")
    suspend fun clear()
}

@Dao
interface SyncDocDao {
    @Query("SELECT * FROM sync_docs")
    fun observe(): Flow<List<SyncDocEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(rows: List<SyncDocEntity>)

    @Query("DELETE FROM sync_docs")
    suspend fun clear()
}

@Dao
interface SyncStateDao {
    @Query("SELECT * FROM sync_state WHERE id = ${SyncStateEntity.SINGLETON_ID}")
    fun observe(): Flow<SyncStateEntity?>

    @Query("SELECT * FROM sync_state WHERE id = ${SyncStateEntity.SINGLETON_ID}")
    suspend fun get(): SyncStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(state: SyncStateEntity)

    @Query("DELETE FROM sync_state")
    suspend fun clear()

    /**
     * The cursor and the `ETag`, written **after** a delta has been applied.
     *
     * Its own statement rather than a whole-row `put`, so advancing the cursor
     * cannot accidentally rewrite the mutation counter with a stale copy read
     * before the push that moved it.
     */
    @Query(
        "UPDATE sync_state SET cursor = :cursor, etag = :etag, life_day_date = :lifeDayDate, " +
            "life_day_start = :lifeDayStart, life_day_end = :lifeDayEnd, " +
            "day_reset_time = :dayResetTime, timezone = :timezone, server_time = :serverTime, " +
            "fetched_at = :fetchedAt, base_url = :baseUrl WHERE id = ${SyncStateEntity.SINGLETON_ID}",
    )
    suspend fun advance(
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
    )

    /** Only `fetchedAt` moves on a `304`: nothing changed, so nothing else may. */
    @Query("UPDATE sync_state SET fetched_at = :fetchedAt WHERE id = ${SyncStateEntity.SINGLETON_ID}")
    suspend fun touch(fetchedAt: Long)

    @Query("UPDATE sync_state SET last_mutation_id = :id WHERE id = ${SyncStateEntity.SINGLETON_ID}")
    suspend fun setLastMutationId(id: Long)
}

/**
 * The whole delta, applied as one transaction.
 *
 * A `@Transaction` method on an abstract DAO rather than a sequence of calls in
 * the repository, and that is the point of this class existing: the UI reads
 * Room through a `Flow`, so a half-applied delta is not a transient
 * inconsistency, it is a **frame the user sees**. Applying ten collections with
 * ten separate writes would emit up to ten times and draw a day where the
 * agenda has moved on but progress has not — or, on a reset, a day that is
 * briefly empty.
 *
 * The order is the contract's, from SYNC.md §5:
 *
 *  1. if `reset`, drop everything held;
 *  2. upsert each changed entity by its id;
 *  3. delete each tombstoned id;
 *  4. replace each document that arrived;
 *  5. store the cursor.
 *
 * The cursor is written **last and inside the same transaction**, so it is
 * impossible to hold a cursor for a delta that was not applied. A crash costs
 * one redundant delta, which is idempotent; the other order silently loses a
 * change for good.
 */
@Dao
abstract class SyncApplyDao {

    @Transaction
    open suspend fun apply(delta: SyncDelta) {
        if (delta.reset) {
            clearHabits()
            clearTasks()
            clearGoals()
            clearProperties()
            clearQuests()
            clearAchievements()
            clearDocs()
        }

        if (delta.habits.isNotEmpty()) upsertHabits(delta.habits)
        if (delta.tasks.isNotEmpty()) upsertTasks(delta.tasks)
        if (delta.goals.isNotEmpty()) upsertGoals(delta.goals)
        if (delta.properties.isNotEmpty()) upsertProperties(delta.properties)
        if (delta.quests.isNotEmpty()) upsertQuests(delta.quests)
        if (delta.achievements.isNotEmpty()) upsertAchievements(delta.achievements)

        if (delta.deletedHabits.isNotEmpty()) deleteHabits(delta.deletedHabits)
        if (delta.deletedTasks.isNotEmpty()) deleteTasks(delta.deletedTasks)
        if (delta.deletedGoals.isNotEmpty()) deleteGoals(delta.deletedGoals)
        if (delta.deletedProperties.isNotEmpty()) deleteProperties(delta.deletedProperties)
        if (delta.deletedQuests.isNotEmpty()) deleteQuests(delta.deletedQuests)
        if (delta.deletedAchievements.isNotEmpty()) deleteAchievements(delta.deletedAchievements)

        if (delta.docs.isNotEmpty()) upsertDocs(delta.docs)

        // A reset wipes the singleton too, so the row has to be (re)created
        // rather than updated — `advance` would update nothing.
        val existing = state()
        if (existing == null) {
            put(
                SyncStateEntity(
                    cursor = delta.cursor,
                    etag = delta.etag,
                    lifeDayDate = delta.lifeDayDate,
                    lifeDayStart = delta.lifeDayStart,
                    lifeDayEnd = delta.lifeDayEnd,
                    dayResetTime = delta.dayResetTime,
                    timezone = delta.timezone,
                    serverTime = delta.serverTime,
                    clientId = delta.clientId,
                    lastMutationId = 0,
                    fetchedAt = delta.fetchedAt,
                    baseUrl = delta.baseUrl,
                ),
            )
        } else {
            advance(
                cursor = delta.cursor,
                etag = delta.etag,
                lifeDayDate = delta.lifeDayDate,
                lifeDayStart = delta.lifeDayStart,
                lifeDayEnd = delta.lifeDayEnd,
                dayResetTime = delta.dayResetTime,
                timezone = delta.timezone,
                serverTime = delta.serverTime,
                fetchedAt = delta.fetchedAt,
                baseUrl = delta.baseUrl,
            )
        }
    }

    /**
     * Forget this server entirely — "Change server", and a `401`.
     *
     * One transaction for the same reason as [apply]: a cleared day that still
     * has a cursor would poll for a delta against state it no longer holds and
     * be told "nothing changed" forever.
     */
    @Transaction
    open suspend fun clearAll() {
        clearHabits()
        clearTasks()
        clearGoals()
        clearProperties()
        clearQuests()
        clearAchievements()
        clearDocs()
        clearState()
    }

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertHabits(rows: List<HabitEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertTasks(rows: List<TaskEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertGoals(rows: List<GoalEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertProperties(rows: List<PropertyEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertQuests(rows: List<QuestEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertAchievements(rows: List<AchievementEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertDocs(rows: List<SyncDocEntity>)

    @Query("DELETE FROM habits WHERE id IN (:ids)")
    abstract suspend fun deleteHabits(ids: List<String>)

    @Query("DELETE FROM tasks WHERE id IN (:ids)")
    abstract suspend fun deleteTasks(ids: List<String>)

    @Query("DELETE FROM goals WHERE id IN (:ids)")
    abstract suspend fun deleteGoals(ids: List<String>)

    @Query("DELETE FROM properties WHERE uid IN (:ids)")
    abstract suspend fun deleteProperties(ids: List<String>)

    @Query("DELETE FROM quests WHERE id IN (:ids)")
    abstract suspend fun deleteQuests(ids: List<String>)

    @Query("DELETE FROM achievements WHERE id IN (:ids)")
    abstract suspend fun deleteAchievements(ids: List<String>)

    @Query("DELETE FROM habits")
    abstract suspend fun clearHabits()

    @Query("DELETE FROM tasks")
    abstract suspend fun clearTasks()

    @Query("DELETE FROM goals")
    abstract suspend fun clearGoals()

    @Query("DELETE FROM properties")
    abstract suspend fun clearProperties()

    @Query("DELETE FROM quests")
    abstract suspend fun clearQuests()

    @Query("DELETE FROM achievements")
    abstract suspend fun clearAchievements()

    @Query("DELETE FROM sync_docs")
    abstract suspend fun clearDocs()

    @Query("DELETE FROM sync_state")
    abstract suspend fun clearState()

    @Query("SELECT * FROM sync_state WHERE id = ${SyncStateEntity.SINGLETON_ID}")
    abstract suspend fun state(): SyncStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun put(state: SyncStateEntity)

    @Query(
        "UPDATE sync_state SET cursor = :cursor, etag = :etag, life_day_date = :lifeDayDate, " +
            "life_day_start = :lifeDayStart, life_day_end = :lifeDayEnd, " +
            "day_reset_time = :dayResetTime, timezone = :timezone, server_time = :serverTime, " +
            "fetched_at = :fetchedAt, base_url = :baseUrl WHERE id = ${SyncStateEntity.SINGLETON_ID}",
    )
    abstract suspend fun advance(
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
    )
}

/**
 * One delta, already turned into rows, ready to be written.
 *
 * A plain value rather than the wire DTO, so the mapping from JSON to rows
 * happens once — off the main thread, in the repository — and the transaction
 * itself does no parsing. The transaction holds the database's write lock, and
 * deserialising 300 KB inside it would hold that lock across the parse.
 */
data class SyncDelta(
    val reset: Boolean,
    val habits: List<HabitEntity> = emptyList(),
    val tasks: List<TaskEntity> = emptyList(),
    val goals: List<GoalEntity> = emptyList(),
    val properties: List<PropertyEntity> = emptyList(),
    val quests: List<QuestEntity> = emptyList(),
    val achievements: List<AchievementEntity> = emptyList(),
    val deletedHabits: List<String> = emptyList(),
    val deletedTasks: List<String> = emptyList(),
    val deletedGoals: List<String> = emptyList(),
    val deletedProperties: List<String> = emptyList(),
    val deletedQuests: List<String> = emptyList(),
    val deletedAchievements: List<String> = emptyList(),
    val docs: List<SyncDocEntity> = emptyList(),
    val cursor: String?,
    val etag: String?,
    val lifeDayDate: String,
    val lifeDayStart: String?,
    val lifeDayEnd: String?,
    val dayResetTime: String,
    val timezone: String?,
    val serverTime: String?,
    val clientId: String,
    val fetchedAt: Long,
    val baseUrl: String,
)
