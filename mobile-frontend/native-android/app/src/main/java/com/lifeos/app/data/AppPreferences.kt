package com.lifeos.app.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore("lifeos_prefs")

/**
 * Device-local app settings. **The token is not here** — it is in
 * Keystore-backed `EncryptedSharedPreferences` (see [TokenStore]).
 *
 * The palette lives here rather than on the server: it is the app's theme, and
 * `settings.accentTheme` is a server setting that drives the website. Neither is
 * written from the other, and the "Web app accent" control that used to blur the
 * two is deleted (§9).
 */
data class AppPrefs(
    val baseUrl: String? = null,
    /** Addresses only, never paired with tokens. The realistic failure is a changed LAN IP. */
    val recentAddresses: List<String> = emptyList(),
    val paletteId: String = "bloom",
    /** OR'd with the OS animator scale at the point of use (§5.6). */
    val reducedMotionLocal: Boolean = false,
    /**
     * Per-notification-type sound, by `NotificationType.key` → `SoundId.wire`.
     *
     * **Device-local, and that is a decision.** The server has one
     * `notificationSound`, which this app reads as the *default* for Reminder
     * and Due-now so the phone agrees with the dashboard out of the box. But a
     * sound is bound to an Android channel and therefore to this device and this
     * install: writing a per-type choice back to the server would describe one
     * phone's channels to every client, and the web client has no channels at
     * all. Same reasoning as the palette (§9.1).
     *
     * A type absent from the map has not been chosen and falls back —
     * see `NotificationSounds.resolve`.
     */
    val notificationSounds: Map<String, String> = emptyMap(),
    /**
     * Whether the in-context `POST_NOTIFICATIONS` rationale has been shown.
     *
     * §8.2 asks for the permission the first time the user is about to rely on
     * a reminder, never on first launch cold. This is how "the first time" is
     * remembered across processes, so a denial is not re-asked on every resume.
     */
    val notificationPermissionAsked: Boolean = false,
)

/**
 * The two things the repository needs from preferences.
 *
 * Narrow on purpose: the repository must be constructible in a unit test without
 * an Android `Context`, and the life-day guard and the queue ordering are exactly
 * the logic worth testing.
 */
interface ConnectionConfig {
    suspend fun baseUrl(): String?
    suspend fun setBaseUrl(url: String)
}

class AppPreferences(private val context: Context) : ConnectionConfig {

    val prefs: Flow<AppPrefs> = context.dataStore.data.map { p ->
        AppPrefs(
            baseUrl = p[KEY_BASE_URL],
            recentAddresses = p[KEY_RECENT]?.split(RECENT_SEPARATOR)?.filter { it.isNotBlank() }
                ?: emptyList(),
            paletteId = p[KEY_PALETTE] ?: "bloom",
            reducedMotionLocal = p[KEY_REDUCED_MOTION] ?: false,
            notificationSounds = decodeSounds(p[KEY_NOTIFICATION_SOUNDS]),
            notificationPermissionAsked = p[KEY_PERMISSION_ASKED] ?: false,
        )
    }

    suspend fun current(): AppPrefs = prefs.first()

    override suspend fun baseUrl(): String? = current().baseUrl

    override suspend fun setBaseUrl(url: String) {
        context.dataStore.edit { p ->
            p[KEY_BASE_URL] = url
            val existing = p[KEY_RECENT]?.split(RECENT_SEPARATOR)?.filter { it.isNotBlank() }
                ?: emptyList()
            // Most recent first, de-duplicated, capped — this is a convenience,
            // not a history.
            p[KEY_RECENT] = (listOf(url) + existing.filter { it != url })
                .take(MAX_RECENT)
                .joinToString(RECENT_SEPARATOR)
        }
    }

    suspend fun setPalette(id: String) {
        context.dataStore.edit { it[KEY_PALETTE] = id }
    }

    suspend fun setReducedMotion(value: Boolean) {
        context.dataStore.edit { it[KEY_REDUCED_MOTION] = value }
    }

    /** `typeKey` → `soundWire`. The channel is created by the caller, not here. */
    suspend fun setNotificationSound(typeKey: String, soundWire: String) {
        context.dataStore.edit { p ->
            val merged = decodeSounds(p[KEY_NOTIFICATION_SOUNDS]) + (typeKey to soundWire)
            p[KEY_NOTIFICATION_SOUNDS] = merged.entries
                .joinToString(PAIR_SEPARATOR) { "${it.key}=${it.value}" }
        }
    }

    suspend fun setNotificationPermissionAsked(value: Boolean) {
        context.dataStore.edit { it[KEY_PERMISSION_ASKED] = value }
    }

    private companion object {
        val KEY_BASE_URL = stringPreferencesKey("base_url")
        val KEY_RECENT = stringPreferencesKey("recent_addresses")
        val KEY_PALETTE = stringPreferencesKey("palette_id")
        val KEY_REDUCED_MOTION = booleanPreferencesKey("reduced_motion")
        val KEY_NOTIFICATION_SOUNDS = stringPreferencesKey("notification_sounds")
        val KEY_PERMISSION_ASKED = booleanPreferencesKey("notification_permission_asked")
        const val RECENT_SEPARATOR = "\u0001"
        const val PAIR_SEPARATOR = "\u0001"
        const val MAX_RECENT = 5

        /**
         * `key=value` pairs, because DataStore has no map type.
         *
         * Anything unparseable is dropped rather than throwing: a corrupted
         * preference must cost a sound choice, never the launch.
         */
        fun decodeSounds(stored: String?): Map<String, String> =
            stored?.split(PAIR_SEPARATOR)
                ?.mapNotNull { pair ->
                    val parts = pair.split('=', limit = 2)
                    if (parts.size == 2 && parts[0].isNotBlank()) parts[0] to parts[1] else null
                }
                ?.toMap()
                ?: emptyMap()
    }
}
