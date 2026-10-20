package com.lifeos.app.domain

import com.lifeos.app.data.api.AddressInput
import java.net.URLDecoder

/**
 * A scanned pairing: the code, and the address it told us to point at.
 *
 * **`toString` never prints the code.** The code is a credential — it is
 * exchanged for the API token — and the cheapest way for it to end up in a log
 * is a data class interpolated into a message by someone debugging something
 * else. Nothing in this app logs it on purpose; this makes the accident
 * harmless too.
 */
data class PairInvite(val code: String, val baseUrl: String) {
    override fun toString(): String = "PairInvite(code=***, baseUrl=$baseUrl)"
}

/**
 * The `lifeos://pair?code=…&url=…` deep link, parsed (UI_SPEC §7.3).
 *
 * Pure Kotlin — no `android.net.Uri` — for two reasons. It is unit-testable
 * without a device, and `Uri.parse` is one of the methods a JVM unit test gets
 * as a stub, so a parser built on it is a parser that cannot be tested where
 * the rest of this logic is.
 *
 * Both forms the server mints land here as the same string. `apps/web`'s pair
 * page hands Android an `intent://pair?…#Intent;scheme=lifeos;package=…;end`
 * URL because Chrome will not follow a bare custom scheme from a page it did
 * not navigate to — but the OS resolves that to an intent whose data is
 * `lifeos://pair?…`, so the Activity sees the scheme form either way and there
 * is exactly one parser.
 *
 * `connect` is accepted beside `pair` because QRs minted by older servers used
 * it, and a QR on someone's screen outlives the release that drew it.
 */
object PairLink {

    const val SCHEME = "lifeos"

    /** Every host the server can mint, now or in the past. */
    val HOSTS: Set<String> = setOf("pair", "connect")

    /**
     * The server's code alphabet is `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — no
     * `O`/`0`, no `I`/`l`/`1`, because people fall back to typing it when a QR
     * fails. Matched case-insensitively and upper-cased, since the claim
     * endpoint upper-cases before comparing and a lower-case scan is a valid
     * scan. Mirrors `apps/web/src/pages/PairPage.tsx`.
     */
    private val CODE = Regex("^[A-Za-z2-9]{6,32}$")

    /**
     * Parse, or return null.
     *
     * Null for anything that is not unambiguously one of our pairing links:
     * another scheme, another host, a missing code, a code that is not a code,
     * an address that does not normalise. A deep link is attacker-reachable —
     * any app or any web page can fire one at us — so nothing here guesses, and
     * the worst a hostile link can do is send one request to an address the
     * user can see on screen before anything is saved.
     */
    fun parse(raw: String?): PairInvite? {
        val text = raw?.trim().orEmpty()
        if (text.isEmpty()) return null

        val mark = text.indexOf("://")
        if (mark <= 0) return null
        if (!text.regionMatches(0, SCHEME, 0, mark, ignoreCase = true)) return null

        // A fragment is never ours: the web fallback keeps its code in one
        // (`/pair#c=CODE`) precisely so it never reaches a server, and the
        // intent form's `#Intent;…` tail is the OS's, not a parameter.
        val body = text.substring(mark + 3).substringBefore('#')
        val host = body.substringBefore('?').trim('/')
        if (host.lowercase() !in HOSTS) return null

        val query = body.substringAfter('?', "")
        if (query.isEmpty()) return null

        val params = HashMap<String, String>()
        query.split('&').forEach { pair ->
            if (pair.isBlank()) return@forEach
            val name = pair.substringBefore('=')
            val value = pair.substringAfter('=', "")
            if (name.isNotBlank() && value.isNotBlank() && name !in params) {
                params[name] = decode(value)
            }
        }

        val code = params["code"]?.takeIf { CODE.matches(it) }?.uppercase() ?: return null
        val baseUrl = params["url"]?.let { AddressInput.normalise(it) } ?: return null

        return PairInvite(code = code, baseUrl = baseUrl)
    }

    /**
     * Percent-decoding, and only that.
     *
     * `URLDecoder` also turns `+` into a space, which is the form-encoding rule
     * and not the URL one. `encodeURIComponent` never emits a bare `+`, so the
     * difference only ever shows up on a hand-written link — where turning a
     * plus in a host name into a space would produce a baffling failure rather
     * than an honest one.
     */
    private fun decode(value: String): String =
        runCatching { URLDecoder.decode(value.replace("+", "%2B"), "UTF-8") }.getOrDefault(value)
}
