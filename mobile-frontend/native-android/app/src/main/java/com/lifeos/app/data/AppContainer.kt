package com.lifeos.app.data

import android.content.Context
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.LifeOsApi
import com.lifeos.app.data.art.ArtOrigin
import com.lifeos.app.data.db.FileSnapshotPayloads
import com.lifeos.app.data.db.LifeOsDatabase
import com.lifeos.app.data.db.SnapshotPayloads
import com.lifeos.app.notify.ReminderCoordinator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * The object graph, built by hand.
 *
 * No DI framework: the graph is a dozen objects wide and every dependency is a
 * constructor argument, so a library would be a third thing to learn for no
 * shorter wiring and one more annotation processor in the build.
 */
class AppContainer(private val context: Context) {

    private val database by lazy { LifeOsDatabase.build(context) }

    val tokens by lazy { TokenStore(context) }
    val preferences by lazy { AppPreferences(context) }
    val probe by lazy { ServerProbe(tokens) }

    /**
     * The QR pairing claim.
     *
     * Not built from [apiFactory]: that cache is keyed on the address the app is
     * *already* configured for and its clients carry the stored token, and a
     * claim is unauthenticated against an address the app has never spoken to.
     */
    val pairClaim by lazy { PairClaim() }

    /**
     * Which origin an image request may carry the token to.
     *
     * Kept in step with preferences by the process (see `LifeOsApp`) rather than
     * read per request, because an OkHttp interceptor runs on a network thread
     * and `AppPreferences.baseUrl()` is a suspend read of DataStore.
     */
    val artOrigin by lazy { ArtOrigin() }

    /**
     * Retrofit instances are cached per address.
     *
     * Rebuilding one per request would re-create an OkHttp connection pool each
     * time, which on a LAN costs more than the request. Keyed by address because
     * "Change server" has to work without restarting the process.
     */
    private val apis = HashMap<String, LifeOsApi>()

    private val apiFactory: (String) -> LifeOsApi = { baseUrl ->
        synchronized(apis) {
            apis.getOrPut(ApiClient.normaliseBase(baseUrl)) {
                ApiClient.api(baseUrl, tokens)
            }
        }
    }

    /**
     * The 2.0.2 stopgap, kept only to delete what it left behind.
     *
     * The whole-day payload lived in a file beside the database, because the
     * same bytes in a `TEXT` column exceeded Android's 2 MB per-row
     * `CursorWindow` limit and threw `SQLiteBlobTooBigException` on every launch
     * once one had been stored. Protocol 4 stores rows, so nothing writes this
     * any more — but an upgrading install still has a 2.26 MB file sitting in
     * `filesDir`, and a SQL migration cannot unlink a file. So the file is
     * removed once, here, on the first construction of the graph after the
     * upgrade. Nothing reads it.
     */
    private val legacyPayloads: SnapshotPayloads by lazy { FileSnapshotPayloads(context.filesDir) }

    val repository by lazy {
        LifeOsRepository(
            habitsDao = database.habits(),
            tasksDao = database.tasks(),
            goalsDao = database.goals(),
            propertiesDao = database.properties(),
            questsDao = database.quests(),
            achievementsDao = database.achievements(),
            docsDao = database.syncDocs(),
            stateDao = database.syncState(),
            applyDao = database.syncApply(),
            settingsStore = database.serverSettings(),
            writes = database.pendingWrites(),
            prefs = preferences,
            tokens = tokens,
            apiFactory = apiFactory,
        )
    }

    /**
     * Reclaim the old payload file, once.
     *
     * Deliberately not in a `lazy` the app might never touch, and deliberately
     * not blocking: it is one `delete()` of a file that is no longer referenced
     * by anything, and if it fails the only cost is the disk space it was
     * already using.
     */
    suspend fun discardLegacySnapshot() {
        runCatching { legacyPayloads.clear() }
    }

    val firedNotifications by lazy { database.firedNotifications() }

    /**
     * The process's own scope.
     *
     * For the two things that outlive every `ViewModel` and every composition:
     * the reminder runner, and the broadcast receivers, which have no scope of
     * their own and whose process may be killed the moment `onReceive` returns.
     *
     * `SupervisorJob` so one failure cannot take the others down, and
     * deliberately never cancelled — its lifetime is the process's.
     */
    val appScope: CoroutineScope by lazy {
        CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }

    /**
     * The reminder runner (§8.4).
     *
     * **Not owned by a screen.** That is the lesson that transferred from the
     * old app, where the equivalent was mounted by Today and therefore did
     * nothing whenever the app opened anywhere else — which included every
     * notification tap.
     */
    val reminders by lazy {
        ReminderCoordinator(
            context = context,
            repository = repository,
            preferences = preferences,
            fired = firedNotifications,
            scope = appScope,
        )
    }
}
