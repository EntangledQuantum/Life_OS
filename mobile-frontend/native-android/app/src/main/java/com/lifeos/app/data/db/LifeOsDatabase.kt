package com.lifeos.app.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [SnapshotEntity::class, ServerSettingsEntity::class, PendingWriteEntity::class],
    version = 2,
    exportSchema = true,
)
abstract class LifeOsDatabase : RoomDatabase() {
    abstract fun snapshots(): SnapshotDao
    abstract fun serverSettings(): ServerSettingsDao
    abstract fun pendingWrites(): PendingWriteDao

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

        fun build(context: Context): LifeOsDatabase =
            Room.databaseBuilder(context, LifeOsDatabase::class.java, "lifeos.db")
                /*
                 * The snapshot is a cache and can always be re-fetched, but
                 * pending_writes cannot — a destructive migration would silently
                 * drop writes the user believes they made. So migrations are
                 * written by hand from here on; there is no
                 * fallbackToDestructiveMigration.
                 */
                .addMigrations(MIGRATION_1_2)
                .build()
    }
}
