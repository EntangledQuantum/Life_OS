package com.lifeos.app.data.api

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * How long to wait, decided by the address.
 *
 * ## Why this file exists
 *
 * Until 2.0.2 the app had one set of deadlines for every server: connect 5s,
 * read 12s, call 15s, and 6s for anything the user was standing in front of
 * (§0.2). Those numbers were measured on a LAN, and on a LAN they are right —
 * a machine on the same Wi-Fi answers `/health` in single-digit milliseconds,
 * so a 6s probe that fails fast is the whole point of §7: making someone wait
 * thirty seconds for a laptop that is asleep is the bug, not the fix.
 *
 * But the same app is also reached from outside the house, through a Tailscale
 * Funnel and a reverse proxy, and there the numbers are not close. Measured
 * with `curl` **on the phone**, against `https://sunny.tailf9037f.ts.net/lifeos`:
 *
 * | Request | Observed total |
 * |---|---|
 * | TLS handshake alone | 1.4 – 1.7 s |
 * | `GET /lifeos/health` | 3.45, 3.66, 4.17, 5.61, 5.69 s |
 * | `GET /lifeos/api/v1/auth/me` | ~2 s |
 * | `POST /lifeos/api/v1/pair/claim` | 12.27, 13.85, 17.37 s |
 *
 * So the claim — which was given the **probe's** 6s — could never finish, not
 * once, no matter how many times the user scanned the QR. The app said
 * *"Couldn't reach that address (timed out)"*, which sent them to **Change
 * server** to fix an address that was correct. And `/health` at 3.4–5.7s
 * straddled its 6s limit, which is why that server read as *flaky* rather than
 * as consistently down: some probes came back 200 and some came back nothing.
 *
 * The fix is not a bigger number everywhere. It is to ask which server we are
 * talking to and spend the patience there.
 *
 * ## The two budgets
 *
 * [LOCAL] is the old set, unchanged, for a loopback / RFC 1918 / `.local`
 * address. [REMOTE] is everything else, sized off the table above with real
 * margin, because a public host's latency is not ours to predict and the cost
 * of being wrong is a user who cannot pair at all.
 */
data class Budget(
    val connectSeconds: Long,
    val readSeconds: Long,
    val writeSeconds: Long,
    /** The outer cap on one whole call, retries included. */
    val callSeconds: Long,
    /** A probe paints a status strip; the user is watching it. */
    val probeSeconds: Long,
    /** One user-initiated action, where waiting is the right answer. */
    val claimSeconds: Long,
) {

    /**
     * The probe's client: the same connect/read, a shorter cap on the whole call.
     *
     * A probe is a thing someone is standing in front of, so it gives up sooner
     * than an ordinary request — on a LAN noticeably sooner.
     */
    fun forProbe(): Budget = copy(callSeconds = probeSeconds)

    /**
     * The pairing claim's client.
     *
     * Its own budget, not the probe's. That substitution was the bug: a probe
     * paints a strip and can be retried by the next poll, while the claim is a
     * single irreversible user action with a five-minute code behind it, and
     * there is nothing else in the app that will have another go. The read and
     * write deadlines are lifted to match the call cap so a slow *server* —
     * which is what 12–17s is — cannot trip a read timeout before the budget
     * the user was actually promised has expired.
     */
    fun forClaim(): Budget = copy(
        callSeconds = claimSeconds,
        readSeconds = maxOf(readSeconds, claimSeconds),
        writeSeconds = maxOf(writeSeconds, claimSeconds),
    )

    companion object {

        /**
         * A machine on this network. §0.2's numbers, deliberately untouched.
         *
         * Nothing here is generous and nothing here should be: a sleeping laptop
         * on the same Wi-Fi has to fail fast, or every screen in the app waits
         * on it. The claim gets the ordinary call budget rather than the probe's
         * — on a LAN that is already ~1000× the measured round trip.
         */
        val LOCAL = Budget(
            connectSeconds = 5,
            readSeconds = 12,
            writeSeconds = 12,
            callSeconds = 15,
            probeSeconds = 6,
            claimSeconds = 15,
        )

        /**
         * A public or tunnelled host. Every number traces to a measurement.
         *
         *  - `connect` 15s — ~6× the 1.4–2.5s handshake, with room for DNS and
         *    for a Funnel ingress that has to warm up.
         *  - `call` 60s — **the number this release got wrong twice.** This is
         *    the poll's budget, and it is governed by the dashboard payload,
         *    not by the round trip: `GET /api/v1/dashboard/today` is **2.26 MB**
         *    on this instance (habit and goal art arrives as inline base64) and
         *    measured from the phone at 3.64, 10.92, 23.17 and 41.55 seconds —
         *    an order of magnitude of variance on one LTE connection in one
         *    evening. 30s was tried on the device and still reported `timeout`.
         *    Being generous here costs nothing the user can see, because the UI
         *    renders from Room and never waits on a socket (§7.1); being mean
         *    costs a status strip that says the server is unreachable while it
         *    is mid-download.
         *  - `read` 60s — OkHttp's read deadline is per byte-gap rather than
         *    total, so it is rarely the one that fires, but it must not sit
         *    under the call cap or it becomes the real limit by accident.
         *  - `probe` 15s — 2.6× the slowest `/health` (3.0–5.7s measured).
         *    Three probes run in sequence (§7.6) so a dead remote host costs
         *    45s of **Test**, which is a button the user pressed, with per-row
         *    results appearing as they land. `/health` is small, so it is not
         *    subject to the payload problem above.
         *  - `claim` 45s — 2.6× the 17.37s worst case. Also a small response.
         *    The margin is the point: the measurement is three samples on one
         *    evening of one network.
         */
        val REMOTE = Budget(
            connectSeconds = 15,
            readSeconds = 60,
            writeSeconds = 60,
            callSeconds = 60,
            probeSeconds = 15,
            claimSeconds = 45,
        )

        /**
         * The budget for an address — the one entry point, so no caller decides
         * this for itself.
         *
         * An address that will not parse gets [REMOTE]. That asymmetry is
         * deliberate: guessing LOCAL for something unrecognisable risks the
         * failure this release exists to fix (a correct address the app refuses
         * to wait for), while guessing REMOTE only risks waiting longer than
         * necessary for an address that was never going to work.
         */
        fun of(baseUrl: String?): Budget = if (Reach.isPrivate(baseUrl)) LOCAL else REMOTE

        /** The budget for one host — what the image loader has per request. */
        fun ofHost(host: String?): Budget =
            if (host != null && Reach.isPrivateHost(host)) LOCAL else REMOTE
    }
}

/**
 * Is this address on the user's own network?
 *
 * A **port** of `isPrivateHostname` in `apps/api/src/net.ts` — the server uses
 * the same ranges to decide which browser origins CORS may trust, and the two
 * answers have to agree about what "my own network" means or the app and the
 * server disagree about the same address. Copied rather than imported, like
 * `domain/Art` and `domain/Growth`: this folder is a standalone Gradle build
 * (see the isolation contract in the README), so a test is what keeps the copy
 * honest.
 *
 * **A tailnet address (`100.64.0.0/10`) is deliberately *not* private here**, and
 * that is not an oversight in the port — it is the same answer `net.ts` gives.
 * A `100.x` address is reached over WireGuard, which may be a direct path on the
 * same Wi-Fi or may be relayed through a DERP server on another continent, and
 * the app cannot tell which from the address. The honest budget for "I cannot
 * tell" is the generous one.
 */
object Reach {

    /** The host out of an address, then [isPrivateHost]. */
    fun isPrivate(baseUrl: String?): Boolean {
        val raw = baseUrl?.trim()?.takeIf { it.isNotEmpty() } ?: return false
        val url = raw.toHttpUrlOrNull()
            // `toHttpUrlOrNull` needs a scheme; the address field normalises one
            // on, but a bare host can still reach here from a stored value.
            ?: "http://$raw".toHttpUrlOrNull()
            ?: return false
        return isPrivateHost(url.host)
    }

    /** RFC 1918 / loopback / link-local — the addresses a home network uses. */
    fun isPrivateHost(hostname: String): Boolean {
        val host = hostname.lowercase().removeSurrounding("[", "]")
        if (host == "localhost" || host.endsWith(".localhost")) return true
        // mDNS names, e.g. macbook.local
        if (host.endsWith(".local")) return true
        if (host == "::1") return true
        // IPv6 link-local (fe80::/10) and unique-local (fc00::/7)
        if (IPV6_PRIVATE.matches(host)) return true

        val v4 = IPV4.matchEntire(host) ?: return false
        val a = v4.groupValues[1].toIntOrNull() ?: return false
        val b = v4.groupValues[2].toIntOrNull() ?: return false
        if (a == 127 || a == 10) return true
        if (a == 192 && b == 168) return true
        if (a == 172 && b in 16..31) return true
        if (a == 169 && b == 254) return true // link-local
        return false
    }

    private val IPV6_PRIVATE = Regex("^(fe80|fc|fd)[0-9a-f:]*$", RegexOption.IGNORE_CASE)
    private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")
}
