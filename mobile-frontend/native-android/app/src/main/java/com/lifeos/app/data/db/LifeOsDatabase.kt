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
    version = 4,
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

        /**
         * 3 → 4: the dashboard payload leaves the database.
         *
         * `snapshot.payload_json` held the whole `dashboard/today` body, which
         * on a real instance is 2.26 MB of mostly inline base64 artwork — over
         * Android's 2 MB `CursorWindow` limit, so reading the row threw
         * `SQLiteBlobTooBigException` and killed the process on every launch
         * once one had been stored. The payload now lives in a file
         * ([SnapshotPayloads]) and this table keeps only the metadata.
         *
         * **Dropped rather than rebuilt**, and that is safe here precisely
         * because of the rule stated below: the snapshot is a cache, the next
         * poll refills it, and this migration does not go anywhere near
         * `pending_writes`. Copying the old column's contents out to a file
         * would mean reading the very row that cannot be read.
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

        fun build(context: Context): LifeOsDatabase =
            Room.databaseBuilder(context, LifeOsDatabase::class.java, "lifeos.db")
                /*
                 * The snapshot is a cache and can always be re-fetched, but
                 * pending_writes cannot — a destructive migration would silently
                 * drop writes the user believes they made. So migrations are
                 * written by hand from here on; there is no
                 * fallbackToDestructiveMigration.
                 */
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                .build()
    }
}
