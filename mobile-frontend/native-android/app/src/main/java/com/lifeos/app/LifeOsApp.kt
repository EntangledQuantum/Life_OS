package com.lifeos.app

import android.app.Application
import com.lifeos.app.data.AppContainer

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
    }
}
