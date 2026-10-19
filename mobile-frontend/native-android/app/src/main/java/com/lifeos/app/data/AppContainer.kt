package com.lifeos.app.data

import android.content.Context
import com.lifeos.app.data.api.ApiClient
import com.lifeos.app.data.api.LifeOsApi
import com.lifeos.app.data.db.LifeOsDatabase

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

    val repository by lazy {
        LifeOsRepository(
            snapshots = database.snapshots(),
            settingsStore = database.serverSettings(),
            writes = database.pendingWrites(),
            prefs = preferences,
            tokens = tokens,
            apiFactory = apiFactory,
        )
    }
}
