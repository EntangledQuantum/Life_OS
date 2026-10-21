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
import com.lifeos.app.domain.PairInvite
import com.lifeos.app.domain.PairLink
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

    /**
     * The QR pairing link that opened us, if one did (§7.3).
     *
     * Exactly the same two-path shape as [pendingTap], and for a stronger
     * reason: a notification tap can arrive while the app is alive, but a
     * pairing link almost never does. The phone is opening *because* the QR was
     * scanned, so the **cold start is the common case** — and 2.0.0 read only
     * notification extras, which is why scanning the QR in any other app opened
     * Life OS on Today and then did nothing at all. The manifest matched the
     * link; nothing read it.
     */
    private val pendingPair = mutableStateOf<PairInvite?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        val container = (application as LifeOsApp).container

        // Path one: the cold start.
        readTap(intent)
        readPairLink(intent)

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
                    pendingPair = pendingPair.value,
                    onPairRead = { pendingPair.value = null },
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
        readPairLink(intent)
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
     * The pairing deep link, from either path.
     *
     * `intent.data` is a `lifeos://pair?code=…&url=…` URL, whether it was fired
     * as that scheme or as the `intent://pair?…#Intent;scheme=lifeos;…` form
     * `apps/web` hands Android (Chrome will not follow a bare custom scheme from
     * a page it did not navigate to; the OS resolves the intent form to the same
     * data). `PairLink` is the only parser, and it is pure Kotlin so it is
     * unit-tested rather than only felt.
     *
     * **Nothing here is logged.** Not the URL, not the code — the code is traded
     * for the API token, so it is a credential for the five minutes it lives.
     *
     * The data is cleared off the intent once read, exactly as the notification
     * extras are. Without that, `configChanges` means every rotation re-reads
     * `getIntent()` and re-claims a code that is single-use and already spent,
     * turning a paired phone into "that code is no longer valid".
     */
    private fun readPairLink(intent: Intent?) {
        val data = intent?.data ?: return
        val invite = PairLink.parse(data.toString())
        // A link we do not recognise is dropped rather than surfaced. Any app
        // and any web page can fire one of these at us.
        if (invite != null) pendingPair.value = invite
        intent.data = null
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
