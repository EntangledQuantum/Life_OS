package com.lifeos.app.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        ServerSettingsEntity::class,
        PendingWriteEntity::class,
        FiredNotificationEntity::class,
        // Protocol 4: one row per thing.
        HabitEntity::class,
        TaskEntity::class,
        GoalEntity::class,
        PropertyEntity::class,
        QuestEntity::class,
        AchievementEntity::class,
        SyncDocEntity::class,
        SyncStateEntity::class,
    ],
    version = 5,
    exportSchema = true,
)
abstract class LifeOsDatabase : RoomDatabase() {
    abstract fun serverSettings(): ServerSettingsDao
    abstract fun pendingWrites(): PendingWriteDao
    abstract fun firedNotifications(): FiredNotificationDao

    abstract fun habits(): HabitDao
    abstract fun tasks(): TaskDao
    abstract fun goals(): GoalDao
    abstract fun properties(): PropertyDao
    abstract fun quests(): QuestDao
    abstract fun achievements(): AchievementDao
    abstract fun syncDocs(): SyncDocDao
    abstract fun syncState(): SyncStateDao
    abstract fun syncApply(): SyncApplyDao

    companion object {
        /**
         * 1 → 2: `server_settings`.
         *
         * The dashboard payload carried no `settings` key, so settings were a
         * second read with their own cache row. Written by hand rather than
         * generated, and additive only: it touches nothing in `pending_writes`,
         * which is the table that must survive every migration.
         */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `server_settings` (" +
                        "`id` INTEGER NOT NULL, " +
                        "`payload_json` TEXT NOT NULL, " +
                        "`fetched_at` INTEGER NOT NULL, " +
                        "PRIMARY KEY(`id`))",
                )
            }
        }

        /**
         * 2 → 3: `fired_notifications`.
         *
         * The once-only set (§8.4), which has to outlive the process. Additive
         * again, and again it does not touch `pending_writes`.
         */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `fired_notifications` (" +
                        "`key` TEXT NOT NULL, " +
                        "`fired_at` INTEGER NOT NULL, " +
                        "`life_day_date` TEXT NOT NULL, " +
                        "PRIMARY KEY(`key`))",
                )
            }
        }

        /**
         * 3 → 4: the dashboard payload leaves the database.
         *
         * `snapshot.payload_json` held the whole `dashboard/today` body, which
         * on a real instance is 2.26 MB of mostly inline base64 artwork — over
         * Android's 2 MB `CursorWindow` limit, so reading the row threw
         * `SQLiteBlobTooBigException` and killed the process on every launch
         * once one had been stored. The payload moved to a file and this table
         * kept only the metadata.
         *
         * Kept verbatim although `snapshot` no longer exists at version 5: a
         * migration is a historical record and an install still on 3 has to be
         * able to walk through it to get here.
         */
        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("DROP TABLE IF EXISTS `snapshot`")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `snapshot` (" +
                        "`id` INTEGER NOT NULL, " +
                        "`fetched_at` INTEGER NOT NULL, " +
                        "`life_day_date` TEXT NOT NULL, " +
                        "`base_url` TEXT NOT NULL, " +
                        "PRIMARY KEY(`id`))",
                )
            }
        }

        /**
         * 4 → 5: **protocol 4 — the day becomes rows.**
         *
         * The one migration in this app's history that changes how the day is
         * stored rather than where. Until now the whole day was a single opaque
         * payload: a 2.26 MB column (version 3, which crashed), then a 2.26 MB
         * file beside the database (version 4, which did not crash but was still
         * rewritten whole on every poll). Protocol 4 sends rows and tombstones,
         * so this creates the six keyed collections, the nine documents and the
         * one state row, and the blob is gone for good.
         *
         * ### What is preserved, and what is not
         *
         * **`pending_writes` is preserved, and that is the whole risk of this
         * migration.** It is the one table that cannot be re-fetched: it holds
         * writes the user believes they made, each stamped with the life-day it
         * was made in. So it is `ALTER TABLE ... ADD COLUMN`, which SQLite does
         * in place without touching a row, and never a recreate. A destructive
         * migration here would silently discard someone's morning.
         *
         * `fired_notifications` is preserved too: it is the durable "fire once"
         * set, and dropping it would make every reminder say itself again on the
         * next launch.
         *
         * `server_settings` is preserved because it still has a reader — the
         * `settings` document is written into it, so the settings the UI draws
         * survive an upgrade even before the first protocol 4 response lands.
         *
         * **`snapshot` is dropped.** It is a cache, the next poll refills it, and
         * nothing reads it any more. The 2.26 MB payload *file* it referred to is
         * deleted separately, by [SnapshotPayloads.clear] on first run, because a
         * SQL migration cannot unlink a file and leaving it would waste the
         * user's storage forever.
         *
         * ### Why no data is carried across
         *
         * Nothing attempts to translate the old payload into the new rows, and
         * that is deliberate rather than lazy. The old body is a v3 payload: its
         * tasks have none of the four window instants, its artwork is inline
         * base64 rather than asset URLs, and its `current`, `dueReminders` and
         * `timeline` are server-computed values that protocol 4 does not accept.
         * Rows built from it would be wrong in exactly the ways this release
         * exists to fix, and they would be indistinguishable from correct ones.
         * The first sync after upgrading is a cold sync — `reset: true`, 303,815
         * bytes once — and then the app is current. One cold sync is a far better
         * trade than a day's worth of subtly wrong rows that never get corrected
         * because the server thinks the client already has them.
         */
        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // The six collections. Keyed by the server's own ids, so a
                // replayed delta is an idempotent REPLACE of a row with itself.
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `habits` (" +
                        "`id` TEXT NOT NULL, `json` TEXT NOT NULL, PRIMARY KEY(`id`))",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `tasks` (" +
                        "`id` TEXT NOT NULL, " +
                        "`status` TEXT NOT NULL, " +
                        "`slot` INTEGER, " +
                        "`kind` TEXT NOT NULL, " +
                        "`show_at` TEXT, " +
                        "`current_from` TEXT, " +
                        "`current_until` TEXT, " +
                        "`due_from` TEXT, " +
                        "`due_until` TEXT, " +
                        "`notified_at` TEXT, " +
                        "`json` TEXT NOT NULL, " +
                        "PRIMARY KEY(`id`))",
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_tasks_status` ON `tasks` (`status`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_tasks_slot` ON `tasks` (`slot`)")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `goals` (" +
                        "`id` TEXT NOT NULL, `json` TEXT NOT NULL, PRIMARY KEY(`id`))",
                )
                // `uid`, not `id`: the one collection whose id field is named
                // something else, and getting it wrong would tombstone nothing.
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `properties` (" +
                        "`uid` TEXT NOT NULL, `json` TEXT NOT NULL, PRIMARY KEY(`uid`))",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `quests` (" +
                        "`id` TEXT NOT NULL, `json` TEXT NOT NULL, PRIMARY KEY(`id`))",
                )
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `achievements` (" +
                        "`id` TEXT NOT NULL, `json` TEXT NOT NULL, PRIMARY KEY(`id`))",
                )

                // The nine documents. `json` is nullable because an
                // `activeSession` that arrived as an explicit null means the
                // session was cleared, which is a value and not an absence.
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `sync_docs` (" +
                        "`name` TEXT NOT NULL, `json` TEXT, PRIMARY KEY(`name`))",
                )

                // Where this installation is in the protocol.
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `sync_state` (" +
                        "`id` INTEGER NOT NULL, " +
                        "`cursor` TEXT, " +
                        "`etag` TEXT, " +
                        "`life_day_date` TEXT NOT NULL, " +
                        "`life_day_start` TEXT, " +
                        "`life_day_end` TEXT, " +
                        "`day_reset_time` TEXT NOT NULL, " +
                        "`timezone` TEXT, " +
                        "`server_time` TEXT, " +
                        "`client_id` TEXT NOT NULL, " +
                        "`last_mutation_id` INTEGER NOT NULL, " +
                        "`fetched_at` INTEGER NOT NULL, " +
                        "`base_url` TEXT NOT NULL, " +
                        "PRIMARY KEY(`id`))",
                )

                /*
                 * The queue keeps its rows and gains one column.
                 *
                 * `mutation_id` is the number a queued write was sent under. It
                 * is assigned when the write first goes to `/sync/push` and
                 * reused on every retry, which is what lets the server recognise
                 * a retry as a `duplicate` instead of completing a habit twice.
                 * Null means "not yet sent", which is correct for every row that
                 * already exists at the moment of this upgrade.
                 *
                 * ADD COLUMN, so SQLite rewrites no rows and the user's unsent
                 * writes survive with their life-day stamps intact.
                 */
                db.execSQL("ALTER TABLE `pending_writes` ADD COLUMN `mutation_id` INTEGER")

                // The payload row is dead. Its file is deleted on first run.
                db.execSQL("DROP TABLE IF EXISTS `snapshot`")
            }
        }

        fun build(context: Context): LifeOsDatabase =
            Room.databaseBuilder(context, LifeOsDatabase::class.java, "lifeos.db")
                /*
                 * The day is a cache and can always be re-synced, but
                 * pending_writes cannot — a destructive migration would silently
                 * drop writes the user believes they made. So migrations are
                 * written by hand; there is no fallbackToDestructiveMigration,
                 * and there must never be one.
                 */
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
                .build()
    }
}
