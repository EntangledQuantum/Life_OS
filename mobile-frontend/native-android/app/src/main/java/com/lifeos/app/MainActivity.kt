package com.lifeos.app

import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.lifeos.app.data.AppPrefs
import com.lifeos.app.ui.LifeOsRoot
import com.lifeos.app.ui.theme.LifeOsTheme
import com.lifeos.app.ui.theme.Palettes

/**
 * The single Activity.
 *
 * `configChanges` in the manifest keeps the process alive across rotation and
 * split-screen resizes, because the window size class is read live
 * (`currentWindowAdaptiveInfo`) rather than from a device type — Android resizes
 * the app while it runs, and a recreate on every drag would throw away the
 * agenda's ordering epoch and re-sort the list under the user's finger.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        val container = (application as LifeOsApp).container

        setContent {
            val flow = remember { container.preferences.prefs }
            val prefs by flow.collectAsStateWithLifecycle(initialValue = AppPrefs())

            LifeOsTheme(
                palette = Palettes.byId(prefs.paletteId),
                reducedMotion = prefs.reducedMotionLocal || osReducedMotion(),
            ) {
                LifeOsRoot(container = container)
            }
        }
    }

    /**
     * The OS's own reduced-motion setting (§5.6), OR'd with the app's.
     *
     * `ANIMATOR_DURATION_SCALE == 0` is what "Remove animations" in accessibility
     * settings actually sets. Either one being on means reduced.
     */
    private fun osReducedMotion(): Boolean = runCatching {
        Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }.getOrDefault(false)
}
