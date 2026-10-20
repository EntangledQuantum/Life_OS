package com.lifeos.app

import android.app.Application
import android.content.Context
import coil3.ImageLoader
import coil3.SingletonImageLoader
import com.lifeos.app.data.AppContainer
import com.lifeos.app.data.art.ArtLoader
import com.lifeos.app.data.sync.SyncWorker
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The process.
 *
 * There is no dependency-injection framework: the graph is small, built once
 * here, and every dependency is a plain constructor argument. A DI library would
 * be a third thing to learn for no shorter wiring.
 *
 * Nothing in this class — or anywhere in the app — initialises telemetry,
 * analytics or crash reporting. That is a product promise, not an oversight.
 */
class LifeOsApp : Application(), SingletonImageLoader.Factory {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)

        /*
         * The reminder runner is started here and nowhere else (§8.4).
         *
         * Not from a screen: in the old app the equivalent was mounted by Today,
         * so if the app opened anywhere else — which includes every notification
         * tap — nothing was ever registered with the OS. `onCreate` runs before
         * any Activity and before any `WorkManager` worker in this process, so
         * both the cold-start path and the background-sync path are covered by
         * one call.
         *
         * It only collects Room, so this costs nothing until a snapshot exists.
         */
        container.reminders.start()

        /*
         * Keep the image loader's notion of "the user's own server" in step with
         * the configured address.
         *
         * The token rides along only on requests to this origin, so "Change
         * server" has to reach images at the same moment it reaches every other
         * request — otherwise the first picture after a server change either
         * fails `401` or, far worse, sends the old server's token to the new
         * one's host.
         */
        container.appScope.launch {
            container.preferences.prefs
                .map { it.baseUrl }
                .distinctUntilChanged()
                .collect { container.artOrigin.set(it) }
        }

        // Best-effort background freshener. `KEEP`, so this is idempotent and
        // re-asking on every launch does not push the next run out.
        SyncWorker.schedulePeriodic(this)
    }

    /**
     * The one image loader, built here so every surface shares one memory cache
     * and one disk cache.
     *
     * Called lazily on the first image request, which is always after
     * `onCreate`, so `container` is there. See [ArtLoader] for why the network
     * layer is this app's own OkHttp and nothing else.
     */
    override fun newImageLoader(context: Context): ImageLoader =
        ArtLoader.create(context, container.tokens, container.artOrigin)
}
