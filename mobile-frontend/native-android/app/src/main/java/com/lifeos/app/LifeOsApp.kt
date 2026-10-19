package com.lifeos.app

import android.app.Application
import com.lifeos.app.data.AppContainer
import com.lifeos.app.data.sync.SyncWorker

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
class LifeOsApp : Application() {
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

        // Best-effort background freshener. `KEEP`, so this is idempotent and
        // re-asking on every launch does not push the next run out.
        SyncWorker.schedulePeriodic(this)
    }
}
