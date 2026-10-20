package com.lifeos.app

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.lifeos.app.data.AppPrefs
import com.lifeos.app.notify.Notifier
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

    /**
     * The notification that opened us, if one did (§8.4).
     *
     * Compose state rather than a field, so the composition reacts to
     * `onNewIntent` without a recreate. Both paths write it, and they both have
     * to exist: the subscription alone misses the **cold start**, which is the
     * common case because the notification is why the app is opening.
     */
    private val pendingTap = mutableStateOf<Pair<String, String>?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        val container = (application as LifeOsApp).container

        // Path one: the cold start.
        readTap(intent)

        setContent {
            val flow = remember { container.preferences.prefs }
            val prefs by flow.collectAsStateWithLifecycle(initialValue = AppPrefs())

            LifeOsTheme(
                palette = Palettes.byId(prefs.paletteId),
                reducedMotion = prefs.reducedMotionLocal || osReducedMotion(),
            ) {
                LifeOsRoot(
                    container = container,
                    pendingTap = pendingTap.value,
                    onTapRead = { pendingTap.value = null },
                )
            }
        }
    }

    /**
     * Path two: the app was already running.
     *
     * `launchMode` is default and the tap intent carries
     * `FLAG_ACTIVITY_SINGLE_TOP`, so a tap while the app is alive arrives here
     * rather than starting a second Activity on top of the first.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readTap(intent)
    }

    private fun readTap(intent: Intent?) {
        val type = intent?.getStringExtra(Notifier.EXTRA_TYPE) ?: return
        val target = intent.getStringExtra(Notifier.EXTRA_TARGET) ?: return
        pendingTap.value = type to target
        /*
         * Cleared off the intent once read. Without this, every configuration
         * change that re-reads `getIntent()` re-opens the sheet the user just
         * closed — and `configChanges` in the manifest means that is a resize,
         * not a recreate, which makes it look random.
         */
        intent.removeExtra(Notifier.EXTRA_TYPE)
        intent.removeExtra(Notifier.EXTRA_TARGET)
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
