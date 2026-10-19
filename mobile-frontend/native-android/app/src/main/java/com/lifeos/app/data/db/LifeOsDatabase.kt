package com.lifeos.app.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [SnapshotEntity::class, PendingWriteEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class LifeOsDatabase : RoomDatabase() {
    abstract fun snapshots(): SnapshotDao
    abstract fun pendingWrites(): PendingWriteDao

    companion object {
        fun build(context: Context): LifeOsDatabase =
            Room.databaseBuilder(context, LifeOsDatabase::class.java, "lifeos.db")
                /*
                 * The snapshot is a cache and can always be re-fetched, but
                 * pending_writes cannot — a destructive migration would silently
                 * drop writes the user believes they made. So migrations are
                 * written by hand from here on; there is no
                 * fallbackToDestructiveMigration.
                 */
                .build()
    }
}
