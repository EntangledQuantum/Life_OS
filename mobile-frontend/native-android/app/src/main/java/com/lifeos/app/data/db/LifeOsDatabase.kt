package com.lifeos.app.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        SnapshotEntity::class,
        ServerSettingsEntity::class,
        PendingWriteEntity::class,
        FiredNotificationEntity::class,
    ],
    version = 3,
    exportSchema = true,
)
abstract class LifeOsDatabase : RoomDatabase() {
    abstract fun snapshots(): SnapshotDao
    abstract fun serverSettings(): ServerSettingsDao
    abstract fun pendingWrites(): PendingWriteDao
    abstract fun firedNotifications(): FiredNotificationDao

    companion object {
        /**
         * 1 → 2: `server_settings`.
         *
         * The dashboard payload carries no `settings` key, so settings are a
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

        fun build(context: Context): LifeOsDatabase =
            Room.databaseBuilder(context, LifeOsDatabase::class.java, "lifeos.db")
                /*
                 * The snapshot is a cache and can always be re-fetched, but
                 * pending_writes cannot — a destructive migration would silently
                 * drop writes the user believes they made. So migrations are
                 * written by hand from here on; there is no
                 * fallbackToDestructiveMigration.
                 */
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                .build()
    }
}
