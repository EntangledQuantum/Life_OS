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

    private companion object {
        val KEY_BASE_URL = stringPreferencesKey("base_url")
        val KEY_RECENT = stringPreferencesKey("recent_addresses")
        val KEY_PALETTE = stringPreferencesKey("palette_id")
        val KEY_REDUCED_MOTION = booleanPreferencesKey("reduced_motion")
        const val RECENT_SEPARATOR = "\u0001"
        const val MAX_RECENT = 5
    }
}
