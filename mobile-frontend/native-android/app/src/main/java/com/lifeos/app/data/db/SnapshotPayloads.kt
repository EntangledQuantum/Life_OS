package com.lifeos.app.data.db

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Where the dashboard snapshot's JSON actually lives — a file, not a database
 * column.
 *
 * ## The crash this exists to stop
 *
 * Until 2.0.2 the whole `GET /api/v1/dashboard/today` body was one `TEXT`
 * column on a single-row table, and every read went through Room's `Flow`,
 * which goes through Android's `Cursor`. **A `CursorWindow` is 2 MB and that is
 * a hard limit per row.** On this user's instance the payload is **2.26 MB** —
 * habits and goals carry their artwork as inline base64, so it grows with the
 * number of pictures an agent has attached — and the first read after the first
 * successful fetch threw:
 *
 * ```
 * android.database.sqlite.SQLiteBlobTooBigException:
 *     Row too big to fit into CursorWindow requiredPos=0, totalRows=1
 *         at SnapshotDao_Impl.observe$lambda$1(SnapshotDao_Impl.kt:59)
 * ```
 *
 * which is an uncaught exception on the collector, which is the process. That
 * is the *"it crashed altogether after connecting"* the user reported: pair
 * successfully, fetch successfully, store successfully, die on the read — and
 * then die again on every launch, because the row is still there. It does not
 * reproduce against a small LAN instance or an older copy of the database,
 * because under about 2 MB of artwork there is no bug at all; the app simply
 * gets quietly closer to the cliff with every picture added.
 *
 * Storing it in a file removes the cliff rather than moving it: the row left in
 * SQLite is four small columns, and the payload is read with a plain file read
 * that has no size limit worth worrying about.
 *
 * **The write is atomic.** A snapshot is replaced by writing a temporary file
 * and renaming it over the old one, so a process killed mid-write — which on
 * ColorOS happens for reasons that have nothing to do with this app — leaves
 * either the previous snapshot or the new one, never half of either. A
 * truncated file would parse as nothing and show an empty dashboard, which is
 * the one failure worse than a stale one.
 */
interface SnapshotPayloads {
    suspend fun write(json: String)

    /** Null when there is none, or when it cannot be read. Never throws. */
    suspend fun read(): String?

    suspend fun clear()
}

/** The real one. [dir] is the app's private files directory. */
class FileSnapshotPayloads(private val dir: File) : SnapshotPayloads {

    private val file get() = File(dir, FILE_NAME)
    private val temp get() = File(dir, "$FILE_NAME.tmp")

    override suspend fun write(json: String) = withContext(Dispatchers.IO) {
        runCatching {
            dir.mkdirs()
            temp.writeText(json)
            // `renameTo` is atomic within one filesystem, which this is.
            if (!temp.renameTo(file)) {
                file.writeText(json)
                temp.delete()
            }
        }
        Unit
    }

    override suspend fun read(): String? = withContext(Dispatchers.IO) {
        runCatching { file.takeIf { it.exists() }?.readText() }.getOrNull()
    }

    override suspend fun clear() = withContext(Dispatchers.IO) {
        runCatching {
            file.delete()
            temp.delete()
        }
        Unit
    }

    private companion object {
        const val FILE_NAME = "dashboard-today.json"
    }
}
