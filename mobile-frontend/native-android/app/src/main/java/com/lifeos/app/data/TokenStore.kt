package com.lifeos.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.MasterKey

/**
 * Where a request's bearer token comes from.
 *
 * Narrow on purpose: the OkHttp interceptor needs exactly one method, and the
 * server screen needs to test a token the user has typed but not saved without
 * touching the Keystore or overwriting what is stored. Two implementations,
 * [TokenStore] and [StaticToken], and nothing else may read the token.
 */
interface TokenSource {
    fun token(): String?

    /** Whether there is a token to send at all. */
    fun hasToken(): Boolean = !token().isNullOrBlank()

    /** Called on `401`, and on Disconnect. Never retried in a loop around it. */
    fun clear() {}
}

/** A token the user has typed but not saved. Never persisted. */
class StaticToken(private val value: String) : TokenSource {
    override fun token(): String? = value.ifBlank { null }
}

/**
 * The API token, in Keystore-backed `EncryptedSharedPreferences`.
 *
 * Never in plain DataStore, never in a log line, never in a crash report (there
 * are no crash reports). The token is the only credential there is — there is no
 * username/password anywhere in this product, and `POST /auth/login` is `410`.
 *
 * Nothing in this class returns the token in a `toString()`, and nothing
 * anywhere in the app logs it, even at debug level. If you are adding a log line
 * near a request, log the *address*, never the header.
 */
class TokenStore(context: Context) : TokenSource {

    private val prefs: SharedPreferences by lazy {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE,
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * An in-memory mirror so the OkHttp interceptor does not touch disk (and the
     * Keystore) on every request. Written only through [save] and [clear].
     */
    @Volatile
    private var cached: String? = null

    @Volatile
    private var loaded = false

    override fun token(): String? {
        if (!loaded) {
            cached = runCatching { prefs.getString(KEY_TOKEN, null) }.getOrNull()
            loaded = true
        }
        return cached
    }

    fun save(token: String) {
        prefs.edit { putString(KEY_TOKEN, token) }
        cached = token
        loaded = true
    }

    override fun clear() {
        prefs.edit { remove(KEY_TOKEN) }
        cached = null
        loaded = true
    }

    private companion object {
        const val FILE = "lifeos_secure"
        const val KEY_TOKEN = "api_token"
    }
}
