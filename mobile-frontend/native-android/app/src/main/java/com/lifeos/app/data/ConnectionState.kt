package com.lifeos.app.data

import com.lifeos.app.data.api.ProtocolMismatchDto
import com.lifeos.app.data.api.Reach

/**
 * The connection state machine (UI_SPEC §7.2).
 *
 * ```
 * Unconfigured ─connect/pair─► Probing ─ok─► Online
 *                                 │           │  │
 *                                 │           │  └─ poll fails ─► Stale ─3 fails─► Unreachable
 *                                 │           └─ 401 ──────────────────────────────► Unauthorized
 *                                 └─ 426 ───────────────────────────────────────────► Outdated
 * Unreachable ─any success─► Online     Unauthorized ─re-enter token─► Probing
 * ```
 *
 * One observable state, rendered by one strip and one error panel. The old app
 * had the network as the source of truth, so every failure became an error panel
 * and there was no such thing as "stale but usable".
 */
sealed interface ConnectionState {

    /** No address, or no token. The connect graph owns the screen. */
    data object Unconfigured : ConnectionState

    /** A probe is in flight. Transient; the cached snapshot still renders. */
    data object Probing : ConnectionState

    /** Last poll succeeded. **No strip at all** — success is silent. */
    data object Online : ConnectionState

    /** 1–2 consecutive failures with a cache under 10 minutes old. */
    data class Stale(val failures: Int, val fetchedAt: Long?) : ConnectionState

    /** 3+ failures, or a cache far older than the poll interval. */
    data class Unreachable(val failures: Int, val fetchedAt: Long?, val detail: String?) :
        ConnectionState

    /** `401`. The token is cleared; connect opens with the address prefilled. */
    data object Unauthorized : ConnectionState

    /** `426`. A full-screen block, because nothing in the app can work. */
    data class Outdated(val mismatch: ProtocolMismatchDto) : ConnectionState

    /** Whether the status strip should be drawn at all. */
    val showsStrip: Boolean
        get() = this is Stale || this is Unreachable

    companion object {
        /** Stale becomes Unreachable at the third consecutive failure. */
        const val UNREACHABLE_AFTER_FAILURES = 3

        /** A cache older than this is Unreachable regardless of the count. */
        const val STALE_CACHE_LIMIT_MS = 10 * 60 * 1000L

        /**
         * Classify a run of failures. One function, so the strip's wording and
         * the state can never disagree about which one it is.
         */
        fun afterFailure(
            failures: Int,
            fetchedAt: Long?,
            now: Long,
            detail: String?,
        ): ConnectionState {
            val age = fetchedAt?.let { now - it }
            val tooOld = age != null && age > STALE_CACHE_LIMIT_MS
            return if (failures >= UNREACHABLE_AFTER_FAILURES || tooOld || fetchedAt == null) {
                Unreachable(failures, fetchedAt, detail)
            } else {
                Stale(failures, fetchedAt)
            }
        }
    }
}

/**
 * Poll intervals per destination (§7.1), and how far apart they go when the
 * server is not on this network (§7.9).
 *
 * The poll runs while a destination is resumed and stops when the process is
 * backgrounded. It is never started from a composition.
 */
object PollIntervals {
    const val TODAY_MS = 8_000L
    const val DAY_MS = 10_000L
    const val YOU_MS = 15_000L

    /**
     * How much further apart the ticks go for a public or tunnelled server.
     *
     * Eight seconds is right for a LAN, where a refetch costs ~50ms and the
     * radio is barely touched. It is wrong for a server across the internet:
     * this user's dashboard payload is **2.26 MB** and measured from the phone
     * at 3.64, 10.92, 23.17 and 41.55 seconds, so an 8s tick means a download
     * is permanently in flight — a continuous stream on mobile data, for a
     * screen nobody reads that fast. Four times the interval gives the radio
     * somewhere to idle at the median fetch without the dashboard going stale.
     *
     * It is a mitigation, not a cure. The cure is a dashboard payload that does
     * not carry every habit's artwork as inline base64 on every poll, and that
     * lives in the API, not in this app.
     *
     * This is the second half of the fix; the first is that a tick whose
     * predecessor is still running is dropped rather than stacked
     * (`LifeOsRepository.refresh`). Neither alone is enough: coalescing without
     * this still leaves a request always in flight, and this without
     * coalescing still stacks whenever a fetch runs long.
     */
    const val REMOTE_MULTIPLIER = 4

    /**
     * The interval to actually use for [base], given the configured address.
     *
     * One function, so the three destinations cannot disagree about what "far
     * away" means — and so that "Change server" changes the poll rate at the
     * same moment it changes everything else.
     */
    fun forAddress(baseUrl: String?, base: Long): Long =
        if (Reach.isPrivate(baseUrl)) base else base * REMOTE_MULTIPLIER

    /**
     * How long an empty cache is given before it becomes a panel (§3).
     *
     * Same reasoning, same predicate. A flat six seconds against a server whose
     * first fetch legitimately takes 6.8–15.2s put *"Waiting for today's
     * dashboard"* and a **Change server** button in front of a user whose
     * dashboard was on its way — observed on the device, which is how this one
     * was found.
     */
    fun emptyCacheTimeout(baseUrl: String?, base: Long): Long = forAddress(baseUrl, base)
}
